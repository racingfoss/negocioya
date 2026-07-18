from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from statistics import median
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from . import models


# ---------------------------------------------------------------------------
# Configuración del negocio: fila única (singleton, id fijo = 1). Reemplaza a
# los "números mágicos" que antes eran constantes de módulo acá mismo
# (DEMANDA_VENTANA_DIAS, LEAD_TIME_DEFAULT_DIAS, SAFETY_DAYS,
# UMBRAL_CAMBIO_COSTO_PCT, y varios hardcodeados sueltos en Stock/Análisis) —
# ver la tabla completa y sus defaults en CLAUDE.md. Se crea con esos mismos
# defaults en el primer uso (bootstrap), así que aplicar esto no cambia ningún
# comportamiento hasta que la usuaria edite algo desde Configuración.
# ---------------------------------------------------------------------------
def get_configuracion(db: Session) -> models.Configuracion:
    config = db.get(models.Configuracion, 1)
    if not config:
        config = models.Configuracion(id=1)
        db.add(config)
        db.commit()
        db.refresh(config)
    return config


# ---------------------------------------------------------------------------
# Costo promedio ponderado: se recalcula solo cada vez que cambian las compras
# de un producto. Es el método estándar (PPP) para productos con reposiciones
# a distinto costo a lo largo del tiempo.
#
# Productos con variantes (tiene_variantes=True): el costo NO se trackea por
# variante — se promedia entre TODAS las compras del producto sin importar qué
# variante puntual se compró, exactamente igual que un producto sin variantes.
# Se descartó el costo por variante (aunque el pedido original lo pedía, con el
# argumento de que un talle XL podría consumir más tela) porque en el uso real
# el costo no varía entre talle/color de un mismo producto.
# ---------------------------------------------------------------------------
def recalcular_costo_promedio(db: Session, producto_id: int) -> None:
    producto = db.get(models.Producto, producto_id)
    if not producto:
        return

    compras = db.query(models.Compra).filter(models.Compra.producto_id == producto_id).all()
    total_unidades = sum(c.cantidad for c in compras)
    if total_unidades > 0:
        total_costo = sum(float(c.cantidad) * float(c.costo_unitario) for c in compras)
        producto.costo = round(total_costo / total_unidades, 2)
        db.commit()


# ---------------------------------------------------------------------------
# Simulación de compra: no escribe nada en la base, es solo una proyección
# para mostrar antes de confirmar.
#
# El aviso de "¿actualizamos el precio de venta?" se dispara comparando contra
# el COSTO DE REPOSICIÓN (costo_unitario de la última Compra registrada), no
# contra el promedio ponderado. Motivo: con mucho stock acumulado a costo
# viejo, una compra nueva bastante más cara casi no mueve el promedio, y el
# aviso no se disparaba aunque el costo de reposición hubiera saltado fuerte
# (ver CLAUDE.md). El promedio ponderado (`diferencia_vs_promedio_pct`) se
# sigue calculando e informando como dato contable adicional, pero ya no
# decide el umbral ni el precio sugerido.
#
# El costo se evalúa siempre a nivel PRODUCTO (con o sin variantes): el precio
# de venta y el costo promedio son compartidos entre todas las variantes de un
# producto (ver nota en recalcular_costo_promedio).
# ---------------------------------------------------------------------------
def simular_compra(db: Session, producto_id: int, cantidad: int, costo_unitario: float) -> Optional[dict]:
    producto = db.get(models.Producto, producto_id)
    if not producto:
        return None

    umbral_cambio_costo_pct = float(get_configuracion(db).umbral_cambio_costo_pct)

    compras = db.query(models.Compra).filter(models.Compra.producto_id == producto_id).all()
    total_unidades_actual = sum(c.cantidad for c in compras)
    total_costo_actual = sum(float(c.cantidad) * float(c.costo_unitario) for c in compras)
    costo_promedio_actual = (
        round(total_costo_actual / total_unidades_actual, 2) if total_unidades_actual > 0 else float(producto.costo)
    )

    nuevas_unidades = total_unidades_actual + cantidad
    nuevo_costo_total = total_costo_actual + cantidad * costo_unitario
    costo_promedio_nuevo = round(nuevo_costo_total / nuevas_unidades, 2) if nuevas_unidades > 0 else costo_unitario

    diferencia_vs_promedio_pct = (
        round((costo_promedio_nuevo - costo_promedio_actual) / costo_promedio_actual * 100, 2)
        if costo_promedio_actual else 0.0
    )

    ultima_compra = (
        db.query(models.Compra)
        .filter(models.Compra.producto_id == producto_id)
        .order_by(models.Compra.fecha.desc(), models.Compra.id.desc())
        .first()
    )
    costo_ultima_compra = float(ultima_compra.costo_unitario) if ultima_compra else None
    diferencia_vs_ultima_compra_pct = (
        round((costo_unitario - costo_ultima_compra) / costo_ultima_compra * 100, 2)
        if costo_ultima_compra else None
    )

    precio_actual = float(producto.precio_venta)
    pct_para_precio = diferencia_vs_ultima_compra_pct if diferencia_vs_ultima_compra_pct is not None else 0.0
    precio_sugerido = round(precio_actual * (1 + pct_para_precio / 100), 2)

    return {
        "producto_id": producto_id,
        "producto": producto.nombre,
        "costo_promedio_actual": costo_promedio_actual,
        "costo_promedio_nuevo": costo_promedio_nuevo,
        "costo_ultima_compra": costo_ultima_compra,
        "diferencia_vs_ultima_compra_pct": diferencia_vs_ultima_compra_pct,
        "diferencia_vs_promedio_pct": diferencia_vs_promedio_pct,
        "supera_umbral": (
            diferencia_vs_ultima_compra_pct is not None and abs(diferencia_vs_ultima_compra_pct) > umbral_cambio_costo_pct
        ),
        "precio_venta_actual": precio_actual,
        "precio_venta_sugerido": precio_sugerido,
    }


# ---------------------------------------------------------------------------
# Resuelve la Variante de un producto que corresponde exactamente a una
# combinación de valores de atributo (por sus valor_atributo_id), creándola si
# todavía no existe. Reutilizado por POST /productos/{id}/variantes/generar
# (una combinación por cada iteración del producto cartesiano) y por la
# importación de Excel (una combinación por fila con atributos completos).
# No hace commit — el caller decide cuándo confirmar la transacción.
# ---------------------------------------------------------------------------
def resolver_o_crear_variante(db: Session, producto_id: int, valor_ids: list[int]) -> models.Variante:
    clave = frozenset(valor_ids)
    variantes_existentes = (
        db.query(models.Variante)
        .options(joinedload(models.Variante.valores))
        .filter(models.Variante.producto_id == producto_id)
        .all()
    )
    for v in variantes_existentes:
        if frozenset(vv.valor_atributo_id for vv in v.valores) == clave:
            return v

    variante = models.Variante(producto_id=producto_id)
    db.add(variante)
    db.flush()
    for valor_id in valor_ids:
        db.add(models.VarianteValor(variante_id=variante.id, valor_atributo_id=valor_id))
    db.flush()
    return variante


# ---------------------------------------------------------------------------
# Panel de control: caja
# "Venta" e "Ingreso" suman a la caja; "Egreso" resta.
# ---------------------------------------------------------------------------
def get_caja_actual(db: Session) -> dict:
    ingresos = db.query(
        func.coalesce(func.sum(models.Movimiento.monto), 0)
    ).filter(models.Movimiento.tipo.in_(["Venta", "Ingreso"])).scalar()
    egresos = db.query(
        func.coalesce(func.sum(models.Movimiento.monto), 0)
    ).filter(models.Movimiento.tipo == "Egreso").scalar()
    ingresos, egresos = float(ingresos), float(egresos)
    return {
        "ingresos_reales": ingresos,
        "egresos_reales": egresos,
        "caja_actual": ingresos - egresos,
    }


# ---------------------------------------------------------------------------
# Subcategorías: adjacency list simple (`parent_id`) + recursión en Python.
# Sin materialized path ni nested sets — poco volumen de datos para una sola
# persona, no vale la complejidad extra.
# ---------------------------------------------------------------------------
def validar_no_ciclo(db: Session, categoria_id: int, nuevo_parent_id: Optional[int]) -> bool:
    """True si asignar `nuevo_parent_id` como padre de `categoria_id` NO genera un ciclo
    (una categoría no puede terminar siendo ancestro de sí misma)."""
    if nuevo_parent_id is None:
        return True
    if nuevo_parent_id == categoria_id:
        return False
    actual_id = nuevo_parent_id
    visitados = set()
    while actual_id is not None:
        if actual_id == categoria_id:
            return False
        if actual_id in visitados:
            break
        visitados.add(actual_id)
        padre = db.get(models.Categoria, actual_id)
        actual_id = padre.parent_id if padre else None
    return True


def categorias_arbol(db: Session) -> list:
    """Estructura anidada (para la vista de árbol del frontend)."""
    categorias = db.query(models.Categoria).order_by(models.Categoria.nombre).all()
    por_id = {
        c.id: {"id": c.id, "nombre": c.nombre, "descripcion": c.descripcion, "parent_id": c.parent_id, "hijos": []}
        for c in categorias
    }
    raices = []
    for c in categorias:
        nodo = por_id[c.id]
        if c.parent_id and c.parent_id in por_id:
            por_id[c.parent_id]["hijos"].append(nodo)
        else:
            raices.append(nodo)
    return raices


def _cadena_categorias(categoria_id: int, categorias_todas: dict) -> list:
    """De `categoria_id` hacia arriba (incluido), sin repetir."""
    cadena = []
    visitados = set()
    actual_id = categoria_id
    while actual_id is not None and actual_id not in visitados:
        visitados.add(actual_id)
        cadena.append(actual_id)
        cat = categorias_todas.get(actual_id)
        actual_id = cat.parent_id if cat else None
    return cadena


def _categorias_objetivo(categoria_id: Optional[int], categorias_todas: dict, rollup: bool) -> list:
    """A qué categoría(s) hay que sumarle los números de un producto con esta categoria_id.
    Sin rollup: solo la propia (comportamiento de siempre, a nivel hoja).
    Con rollup: la propia + todos sus ancestros (para que "Ropa de fiesta" sume lo de "Vestido" y
    lo de "Corto"/"Largo" debajo)."""
    if categoria_id is None:
        return [None]
    return _cadena_categorias(categoria_id, categorias_todas) if rollup else [categoria_id]


def _nombre_categoria(categoria_id: Optional[int], categorias_todas: dict) -> str:
    return categorias_todas[categoria_id].nombre if categoria_id in categorias_todas else "Sin categoría"


# ---------------------------------------------------------------------------
# Punto de equilibrio ponderado (mix de productos activos, en $ de facturación)
#
# Dos modos para el mix_pct de cada producto:
# - "real" (default): sale de la facturación real de cada producto en los
#   últimos `dias` días (Movimiento tipo "Venta"), no de un valor cargado a
#   mano. Se prefiere sobre el manual porque una vez que hay ventas cargadas,
#   mantener mix_pct actualizado a mano es una carga extra que nadie va a
#   sostener semana a semana, y se desactualiza. Un producto sin ventas en la
#   ventana da 0% (correcto: si no se vendió, no debería pesar en el mix).
# - "manual": usa producto.mix_pct tal cual está cargado en el Catálogo. Sigue
#   siendo necesario para productos nuevos sin historial, o para simular
#   escenarios ("¿y si este producto vendiera más?"). Ver CLAUDE.md.
# ---------------------------------------------------------------------------
def punto_equilibrio_ponderado(db: Session, modo: str = "real", dias: int = 30) -> dict:
    productos = db.query(models.Producto).filter(models.Producto.activo.is_(True)).all()
    costos_fijos_total = float(
        db.query(func.coalesce(func.sum(models.CostoFijo.monto), 0)).scalar()
    )

    if not productos:
        return {"error": "No hay productos activos cargados en el catálogo."}

    facturacion_ventana = {}
    if modo == "real":
        facturacion_ventana = facturacion_por_producto(db, dias=dias)
        facturacion_total_ventana = sum(facturacion_ventana.values())
        if facturacion_total_ventana <= 0:
            return {
                "error": f"No hay ventas registradas en los últimos {dias} días. "
                         "Probá con una ventana más amplia o usá el modo manual."
            }

    mix_por_producto = {}
    for p in productos:
        if modo == "real":
            mix_por_producto[p.id] = (facturacion_ventana.get(p.id, 0.0) / facturacion_total_ventana) * 100
        else:
            mix_por_producto[p.id] = float(p.mix_pct)

    mix_total = sum(mix_por_producto.values())

    margen_ponderado = 0.0
    detalle = []
    for p in productos:
        precio = float(p.precio_venta)
        costo = float(p.costo)
        mix = mix_por_producto[p.id]
        margen_pct = (precio - costo) / precio if precio else 0
        margen_ponderado += (mix / 100) * margen_pct
        item = {
            "producto_id": p.id,
            "producto": p.nombre,
            "mix_pct": round(mix, 2),
            "precio_venta": precio,
            "costo": costo,
            "margen_pct": round(margen_pct * 100, 2),
        }
        if modo == "real":
            item["facturacion_ventana"] = round(facturacion_ventana.get(p.id, 0.0), 2)
        detalle.append(item)

    if margen_ponderado <= 0:
        return {"error": "El margen ponderado es cero o negativo. Revisá precios y costos cargados."}

    facturacion_minima = costos_fijos_total / margen_ponderado

    unidades_totales = 0
    for item in detalle:
        monto_asignado = facturacion_minima * (item["mix_pct"] / 100)
        unidades = monto_asignado / item["precio_venta"] if item["precio_venta"] else 0
        item["unidades_requeridas"] = round(unidades)
        item["facturacion_asignada"] = round(monto_asignado, 2)
        unidades_totales += item["unidades_requeridas"]

    return {
        "modo": modo,
        "dias": dias if modo == "real" else None,
        "costos_fijos_total": costos_fijos_total,
        "margen_ponderado_pct": round(margen_ponderado * 100, 2),
        "facturacion_minima_requerida": round(facturacion_minima, 2),
        "unidades_totales_requeridas": unidades_totales,
        "mix_total_pct": round(mix_total, 2),
        "detalle": detalle,
    }


# ---------------------------------------------------------------------------
# Utilidad: unidades vendidas por producto (ventana de días opcional)
# Solo cuenta movimientos tipo "Venta".
# ---------------------------------------------------------------------------
def unidades_vendidas_por_producto(db: Session, dias: Optional[int] = None) -> dict:
    q = db.query(
        models.Movimiento.producto_id,
        func.coalesce(func.sum(models.Movimiento.cantidad), 0).label("unidades"),
    ).filter(
        models.Movimiento.tipo == "Venta",
        models.Movimiento.producto_id.isnot(None),
    )
    if dias:
        desde = datetime.utcnow() - timedelta(days=dias)
        q = q.filter(models.Movimiento.fecha >= desde)
    q = q.group_by(models.Movimiento.producto_id)
    return {row.producto_id: int(row.unidades) for row in q.all()}


# ---------------------------------------------------------------------------
# Facturación por producto (ventana de días opcional), para el modo "real" del
# mix% del Punto de Equilibrio Ponderado. Mismo patrón de query que
# unidades_vendidas_por_producto, pero sumando `monto` en vez de `cantidad` —
# función separada a propósito, no se toca unidades_vendidas_por_producto
# porque la usan BCG, Stock y Sell-through.
# ---------------------------------------------------------------------------
def facturacion_por_producto(db: Session, dias: Optional[int] = None) -> dict:
    q = db.query(
        models.Movimiento.producto_id,
        func.coalesce(func.sum(models.Movimiento.monto), 0).label("monto"),
    ).filter(
        models.Movimiento.tipo == "Venta",
        models.Movimiento.producto_id.isnot(None),
    )
    if dias:
        desde = datetime.utcnow() - timedelta(days=dias)
        q = q.filter(models.Movimiento.fecha >= desde)
    q = q.group_by(models.Movimiento.producto_id)
    return {row.producto_id: float(row.monto) for row in q.all()}


def unidades_vendidas_por_variante(db: Session, dias: Optional[int] = None) -> dict:
    q = db.query(
        models.Movimiento.variante_id,
        func.coalesce(func.sum(models.Movimiento.cantidad), 0).label("unidades"),
    ).filter(
        models.Movimiento.tipo == "Venta",
        models.Movimiento.variante_id.isnot(None),
    )
    if dias:
        desde = datetime.utcnow() - timedelta(days=dias)
        q = q.filter(models.Movimiento.fecha >= desde)
    q = q.group_by(models.Movimiento.variante_id)
    return {row.variante_id: int(row.unidades) for row in q.all()}


# ---------------------------------------------------------------------------
# Matriz BCG: margen (%) vs volumen vendido, umbral = mediana
# ---------------------------------------------------------------------------
def matriz_bcg(db: Session, dias: int = 30) -> dict:
    productos = db.query(models.Producto).filter(models.Producto.activo.is_(True)).all()
    if not productos:
        return {"error": "No hay productos activos cargados en el catálogo."}

    ventas = unidades_vendidas_por_producto(db, dias=dias)

    items = []
    for p in productos:
        precio = float(p.precio_venta)
        costo = float(p.costo)
        margen_pct = (precio - costo) / precio * 100 if precio else 0
        volumen = ventas.get(p.id, 0)
        items.append({
            "producto_id": p.id,
            "producto": p.nombre,
            "categoria": p.categoria.nombre if p.categoria else "Sin categoría",
            "categoria_id": p.categoria_id,
            "margen_pct": round(margen_pct, 2),
            "volumen": volumen,
        })

    margenes = [i["margen_pct"] for i in items]
    volumenes = [i["volumen"] for i in items]
    margen_mediano = median(margenes) if margenes else 0
    volumen_mediano = median(volumenes) if volumenes else 0

    for i in items:
        alto_margen = i["margen_pct"] >= margen_mediano
        alto_volumen = i["volumen"] >= volumen_mediano
        if alto_margen and alto_volumen:
            cuadrante = "Estrella"
        elif not alto_margen and alto_volumen:
            cuadrante = "Vaca"
        elif alto_margen and not alto_volumen:
            cuadrante = "Incognita"
        else:
            cuadrante = "Perro"
        i["cuadrante"] = cuadrante

    return {
        "margen_mediano_pct": round(margen_mediano, 2),
        "volumen_mediano": volumen_mediano,
        "dias_analizados": dias,
        "items": items,
    }


# ---------------------------------------------------------------------------
# Stock actual (calculado) = total comprado - total vendido.
#
# Antigüedad en stock (rotación): FIFO — se "consumen" primero las compras
# más viejas, y la antigüedad se mide desde la compra más vieja que todavía
# tiene unidades sin vender.
#
# Cobertura (para saber si se va a quedar sin stock): Days-of-Cover.
#   demanda_media_diaria = unidades vendidas en los últimos 90 días / 90
#   dias_cobertura = stock_actual / demanda_media_diaria
#   umbral de reposición = lead_time_dias (por producto, default 7) + colchón fijo de 3 días
# Badge de color: verde > 30 días, ámbar 7–30, rojo < 7 (o "reponer" si cae
# por debajo de su propio umbral de lead time, aunque esté en zona ámbar).
# ---------------------------------------------------------------------------
def _fifo_dias_en_stock(compras: list, vendido: int, hoy: date) -> Optional[int]:
    compras_ordenadas = sorted(compras, key=lambda c: c.fecha)
    restante_a_descontar = vendido
    for c in compras_ordenadas:
        if restante_a_descontar >= c.cantidad:
            restante_a_descontar -= c.cantidad
            continue
        # esta es la compra más vieja que todavía tiene stock sin vender
        return (hoy - c.fecha).days
    return None  # todo el stock comprado ya se vendió (o no hay compras)


def _estado_stock(
    stock_actual: int, dias_cobertura: Optional[float], umbral_reposicion: int,
    dias_verde: int, dias_rojo: int,
) -> tuple[str, bool]:
    if stock_actual <= 0:
        return "Sin stock", True
    if dias_cobertura is None:
        return "Sin ventas recientes", False
    necesita_reponer = dias_cobertura <= umbral_reposicion
    if dias_cobertura < dias_rojo:
        return "Crítico", True
    if dias_cobertura <= dias_verde:
        return "Próximo a agotarse" if necesita_reponer else "Atención", necesita_reponer
    return "OK", False


def stock_por_producto(db: Session) -> list:
    config = get_configuracion(db)
    productos = db.query(models.Producto).filter(models.Producto.activo.is_(True)).all()
    ventas_total = unidades_vendidas_por_producto(db, dias=None)
    ventas_ventana = unidades_vendidas_por_producto(db, dias=config.demanda_ventana_dias)
    hoy = date.today()

    resultado = []
    for p in productos:
        compras = db.query(models.Compra).filter(models.Compra.producto_id == p.id).all()
        total_comprado = sum(c.cantidad for c in compras)
        total_vendido = ventas_total.get(p.id, 0)
        stock_actual = total_comprado - total_vendido
        dias_en_stock = _fifo_dias_en_stock(compras, total_vendido, hoy) if stock_actual > 0 else None
        alerta_rotacion = dias_en_stock is not None and dias_en_stock > config.rotacion_alerta_dias

        vendido_ventana = ventas_ventana.get(p.id, 0)
        demanda_media_diaria = round(vendido_ventana / config.demanda_ventana_dias, 3)
        dias_cobertura = round(stock_actual / demanda_media_diaria, 1) if demanda_media_diaria > 0 else None
        umbral_reposicion = (p.lead_time_dias or config.lead_time_default_dias) + config.safety_days
        estado_stock, necesita_reponer = _estado_stock(
            stock_actual, dias_cobertura, umbral_reposicion, config.stock_dias_verde, config.stock_dias_rojo
        )

        resultado.append({
            "producto_id": p.id,
            "producto": p.nombre,
            "categoria": p.categoria.nombre if p.categoria else "Sin categoría",
            "stock_actual": stock_actual,
            "total_comprado": total_comprado,
            "total_vendido": total_vendido,
            "costo_promedio": float(p.costo),
            "dias_en_stock": dias_en_stock,
            "alerta_rotacion_90_dias": alerta_rotacion,
            "demanda_media_diaria": demanda_media_diaria,
            "dias_cobertura": dias_cobertura,
            "lead_time_dias": p.lead_time_dias or config.lead_time_default_dias,
            "estado_stock": estado_stock,
            "necesita_reponer": necesita_reponer,
        })

    resultado.sort(key=lambda x: (x["dias_cobertura"] is None, x["dias_cobertura"] if x["dias_cobertura"] is not None else 9999))
    return resultado


def stock_por_categoria(db: Session, rollup: bool = False) -> list:
    config = get_configuracion(db)
    items = stock_por_producto(db)
    productos_cat = dict(db.query(models.Producto.id, models.Producto.categoria_id).all())
    categorias_todas = {c.id: c for c in db.query(models.Categoria).all()}

    categorias: dict = {}
    for i in items:
        cat_id = productos_cat.get(i["producto_id"])
        for target in _categorias_objetivo(cat_id, categorias_todas, rollup):
            cat = categorias.setdefault(target, {
                "categoria": _nombre_categoria(target, categorias_todas),
                "stock_actual": 0, "cantidad_productos": 0, "demanda_media_diaria": 0.0,
            })
            cat["stock_actual"] += i["stock_actual"]
            cat["cantidad_productos"] += 1
            cat["demanda_media_diaria"] += i["demanda_media_diaria"]

    resultado = list(categorias.values())
    for c in resultado:
        c["demanda_media_diaria"] = round(c["demanda_media_diaria"], 3)
        dias_cobertura = (
            round(c["stock_actual"] / c["demanda_media_diaria"], 1) if c["demanda_media_diaria"] > 0 else None
        )
        c["dias_cobertura"] = dias_cobertura
        estado, _ = _estado_stock(
            c["stock_actual"], dias_cobertura, config.lead_time_default_dias + config.safety_days,
            config.stock_dias_verde, config.stock_dias_rojo,
        )
        c["estado_stock"] = estado

    resultado.sort(key=lambda x: (x["dias_cobertura"] is None, x["dias_cobertura"] if x["dias_cobertura"] is not None else 9999))
    return resultado


# ---------------------------------------------------------------------------
# Stock por variante: mismo cálculo que stock_por_producto (compras - ventas,
# FIFO para antigüedad, days-of-cover), pero agrupado por variante_id en vez de
# producto_id. stock_por_producto y stock_por_categoria NO se tocan — agregan
# por producto_id, que siempre está poblado (con o sin variante), así que ya
# dan el total correcto sin necesidad de reescribirlos.
# ---------------------------------------------------------------------------
def stock_por_variante(db: Session) -> list:
    config = get_configuracion(db)
    variantes = db.query(models.Variante).filter(models.Variante.activo.is_(True)).all()
    ventas_total = unidades_vendidas_por_variante(db, dias=None)
    ventas_ventana = unidades_vendidas_por_variante(db, dias=config.demanda_ventana_dias)
    hoy = date.today()

    resultado = []
    for v in variantes:
        compras = db.query(models.Compra).filter(models.Compra.variante_id == v.id).all()
        total_comprado = sum(c.cantidad for c in compras)
        total_vendido = ventas_total.get(v.id, 0)
        stock_actual = total_comprado - total_vendido
        dias_en_stock = _fifo_dias_en_stock(compras, total_vendido, hoy) if stock_actual > 0 else None
        alerta_rotacion = dias_en_stock is not None and dias_en_stock > config.rotacion_alerta_dias

        vendido_ventana = ventas_ventana.get(v.id, 0)
        demanda_media_diaria = round(vendido_ventana / config.demanda_ventana_dias, 3)
        dias_cobertura = round(stock_actual / demanda_media_diaria, 1) if demanda_media_diaria > 0 else None
        lead_time = v.producto.lead_time_dias or config.lead_time_default_dias
        umbral_reposicion = lead_time + config.safety_days
        estado_stock, necesita_reponer = _estado_stock(
            stock_actual, dias_cobertura, umbral_reposicion, config.stock_dias_verde, config.stock_dias_rojo
        )

        resultado.append({
            "variante_id": v.id,
            "producto_id": v.producto_id,
            "stock_actual": stock_actual,
            "total_comprado": total_comprado,
            "total_vendido": total_vendido,
            "costo_promedio": float(v.producto.costo),
            "dias_en_stock": dias_en_stock,
            "alerta_rotacion_90_dias": alerta_rotacion,
            "demanda_media_diaria": demanda_media_diaria,
            "dias_cobertura": dias_cobertura,
            "lead_time_dias": lead_time,
            "estado_stock": estado_stock,
            "necesita_reponer": necesita_reponer,
        })
    return resultado


def stock_disponible(db: Session, producto_id: int, variante_id: Optional[int] = None) -> int:
    """Unidades disponibles ahora mismo (total comprado - total vendido), acotado a un producto o
    a una variante puntual. Mismo cálculo que stock_por_producto/stock_por_variante, pero sin
    recorrer todo el catálogo — pensado para validar una Venta puntual (POST/PUT /movimientos)."""
    if variante_id is not None:
        total_comprado = db.query(func.coalesce(func.sum(models.Compra.cantidad), 0)).filter(
            models.Compra.variante_id == variante_id
        ).scalar()
        total_vendido = db.query(func.coalesce(func.sum(models.Movimiento.cantidad), 0)).filter(
            models.Movimiento.tipo == "Venta", models.Movimiento.variante_id == variante_id
        ).scalar()
    else:
        total_comprado = db.query(func.coalesce(func.sum(models.Compra.cantidad), 0)).filter(
            models.Compra.producto_id == producto_id
        ).scalar()
        total_vendido = db.query(func.coalesce(func.sum(models.Movimiento.cantidad), 0)).filter(
            models.Movimiento.tipo == "Venta", models.Movimiento.producto_id == producto_id
        ).scalar()
    return int(total_comprado) - int(total_vendido)


TIPOS_MOVIMIENTO_VALIDOS = ("Venta", "Ingreso", "Egreso")

# Cadena de estados de logística de un Pedido (Fase B), cualquier canal. "Listo para retirar"
# y "Enviado" son ambos válidos para cualquier pedido (el frontend decide cuál ofrecer según
# forma_entrega, no se acopla acá para no sumar una quinta categoría rara). Cancelado no
# dispara ninguna reversión de stock todavía (eso es una fase futura) — es solo un valor
# disponible en el selector.
ESTADOS_PEDIDO_VALIDOS = ("Pendiente", "Preparando", "Listo para retirar", "Enviado", "Entregado", "Cancelado")


# ---------------------------------------------------------------------------
# Única función de este módulo que lanza HTTPException — excepción deliberada a
# la convención "los routers validan, calculations calcula". Se justifica porque
# POST/PUT /movimientos (Caja) y POST /ecommerce/ordenes necesitan literalmente
# la misma regla de negocio para dar de alta una Venta; duplicarla en dos
# routers era peor que la inconsistencia de estilo. `actual` solo lo usa el PUT
# de edición de un Movimiento ya existente (le suma de vuelta su propia
# cantidad vieja antes de comparar, porque ya está descontada del stock actual)
# — en toda alta (POST /movimientos y cada línea de una orden de e-commerce)
# queda en None.
# ---------------------------------------------------------------------------
def validar_movimiento(
    db: Session,
    tipo: str,
    producto_id: Optional[int],
    variante_id: Optional[int],
    cantidad: Optional[int],
    actual: Optional["models.Movimiento"] = None,
) -> None:
    if tipo not in TIPOS_MOVIMIENTO_VALIDOS:
        raise HTTPException(400, "El tipo debe ser 'Venta', 'Ingreso' o 'Egreso'.")
    if tipo == "Venta" and not producto_id:
        raise HTTPException(400, "Una Venta debe tener un producto asociado.")
    if producto_id is not None:
        producto = db.get(models.Producto, producto_id)
        if not producto:
            raise HTTPException(400, "El producto indicado no existe.")
        if tipo == "Venta" and producto.tiene_variantes and not variante_id:
            raise HTTPException(400, "Este producto tiene variantes: especificá la variante de la venta.")
        if variante_id is not None:
            variante = db.get(models.Variante, variante_id)
            if not variante or variante.producto_id != producto_id:
                raise HTTPException(400, "La variante indicada no corresponde a este producto.")
        if tipo == "Venta":
            disponible = stock_disponible(db, producto_id, variante_id)
            # al editar una Venta ya registrada del mismo producto/variante, su cantidad vieja ya está
            # descontada del stock actual — se sube de vuelta antes de comparar contra la cantidad nueva
            if (
                actual is not None
                and actual.tipo == "Venta"
                and actual.producto_id == producto_id
                and actual.variante_id == variante_id
            ):
                disponible += actual.cantidad or 0
            if (cantidad or 0) > disponible:
                referencia = "esta variante" if variante_id else "este producto"
                raise HTTPException(
                    400,
                    f"No hay stock suficiente para {referencia}: disponible {disponible}, "
                    f"pediste {cantidad}.",
                )


def registrar_venta(
    db: Session,
    producto_id: int,
    variante_id: Optional[int],
    cantidad: int,
    monto: Decimal,
    concepto: Optional[str] = None,
    fecha: Optional[datetime] = None,
    costo_fijo_id: Optional[int] = None,
) -> models.Movimiento:
    """Valida (vía validar_movimiento) y arma un Movimiento tipo Venta — único camino de alta de una
    Venta, usado por POST /movimientos y por cada línea de POST /ecommerce/ordenes. No hace commit ni
    refresh: el caller controla la transacción (en e-commerce, junto con la Orden y sus items)."""
    validar_movimiento(db, "Venta", producto_id, variante_id, cantidad, actual=None)
    mov = models.Movimiento(
        tipo="Venta",
        concepto=concepto,
        cantidad=cantidad,
        monto=monto,
        producto_id=producto_id,
        variante_id=variante_id,
        costo_fijo_id=costo_fijo_id,
    )
    if fecha is not None:
        mov.fecha = fecha
    db.add(mov)
    db.flush()  # mov.id disponible sin comprometer la transacción — mismo patrón que resolver_o_crear_variante
    return mov


# ---------------------------------------------------------------------------
# Árbol de stock de 3 niveles para productos con variantes: Producto (total) >
# valor del atributo con orden=1 (subtotal, ej. Talle) > variante individual con
# el resto de sus atributos (detalle, ej. Color). Si el producto solo tiene un
# atributo configurado, el árbol queda de 2 niveles (sin forzar un nivel 3 vacío).
# Productos sin variantes se devuelven igual que en stock_por_producto.
# ---------------------------------------------------------------------------
def stock_por_producto_arbol(db: Session) -> list:
    filas_por_producto = {f["producto_id"]: f for f in stock_por_producto(db)}
    productos = db.query(models.Producto).filter(models.Producto.activo.is_(True)).all()

    variantes_por_producto = defaultdict(list)
    for fv in stock_por_variante(db):
        variantes_por_producto[fv["producto_id"]].append(fv)

    resultado = []
    for p in productos:
        fila = filas_por_producto.get(p.id)
        if fila is None:
            continue

        if not p.tiene_variantes:
            resultado.append({**fila, "grupos": None})
            continue

        atributos_ordenados = (
            db.query(models.ProductoAtributo)
            .filter(models.ProductoAtributo.producto_id == p.id)
            .order_by(models.ProductoAtributo.orden)
            .all()
        )
        variantes_info = variantes_por_producto.get(p.id, [])
        if not atributos_ordenados:
            # tiene_variantes=True pero todavía no se configuraron atributos/variantes
            resultado.append({**fila, "grupos": None})
            continue

        primer_atributo_id = atributos_ordenados[0].atributo_id
        resto_atributos_ids = [pa.atributo_id for pa in atributos_ordenados[1:]]

        variante_ids = [v["variante_id"] for v in variantes_info]
        valores_por_variante = defaultdict(dict)  # variante_id -> {atributo_id: "valor"}
        if variante_ids:
            filas_valores = (
                db.query(models.VarianteValor, models.ValorAtributo)
                .join(models.ValorAtributo, models.VarianteValor.valor_atributo_id == models.ValorAtributo.id)
                .filter(models.VarianteValor.variante_id.in_(variante_ids))
                .all()
            )
            for vv, va in filas_valores:
                valores_por_variante[vv.variante_id][va.atributo_id] = va.valor

        grupos: dict = {}
        for vi in variantes_info:
            valores_v = valores_por_variante.get(vi["variante_id"], {})
            valor_primario = valores_v.get(primer_atributo_id, "—")
            grupo = grupos.setdefault(valor_primario, {
                "nombre": valor_primario, "stock_actual": 0, "total_comprado": 0, "total_vendido": 0, "variantes": [],
            })
            grupo["stock_actual"] += vi["stock_actual"]
            grupo["total_comprado"] += vi["total_comprado"]
            grupo["total_vendido"] += vi["total_vendido"]
            if resto_atributos_ids:
                etiqueta = " / ".join(valores_v.get(a_id, "—") for a_id in resto_atributos_ids)
                grupo["variantes"].append({**vi, "nombre": etiqueta})

        if not resto_atributos_ids:
            for g in grupos.values():
                g["variantes"] = None  # árbol de 2 niveles, sin nivel de detalle vacío

        resultado.append({**fila, "grupos": list(grupos.values())})

    return resultado


# ---------------------------------------------------------------------------
# Sell-through: % del total histórico comprado que ya se vendió.
# ---------------------------------------------------------------------------
def sell_through(db: Session) -> list:
    items = stock_por_producto(db)
    for i in items:
        i["sell_through_pct"] = (
            round(i["total_vendido"] / i["total_comprado"] * 100, 1) if i["total_comprado"] else None
        )
    return items


# ---------------------------------------------------------------------------
# Contribución de margen por categoría ("motor" vs "decoración")
# ---------------------------------------------------------------------------
def contribucion_por_categoria(db: Session, dias: Optional[int] = None, rollup: bool = False) -> dict:
    productos = db.query(models.Producto).filter(models.Producto.activo.is_(True)).all()
    ventas = unidades_vendidas_por_producto(db, dias=dias)
    categorias_todas = {c.id: c for c in db.query(models.Categoria).all()}

    categorias: dict = {}
    total_margen = 0.0
    for p in productos:
        precio = float(p.precio_venta)
        costo = float(p.costo)
        unidades = ventas.get(p.id, 0)
        margen_generado = (precio - costo) * unidades
        total_margen += margen_generado
        for target in _categorias_objetivo(p.categoria_id, categorias_todas, rollup):
            cat = categorias.setdefault(target, {
                "categoria": _nombre_categoria(target, categorias_todas), "margen_generado": 0.0, "unidades_vendidas": 0,
            })
            cat["margen_generado"] += margen_generado
            cat["unidades_vendidas"] += unidades

    resultado = list(categorias.values())
    for c in resultado:
        c["margen_generado"] = round(c["margen_generado"], 2)
        c["pct_del_margen_total"] = (
            round(c["margen_generado"] / total_margen * 100, 1) if total_margen else 0
        )
    resultado.sort(key=lambda x: x["margen_generado"], reverse=True)

    return {"total_margen_generado": round(total_margen, 2), "categorias": resultado}


# ---------------------------------------------------------------------------
# Análisis combinado: BCG + Contribución de margen, en una sola vista.
#
# Por producto: además del cuadrante BCG, calcula cuánto margen ($ y %)
# generó, y marca como "candidato a renegociación" a los que tienen margen
# bajo (< 15%) pero están entre el 30% más vendido (percentil 70 de volumen)
# — típicamente productos "Vaca" que convendría renegociar con el proveedor
# o resignar por otro con mejor margen.
#
# Por categoría: clasifica "Motor" vs "Decoración" comparando el margen
# generado acumulado (de mayor a menor) contra los costos fijos totales del
# negocio — la/las categorías que alcanzan a cubrir los costos fijos son el
# "motor"; el resto es margen adicional pero no imprescindible. Si no hay
# costos fijos cargados, usa la regla de Pareto (80% del margen acumulado).
# ---------------------------------------------------------------------------
def analisis_combinado(db: Session, dias: int = 30, rollup: bool = False) -> dict:
    config = get_configuracion(db)
    margen_umbral_pct = float(config.renegociacion_margen_umbral_pct)
    percentil_volumen = float(config.renegociacion_percentil_volumen)
    pareto_pct = float(config.motor_decoracion_pareto_pct) / 100

    bcg = matriz_bcg(db, dias=dias)
    if "error" in bcg:
        return bcg

    ventas = unidades_vendidas_por_producto(db, dias=dias)
    productos_map = {p.id: p for p in db.query(models.Producto).filter(models.Producto.activo.is_(True)).all()}
    categorias_todas = {c.id: c for c in db.query(models.Categoria).all()}

    total_margen = 0.0
    productos_out = []
    for item in bcg["items"]:
        p = productos_map[item["producto_id"]]
        precio, costo = float(p.precio_venta), float(p.costo)
        unidades = ventas.get(p.id, 0)
        margen_generado = round((precio - costo) * unidades, 2)
        total_margen += margen_generado
        productos_out.append({**item, "margen_generado": margen_generado})

    volumenes_ordenados = sorted(i["volumen"] for i in productos_out)
    if volumenes_ordenados:
        idx_p70 = min(int(len(volumenes_ordenados) * percentil_volumen), len(volumenes_ordenados) - 1)
        percentil_70_volumen = volumenes_ordenados[idx_p70]
    else:
        percentil_70_volumen = 0

    for item in productos_out:
        item["pct_del_margen_total"] = round(item["margen_generado"] / total_margen * 100, 1) if total_margen else 0
        item["candidato_renegociacion"] = (
            item["margen_pct"] < margen_umbral_pct and item["volumen"] >= percentil_70_volumen and item["volumen"] > 0
        )

    # rollup por categoría, con conteo de cuadrantes BCG
    categorias_map: dict = {}
    for item in productos_out:
        for target in _categorias_objetivo(item["categoria_id"], categorias_todas, rollup):
            c = categorias_map.setdefault(target, {
                "categoria": _nombre_categoria(target, categorias_todas), "margen_generado": 0.0, "unidades_vendidas": 0,
                "cantidad_estrella": 0, "cantidad_vaca": 0, "cantidad_incognita": 0, "cantidad_perro": 0,
            })
            c["margen_generado"] += item["margen_generado"]
            c["unidades_vendidas"] += item["volumen"]
            c["cantidad_" + item["cuadrante"].lower()] += 1

    categorias_out = list(categorias_map.values())
    for c in categorias_out:
        c["margen_generado"] = round(c["margen_generado"], 2)
        c["pct_del_margen_total"] = round(c["margen_generado"] / total_margen * 100, 1) if total_margen else 0
    categorias_out.sort(key=lambda x: x["margen_generado"], reverse=True)

    costos_fijos_total = float(db.query(func.coalesce(func.sum(models.CostoFijo.monto), 0)).scalar())
    acumulado = 0.0
    for c in categorias_out:
        if costos_fijos_total > 0:
            c["clasificacion"] = "Motor" if acumulado < costos_fijos_total else "Decoración"
        else:
            c["clasificacion"] = "Motor" if acumulado < total_margen * pareto_pct else "Decoración"
        acumulado += c["margen_generado"]

    return {
        "dias_analizados": dias,
        "margen_mediano_pct": bcg["margen_mediano_pct"],
        "volumen_mediano": bcg["volumen_mediano"],
        "total_margen_generado": round(total_margen, 2),
        "costos_fijos_total": costos_fijos_total,
        "productos": productos_out,
        "categorias": categorias_out,
    }


# ---------------------------------------------------------------------------
# Snapshots del mix real: una foto periódica de facturacion_por_producto (la
# MISMA función que usa el modo "real" del Punto de Equilibrio, no se duplica
# lógica) para poder graficar la evolución del mix% en el tiempo.
#
# Detección "lazy" (sin scheduler/cron nuevo): en vez de programar una tarea
# periódica, se revisa en cada apertura de las pantallas de rutina (Dashboard:
# /dashboard/resumen y /dashboard/punto-equilibrio) si ya pasó el período
# configurado desde el último snapshot, y si es así se toma uno. No hace falta
# que sea puntual al día exacto — alcanza con que se dispare la primera vez que
# se detecta que ya tocaba. Se eligió este enfoque en vez de un cron real
# porque el proyecto no tiene infraestructura de tareas en segundo plano
# (no hay Celery/APScheduler ni un worker separado), y para un negocio
# unipersonal que abre la app todos los días alcanza de sobra: el "atraso"
# máximo es de un día de uso, no semanas.
# ---------------------------------------------------------------------------
def tomar_snapshot_mix(db: Session) -> list[models.MixSnapshot]:
    config = get_configuracion(db)
    ventana_dias = config.snapshot_periodo_dias
    facturacion = facturacion_por_producto(db, dias=ventana_dias)
    total = sum(facturacion.values())
    if total <= 0:
        return []

    productos = db.query(models.Producto).filter(models.Producto.activo.is_(True)).all()
    ahora = datetime.now(timezone.utc)
    creados = []
    for p in productos:
        monto = facturacion.get(p.id, 0.0)
        if monto <= 0:
            continue
        snap = models.MixSnapshot(
            fecha=ahora,
            ventana_dias=ventana_dias,
            producto_id=p.id,
            producto_nombre=p.nombre,
            categoria_nombre=p.categoria.nombre if p.categoria else None,
            mix_pct=round(monto / total * 100, 3),
            facturacion=round(monto, 2),
        )
        db.add(snap)
        creados.append(snap)
    db.commit()
    for s in creados:
        db.refresh(s)
    return creados


def verificar_y_tomar_snapshot_si_corresponde(db: Session) -> None:
    config = get_configuracion(db)
    ultimo = db.query(models.MixSnapshot).order_by(models.MixSnapshot.fecha.desc()).first()
    if ultimo is None:
        tomar_snapshot_mix(db)
        return
    proximo_vencimiento = ultimo.fecha + timedelta(days=config.snapshot_periodo_dias)
    if datetime.now(timezone.utc) >= proximo_vencimiento:
        tomar_snapshot_mix(db)
