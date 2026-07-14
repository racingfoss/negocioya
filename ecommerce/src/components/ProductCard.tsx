import Link from "next/link";
import type { ProductoCatalogo } from "@/lib/types";
import { fotoUrl, formatearPrecio } from "@/lib/urls";

export default function ProductCard({ producto }: { producto: ProductoCatalogo }) {
  const portada = producto.fotos[0];

  return (
    <Link
      href={`/productos/${producto.id}`}
      className="group block overflow-hidden rounded-2xl border border-[#e8ded2] bg-white transition-shadow hover:shadow-lg"
    >
      <div className="relative aspect-[3/4] w-full overflow-hidden bg-[#f0e9df]">
        {portada ? (
          // eslint-disable-next-line @next/next/no-img-element -- host de fotos es una IP/dominio
          // configurable por env var (FASHBALANCE_PUBLIC_URL), no vale la pena el setup de
          // remotePatterns de next/image para esto
          <img
            src={fotoUrl(portada.ruta_archivo)}
            alt={producto.nombre}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-[#a89c8d]">Sin foto</div>
        )}
      </div>
      <div className="p-4">
        <h2 className="truncate text-base font-medium text-[#2a231f]">{producto.nombre}</h2>
        <p className="mt-1 text-lg font-semibold text-[#b5473a]">{formatearPrecio(producto.precio_venta)}</p>
      </div>
    </Link>
  );
}
