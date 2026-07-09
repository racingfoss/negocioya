from datetime import date, datetime, timedelta
from statistics import median
from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from . import models


# ---------------------------------------------------------------------------
# Costo promedio ponderado: se recalcula solo cada vez que cambian las compras
# de un producto. Es el método estándar (PPP) para productos con reposiciones
# a distinto costo a lo largo del tiempo.
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
# Antigüedad en stock: FIFO — se "consumen" primero las compras más viejas,
# y la antigüedad se mide desde la compra más vieja que todavía tiene
# unidades sin vender. Es el método estándar de valuación de inventario.
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


def stock_por_producto(db: Session) -> list:
    productos = db.query(models.Producto).filter(models.Producto.activo.is_(True)).all()
    ventas = unidades_vendidas_por_producto(db, dias=None)
    hoy = date.today()

    resultado = []
    for p in productos:
        compras = db.query(models.Compra).filter(models.Compra.producto_id == p.id).all()
        total_comprado = sum(c.cantidad for c in compras)
        total_vendido = ventas.get(p.id, 0)
        stock_actual = total_comprado - total_vendido
        dias_en_stock = _fifo_dias_en_stock(compras, total_vendido, hoy) if stock_actual > 0 else None
        alerta = dias_en_stock is not None and dias_en_stock > 90

        resultado.append({
            "producto_id": p.id,
            "producto": p.nombre,
            "categoria": p.categoria.nombre if p.categoria else "Sin categoría",
            "stock_actual": stock_actual,
            "total_comprado": total_comprado,
            "total_vendido": total_vendido,
            "costo_promedio": float(p.costo),
            "dias_en_stock": dias_en_stock,
            "alerta_rotacion_90_dias": alerta,
        })

    resultado.sort(key=lambda x: (not x["alerta_rotacion_90_dias"], -(x["dias_en_stock"] or 0)))
    return resultado


def stock_por_categoria(db: Session) -> list:
    items = stock_por_producto(db)
    categorias: dict = {}
    for i in items:
        cat = categorias.setdefault(i["categoria"], {"categoria": i["categoria"], "stock_actual": 0, "cantidad_productos": 0})
        cat["stock_actual"] += i["stock_actual"]
        cat["cantidad_productos"] += 1
    return sorted(categorias.values(), key=lambda x: x["stock_actual"], reverse=True)


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
def contribucion_por_categoria(db: Session, dias: Optional[int] = None) -> dict:
    productos = db.query(models.Producto).filter(models.Producto.activo.is_(True)).all()
    ventas = unidades_vendidas_por_producto(db, dias=dias)

    categorias: dict = {}
    total_margen = 0.0
    for p in productos:
        precio = float(p.precio_venta)
        costo = float(p.costo)
        unidades = ventas.get(p.id, 0)
        margen_generado = (precio - costo) * unidades
        cat_nombre = p.categoria.nombre if p.categoria else "Sin categoría"
        categorias.setdefault(cat_nombre, {
            "categoria": cat_nombre, "margen_generado": 0.0, "unidades_vendidas": 0,
        })
        categorias[cat_nombre]["margen_generado"] += margen_generado
        categorias[cat_nombre]["unidades_vendidas"] += unidades
        total_margen += margen_generado

    resultado = list(categorias.values())
    for c in resultado:
        c["margen_generado"] = round(c["margen_generado"], 2)
        c["pct_del_margen_total"] = (
            round(c["margen_generado"] / total_margen * 100, 1) if total_margen else 0
        )
    resultado.sort(key=lambda x: x["margen_generado"], reverse=True)

    return {"total_margen_generado": round(total_margen, 2), "categorias": resultado}
