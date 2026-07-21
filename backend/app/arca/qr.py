"""QR de comprobante electrónico (ARCA, RG 4892 — versión 1 del formato). Módulo puro, sin acceso
a DB — mismo criterio que wsaa.py/wsfe.py (agnóstico de Pedido/Factura, solo recibe valores ya
resueltos por el caller). Sin importar `qrcode` acá a propósito: renderizar el PNG es
responsabilidad de la capa de presentación (facturas_pdf.py), esto solo arma la URL a codificar."""

import base64
import json
from datetime import date
from decimal import Decimal

URL_BASE = "https://www.arca.gob.ar/fe/qr/"


def construir_url_qr(
    *,
    fecha_emision: date,
    cuit: int,
    punto_venta: int,
    tipo_comprobante: int,
    numero_comprobante: int,
    importe_total: Decimal,
    doc_tipo: int,
    doc_nro: int,
    cae: str,
) -> str:
    """Arma la URL que hay que codificar en el QR según la especificación ARCA (RG 4892, v1):
    {URL_BASE}?p={JSON en Base64}. moneda/ctz/tipoCodAut son siempre "PES"/1/"E" en este
    proyecto (nunca otra moneda, nunca CAEA)."""
    payload = {
        "ver": 1,
        "fecha": fecha_emision.strftime("%Y-%m-%d"),
        "cuit": cuit,
        "ptoVta": punto_venta,
        "tipoCmp": tipo_comprobante,
        "nroCmp": numero_comprobante,
        "importe": float(round(importe_total, 2)),
        "moneda": "PES",
        "ctz": 1,
        "tipoDocRec": doc_tipo,
        "nroDocRec": doc_nro,
        "tipoCodAut": "E",
        "codAut": int(cae),
    }
    json_base64 = base64.b64encode(json.dumps(payload).encode("utf-8")).decode("ascii")
    return f"{URL_BASE}?p={json_base64}"
