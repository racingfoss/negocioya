from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session, joinedload

from .. import calculations, facturacion, facturas_pdf, models, schemas
from ..database import get_db

router = APIRouter(prefix="/pedidos", tags=["Pedidos"])


def _pedido_out(db: Session, pedido: models.Pedido) -> schemas.PedidoOut:
    """monto_neto no es un atributo del ORM (Fase C) — model_validate lo dejaría en su default
    Decimal("0") SIN error si no se completa acá, así que este helper es obligatorio en los 3
    endpoints que devuelven un Pedido, no solo en listar(). variante_descripcion (Fase D parte 1)
    tampoco es un atributo del ORM, mismo criterio."""
    out = schemas.PedidoOut.model_validate(pedido)
    out.monto_neto = calculations.monto_neto_pedido(db, pedido)
    for item in out.items:
        if item.variante_id is not None:
            item.variante_descripcion = calculations.descripcion_variante(db, item.variante_id)
    cambio_origen = db.query(models.Cambio).filter(models.Cambio.pedido_nuevo_id == pedido.id).first()
    if cambio_origen is not None:
        out.cambio_origen = schemas.CambioOrigenOut.model_validate(cambio_origen)
    return out


def _devolucion_out(db: Session, devolucion: models.Devolucion) -> schemas.DevolucionOut:
    """requiere_nota_credito y nota_credito (Fase D parte 2) no son atributos del ORM, mismo
    criterio que _pedido_out con monto_neto: hay que completarlos a mano en cualquier endpoint
    que devuelva una Devolucion, no solo en el listado."""
    out = schemas.DevolucionOut.model_validate(devolucion)
    out.requiere_nota_credito = calculations.devolucion_requiere_nota_credito(db, devolucion)
    nota_credito = (
        db.query(models.Factura)
        .filter(
            models.Factura.devolucion_id == devolucion.id,
            models.Factura.tipo_comprobante == calculations.TIPO_COMPROBANTE_NOTA_CREDITO_C,
            models.Factura.estado == "Emitida",
        )
        .first()
    )
    if nota_credito is not None:
        out.nota_credito = schemas.FacturaOut.model_validate(nota_credito)
    cambio = db.query(models.Cambio).filter(models.Cambio.devolucion_id == devolucion.id).first()
    if cambio is not None:
        out.cambio = schemas.CambioResumenOut.model_validate(cambio)
    return out


def _cambio_out(db: Session, cambio: models.Cambio) -> schemas.CambioOut:
    """Cambio no tiene relationship hacia Pedido/Devolucion (fila de cruce minimalista, ver
    models.Cambio) — a diferencia de _pedido_out/_devolucion_out, acá no alcanza con
    model_validate + completar campos sueltos: pedido_nuevo/devolucion tienen que resolverse
    enteros a mano, reusando _pedido_out/_devolucion_out para no reinventar esos cálculos."""
    pedido_nuevo = db.get(models.Pedido, cambio.pedido_nuevo_id)
    devolucion = db.get(models.Devolucion, cambio.devolucion_id)
    return schemas.CambioOut(
        id=cambio.id,
        pedido_original_id=cambio.pedido_original_id,
        devolucion=_devolucion_out(db, devolucion),
        pedido_nuevo=_pedido_out(db, pedido_nuevo),
        diferencia_monto=cambio.diferencia_monto,
        fecha=cambio.fecha,
        motivo=cambio.motivo,
    )


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
    acá de una sola vez. Wrapper delgado: toda la mecánica (validación atómica por línea, liberar la
    reserva de la sesión primero, armar Pedido + PedidoItem + Movimiento) vive en
    calculations.crear_pedido_con_items, reusada también por procesar_cambio (Cambio de producto)."""
    if not payload.lineas:
        raise HTTPException(400, "El pedido necesita al menos una línea.")
    try:
        pedido = calculations.crear_pedido_con_items(
            db,
            canal="local",
            items=payload.lineas,
            facturar_arca=payload.facturar_arca,
            cliente_nombre=payload.cliente_nombre,
            notas=payload.notas,
            sesion_id=payload.sesion_id,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
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


@router.put("/{pedido_id}/facturar-arca", response_model=schemas.PedidoOut)
def actualizar_facturar_arca(
    pedido_id: int, payload: schemas.FacturarArcaUpdate, db: Session = Depends(get_db)
):
    """Permite prender/apagar facturar_arca en cualquier momento (para cualquier canal), mientras
    el pedido siga siendo elegible para facturar — antes solo se fijaba una vez al confirmar."""
    pedido = db.get(models.Pedido, pedido_id)
    if not pedido:
        raise HTTPException(404, "Pedido no encontrado.")
    if pedido.estado == "Cancelado":
        raise HTTPException(400, "El pedido está cancelado, no hay nada que facturar.")
    factura_emitida = (
        db.query(models.Factura)
        .filter(
            models.Factura.pedido_id == pedido_id,
            models.Factura.tipo_comprobante == calculations.TIPO_COMPROBANTE_FACTURA_C,
            models.Factura.estado == "Emitida",
        )
        .first()
    )
    if factura_emitida is not None:
        raise HTTPException(
            400, "Este pedido ya tiene una Factura C emitida con CAE — no se puede modificar facturar_arca."
        )
    pedido.facturar_arca = payload.facturar_arca
    db.commit()
    db.refresh(pedido)
    return _pedido_out(db, pedido)


@router.post("/{pedido_id}/facturar", response_model=schemas.FacturaOut)
def facturar(pedido_id: int, db: Session = Depends(get_db)):
    """Pide un CAE real a ARCA para este pedido (Fase C) — ver facturacion.facturar_pedido para
    la orquestación completa (validaciones, llamado a WSFEv1, persistencia del intento)."""
    return facturacion.facturar_pedido(db, pedido_id)


@router.post("/{pedido_id}/devoluciones", response_model=schemas.DevolucionOut)
def crear_devolucion(pedido_id: int, payload: schemas.DevolucionCreate, db: Session = Depends(get_db)):
    """Cancelación (antes de entregar) o devolución (después) de una o varias líneas de un Pedido
    ya confirmado (Fase D parte 1) — ver calculations.procesar_devolucion para la mecánica
    completa (reversión de stock/caja vía un Movimiento tipo "Devolucion" por línea)."""
    if not db.get(models.Pedido, pedido_id):
        raise HTTPException(404, "Pedido no encontrado.")
    try:
        devolucion = calculations.procesar_devolucion(
            db, pedido_id, payload.items, motivo=payload.motivo, tipo=payload.tipo
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    return _devolucion_out(db, devolucion)


@router.get("/{pedido_id}/devoluciones", response_model=list[schemas.DevolucionOut])
def listar_devoluciones(pedido_id: int, db: Session = Depends(get_db)):
    """Historial de devoluciones/cancelaciones de un Pedido — usado tanto por el backend (validar
    cuánto queda disponible por línea) como por el frontend (mostrarlo en el panel de devolución,
    incluido si corresponde ofrecer "Emitir Nota de Crédito" por fila, Fase D parte 2)."""
    devoluciones = (
        db.query(models.Devolucion)
        .options(joinedload(models.Devolucion.items))
        .filter(models.Devolucion.pedido_id == pedido_id)
        .order_by(models.Devolucion.fecha.desc())
        .all()
    )
    return [_devolucion_out(db, d) for d in devoluciones]


@router.post("/{pedido_id}/cambios", response_model=schemas.CambioOut)
def crear_cambio(pedido_id: int, payload: schemas.CambioCreate, db: Session = Depends(get_db)):
    """Cambio de producto: una Devolucion sobre el pedido original + un Pedido nuevo con el ítem de
    cambio, vinculados por una fila Cambio para trazabilidad — ver calculations.procesar_cambio
    para la mecánica completa (atomicidad, cálculo de diferencia)."""
    pedido = db.get(models.Pedido, pedido_id)
    if not pedido:
        raise HTTPException(404, "Pedido no encontrado.")
    try:
        cambio = calculations.procesar_cambio(
            db,
            pedido,
            payload.items_devolver,
            payload.items_nuevos,
            motivo=payload.motivo,
            canal_nuevo=payload.canal_nuevo,
            facturar_arca_nuevo=payload.facturar_arca_nuevo,
            cliente_nombre_nuevo=payload.cliente_nombre_nuevo,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    return _cambio_out(db, cambio)


@router.get("/{pedido_id}/cambios", response_model=list[schemas.CambioOut])
def listar_cambios(pedido_id: int, db: Session = Depends(get_db)):
    """Historial de cambios de producto de un Pedido, más reciente primero — mismo criterio que
    GET /{pedido_id}/devoluciones."""
    cambios = (
        db.query(models.Cambio)
        .filter(models.Cambio.pedido_original_id == pedido_id)
        .order_by(models.Cambio.fecha.desc())
        .all()
    )
    return [_cambio_out(db, c) for c in cambios]


@router.post(
    "/{pedido_id}/devoluciones/{devolucion_id}/nota-credito",
    response_model=schemas.FacturaOut,
)
def emitir_nota_credito(pedido_id: int, devolucion_id: int, db: Session = Depends(get_db)):
    """Pide un CAE real a ARCA para la Nota de Crédito C de esta devolución (Fase D parte 2) — ver
    facturacion.emitir_nota_credito para la orquestación completa (elegibilidad, llamado a
    WSFEv1 con CbtesAsoc, persistencia del intento). `pedido_id` en la ruta es solo para el
    anidamiento consistente con el resto de este router — la validación real es contra
    devolucion_id, que ya identifica su pedido de forma unívoca."""
    return facturacion.emitir_nota_credito(db, devolucion_id)


@router.get("/{pedido_id}/facturas/{factura_id}/pdf")
def factura_pdf(pedido_id: int, factura_id: int, db: Session = Depends(get_db)):
    """Comprobante imprimible (Factura C o Nota de Crédito C) con código QR ARCA (Fase E) — ver
    facturas_pdf.generar_pdf_factura para el armado completo. Se genera al vuelo en cada
    descarga, mismo criterio que GET /importacion/plantilla (nada se persiste en disco)."""
    if not db.get(models.Pedido, pedido_id):
        raise HTTPException(404, "Pedido no encontrado.")
    factura = db.get(models.Factura, factura_id)
    if not factura or factura.pedido_id != pedido_id:
        raise HTTPException(404, "Factura no encontrada para este pedido.")
    try:
        pdf_bytes = facturas_pdf.generar_pdf_factura(db, factura)
    except ValueError as e:
        raise HTTPException(400, str(e))

    es_nota_credito = factura.tipo_comprobante == facturas_pdf.TIPO_COMPROBANTE_NOTA_CREDITO_C
    prefijo = "NC" if es_nota_credito else "Factura"
    nombre_archivo = f"{prefijo}C_{factura.punto_venta:04d}-{factura.numero_comprobante:08d}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{nombre_archivo}"'},
    )
