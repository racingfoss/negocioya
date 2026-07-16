"use client";

import { useEffect, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useCart } from "@/context/CartContext";
import { formatearPrecio } from "@/lib/urls";
import { crearOrdenAction } from "./actions";

const METODOS_PAGO = ["Efectivo al retirar", "Transferencia bancaria"];

function BotonConfirmar() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-full bg-[#b5473a] px-8 py-3 font-medium text-white hover:bg-[#8a362c] disabled:opacity-50"
    >
      {pending ? "Procesando..." : "Confirmar pedido"}
    </button>
  );
}

export default function CheckoutForm() {
  const { items, total, vaciarCarrito } = useCart();
  const router = useRouter();
  const [formaEntrega, setFormaEntrega] = useState<"Retiro en persona" | "Envío">("Retiro en persona");
  const [estado, formAction] = useFormState(crearOrdenAction.bind(null, items), null);

  useEffect(() => {
    if (estado?.ok) {
      vaciarCarrito();
      router.push(`/pedido-confirmado?id=${estado.ordenId}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  if (items.length === 0) {
    return (
      <p className="text-[#6b6058]">
        Tu carrito está vacío. <Link href="/carrito" className="text-[#b5473a] underline">Volver al carrito</Link>
      </p>
    );
  }

  return (
    <div className="grid gap-8 sm:grid-cols-2">
      <form action={formAction} className="space-y-5">
        <div>
          <label className="mb-1 block text-sm font-medium text-[#2a231f]">Nombre</label>
          <input
            name="cliente_nombre"
            required
            className="w-full rounded-lg border border-[#e8ded2] bg-white px-3 py-2 text-[#2a231f]"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-[#2a231f]">Email (opcional)</label>
          <input
            type="email"
            name="cliente_email"
            className="w-full rounded-lg border border-[#e8ded2] bg-white px-3 py-2 text-[#2a231f]"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-[#2a231f]">Teléfono (opcional)</label>
          <input
            name="cliente_telefono"
            className="w-full rounded-lg border border-[#e8ded2] bg-white px-3 py-2 text-[#2a231f]"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-[#2a231f]">Forma de entrega</label>
          <div className="flex gap-4">
            {(["Retiro en persona", "Envío"] as const).map((opcion) => (
              <label key={opcion} className="flex items-center gap-2 text-sm text-[#2a231f]">
                <input
                  type="radio"
                  name="forma_entrega"
                  value={opcion}
                  checked={formaEntrega === opcion}
                  onChange={() => setFormaEntrega(opcion)}
                />
                {opcion}
              </label>
            ))}
          </div>
        </div>

        {formaEntrega === "Envío" && (
          <div>
            <label className="mb-1 block text-sm font-medium text-[#2a231f]">Dirección de envío</label>
            <input
              name="direccion_envio"
              required
              className="w-full rounded-lg border border-[#e8ded2] bg-white px-3 py-2 text-[#2a231f]"
            />
          </div>
        )}

        <div>
          <label className="mb-1 block text-sm font-medium text-[#2a231f]">Notas (opcional)</label>
          <textarea
            name="notas"
            rows={2}
            className="w-full rounded-lg border border-[#e8ded2] bg-white px-3 py-2 text-[#2a231f]"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-[#2a231f]">Método de pago</label>
          <div className="space-y-2">
            {METODOS_PAGO.map((metodo) => (
              <label key={metodo} className="flex items-center gap-2 text-sm text-[#2a231f]">
                <input type="radio" name="metodo_pago_preferido" value={metodo} defaultChecked={metodo === METODOS_PAGO[0]} />
                {metodo}
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-[#a89c8d]">
            Es solo informativo para coordinar el pago — no procesamos pagos online en esta etapa.
          </p>
        </div>

        {estado && !estado.ok && (
          <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{estado.error}</p>
        )}

        <BotonConfirmar />
      </form>

      <div className="space-y-3 rounded-2xl border border-[#e8ded2] bg-white p-4 h-fit">
        <h2 className="font-serif text-xl text-[#2a231f]">Resumen del pedido</h2>
        <div className="divide-y divide-[#e8ded2]">
          {items.map((item) => (
            <div key={`${item.producto_id}-${item.variante_id ?? "sin-variante"}`} className="flex justify-between py-2 text-sm">
              <div>
                <p className="text-[#2a231f]">
                  {item.nombre}
                  {item.variante_descripcion ? ` (${item.variante_descripcion})` : ""} x{item.cantidad}
                </p>
              </div>
              <p className="text-[#2a231f]">{formatearPrecio(String(item.precio_venta * item.cantidad))}</p>
            </div>
          ))}
        </div>
        <div className="flex justify-between border-t border-[#e8ded2] pt-3 font-medium">
          <p className="text-[#2a231f]">Total</p>
          <p className="text-lg text-[#b5473a]">{formatearPrecio(String(total))}</p>
        </div>
      </div>
    </div>
  );
}
