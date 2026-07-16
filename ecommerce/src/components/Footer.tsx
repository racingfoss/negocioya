import SocialLinks from "./SocialLinks";

export default function Footer({
  nombreTienda,
  instagram,
  facebook,
}: {
  nombreTienda: string;
  instagram: string | null;
  facebook: string | null;
}) {
  return (
    <footer className="mt-16 border-t border-[#e8ded2] bg-[#faf7f2]">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 px-4 py-8 text-sm text-[#6b6058] sm:flex-row sm:justify-between sm:px-6">
        <p>© {new Date().getFullYear()} {nombreTienda}. Todos los derechos reservados.</p>
        <SocialLinks instagram={instagram} facebook={facebook} />
      </div>
    </footer>
  );
}
