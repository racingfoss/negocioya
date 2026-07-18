from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from .. import calculations, models, schemas
from ..database import get_db

router = APIRouter(prefix="/pedidos", tags=["Pedidos"])


@router.get("/", response_model=list[schemas.PedidoOut])
def listar(db: Session = Depends(get_db), limit: int = 300):
    """Pedidos de AMBOS canales (ecommerce y local), unificados (Fase B). Reemplaza al viejo
    GET /ecommerce/ordenes, que solo listaba el canal online."""
    return (
        db.query(models.Pedido)
        .options(joinedload(models.Pedido.items).joinedload(models.PedidoItem.producto))
        .order_by(models.Pedido.fecha.desc())
        .limit(limit)
        .all()
    )


@router.post("/", response_model=schemas.PedidoOut)
def crear_local(payload: schemas.PedidoLocalCreate, db: Session = Depends(get_db)):
    """Alta de un Pedido canal="local" desde Caja — el carrito armado en Movimientos.jsx se confirma
    acá de una sola vez. Mismo criterio de validación atómica que POST /ecommerce/ordenes (todas las
    líneas se validan ANTES de escribir nada), pero sin el chequeo de visible_ecommerce (una venta de
    mostrador puede vender algo no publicado online) ni de forma_entrega/direccion_envio (no aplica a
    canal local)."""
    if not payload.lineas:
        raise HTTPException(400, "El pedido necesita al menos una línea.")

    productos_cache: dict[int, models.Producto] = {}
    for idx, linea in enumerate(payload.lineas, start=1):
        producto = productos_cache.get(linea.producto_id)
        if producto is None:
            producto = db.get(models.Producto, linea.producto_id)
            productos_cache[linea.producto_id] = producto
        if not producto or not producto.activo:
            raise HTTPException(400, f"Línea {idx}: el producto no existe o no está activo.")
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
    # canal local arranca directo en Entregado: la clienta se lo lleva puesto en el momento,
    # a diferencia de un pedido ecommerce que todavía falta prepararlo/enviarlo.
    pedido = models.Pedido(
        canal="local",
        facturar_arca=payload.facturar_arca,
        estado="Entregado",
        cliente_nombre=payload.cliente_nombre,
        notas=payload.notas,
        total=total,
    )
    db.add(pedido)
    db.flush()  # pedido.id disponible sin comprometer la transacción

    for linea in payload.lineas:
        precio_unitario = productos_cache[linea.producto_id].precio_venta
        mov = calculations.registrar_venta(
            db,
            linea.producto_id,
            linea.variante_id,
            linea.cantidad,
            monto=precio_unitario * linea.cantidad,
            concepto=f"Venta mostrador — pedido #{pedido.id}",
        )
        db.add(
            models.PedidoItem(
                pedido_id=pedido.id,
                producto_id=linea.producto_id,
                variante_id=linea.variante_id,
                cantidad=linea.cantidad,
                precio_unitario=precio_unitario,
                movimiento_id=mov.id,
            )
        )

    db.commit()
    db.refresh(pedido)
    return pedido


@router.put("/{pedido_id}/estado", response_model=schemas.PedidoOut)
def cambiar_estado(pedido_id: int, payload: schemas.PedidoEstadoUpdate, db: Session = Depends(get_db)):
    pedido = db.get(models.Pedido, pedido_id)
    if not pedido:
        raise HTTPException(404, "Pedido no encontrado.")
    if payload.estado not in calculations.ESTADOS_PEDIDO_VALIDOS:
        raise HTTPException(
            400, f"Estado inválido. Válidos: {', '.join(calculations.ESTADOS_PEDIDO_VALIDOS)}."
        )
    pedido.estado = payload.estado
    db.commit()
    db.refresh(pedido)
    return pedido
