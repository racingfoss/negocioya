import datetime as dt

import zeep

from . import config, wsaa

# Cliente WSFEv1, acotado a lo que necesita Factura C (11) sin detalle de ítem — no
# implementa el resto del catálogo enorme de WSFEv1 (otros tipos de comprobante, CAEA, etc.).

_cliente: zeep.Client | None = None


def _client() -> zeep.Client:
    global _cliente
    if _cliente is None:
        _cliente = zeep.Client(wsdl=config.WSFE_URL)
    return _cliente


def _auth(cuit: str) -> dict:
    ticket = wsaa.obtener_ticket("wsfe")
    return {"Token": ticket["token"], "Sign": ticket["sign"], "Cuit": cuit}


def fe_dummy() -> dict:
    """Chequeo de conectividad, sin auth (WSFEv1 no la pide para este método)."""
    resultado = _client().service.FEDummy()
    return {
        "app_server": resultado.AppServer,
        "db_server": resultado.DbServer,
        "auth_server": resultado.AuthServer,
    }


def fe_comp_ultimo_autorizado(cuit: str, pto_vta: int, cbte_tipo: int = 11) -> int:
    """Último número de comprobante autorizado en ARCA para pto_vta/cbte_tipo. Se llama
    siempre antes de pedir un CAE — ARCA es la fuente de verdad del número, nunca se lleva
    un contador propio en la base que se pueda desincronizar."""
    resultado = _client().service.FECompUltimoAutorizado(
        Auth=_auth(cuit), PtoVta=pto_vta, CbteTipo=cbte_tipo
    )
    return resultado.CbteNro


def fe_cae_solicitar(
    cuit: str,
    pto_vta: int,
    imp_neto: float,
    doc_tipo: int = 99,
    doc_nro: int = 0,
    condicion_iva_receptor_id: int = 5,
    cbte_tipo: int = 11,
    cbtes_asoc: list[dict] | None = None,
    _incluir_iva_invalido: bool = False,
) -> dict:
    """Pide un CAE para una Factura C (cbte_tipo=11 por default) o, desde Fase D parte 2, una
    Nota de Crédito C (cbte_tipo=13). doc_tipo/doc_nro default a Consumidor Final (99/0),
    condicion_iva_receptor_id default a 5 (Consumidor Final) — este campo lo exige ARCA hoy en
    FECAEDetRequest aunque no estaba en el detalle original del prompt de esta fase.
    `fe_comp_ultimo_autorizado` ya toma `cbte_tipo` como parámetro, así que la numeración de la
    Nota de Crédito (independiente de la de Factura C) sale bien sin cambios ahí.

    `cbtes_asoc`, si se pasa (Nota de Crédito/Débito), arma el array `CbtesAsoc` con el/los
    comprobante(s) que se están acreditando/debitando — cada dict con las claves `"Tipo"`,
    `"PtoVta"`, `"Nro"` (mismos nombres de campo que ya usa `detalle` para hablarle a ARCA, los
    3 obligatorios). Confirmado contra los ejemplos oficiales de FECAESolicitar para Nota de
    Crédito C (AFIP SDK) y el manual de WSFEv1: los importes (`ImpNeto`/`ImpTotal`) se informan
    en POSITIVO igual que en una Factura — es el `cbte_tipo` (13) el que le indica a ARCA que es
    una nota de crédito, no el signo del importe. Por eso `fe_cae_solicitar` no le hace ningún
    tratamiento especial al signo de `imp_neto` acá: el caller (`facturacion.py`) le pasa el
    monto de la devolución tal cual, en positivo.

    `_incluir_iva_invalido` es solo para el script de prueba (caso de rechazo esperado): manda
    el array `Iva`, que WSFEv1 rechaza para tipo C. Nunca se usa en el camino normal.
    """
    nro = fe_comp_ultimo_autorizado(cuit, pto_vta, cbte_tipo) + 1
    detalle = {
        "Concepto": 1,
        "DocTipo": doc_tipo,
        "DocNro": doc_nro,
        "CbteDesde": nro,
        "CbteHasta": nro,
        "CbteFch": dt.date.today().strftime("%Y%m%d"),
        "ImpTotal": imp_neto,
        "ImpTotConc": 0,
        "ImpNeto": imp_neto,
        "ImpOpEx": 0,
        "ImpIVA": 0,
        "ImpTrib": 0,
        "MonId": "PES",
        "MonCotiz": 1,
        "CondicionIVAReceptorId": condicion_iva_receptor_id,
        # Sin la clave "Iva": está prohibida para Factura C, WSFEv1 la rechaza si viene.
    }
    if cbtes_asoc:
        detalle["CbtesAsoc"] = {"CbteAsoc": cbtes_asoc}
    if _incluir_iva_invalido:
        detalle["Iva"] = {
            "AlicIva": [{"Id": 5, "BaseImp": imp_neto, "Importe": imp_neto * 0.21}]
        }
    fe_cae_req = {
        "FeCabReq": {"CantReg": 1, "PtoVta": pto_vta, "CbteTipo": cbte_tipo},
        "FeDetReq": {"FECAEDetRequest": [detalle]},
    }
    resultado = _client().service.FECAESolicitar(Auth=_auth(cuit), FeCAEReq=fe_cae_req)
    return _interpretar_respuesta(resultado)


def _items(contenedor, nombre_item: str) -> list:
    """zeep puede exponer un ArrayOfX ya aplanado a lista, o como objeto con un atributo
    `nombre_item` conteniendo la lista, según cómo esté definido el array en el WSDL de ARCA.
    Soporta ambas formas para no romper según el detalle exacto de la respuesta real."""
    if contenedor is None:
        return []
    if isinstance(contenedor, list):
        return contenedor
    return getattr(contenedor, nombre_item, None) or []


def _interpretar_respuesta(resultado) -> dict:
    det = resultado.FeDetResp.FECAEDetResponse[0]
    # zeep lanza AttributeError (no devuelve None) al acceder directo a un elemento opcional
    # ausente en la respuesta — de ahí getattr(..., None) en vez de resultado.Errors/det.Obs.
    errores = [
        {"codigo": e.Code, "mensaje": e.Msg}
        for e in _items(getattr(resultado, "Errors", None), "Err")
    ]
    observaciones = [
        {"codigo": o.Code, "mensaje": o.Msg}
        for o in _items(getattr(det, "Observaciones", None), "Obs")
    ]

    if det.Resultado == "A":
        return {
            "aprobado": True,
            "cae": det.CAE,
            "cbte_nro": det.CbteDesde,
            "vencimiento": det.CAEFchVto,
            "observaciones": observaciones,
        }
    # Resultado == "R" (rechazado) o cualquier otro caso no aprobado: devolvemos el detalle
    # real de ARCA, nunca una excepción genérica sin contexto.
    return {
        "aprobado": False,
        "resultado": det.Resultado,
        "errores": errores or observaciones,
    }
