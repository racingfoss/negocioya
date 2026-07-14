import Link from "next/link";
import SocialLinks from "./SocialLinks";

export default function Header() {
  return (
    <header className="border-b border-[#e8ded2] bg-[#faf7f2]/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
        <Link href="/" className="font-serif text-2xl tracking-tight text-[#2a231f]">
          FashBalance
        </Link>
        <SocialLinks className="text-[#2a231f]" />
      </div>
    </header>
  );
}
