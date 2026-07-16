"use server";

import { procesarCheckout } from "@/lib/checkout";
import type { CartItem, ResultadoCheckout } from "@/lib/types";

/**
 * Envoltura fina: FormData → objeto, delega toda la lógica real a procesarCheckout() (lib/checkout.ts).
 * `carrito` viaja bindeado (crearOrdenAction.bind(null, items)) porque no es un campo de formulario —
 * es el mecanismo nativo de Next.js para pasar datos extra a una Server Action invocada por <form action>.
 */
export async function crearOrdenAction(
  carrito: CartItem[],
  _prevState: ResultadoCheckout | null,
  formData: FormData
): Promise<ResultadoCheckout> {
  return procesarCheckout(carrito, {
    cliente_nombre: String(formData.get("cliente_nombre") ?? ""),
    cliente_email: String(formData.get("cliente_email") ?? "") || undefined,
    cliente_telefono: String(formData.get("cliente_telefono") ?? "") || undefined,
    forma_entrega: String(formData.get("forma_entrega") ?? "") as "Retiro en persona" | "Envío",
    direccion_envio: String(formData.get("direccion_envio") ?? "") || undefined,
    notas: String(formData.get("notas") ?? "") || undefined,
    metodo_pago_preferido: String(formData.get("metodo_pago_preferido") ?? "") || undefined,
  });
}
