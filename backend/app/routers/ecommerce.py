from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from .. import auth, calculations, models, schemas
from ..database import get_db
from . import productos

router = APIRouter(prefix="/ecommerce", tags=["E-commerce"])


def _producto_a_catalogo_dict(
    db: Session, p: models.Producto, stock_producto_map: dict, stock_variante_map: dict
) -> dict:
    item = {
        "id": p.id,
        "nombre": p.nombre,
        "descripcion_ecommerce": p.descripcion_ecommerce,
        "precio_venta": p.precio_venta,
        "categoria": p.categoria.nombre if p.categoria else None,
        "fotos": sorted(p.fotos, key=lambda f: f.orden),
        "tiene_variantes": p.tiene_variantes,
        "stock_actual": None,
        "variantes": None,
    }
    if p.tiene_variantes:
        # variante se informa igual con stock 0 (no se filtra acá) — decisión del consumidor
        item["variantes"] = productos._formatear_variantes(db, p.id, stock_variante_map)
    else:
        item["stock_actual"] = stock_producto_map.get(p.id, 0)
    return item


@router.get(
    "/configuracion-tienda",
    response_model=schemas.ConfiguracionTiendaOut,
    dependencies=[Depends(auth.require_ecommerce_api_key)],
)
def configuracion_tienda(db: Session = Depends(get_db)):
    """Identidad de la tienda para el storefront (nombre, WhatsApp, redes). Deliberadamente NO es
    GET /configuracion (Admin API interna, sin autenticación, que devuelve todos los umbrales de
    negocio) — este endpoint usa un schema dedicado que solo puede devolver estos 4 campos."""
    return calculations.get_configuracion(db)


@router.get(
    "/catalogo",
    response_model=list[schemas.ProductoCatalogoOut],
    dependencies=[Depends(auth.require_ecommerce_api_key)],
)
def catalogo(db: Session = Depends(get_db)):
    """Catálogo público: solo productos activos y publicados (visible_ecommerce=True). NO expone
    costo/mix_pct/lead_time_dias (ver schemas.ProductoCatalogoOut) — cualquiera puede ver esta
    respuesta JSON en el navegador."""
    productos_db = (
        db.query(models.Producto)
        .options(joinedload(models.Producto.categoria), joinedload(models.Producto.fotos))
        .filter(models.Producto.activo.is_(True), models.Producto.visible_ecommerce.is_(True))
        .order_by(models.Producto.nombre)
        .all()
    )

    # los mapas de stock se calculan una sola vez para todo el catálogo, no por producto
    stock_producto_map = {s["producto_id"]: s["stock_actual"] for s in calculations.stock_por_producto(db)}
    stock_variante_map = {s["variante_id"]: s["stock_actual"] for s in calculations.stock_por_variante(db)}

    return [_producto_a_catalogo_dict(db, p, stock_producto_map, stock_variante_map) for p in productos_db]


@router.get(
    "/catalogo/{producto_id}",
    response_model=schemas.ProductoCatalogoOut,
    dependencies=[Depends(auth.require_ecommerce_api_key)],
)
def catalogo_detalle(producto_id: int, db: Session = Depends(get_db)):
    """Mismo criterio de visibilidad que GET /ecommerce/catalogo: 404 si no existe, no está activo,
    o no está publicado — no se distingue el motivo en la respuesta para no filtrar por inferencia
    que un producto existe pero está oculto. Pensado para la página de detalle de un storefront, así
    no hace falta traer el catálogo completo para mostrar un solo producto."""
    p = (
        db.query(models.Producto)
        .options(joinedload(models.Producto.categoria), joinedload(models.Producto.fotos))
        .filter(
            models.Producto.id == producto_id,
            models.Producto.activo.is_(True),
            models.Producto.visible_ecommerce.is_(True),
        )
        .first()
    )
    if not p:
        raise HTTPException(404, "Producto no encontrado o no disponible en el e-commerce.")

    stock_producto_map = {s["producto_id"]: s["stock_actual"] for s in calculations.stock_por_producto(db)}
    stock_variante_map = {s["variante_id"]: s["stock_actual"] for s in calculations.stock_por_variante(db)}
    return _producto_a_catalogo_dict(db, p, stock_producto_map, stock_variante_map)


@router.post(
    "/ordenes",
    response_model=schemas.PedidoOut,
    dependencies=[Depends(auth.require_ecommerce_api_key)],
)
def crear_orden(payload: schemas.OrdenEcommerceCreate, db: Session = Depends(get_db)):
    """Crea una orden de e-commerce y, por cada línea, una Venta real (Movimiento tipo "Venta" —
    NO una Compra). Valida CADA línea antes de escribir nada; si cualquiera falla, rechaza la orden
    completa con 400 sin crear nada parcial (mismo criterio atómico que Importación y el alta de
    producto con variantes)."""
    if payload.forma_entrega not in ("Retiro en persona", "Envío"):
        raise HTTPException(400, "forma_entrega debe ser 'Retiro en persona' o 'Envío'.")
    if payload.forma_entrega == "Envío" and not payload.direccion_envio:
        raise HTTPException(400, "El envío requiere dirección de envío.")
    if not payload.lineas:
        raise HTTPException(400, "La orden necesita al menos una línea.")

    productos_cache: dict[int, models.Producto] = {}
    for idx, linea in enumerate(payload.lineas, start=1):
        producto = productos_cache.get(linea.producto_id)
        if producto is None:
            producto = db.get(models.Producto, linea.producto_id)
            productos_cache[linea.producto_id] = producto
        if not producto or not producto.activo or not producto.visible_ecommerce:
            raise HTTPException(400, f"Línea {idx}: el producto no existe o no está disponible en el e-commerce.")
        if producto.tiene_variantes:
            if not linea.variante_id:
                raise HTTPException(400, f"Línea {idx}: este producto tiene variantes, indicá variante_id.")
            variante = db.get(models.Variante, linea.variante_id)
            if not variante or variante.producto_id != linea.producto_id:
                raise HTTPException(400, f"Línea {idx}: la variante no corresponde a este producto.")
        elif linea.variante_id:
            raise HTTPException(400, f"Línea {idx}: este producto no tiene variantes, no envíes variante_id.")
        disponible = calculations.stock_disponible(db, linea.producto_id, linea.variante_id)
        if linea.cantidad <= 0 or linea.cantidad > disponible:
            raise HTTPException(
                400, f"Línea {idx}: stock insuficiente (disponible {disponible}, pediste {linea.cantidad})."
            )

    total = sum(productos_cache[l.producto_id].precio_venta * l.cantidad for l in payload.lineas)
    # canal/facturar_arca/estado explícitos (Fase B): toda venta online se factura siempre y
    # arranca en Pendiente (falta prepararla/enviarla) — sin que el comprador vea ni elija nada de esto.
    orden = models.Pedido(
        canal="ecommerce",
        facturar_arca=True,
        estado="Pendiente",
        cliente_nombre=payload.cliente_nombre,
        cliente_email=payload.cliente_email,
        cliente_telefono=payload.cliente_telefono,
        forma_entrega=payload.forma_entrega,
        direccion_envio=payload.direccion_envio,
        notas=payload.notas,
        metodo_pago_preferido=payload.metodo_pago_preferido,
        total=total,
    )
    db.add(orden)
    db.flush()  # orden.id disponible sin comprometer la transacción

    for linea in payload.lineas:
        precio_unitario = productos_cache[linea.producto_id].precio_venta
        mov = calculations.registrar_venta(
            db,
            linea.producto_id,
            linea.variante_id,
            linea.cantidad,
            monto=precio_unitario * linea.cantidad,
            concepto=f"Venta e-commerce — orden #{orden.id}",
        )
        db.add(
            models.PedidoItem(
                pedido_id=orden.id,
                producto_id=linea.producto_id,
                variante_id=linea.variante_id,
                cantidad=linea.cantidad,
                precio_unitario=precio_unitario,
                movimiento_id=mov.id,
            )
        )

    db.commit()
    db.refresh(orden)
    return orden
