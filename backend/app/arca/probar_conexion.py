"""Script de prueba manual contra el ambiente de homologación de ARCA (Fase A).

No es parte de la API — se corre a mano con:
    docker compose exec backend python -m app.arca.probar_conexion

Corre los 5 pasos pedidos para esta fase: FEDummy, obtener ticket WSAA, último comprobante
autorizado, pedir un CAE real, y confirmar que un caso inválido (Iva en Factura C) se rechaza
con el detalle de ARCA en vez de una excepción sin manejar. No toca Pedido/OrdenEcommerce/Caja
ni ninguna pantalla — solo imprime resultados por consola.
"""

from .. import calculations
from ..database import SessionLocal
from . import wsaa, wsfe


def _leer_config_facturacion() -> tuple[str, int]:
    db = SessionLocal()
    try:
        config = calculations.get_configuracion(db)
        return config.arca_cuit, config.arca_punto_venta_defecto
    finally:
        db.close()


def main() -> None:
    cuit, pto_vta = _leer_config_facturacion()
    if not cuit:
        print(
            "❌ No hay CUIT cargado. Andá a ⚙️ Configuración (sección 'ARCA / Facturación "
            "electrónica') y cargá el CUIT antes de correr esta prueba."
        )
        return

    print(f"CUIT: {cuit} · Punto de venta: {pto_vta}")

    print("\n1) FEDummy — chequeo de conectividad")
    print(wsfe.fe_dummy())

    print("\n2) WSAA — obtener ticket de acceso (Token/Sign)")
    ticket = wsaa.obtener_ticket("wsfe")
    print(
        f"Token obtenido (len={len(ticket['token'] or '')}), "
        f"Sign obtenido (len={len(ticket['sign'] or '')}), "
        f"vence: {ticket['expiration_time']}"
    )

    print("\n3) FECompUltimoAutorizado — Factura C, punto de venta", pto_vta)
    ultimo = wsfe.fe_comp_ultimo_autorizado(cuit, pto_vta)
    print(f"Último comprobante autorizado: {ultimo}")

    print("\n4) FECAESolicitar — Factura C de prueba, ImpNeto=1000, Consumidor Final")
    resultado = wsfe.fe_cae_solicitar(cuit, pto_vta, imp_neto=1000)
    if resultado["aprobado"]:
        print(f"✅ CAE: {resultado['cae']} · Vencimiento: {resultado['vencimiento']}")
        if resultado["observaciones"]:
            print(f"   Observaciones: {resultado['observaciones']}")
    else:
        print(f"❌ Rechazado (no debería pasar en este caso): {resultado}")

    print("\n5) Caso de rechazo esperado — Factura C con array <Iva> incluido a propósito")
    resultado_invalido = wsfe.fe_cae_solicitar(
        cuit, pto_vta, imp_neto=1000, _incluir_iva_invalido=True
    )
    if resultado_invalido["aprobado"]:
        print(f"⚠️  Se aprobó igual (inesperado): {resultado_invalido}")
    else:
        print(f"✅ Rechazado como se esperaba: {resultado_invalido}")


if __name__ == "__main__":
    main()
