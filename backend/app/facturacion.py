"""Orquesta la facturación ARCA (WSFEv1) de un Pedido — Fase C. Traduce entre el dominio de
Pedido/Configuracion y el paquete arca/ (que sigue sin saber qué es un Pedido). No vive dentro
de arca/ a propósito: ese paquete es integración SOAP pura, esto es orquestación de negocio.

Este módulo lanza HTTPException directamente (a diferencia de calculations.py, donde
validar_movimiento es la ÚNICA función que lo hace por una razón documentada puntual) — acá es
el punto, facturacion.py funciona como un router grueso, no como una función de cálculo
reusable desde varios lugares."""

from datetime import date, datetime, timezone
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy.orm import Session

from . import calculations, models
from .arca import wsfe

TIPO_COMPROBANTE_FACTURA_C = 11
TIPO_COMPROBANTE_NOTA_CREDITO_C = 13  # Fase D parte 2
DOC_TIPO_CONSUMIDOR_FINAL = 99
DOC_NRO_CONSUMIDOR_FINAL = 0


def _crear_factura_error(
    db: Session,
    pedido_id: int,
    tipo_comprobante: int,
    pto_vta: int,
    monto: Decimal,
    mensaje: str,
    *,
    devolucion_id: int | None = None,
    factura_original_id: int | None = None,
) -> models.Factura:
    """Persiste el intento fallido AHORA (commit propio, no al final de la request) para que
    quede historial aunque el endpoint termine devolviendo un error — confirmado seguro contra
    el manejo de sesión de database.py (get_db() solo hace close() en el finally, sin rollback
    implícito), así que este commit no se pierde aunque después se lance la HTTPException."""
    factura = models.Factura(
        pedido_id=pedido_id,
        tipo_comprobante=tipo_comprobante,
        punto_venta=pto_vta,
        importe_total=monto,
        doc_tipo=DOC_TIPO_CONSUMIDOR_FINAL,
        doc_nro=DOC_NRO_CONSUMIDOR_FINAL,
        estado="Error",
        mensaje_error=mensaje,
        devolucion_id=devolucion_id,
        factura_original_id=factura_original_id,
    )
    db.add(factura)
    db.commit()
    db.refresh(factura)
    return factura


def _solicitar_cae_y_persistir(
    db: Session,
    *,
    pedido_id: int,
    tipo_comprobante: int,
    monto: Decimal,
    cuit: str,
    pto_vta: int,
    cbtes_asoc: list[dict] | None = None,
    devolucion_id: int | None = None,
    factura_original_id: int | None = None,
) -> models.Factura:
    """Llama a ARCA (wsfe.fe_cae_solicitar) e interpreta/persiste el resultado — Emitida o Error,
    con commit en cualquier caso. Compartido por facturar_pedido (Factura C) y
    emitir_nota_credito (Nota de Crédito C, Fase D parte 2): la única diferencia real entre las
    dos es qué tipo_comprobante/monto/cbtes_asoc arma cada caller antes de llegar acá."""
    try:
        resultado = wsfe.fe_cae_solicitar(
            cuit,
            pto_vta,
            imp_neto=float(monto),
            doc_tipo=DOC_TIPO_CONSUMIDOR_FINAL,
            doc_nro=DOC_NRO_CONSUMIDOR_FINAL,
            cbte_tipo=tipo_comprobante,
            cbtes_asoc=cbtes_asoc,
        )
    except Exception as e:
        factura = _crear_factura_error(
            db,
            pedido_id,
            tipo_comprobante,
            pto_vta,
            monto,
            f"Error de conexión con ARCA: {e}",
            devolucion_id=devolucion_id,
            factura_original_id=factura_original_id,
        )
        raise HTTPException(502, factura.mensaje_error) from e

    if not resultado["aprobado"]:
        mensaje = "; ".join(
            f"{err['codigo']}: {err['mensaje']}" for err in resultado.get("errores", [])
        ) or "ARCA rechazó el comprobante."
        _crear_factura_error(
            db,
            pedido_id,
            tipo_comprobante,
            pto_vta,
            monto,
            mensaje,
            devolucion_id=devolucion_id,
            factura_original_id=factura_original_id,
        )
        raise HTTPException(502, mensaje)

    venc = resultado["vencimiento"]
    cae_vencimiento = venc if isinstance(venc, date) else datetime.strptime(venc, "%Y%m%d").date()
    observaciones = resultado.get("observaciones") or []

    factura = models.Factura(
        pedido_id=pedido_id,
        tipo_comprobante=tipo_comprobante,
        punto_venta=pto_vta,
        numero_comprobante=resultado["cbte_nro"],
        cae=resultado["cae"],
        cae_vencimiento=cae_vencimiento,
        fecha_emision=datetime.now(timezone.utc),
        importe_total=monto,
        doc_tipo=DOC_TIPO_CONSUMIDOR_FINAL,
        doc_nro=DOC_NRO_CONSUMIDOR_FINAL,
        estado="Emitida",
        mensaje_error=str(observaciones) if observaciones else None,
        devolucion_id=devolucion_id,
        factura_original_id=factura_original_id,
    )
    db.add(factura)
    db.commit()
    db.refresh(factura)
    return factura


def facturar_pedido(db: Session, pedido_id: int) -> models.Factura:
    pedido = db.get(models.Pedido, pedido_id)
    if not pedido:
        raise HTTPException(404, "El pedido indicado no existe.")
    if not pedido.facturar_arca:
        raise HTTPException(400, "Este pedido no está marcado para facturar.")
    if pedido.estado == "Cancelado":
        raise HTTPException(400, "Un pedido cancelado no se puede facturar.")

    ya_emitida = any(
        f.tipo_comprobante == TIPO_COMPROBANTE_FACTURA_C and f.estado == "Emitida"
        for f in pedido.facturas
    )
    if ya_emitida:
        raise HTTPException(400, "Este pedido ya tiene una factura emitida.")

    monto = calculations.monto_neto_pedido(db, pedido)
    if monto <= 0:
        raise HTTPException(
            400,
            "Este pedido no tiene monto pendiente de facturar — fue devuelto o cancelado en su "
            "totalidad.",
        )

    config = calculations.get_configuracion(db)
    if not config.arca_cuit:
        raise HTTPException(400, "Configurá el CUIT de ARCA en ⚙️ Configuración antes de facturar.")

    return _solicitar_cae_y_persistir(
        db,
        pedido_id=pedido_id,
        tipo_comprobante=TIPO_COMPROBANTE_FACTURA_C,
        monto=monto,
        cuit=config.arca_cuit,
        pto_vta=config.arca_punto_venta_defecto,
    )


def _factura_original_de(db: Session, devolucion: models.Devolucion) -> models.Factura | None:
    """Factura C emitida para el pedido de esta devolución, ANTES de la fecha de la devolución —
    mismo filtro que calculations.devolucion_requiere_nota_credito, para ubicar la fila real y
    armar CbtesAsoc con sus datos. Se re-consulta acá (no se le agrega esto a la función de
    calculations.py, que solo devuelve bool) porque solo hace falta en el camino de éxito/error
    puntual de emitir_nota_credito, no en la regla de elegibilidad en sí."""
    return (
        db.query(models.Factura)
        .filter(
            models.Factura.pedido_id == devolucion.pedido_id,
            models.Factura.tipo_comprobante == TIPO_COMPROBANTE_FACTURA_C,
            models.Factura.estado == "Emitida",
            models.Factura.created_at < devolucion.fecha,
        )
        .order_by(models.Factura.created_at.desc())
        .first()
    )


def emitir_nota_credito(db: Session, devolucion_id: int) -> models.Factura:
    """Fase D parte 2. Pide y persiste una Nota de Crédito C (tipo 13) para una Devolucion cuyo
    Pedido ya tenía una Factura C emitida antes de esa devolución — ver
    calculations.devolucion_requiere_nota_credito para la regla exacta. Manual, nunca se dispara
    sola desde calculations.procesar_devolucion."""
    devolucion = db.get(models.Devolucion, devolucion_id)
    if not devolucion:
        raise HTTPException(404, "La devolución indicada no existe.")

    if not calculations.devolucion_requiere_nota_credito(db, devolucion):
        if _factura_original_de(db, devolucion) is None:
            raise HTTPException(
                400,
                "Este pedido no tiene una Factura C emitida antes de esta devolución — no "
                "corresponde emitir Nota de Crédito.",
            )
        raise HTTPException(400, "Esta devolución ya tiene su Nota de Crédito emitida.")

    factura_original = _factura_original_de(db, devolucion)
    monto = calculations.monto_devolucion(db, devolucion)

    config = calculations.get_configuracion(db)
    if not config.arca_cuit:
        raise HTTPException(400, "Configurá el CUIT de ARCA en ⚙️ Configuración antes de facturar.")

    pto_vta = config.arca_punto_venta_defecto

    return _solicitar_cae_y_persistir(
        db,
        pedido_id=devolucion.pedido_id,
        tipo_comprobante=TIPO_COMPROBANTE_NOTA_CREDITO_C,
        monto=monto,
        cuit=config.arca_cuit,
        pto_vta=pto_vta,
        cbtes_asoc=[
            {
                "Tipo": factura_original.tipo_comprobante,
                "PtoVta": factura_original.punto_venta,
                "Nro": factura_original.numero_comprobante,
            }
        ],
        devolucion_id=devolucion.id,
        factura_original_id=factura_original.id,
    )
