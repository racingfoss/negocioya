export function fotoUrl(rutaArchivo: string): string {
  const base = process.env.FASHBALANCE_PUBLIC_URL ?? "";
  return `${base}/fotos/${rutaArchivo}`;
}

export function formatearPrecio(precio: string): string {
  const numero = Number(precio);
  return numero.toLocaleString("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}
