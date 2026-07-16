"use client";

import Link from "next/link";
import { useCart } from "@/context/CartContext";

export default function CartBadge() {
  const { cantidadTotal } = useCart();

  return (
    <Link href="/carrito" aria-label="Ver carrito" className="relative inline-flex text-[#2a231f] hover:text-[#b5473a]">
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M3.5 6h2.2l.6 3m0 0 1.4 8.2a1.8 1.8 0 0 0 1.8 1.5h8.6a1.8 1.8 0 0 0 1.77-1.47L21 9H6.3M9.5 21a.9.9 0 1 0 0-1.8.9.9 0 0 0 0 1.8Zm8 0a.9.9 0 1 0 0-1.8.9.9 0 0 0 0 1.8Z"
        />
      </svg>
      {cantidadTotal > 0 && (
        <span className="absolute -right-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#b5473a] px-1 text-xs font-semibold text-white">
          {cantidadTotal}
        </span>
      )}
    </Link>
  );
}
