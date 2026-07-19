from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from .. import calculations, facturacion, models, schemas
from ..database import get_db

router = APIRouter(prefix="/pedidos", tags=["Pedidos"])


def _pedido_out(db: Session, pedido: models.Pedido) -> schemas.PedidoOut:
    """monto_neto no es un atributo del ORM (Fase C) — model_validate lo dejaría en su default
    Decimal("0") SIN error si no se completa acá, así que este helper es obligatorio en los 3
    endpoints que devuelven un Pedido, no solo en listar()."""
    out = schemas.PedidoOut.model_validate(pedido)
    out.monto_neto = calculations.monto_neto_pedido(db, pedido)
    return out


@router.get("/", response_model=list[schemas.PedidoOut])
def listar(db: Session = Depends(get_db), limit: int = 300):
    """Pedidos de AMBOS canales (ecommerce y local), unificados (Fase B). Reemplaza al viejo
    GET /ecommerce/ordenes, que solo listaba el canal online."""
    pedidos = (
        db.query(models.Pedido)
        .options(
            joinedload(models.Pedido.items).joinedload(models.PedidoItem.producto),
            joinedload(models.Pedido.facturas),
        )
        .order_by(models.Pedido.fecha.desc())
        .limit(limit)
        .all()
    )
    return [_pedido_out(db, p) for p in pedidos]


@router.post("/", response_model=schemas.PedidoOut)
def crear_local(payload: schemas.PedidoLocalCreate, db: Session = Depends(get_db)):
    """Alta de un Pedido canal="local" desde Caja — el carrito armado en Movimientos.jsx se confirma
    acá de una sola vez. Mismo criterio de validación atómica que POST /ecommerce/ordenes (todas las
    líneas se validan ANTES de escribir nada), pero sin el chequeo de visible_ecommerce (una venta de
    mostrador puede vender algo no publicado online) ni de forma_entrega/direccion_envio (no aplica a
    canal local)."""
    if not payload.lineas:
        raise HTTPException(400, "El pedido necesita al menos una línea.")

    # Si este pedido viene de un carrito con reservas propias (sesion_id de Movimientos.jsx), se
    # liberan ACÁ, antes de validar/vender — no antes de la transacción, en el sentido de "un paso
    # aparte" con su propio commit (eso dejaría una ventana de carrera), sino como el primer paso de
    # ESTA MISMA transacción: si cualquier línea falla más abajo, todo (incluida esta liberación) se
    # revierte junto. Hacerlo acá (y no recién antes del commit final) es necesario porque
    # registrar_venta() valida el stock internamente vía validar_movimiento(), que llama a
    # stock_disponible() SIN excluir esta sesión (no se le cambió la firma) — si la reserva propia
    # siguiera activa en ese momento, se restaría dos veces contra sí misma y una confirmación
    # legítima (cantidad == lo reservado) se rechazaría por "falta de stock".
    if payload.sesion_id:
        calculations.liberar_reserva(db, payload.sesion_id)

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
    return _pedido_out(db, pedido)


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
    return _pedido_out(db, pedido)


@router.post("/{pedido_id}/facturar", response_model=schemas.FacturaOut)
def facturar(pedido_id: int, db: Session = Depends(get_db)):
    """Pide un CAE real a ARCA para este pedido (Fase C) — ver facturacion.facturar_pedido para
    la orquestación completa (validaciones, llamado a WSFEv1, persistencia del intento)."""
    return facturacion.facturar_pedido(db, pedido_id)
