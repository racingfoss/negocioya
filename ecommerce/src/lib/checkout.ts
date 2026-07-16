import type { CartItem, DatosContactoCheckout, ResultadoCheckout } from "./types";

const API_URL = process.env.FASHBALANCE_API_URL;
const API_KEY = process.env.ECOMMERCE_API_KEY;

/**
 * Lógica real del checkout, separada de la Server Action que la invoca (ver checkout/actions.ts)
 * para poder probarla directo con un script (ver scripts/test-checkout.ts), sin navegador ni
 * protocolo interno de Server Actions. Arma el payload y le pega a POST /ecommerce/ordenes con la
 * X-API-Key (nunca en código de cliente). El backend ya valida todo lo de negocio (forma_entrega,
 * dirección si Envío, stock por línea) atómicamente — acá solo repropagamos su `detail`.
 */
export async function procesarCheckout(
  carrito: CartItem[],
  datosContacto: DatosContactoCheckout
): Promise<ResultadoCheckout> {
  if (carrito.length === 0) {
    return { ok: false, error: "El carrito está vacío." };
  }
  if (!datosContacto.cliente_nombre?.trim()) {
    return { ok: false, error: "Falta el nombre." };
  }

  const payload = {
    cliente_nombre: datosContacto.cliente_nombre,
    cliente_email: datosContacto.cliente_email || undefined,
    cliente_telefono: datosContacto.cliente_telefono || undefined,
    forma_entrega: datosContacto.forma_entrega,
    direccion_envio: datosContacto.direccion_envio || undefined,
    notas: datosContacto.notas || undefined,
    metodo_pago_preferido: datosContacto.metodo_pago_preferido || undefined,
    lineas: carrito.map((i) => ({
      producto_id: i.producto_id,
      variante_id: i.variante_id,
      cantidad: i.cantidad,
    })),
  };

  try {
    const res = await fetch(`${API_URL}/ecommerce/ordenes`, {
      method: "POST",
      headers: { "X-API-Key": API_KEY ?? "", "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
    });

    if (res.status === 400) {
      const data = await res.json();
      return { ok: false, error: data.detail ?? "No pudimos procesar el pedido." };
    }
    if (!res.ok) {
      console.error(`FashBalance API respondió ${res.status} en POST /ecommerce/ordenes`);
      return { ok: false, error: "Error al conectar con el sistema. Probá de nuevo en un momento." };
    }

    const data = await res.json();
    return { ok: true, ordenId: data.id };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Error al conectar con el sistema. Probá de nuevo en un momento." };
  }
}
