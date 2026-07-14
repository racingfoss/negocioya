import { getCatalogo } from "@/lib/api";
import ProductCard from "@/components/ProductCard";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const productos = await getCatalogo();

  if (productos.length === 0) {
    return (
      <div className="py-24 text-center text-[#6b6058]">
        Todavía no hay productos publicados.
      </div>
    );
  }

  return (
    <div>
      <h1 className="mb-8 font-serif text-3xl text-[#2a231f]">Nuestros productos</h1>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-6 lg:grid-cols-4">
        {productos.map((producto) => (
          <ProductCard key={producto.id} producto={producto} />
        ))}
      </div>
    </div>
  );
}
