import Link from "next/link";

export default function PedidoConfirmadoPage({ searchParams }: { searchParams: { id?: string } }) {
  return (
    <div className="mx-auto max-w-lg space-y-4 py-16 text-center">
      <h1 className="font-serif text-3xl text-[#2a231f]">¡Gracias por tu compra!</h1>
      <p className="text-[#6b6058]">
        Tu pedido quedó registrado con el número <strong>#{searchParams.id ?? "—"}</strong>. Te vamos a
        contactar para coordinar la entrega y el pago.
      </p>
      <Link
        href="/"
        className="inline-block rounded-full bg-[#b5473a] px-6 py-3 font-medium text-white hover:bg-[#8a362c]"
      >
        Seguir comprando
      </Link>
    </div>
  );
}
