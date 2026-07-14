import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
      <h1 className="font-serif text-3xl text-[#2a231f]">No encontramos esta página</h1>
      <p className="text-[#6b6058]">Puede que el producto ya no esté disponible.</p>
      <Link href="/" className="rounded-full bg-[#b5473a] px-6 py-2 text-white hover:bg-[#8a362c]">
        Volver a la tienda
      </Link>
    </div>
  );
}
