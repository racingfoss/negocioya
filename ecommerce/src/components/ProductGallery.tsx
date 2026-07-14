"use client";

import { useState } from "react";

export interface FotoResuelta {
  id: number;
  url: string;
}

export default function ProductGallery({ fotos, nombre }: { fotos: FotoResuelta[]; nombre: string }) {
  const [activa, setActiva] = useState(0);

  if (fotos.length === 0) {
    return (
      <div className="flex aspect-[3/4] items-center justify-center rounded-2xl bg-[#f0e9df] text-[#a89c8d]">
        Sin fotos
      </div>
    );
  }

  return (
    <div>
      {/* eslint-disable-next-line @next/next/no-img-element -- ver nota en ProductCard.tsx */}
      <img
        src={fotos[activa].url}
        alt={nombre}
        className="aspect-[3/4] w-full rounded-2xl object-cover"
      />
      {fotos.length > 1 && (
        <div className="mt-3 flex gap-2 overflow-x-auto">
          {fotos.map((foto, i) => (
            <button
              key={foto.id}
              onClick={() => setActiva(i)}
              className={`h-16 w-16 shrink-0 overflow-hidden rounded-lg border-2 ${
                i === activa ? "border-[#b5473a]" : "border-transparent"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={foto.url} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
