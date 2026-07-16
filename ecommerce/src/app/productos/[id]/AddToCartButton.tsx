"use client";

import { useState } from "react";
import { useCart } from "@/context/CartContext";
import type { Variante } from "@/lib/types";
import VariantSelector, { type SeleccionVariante } from "./VariantSelector";

const SELECCION_VACIA: SeleccionVariante = { varianteId: null, stock: 0, disponible: false, descripcion: null };

export default function AddToCartButton({
  productoId,
  nombre,
  precioVenta,
  foto,
  tieneVariantes,
  stockProducto,
  variantes,
}: {
  productoId: number;
  nombre: string;
  precioVenta: string;
  foto: string | null;
  tieneVariantes: boolean;
  stockProducto: number | null;
  variantes: Variante[];
}) {
  const { agregarItem } = useCart();
  const [seleccion, setSeleccion] = useState<SeleccionVariante>(SELECCION_VACIA);
  const [cantidad, setCantidad] = useState(1);
  const [agregado, setAgregado] = useState(false);

  const stockDisponible = tieneVariantes ? seleccion.stock : stockProducto ?? 0;
  const puedeAgregar = tieneVariantes ? seleccion.disponible : stockDisponible > 0;

  const agregar = () => {
    agregarItem({
      producto_id: productoId,
      variante_id: tieneVariantes ? seleccion.varianteId : null,
      nombre,
      foto,
      variante_descripcion: tieneVariantes ? seleccion.descripcion : null,
      precio_venta: Number(precioVenta),
      cantidad: Math.min(cantidad, stockDisponible),
      stock_actual: stockDisponible,
    });
    setAgregado(true);
    setCantidad(1);
    setTimeout(() => setAgregado(false), 2000);
  };

  return (
    <div className="space-y-4">
      {tieneVariantes ? (
        <VariantSelector variantes={variantes} onSeleccionChange={setSeleccion} />
      ) : (
        <p className={`text-sm font-medium ${stockDisponible > 0 ? "text-green-700" : "text-red-700"}`}>
          {stockDisponible > 0 ? "Disponible" : "Sin stock"}
        </p>
      )}

      {puedeAgregar && (
        <div className="flex items-center gap-3">
          <input
            type="number"
            min={1}
            max={stockDisponible}
            value={cantidad}
            onChange={(e) => setCantidad(Math.max(1, Math.min(Number(e.target.value) || 1, stockDisponible)))}
            className="w-20 rounded-lg border border-[#e8ded2] bg-white px-3 py-2 text-[#2a231f]"
          />
          <button
            onClick={agregar}
            className="rounded-full bg-[#b5473a] px-6 py-3 font-medium text-white hover:bg-[#8a362c]"
          >
            {agregado ? "¡Agregado!" : "Agregar al carrito"}
          </button>
        </div>
      )}
    </div>
  );
}
