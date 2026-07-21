"""Genera el PDF imprimible de una Factura C o Nota de Crédito C ya emitida (Fase E) — el CAE real
ya está persistido en `Factura` (Fase C / Fase D parte 2), acá solo se arma el comprobante visual +
QR a partir de eso. Vive al mismo nivel que facturacion.py (no adentro de arca/) porque necesita
leer Pedido/PedidoItem/Devolucion/DevolucionItem/Configuracion — arca/ sigue sin saber qué es un
Pedido, y este módulo no habla con ARCA (nunca importa arca.wsfe/wsaa).

Lanza ValueError, no HTTPException — mismo criterio que calculations.py: este módulo no se suma a
las dos únicas excepciones documentadas del proyecto que lanzan HTTPException directo
(calculations.validar_movimiento y facturacion.py). El router (routers/pedidos.py) traduce el
ValueError a un 400."""

from decimal import Decimal, ROUND_HALF_UP
from io import BytesIO
from xml.sax.saxutils import escape as _esc

import qrcode
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Image, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from sqlalchemy.orm import Session

from . import calculations, models
from .arca import qr as arca_qr

TIPO_COMPROBANTE_FACTURA_C = 11
TIPO_COMPROBANTE_NOTA_CREDITO_C = 13
_NOMBRE_TIPO = {
    TIPO_COMPROBANTE_FACTURA_C: "FACTURA",
    TIPO_COMPROBANTE_NOTA_CREDITO_C: "NOTA DE CRÉDITO",
}


def _money(monto: Decimal) -> str:
    """Formato es-AR: punto de miles, coma decimal — Decimal("12100.50") -> "12.100,50"."""
    monto = monto.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    entero, decimales = f"{monto:.2f}".split(".")
    negativo = entero.startswith("-")
    if negativo:
        entero = entero[1:]
    grupos = []
    while len(entero) > 3:
        grupos.insert(0, entero[-3:])
        entero = entero[:-3]
    grupos.insert(0, entero)
    return ("-" if negativo else "") + ".".join(grupos) + "," + decimales


def _numero_comprobante(punto_venta: int, numero: int) -> str:
    return f"{punto_venta:04d}-{numero:08d}"


def _items_factura_c(db: Session, factura: models.Factura) -> list[tuple[str, int, Decimal, Decimal]]:
    """(descripción, cantidad, precio_unitario, subtotal) por cada línea del Pedido facturado."""
    filas = []
    for item in factura.pedido.items:
        nombre = item.producto.nombre if item.producto else f"Producto #{item.producto_id}"
        variante = calculations.descripcion_variante(db, item.variante_id)
        descripcion = f"{nombre} - {variante}" if variante else nombre
        subtotal = item.precio_unitario * item.cantidad
        filas.append((descripcion, item.cantidad, item.precio_unitario, subtotal))
    return filas


def _items_nota_credito(
    db: Session, devolucion: models.Devolucion
) -> list[tuple[str, int, Decimal, Decimal]]:
    """Mismo formato que _items_factura_c, pero la cantidad sale de cada DevolucionItem (puede ser
    menor a la del PedidoItem original si la devolución fue parcial) y el precio unitario siempre
    sale del PedidoItem original, nunca del precio_venta actual del producto."""
    filas = []
    for it in devolucion.items:
        pedido_item = it.pedido_item
        nombre = (
            pedido_item.producto.nombre if pedido_item.producto else f"Producto #{pedido_item.producto_id}"
        )
        variante = calculations.descripcion_variante(db, pedido_item.variante_id)
        descripcion = f"{nombre} - {variante}" if variante else nombre
        subtotal = pedido_item.precio_unitario * it.cantidad
        filas.append((descripcion, it.cantidad, pedido_item.precio_unitario, subtotal))
    return filas


def _armar_story(
    config: models.Configuracion,
    factura: models.Factura,
    factura_original: models.Factura | None,
    items: list[tuple[str, int, Decimal, Decimal]],
    qr_buffer: BytesIO,
    es_nota_credito: bool,
) -> list:
    """Arma la lista de flowables de reportlab.platypus siguiendo el mockup aprobado: emisor
    arriba, datos de comprobante + CAE, receptor, tabla de ítems, totales, QR abajo del todo."""
    styles = getSampleStyleSheet()
    normal = styles["Normal"]
    bold = ParagraphStyle("bold", parent=normal, fontName="Helvetica-Bold")
    right = ParagraphStyle("right", parent=normal, alignment=TA_RIGHT)
    right_bold = ParagraphStyle("right_bold", parent=bold, alignment=TA_RIGHT)
    centrado = ParagraphStyle("centrado", parent=normal, alignment=TA_CENTER)
    letra_grande = ParagraphStyle(
        "letra_grande", parent=normal, alignment=TA_CENTER, fontSize=28, fontName="Helvetica-Bold"
    )

    story = []

    # --- Bloque emisor (izquierda) + letra/comprobante (derecha) ---
    emisor_lineas = [
        f"<b>{_esc(config.arca_razon_social)}</b>",
        f"CUIT: {_esc(config.arca_cuit)}",
        f"Domicilio: {_esc(config.arca_domicilio_fiscal)}",
        f"Condición frente al IVA: {_esc(config.arca_condicion_iva)}",
    ]
    if config.arca_inicio_actividades:
        emisor_lineas.append(
            f"Inicio de actividades: {config.arca_inicio_actividades.strftime('%d/%m/%Y')}"
        )
    emisor_parrafo = Paragraph("<br/>".join(emisor_lineas), normal)

    letra_box = Table(
        [
            [Paragraph("C", letra_grande)],
            [Paragraph(f"Cód. {factura.tipo_comprobante:02d}", centrado)],
        ],
        colWidths=[30 * mm],
    )
    letra_box.setStyle(
        TableStyle(
            [
                ("BOX", (0, 0), (-1, -1), 1, colors.black),
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )

    tipo_nombre = _NOMBRE_TIPO[factura.tipo_comprobante]
    fecha_emision = factura.fecha_emision.strftime("%d/%m/%Y") if factura.fecha_emision else "-"
    comprobante_lineas = [
        f"<b>{tipo_nombre}</b>",
        _numero_comprobante(factura.punto_venta, factura.numero_comprobante),
        f"Fecha de emisión: {fecha_emision}",
    ]
    comprobante_parrafo = Paragraph("<br/>".join(comprobante_lineas), right)

    header = Table(
        [[emisor_parrafo, letra_box], ["", comprobante_parrafo]],
        colWidths=[110 * mm, 60 * mm],
    )
    header.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("SPAN", (0, 0), (0, 1)),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ]
        )
    )
    story.append(header)
    story.append(Spacer(1, 4 * mm))

    if es_nota_credito and factura_original is not None:
        story.append(
            Paragraph(
                "Comprobante que rectifica: Factura C "
                + _numero_comprobante(factura_original.punto_venta, factura_original.numero_comprobante),
                normal,
            )
        )
        story.append(Spacer(1, 2 * mm))

    vencimiento = factura.cae_vencimiento.strftime("%d/%m/%Y") if factura.cae_vencimiento else "-"
    story.append(
        Paragraph(f"CAE: {factura.cae} &nbsp;&nbsp;&nbsp; Vencimiento CAE: {vencimiento}", normal)
    )
    story.append(Paragraph("Comprobante Autorizado", normal))
    story.append(Spacer(1, 4 * mm))

    # --- Receptor ---
    story.append(Paragraph("Cliente: Consumidor Final", bold))
    story.append(Spacer(1, 4 * mm))

    # --- Tabla de ítems ---
    filas = [["Cant.", "Descripción", "P. Unitario", "Subtotal"]]
    for descripcion, cantidad, precio_unitario, subtotal in items:
        filas.append([str(cantidad), _esc(descripcion), _money(precio_unitario), _money(subtotal)])
    tabla_items = Table(filas, colWidths=[15 * mm, 90 * mm, 30 * mm, 35 * mm], repeatRows=1)
    tabla_items.setStyle(
        TableStyle(
            [
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("ALIGN", (0, 0), (0, -1), "CENTER"),
                ("ALIGN", (2, 0), (-1, -1), "RIGHT"),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LINEBELOW", (0, 0), (-1, 0), 0.5, colors.black),
                ("LINEBELOW", (0, -1), (-1, -1), 0.5, colors.black),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ]
        )
    )
    story.append(tabla_items)
    story.append(Spacer(1, 3 * mm))

    # --- Totales ---
    story.append(Paragraph(f"<b>TOTAL: $ {_money(factura.importe_total)}</b>", right_bold))
    story.append(Spacer(1, 4 * mm))

    story.append(Paragraph("Responsable Monotributo — IVA no discriminado", normal))
    story.append(Spacer(1, 8 * mm))

    # --- QR, abajo del todo ---
    qr_img = Image(qr_buffer, width=35 * mm, height=35 * mm)
    qr_img.hAlign = "CENTER"
    story.append(qr_img)

    return story


def generar_pdf_factura(db: Session, factura: models.Factura) -> bytes:
    if factura.estado != "Emitida":
        raise ValueError("Solo se puede imprimir un comprobante ya Emitido.")

    config = calculations.get_configuracion(db)
    if not config.arca_razon_social or not config.arca_domicilio_fiscal:
        raise ValueError(
            "Completá Razón Social y Domicilio Fiscal en ⚙️ Configuración antes de imprimir un "
            "comprobante."
        )

    es_nota_credito = factura.tipo_comprobante == TIPO_COMPROBANTE_NOTA_CREDITO_C
    factura_original = None
    if es_nota_credito:
        devolucion = db.get(models.Devolucion, factura.devolucion_id)
        factura_original = db.get(models.Factura, factura.factura_original_id)
        items = _items_nota_credito(db, devolucion)
    else:
        items = _items_factura_c(db, factura)

    url_qr = arca_qr.construir_url_qr(
        fecha_emision=factura.fecha_emision.date(),
        cuit=int(config.arca_cuit),
        punto_venta=factura.punto_venta,
        tipo_comprobante=factura.tipo_comprobante,
        numero_comprobante=factura.numero_comprobante,
        importe_total=factura.importe_total,
        doc_tipo=factura.doc_tipo,
        doc_nro=factura.doc_nro,
        cae=factura.cae,
    )
    qr_buffer = BytesIO()
    qrcode.make(url_qr).save(qr_buffer, format="PNG")
    qr_buffer.seek(0)

    buffer = BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        topMargin=15 * mm,
        bottomMargin=15 * mm,
        leftMargin=15 * mm,
        rightMargin=15 * mm,
    )
    story = _armar_story(config, factura, factura_original, items, qr_buffer, es_nota_credito)
    doc.build(story)
    return buffer.getvalue()
