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
DOC_TIPO_CONSUMIDOR_FINAL = 99
DOC_NRO_CONSUMIDOR_FINAL = 0


def _crear_factura_error(
    db: Session, pedido_id: int, pto_vta: int, monto: Decimal, mensaje: str
) -> models.Factura:
    """Persiste el intento fallido AHORA (commit propio, no al final de la request) para que
    quede historial aunque el endpoint termine devolviendo un error — confirmado seguro contra
    el manejo de sesión de database.py (get_db() solo hace close() en el finally, sin rollback
    implícito), así que este commit no se pierde aunque después se lance la HTTPException."""
    factura = models.Factura(
        pedido_id=pedido_id,
        tipo_comprobante=TIPO_COMPROBANTE_FACTURA_C,
        punto_venta=pto_vta,
        importe_total=monto,
        doc_tipo=DOC_TIPO_CONSUMIDOR_FINAL,
        doc_nro=DOC_NRO_CONSUMIDOR_FINAL,
        estado="Error",
        mensaje_error=mensaje,
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

    pto_vta = config.arca_punto_venta_defecto

    try:
        resultado = wsfe.fe_cae_solicitar(
            config.arca_cuit,
            pto_vta,
            imp_neto=float(monto),
            doc_tipo=DOC_TIPO_CONSUMIDOR_FINAL,
            doc_nro=DOC_NRO_CONSUMIDOR_FINAL,
            cbte_tipo=TIPO_COMPROBANTE_FACTURA_C,
        )
    except Exception as e:
        factura = _crear_factura_error(
            db, pedido_id, pto_vta, monto, f"Error de conexión con ARCA: {e}"
        )
        raise HTTPException(502, factura.mensaje_error) from e

    if not resultado["aprobado"]:
        mensaje = "; ".join(
            f"{err['codigo']}: {err['mensaje']}" for err in resultado.get("errores", [])
        ) or "ARCA rechazó el comprobante."
        _crear_factura_error(db, pedido_id, pto_vta, monto, mensaje)
        raise HTTPException(502, mensaje)

    venc = resultado["vencimiento"]
    cae_vencimiento = venc if isinstance(venc, date) else datetime.strptime(venc, "%Y%m%d").date()
    observaciones = resultado.get("observaciones") or []

    factura = models.Factura(
        pedido_id=pedido_id,
        tipo_comprobante=TIPO_COMPROBANTE_FACTURA_C,
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
    )
    db.add(factura)
    db.commit()
    db.refresh(factura)
    return factura
