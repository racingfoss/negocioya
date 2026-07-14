"use client";

import { useMemo, useState } from "react";
import type { Variante } from "@/lib/types";
import {
  derivarAtributosProducto,
  elegirValorAtributo,
  opcionesParaAtributo,
  type ValoresElegidos,
} from "@/lib/attributes";

export default function VariantSelector({ variantes }: { variantes: Variante[] }) {
  const atributosProducto = useMemo(() => derivarAtributosProducto(variantes), [variantes]);
  const [valoresElegidos, setValoresElegidos] = useState<ValoresElegidos>({});

  if (variantes.length === 0) {
    return (
      <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
        Este producto todavía no tiene variantes cargadas.
      </p>
    );
  }

  const opcionesPrimerAtributo = opcionesParaAtributo(atributosProducto[0], 0, atributosProducto, variantes, valoresElegidos);
  const sinStockEnNinguna = opcionesPrimerAtributo.length > 0 && opcionesPrimerAtributo.every((o) => !o.conStock);

  if (sinStockEnNinguna) {
    return (
      <p className="rounded-lg bg-[#f0e9df] px-4 py-3 text-sm text-[#6b6058]">
        Este producto no tiene stock disponible en ninguna variante.
      </p>
    );
  }

  const seleccionCompleta = atributosProducto.every((a) => valoresElegidos[a.atributo_id]);
  const varianteResuelta = seleccionCompleta
    ? variantes.find((v) =>
        atributosProducto.every((a) =>
          v.valores.some((x) => x.atributo_id === a.atributo_id && x.valor_atributo_id === valoresElegidos[a.atributo_id])
        )
      )
    : undefined;

  return (
    <div className="space-y-4">
      {atributosProducto.map((a, i) => (
        <div key={a.atributo_id}>
          <label className="mb-1 block text-sm font-medium text-[#2a231f]">{a.atributo}</label>
          <select
            value={valoresElegidos[a.atributo_id] ?? ""}
            onChange={(e) =>
              setValoresElegidos(
                elegirValorAtributo(a.atributo_id, i, Number(e.target.value), atributosProducto, valoresElegidos)
              )
            }
            className="w-full rounded-lg border border-[#e8ded2] bg-white px-3 py-2 text-[#2a231f]"
          >
            <option value="" disabled>
              Elegí {a.atributo.toLowerCase()}
            </option>
            {opcionesParaAtributo(a, i, atributosProducto, variantes, valoresElegidos).map((v) => (
              <option key={v.id} value={v.id} disabled={!v.conStock}>
                {v.valor}
                {!v.conStock ? " (sin stock)" : ""}
              </option>
            ))}
          </select>
        </div>
      ))}
      {seleccionCompleta && varianteResuelta && (
        <p className={`text-sm font-medium ${varianteResuelta.stock_actual > 0 ? "text-green-700" : "text-red-700"}`}>
          {varianteResuelta.stock_actual > 0 ? "Disponible" : "Sin stock en esta combinación"}
        </p>
      )}
      {!seleccionCompleta && (
        <p className="text-sm text-[#6b6058]">Elegí un valor para cada atributo para ver disponibilidad.</p>
      )}
    </div>
  );
}
