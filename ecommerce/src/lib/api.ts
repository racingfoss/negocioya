import type { ConfiguracionTienda, ProductoCatalogo } from "./types";

const API_URL = process.env.FASHBALANCE_API_URL;
const API_KEY = process.env.ECOMMERCE_API_KEY;

async function apiFetch<T>(path: string): Promise<T | null> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { "X-API-Key": API_KEY ?? "" },
    next: { revalidate: 60 },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`FashBalance API respondió ${res.status} en ${path}`);
  }
  return res.json();
}

export async function getCatalogo(): Promise<ProductoCatalogo[]> {
  const data = await apiFetch<ProductoCatalogo[]>("/ecommerce/catalogo");
  return data ?? [];
}

export async function getProducto(id: string | number): Promise<ProductoCatalogo | null> {
  return apiFetch<ProductoCatalogo>(`/ecommerce/catalogo/${id}`);
}

const CONFIGURACION_TIENDA_DEFAULT: ConfiguracionTienda = {
  nombre_ecommerce: "Adorante",
  whatsapp_numero: null,
  instagram_url: null,
  facebook_url: null,
};

export async function getConfiguracionTienda(): Promise<ConfiguracionTienda> {
  const data = await apiFetch<ConfiguracionTienda>("/ecommerce/configuracion-tienda");
  return data ?? CONFIGURACION_TIENDA_DEFAULT;
}
