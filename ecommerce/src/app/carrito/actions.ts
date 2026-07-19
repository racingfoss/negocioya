"use server";

import type { ProductoCatalogo } from "@/lib/types";

const API_URL = process.env.FASHBALANCE_API_URL;
const API_KEY = process.env.ECOMMERCE_API_KEY;

export interface StockFrescoProducto {
  id: number;
  tiene_variantes: boolean;
  stock_actual: number | null;
  variantes: { id: number; stock_actual: number }[] | null;
}

/**
 * A diferencia de getProducto() (lib/api.ts), acá se pega directo a la API con cache: "no-store" en
 * vez de reusar apiFetch() — ese helper está atado a `next: { revalidate: 60 }`, que serviría un
 * stock viejo desde la Data Cache de Next.js justo en el caso que esta revalidación existe para
 * cubrir (el carrito quedó abierto un rato y alguien más compró la última unidad mientras tanto).
 */
async function fetchProductoFresco(id: number): Promise<ProductoCatalogo | null> {
  const res = await fetch(`${API_URL}/ecommerce/catalogo/${id}`, {
    headers: { "X-API-Key": API_KEY ?? "" },
    cache: "no-store",
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    console.error(`FashBalance API respondió ${res.status} en /ecommerce/catalogo/${id}`);
    return null;
  }
  return res.json();
}

/**
 * Revalida el stock real de cada producto_id distinto presente en el carrito (GET
 * /ecommerce/catalogo/{id} ya existente, sin endpoint nuevo). `null` para un id significa que el
 * producto ya no existe o dejó de estar activo/visible — se trata como stock 0 del lado del cliente.
 */
export async function obtenerStockFresco(
  productoIds: number[]
): Promise<Record<number, StockFrescoProducto | null>> {
  const idsUnicos = Array.from(new Set(productoIds));
  const entradas = await Promise.all(
    idsUnicos.map(async (id) => {
      const producto = await fetchProductoFresco(id);
      if (!producto) return [id, null] as const;
      return [
        id,
        {
          id: producto.id,
          tiene_variantes: producto.tiene_variantes,
          stock_actual: producto.stock_actual,
          variantes: producto.variantes
            ? producto.variantes.map((v) => ({ id: v.id, stock_actual: v.stock_actual }))
            : null,
        },
      ] as const;
    })
  );
  return Object.fromEntries(entradas);
}
