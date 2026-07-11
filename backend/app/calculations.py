from collections import defaultdict
from datetime import date, datetime, timedelta
from statistics import median
from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from . import models

# Ventana usada para estimar la demanda media diaria (Days-of-Cover).
# 90 días es un buen equilibrio para un negocio chico: suficiente historial
# para no ser ruido, pero sensible a estacionalidad reciente.
DEMANDA_VENTANA_DIAS = 90
LEAD_TIME_DEFAULT_DIAS = 7  # plazo de reposición asumido si el producto no tiene uno configurado
SAFETY_DAYS = 3  # colchón fijo simple (no estadístico) sumado al lead time
UMBRAL_CAMBIO_COSTO_PCT = 2.0  # a partir de qué % de cambio en el costo promedio se avisa


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
            diferencia_vs_ultima_compra_pct is not None and abs(diferencia_vs_ultima_compra_pct) > UMBRAL_CAMBIO_COSTO_PCT
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
# ---------------------------------------------------------------------------
def punto_equilibrio_ponderado(db: Session) -> dict:
    productos = db.query(models.Producto).filter(models.Producto.activo.is_(True)).all()
    costos_fijos_total = float(
        db.query(func.coalesce(func.sum(models.CostoFijo.monto), 0)).scalar()
    )

    if not productos:
        return {"error": "No hay productos activos cargados en el catálogo."}

    mix_total = sum(float(p.mix_pct) for p in productos)

    margen_ponderado = 0.0
    detalle = []
    for p in productos:
        precio = float(p.precio_venta)
        costo = float(p.costo)
        mix = float(p.mix_pct)
        margen_pct = (precio - costo) / precio if precio else 0
        margen_ponderado += (mix / 100) * margen_pct
        detalle.append({
            "producto_id": p.id,
            "producto": p.nombre,
            "mix_pct": mix,
            "precio_venta": precio,
            "costo": costo,
            "margen_pct": round(margen_pct * 100, 2),
        })

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


def _estado_stock(stock_actual: int, dias_cobertura: Optional[float], umbral_reposicion: int) -> tuple[str, bool]:
    if stock_actual <= 0:
        return "Sin stock", True
    if dias_cobertura is None:
        return "Sin ventas recientes", False
    necesita_reponer = dias_cobertura <= umbral_reposicion
    if dias_cobertura < 7:
        return "Crítico", True
    if dias_cobertura <= 30:
        return "Próximo a agotarse" if necesita_reponer else "Atención", necesita_reponer
    return "OK", False


def stock_por_producto(db: Session) -> list:
    productos = db.query(models.Producto).filter(models.Producto.activo.is_(True)).all()
    ventas_total = unidades_vendidas_por_producto(db, dias=None)
    ventas_ventana = unidades_vendidas_por_producto(db, dias=DEMANDA_VENTANA_DIAS)
    hoy = date.today()

    resultado = []
    for p in productos:
        compras = db.query(models.Compra).filter(models.Compra.producto_id == p.id).all()
        total_comprado = sum(c.cantidad for c in compras)
        total_vendido = ventas_total.get(p.id, 0)
        stock_actual = total_comprado - total_vendido
        dias_en_stock = _fifo_dias_en_stock(compras, total_vendido, hoy) if stock_actual > 0 else None
        alerta_rotacion = dias_en_stock is not None and dias_en_stock > 90

        vendido_ventana = ventas_ventana.get(p.id, 0)
        demanda_media_diaria = round(vendido_ventana / DEMANDA_VENTANA_DIAS, 3)
        dias_cobertura = round(stock_actual / demanda_media_diaria, 1) if demanda_media_diaria > 0 else None
        umbral_reposicion = (p.lead_time_dias or LEAD_TIME_DEFAULT_DIAS) + SAFETY_DAYS
        estado_stock, necesita_reponer = _estado_stock(stock_actual, dias_cobertura, umbral_reposicion)

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
            "lead_time_dias": p.lead_time_dias or LEAD_TIME_DEFAULT_DIAS,
            "estado_stock": estado_stock,
            "necesita_reponer": necesita_reponer,
        })

    resultado.sort(key=lambda x: (x["dias_cobertura"] is None, x["dias_cobertura"] if x["dias_cobertura"] is not None else 9999))
    return resultado


def stock_por_categoria(db: Session, rollup: bool = False) -> list:
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
        estado, _ = _estado_stock(c["stock_actual"], dias_cobertura, LEAD_TIME_DEFAULT_DIAS + SAFETY_DAYS)
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
    variantes = db.query(models.Variante).filter(models.Variante.activo.is_(True)).all()
    ventas_total = unidades_vendidas_por_variante(db, dias=None)
    ventas_ventana = unidades_vendidas_por_variante(db, dias=DEMANDA_VENTANA_DIAS)
    hoy = date.today()

    resultado = []
    for v in variantes:
        compras = db.query(models.Compra).filter(models.Compra.variante_id == v.id).all()
        total_comprado = sum(c.cantidad for c in compras)
        total_vendido = ventas_total.get(v.id, 0)
        stock_actual = total_comprado - total_vendido
        dias_en_stock = _fifo_dias_en_stock(compras, total_vendido, hoy) if stock_actual > 0 else None
        alerta_rotacion = dias_en_stock is not None and dias_en_stock > 90

        vendido_ventana = ventas_ventana.get(v.id, 0)
        demanda_media_diaria = round(vendido_ventana / DEMANDA_VENTANA_DIAS, 3)
        dias_cobertura = round(stock_actual / demanda_media_diaria, 1) if demanda_media_diaria > 0 else None
        lead_time = v.producto.lead_time_dias or LEAD_TIME_DEFAULT_DIAS
        umbral_reposicion = lead_time + SAFETY_DAYS
        estado_stock, necesita_reponer = _estado_stock(stock_actual, dias_cobertura, umbral_reposicion)

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
        idx_p70 = min(int(len(volumenes_ordenados) * 0.7), len(volumenes_ordenados) - 1)
        percentil_70_volumen = volumenes_ordenados[idx_p70]
    else:
        percentil_70_volumen = 0

    for item in productos_out:
        item["pct_del_margen_total"] = round(item["margen_generado"] / total_margen * 100, 1) if total_margen else 0
        item["candidato_renegociacion"] = item["margen_pct"] < 15 and item["volumen"] >= percentil_70_volumen and item["volumen"] > 0

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
            c["clasificacion"] = "Motor" if acumulado < total_margen * 0.8 else "Decoración"
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
