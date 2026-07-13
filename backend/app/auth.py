import os

from fastapi import HTTPException, Security
from fastapi.security import APIKeyHeader

# APIKeyHeader (no Header() a mano) para que Swagger (/docs) muestre el candado y se pueda
# probar el catálogo/las órdenes desde ahí sin armar los headers a mano.
_api_key_scheme = APIKeyHeader(name="X-API-Key", auto_error=False)


def require_ecommerce_api_key(api_key: str | None = Security(_api_key_scheme)) -> None:
    """Dependency reusable para los endpoints públicos de e-commerce (GET /ecommerce/catalogo,
    POST /ecommerce/ordenes). El resto del backend sigue sin autenticación, como hoy."""
    esperado = os.getenv("ECOMMERCE_API_KEY")
    if not esperado or not api_key or api_key != esperado:
        raise HTTPException(401, "API key inválida o ausente.")
