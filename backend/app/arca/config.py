import os

# Configuración de infraestructura para la integración con ARCA (WSAA + WSFEv1). Solo lo que
# depende del filesystem/red del contenedor vive acá como variable de entorno (rutas de
# certificado, URLs de ARCA). El CUIT, el punto de venta y los datos de la Razón Social son
# datos de negocio editables desde ⚙️ Configuración (tabla `configuracion`) — este módulo no
# los lee, se los pasan como parámetro explícito los callers (ver arca/wsfe.py).

ARCA_ENTORNO = os.getenv("ARCA_ENTORNO", "testing")  # "testing" | "produccion"
ARCA_CERT_PATH = os.getenv("ARCA_CERT_PATH")
ARCA_KEY_PATH = os.getenv("ARCA_KEY_PATH")

_URLS = {
    "testing": {
        "wsaa": "https://wsaahomo.afip.gov.ar/ws/services/LoginCms?wsdl",
        "wsfe": "https://wswhomo.afip.gov.ar/wsfev1/service.asmx?WSDL",
    },
    "produccion": {
        "wsaa": "https://wsaa.afip.gov.ar/ws/services/LoginCms?wsdl",
        "wsfe": "https://servicios1.afip.gov.ar/wsfev1/service.asmx?WSDL",
    },
}

if ARCA_ENTORNO not in _URLS:
    raise ValueError(
        f"ARCA_ENTORNO={ARCA_ENTORNO!r} inválido, tiene que ser 'testing' o 'produccion'."
    )

WSAA_URL = _URLS[ARCA_ENTORNO]["wsaa"]
WSFE_URL = _URLS[ARCA_ENTORNO]["wsfe"]

# Cache del ticket de acceso de WSAA (Token/Sign), separado del bind mount de certificados
# (que es de solo lectura) porque acá sí necesitamos escribir.
ARCA_CACHE_DIR = os.getenv("ARCA_CACHE_DIR", "/app/arca_cache")
