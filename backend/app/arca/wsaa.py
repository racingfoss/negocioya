import base64
import datetime as dt
import json
import os
import time
import xml.etree.ElementTree as ET

import zeep
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.serialization import pkcs7

from . import config

# Cliente WSAA: autenticación contra ARCA. Aislado de wsfe.py porque es un paso previo
# genérico (sirve para cualquier servicio de ARCA, no solo WSFEv1) con su propio ciclo de
# vida de 12hs, cacheado en disco para no pedir un ticket nuevo en cada llamada a WSFEv1.

_MARGEN_VENCIMIENTO = dt.timedelta(minutes=5)


def _armar_tra(servicio: str) -> bytes:
    ahora = dt.datetime.now(dt.timezone.utc)
    generation_time = (ahora - dt.timedelta(minutes=10)).isoformat()
    expiration_time = (ahora + dt.timedelta(minutes=10)).isoformat()
    unique_id = int(time.time())
    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<loginTicketRequest version="1.0">'
        "<header>"
        f"<uniqueId>{unique_id}</uniqueId>"
        f"<generationTime>{generation_time}</generationTime>"
        f"<expirationTime>{expiration_time}</expirationTime>"
        "</header>"
        f"<service>{servicio}</service>"
        "</loginTicketRequest>"
    )
    return xml.encode("utf-8")


def _firmar_cms(tra_bytes: bytes) -> bytes:
    if not config.ARCA_CERT_PATH or not config.ARCA_KEY_PATH:
        raise RuntimeError(
            "ARCA_CERT_PATH/ARCA_KEY_PATH no están configurados (variables de entorno)."
        )
    with open(config.ARCA_CERT_PATH, "rb") as f:
        cert = x509.load_pem_x509_certificate(f.read())
    with open(config.ARCA_KEY_PATH, "rb") as f:
        clave = serialization.load_pem_private_key(f.read(), password=None)
    # Sin PKCS7Options.DetachedSignature: el contenido va embebido en el CMS ("nodetach"),
    # que es lo que exige WSAA. Binary evita la canonicalización tipo S/MIME (CRLF), que no
    # aplica acá porque la TRA es XML crudo, no un cuerpo de email.
    return (
        pkcs7.PKCS7SignatureBuilder()
        .set_data(tra_bytes)
        .add_signer(cert, clave, hashes.SHA256())
        .sign(serialization.Encoding.DER, [pkcs7.PKCS7Options.Binary])
    )


def _cache_path(servicio: str) -> str:
    os.makedirs(config.ARCA_CACHE_DIR, exist_ok=True)
    return os.path.join(
        config.ARCA_CACHE_DIR, f"ticket_{config.ARCA_ENTORNO}_{servicio}.json"
    )


def _leer_cache(servicio: str) -> dict | None:
    ruta = _cache_path(servicio)
    if not os.path.exists(ruta):
        return None
    with open(ruta) as f:
        data = json.load(f)
    vencimiento = dt.datetime.fromisoformat(data["expiration_time"])
    if dt.datetime.now(dt.timezone.utc) >= vencimiento - _MARGEN_VENCIMIENTO:
        return None
    return data


def _pedir_ticket(servicio: str) -> dict:
    cms = _firmar_cms(_armar_tra(servicio))
    cms_b64 = base64.b64encode(cms).decode()

    cliente = zeep.Client(wsdl=config.WSAA_URL)
    respuesta_xml = cliente.service.loginCms(in0=cms_b64)

    root = ET.fromstring(respuesta_xml)
    data = {
        "token": root.findtext(".//token"),
        "sign": root.findtext(".//sign"),
        "expiration_time": root.findtext(".//expirationTime"),
    }
    with open(_cache_path(servicio), "w") as f:
        json.dump(data, f)
    return data


def obtener_ticket(servicio: str = "wsfe") -> dict:
    """Token/Sign vigentes para `servicio` — del cache si todavía no venció, o pidiendo uno
    nuevo a WSAA si no. El ticket dura 12hs reales; acá se cachea en
    `{ARCA_CACHE_DIR}/ticket_{entorno}_{servicio}.json` para no pedir uno por cada llamada."""
    cache = _leer_cache(servicio)
    if cache is not None:
        return cache
    return _pedir_ticket(servicio)
