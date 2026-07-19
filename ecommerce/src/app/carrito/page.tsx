"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useCart } from "@/context/CartContext";
import { formatearPrecio } from "@/lib/urls";
import { obtenerStockFresco, type StockFrescoProducto } from "./actions";

/**
 * Stock fresco (recién pedido a FashBalance) de la línea, para no confiar en el `stock_actual`
 * guardado en el carrito al momento de agregar el producto. `undefined` = todavía no llegó la
 * revalidación (no se muestra ningún aviso mientras tanto, no hace falta spinner agresivo).
 */
function stockFrescoDeLinea(
  item: { producto_id: number; variante_id: number | null },
  datos: Record<number, StockFrescoProducto | null>
): number | undefined {
  const producto = datos[item.producto_id];
  if (producto === undefined) return undefined;
  if (producto === null) return 0;
  if (item.variante_id != null) {
    const variante = producto.variantes?.find((v) => v.id === item.variante_id);
    return variante ? variante.stock_actual : 0;
  }
  return producto.stock_actual ?? 0;
}

export default function CarritoPage() {
  const { items, actualizarCantidad, quitarItem, total } = useCart();
  const [stockFresco, setStockFresco] = useState<Record<number, StockFrescoProducto | null>>({});

  useEffect(() => {
    if (items.length === 0) return;
    const idsUnicos = Array.from(new Set(items.map((i) => i.producto_id)));
    obtenerStockFresco(idsUnicos)
      .then(setStockFresco)
      .catch(() => {
        // si falla la revalidación, el carrito sigue mostrándose con el stock conocido al agregar
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (items.length === 0) {
    return (
      <div className="py-16 text-center">
        <p className="text-[#6b6058]">Tu carrito está vacío.</p>
        <Link href="/" className="mt-4 inline-block rounded-full bg-[#b5473a] px-6 py-3 font-medium text-white hover:bg-[#8a362c]">
          Ver productos
        </Link>
      </div>
    );
  }

  const hayLineaSinStock = items.some((item) => stockFrescoDeLinea(item, stockFresco) === 0);

  return (
    <div className="space-y-6">
      <h1 className="font-serif text-3xl text-[#2a231f]">Tu carrito</h1>

      <div className="divide-y divide-[#e8ded2] rounded-2xl border border-[#e8ded2] bg-white">
        {items.map((item) => {
          const disponibleFresco = stockFrescoDeLinea(item, stockFresco);
          const sinStock = disponibleFresco === 0;
          const stockInsuficiente = disponibleFresco !== undefined && disponibleFresco > 0 && disponibleFresco < item.cantidad;

          return (
            <div key={`${item.producto_id}-${item.variante_id ?? "sin-variante"}`} className="p-4">
              <div className="flex items-center gap-4">
                <div className="h-20 w-16 flex-shrink-0 overflow-hidden rounded-lg bg-[#f0e9df]">
                  {item.foto ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.foto} alt={item.nombre} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-xs text-[#a89c8d]">Sin foto</div>
                  )}
                </div>

                <div className="flex-1">
                  <p className="font-medium text-[#2a231f]">{item.nombre}</p>
                  {item.variante_descripcion && (
                    <p className="text-sm text-[#6b6058]">{item.variante_descripcion}</p>
                  )}
                  <p className="mt-1 text-sm text-[#a89c8d]">{formatearPrecio(String(item.precio_venta))} c/u</p>
                </div>

                <input
                  type="number"
                  min={1}
                  max={item.stock_actual}
                  value={item.cantidad}
                  onChange={(e) =>
                    actualizarCantidad(item.producto_id, item.variante_id, Number(e.target.value) || 1)
                  }
                  className="w-16 rounded-lg border border-[#e8ded2] bg-white px-2 py-2 text-center text-[#2a231f]"
                />

                <p className="w-24 text-right font-medium text-[#2a231f]">
                  {formatearPrecio(String(item.precio_venta * item.cantidad))}
                </p>

                <button
                  onClick={() => quitarItem(item.producto_id, item.variante_id)}
                  aria-label="Sacar del carrito"
                  className="text-sm text-[#a89c8d] hover:text-[#b5473a]"
                >
                  Sacar
                </button>
              </div>

              {sinStock && (
                <p className="mt-2 text-sm font-medium text-red-700">
                  Ya no hay stock de este producto{item.variante_descripcion ? ` (${item.variante_descripcion})` : ""}. Sacalo del carrito o esperá a que se repongan.
                </p>
              )}
              {stockInsuficiente && (
                <p className="mt-2 text-sm font-medium text-amber-700">
                  Solo quedan {disponibleFresco} disponibles.
                </p>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between rounded-2xl border border-[#e8ded2] bg-white p-4">
        <p className="text-lg font-medium text-[#2a231f]">Total</p>
        <p className="text-2xl font-semibold text-[#b5473a]">{formatearPrecio(String(total))}</p>
      </div>

      <div className="text-right">
        {hayLineaSinStock ? (
          <div className="inline-block">
            <button
              disabled
              className="cursor-not-allowed rounded-full bg-[#e8ded2] px-8 py-3 font-medium text-[#a89c8d]"
            >
              Finalizar compra
            </button>
            <p className="mt-2 text-sm text-red-700">
              Ajustá o sacá las líneas sin stock para poder continuar.
            </p>
          </div>
        ) : (
          <Link
            href="/checkout"
            className="inline-block rounded-full bg-[#b5473a] px-8 py-3 font-medium text-white hover:bg-[#8a362c]"
          >
            Finalizar compra
          </Link>
        )}
      </div>
    </div>
  );
}
