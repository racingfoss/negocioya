import type { Variante } from "./types";

export interface AtributoDerivado {
  atributo_id: number;
  atributo: string;
}

export interface OpcionValor {
  id: number;
  valor: string;
  conStock: boolean;
}

export type ValoresElegidos = Record<number, number | undefined>;

/**
 * No hay endpoint público con el orden real (ProductoAtributo.orden) — se deriva el orden de los
 * selectores por orden de primera aparición recorriendo las variantes tal como las devuelve el
 * backend. Ver CLAUDE.md, sección del storefront.
 */
export function derivarAtributosProducto(variantes: Variante[]): AtributoDerivado[] {
  const vistos = new Map<number, AtributoDerivado>();
  for (const v of variantes) {
    for (const val of v.valores) {
      if (!vistos.has(val.atributo_id)) {
        vistos.set(val.atributo_id, { atributo_id: val.atributo_id, atributo: val.atributo });
      }
    }
  }
  return Array.from(vistos.values());
}

/** Mismo criterio que opcionesParaAtributo en frontend/src/pages/Movimientos.jsx */
export function opcionesParaAtributo(
  atributo: AtributoDerivado,
  index: number,
  atributosProducto: AtributoDerivado[],
  variantesProducto: Variante[],
  valoresElegidos: ValoresElegidos
): OpcionValor[] {
  const previos = atributosProducto.slice(0, index);
  const candidatas = variantesProducto.filter((v) =>
    previos.every((pa) => {
      const elegido = valoresElegidos[pa.atributo_id];
      if (!elegido) return true;
      return v.valores.some((x) => x.atributo_id === pa.atributo_id && x.valor_atributo_id === Number(elegido));
    })
  );
  const vistos = new Map<number, OpcionValor>();
  candidatas.forEach((v) => {
    const match = v.valores.find((x) => x.atributo_id === atributo.atributo_id);
    if (match) {
      const previo = vistos.get(match.valor_atributo_id);
      const conStock = Number(v.stock_actual) > 0 || (previo?.conStock ?? false);
      vistos.set(match.valor_atributo_id, { id: match.valor_atributo_id, valor: match.valor, conStock });
    }
  });
  return Array.from(vistos.values());
}

/** Mismo criterio que elegirValorAtributo en frontend/src/pages/Movimientos.jsx */
export function elegirValorAtributo(
  atributoId: number,
  index: number,
  valor: number,
  atributosProducto: AtributoDerivado[],
  valoresElegidos: ValoresElegidos
): ValoresElegidos {
  const nuevos: ValoresElegidos = { ...valoresElegidos, [atributoId]: valor };
  atributosProducto.slice(index + 1).forEach((a) => {
    delete nuevos[a.atributo_id];
  });
  return nuevos;
}
