import Link from "next/link";
import SocialLinks from "./SocialLinks";
import CartBadge from "./CartBadge";

export default function Header({
  nombreTienda,
  instagram,
  facebook,
}: {
  nombreTienda: string;
  instagram: string | null;
  facebook: string | null;
}) {
  return (
    <header className="border-b border-[#e8ded2] bg-[#faf7f2]/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
        <Link href="/" className="font-serif text-2xl tracking-tight text-[#2a231f]">
          {nombreTienda}
        </Link>
        <div className="flex items-center gap-4">
          <CartBadge />
          <SocialLinks className="text-[#2a231f]" instagram={instagram} facebook={facebook} />
        </div>
      </div>
    </header>
  );
}
