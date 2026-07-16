import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getConfiguracionTienda, getProducto } from "@/lib/api";
import { fotoUrl, formatearPrecio } from "@/lib/urls";
import ProductGallery from "@/components/ProductGallery";
import VariantSelector from "./VariantSelector";

export const dynamic = "force-dynamic";

type Params = { params: { id: string } };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const producto = await getProducto(params.id);
  if (!producto) return {};

  const titulo = `${producto.nombre} — ${formatearPrecio(producto.precio_venta)}`;
  const descripcion = producto.descripcion_ecommerce ?? undefined;
  const portada = producto.fotos[0];
  const imagen = portada ? fotoUrl(portada.ruta_archivo) : undefined;

  return {
    title: titulo,
    description: descripcion,
    openGraph: {
      title: titulo,
      description: descripcion,
      images: imagen ? [{ url: imagen }] : undefined,
    },
  };
}

export default async function ProductoPage({ params }: Params) {
  const [producto, config] = await Promise.all([getProducto(params.id), getConfiguracionTienda()]);
  if (!producto) notFound();

  const fotos = [...producto.fotos]
    .sort((a, b) => a.orden - b.orden)
    .map((f) => ({ id: f.id, url: fotoUrl(f.ruta_archivo) }));

  return (
    <div className="grid gap-8 sm:grid-cols-2">
      <ProductGallery fotos={fotos} nombre={producto.nombre} />

      <div>
        {producto.categoria && (
          <p className="text-sm uppercase tracking-wide text-[#a89c8d]">{producto.categoria}</p>
        )}
        <h1 className="mt-1 font-serif text-3xl text-[#2a231f]">{producto.nombre}</h1>
        <p className="mt-2 text-2xl font-semibold text-[#b5473a]">{formatearPrecio(producto.precio_venta)}</p>

        {producto.descripcion_ecommerce && (
          <p className="mt-4 whitespace-pre-line text-[#6b6058]">{producto.descripcion_ecommerce}</p>
        )}

        <div className="mt-6">
          {producto.tiene_variantes ? (
            <VariantSelector variantes={producto.variantes ?? []} />
          ) : (
            <p className={`text-sm font-medium ${(producto.stock_actual ?? 0) > 0 ? "text-green-700" : "text-red-700"}`}>
              {(producto.stock_actual ?? 0) > 0 ? "Disponible" : "Sin stock"}
            </p>
          )}
        </div>

        <div className="mt-8">
          <WhatsAppButtonInline nombre={producto.nombre} numero={config.whatsapp_numero} />
        </div>
      </div>
    </div>
  );
}

function WhatsAppButtonInline({ nombre, numero }: { nombre: string; numero: string | null }) {
  if (!numero) return null;
  const mensaje = encodeURIComponent(`Hola! Quería consultar por "${nombre}".`);
  return (
    <a
      href={`https://wa.me/${numero}?text=${mensaje}`}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-2 rounded-full bg-[#25D366] px-5 py-3 font-medium text-white hover:brightness-95"
    >
      Consultar por WhatsApp
    </a>
  );
}
