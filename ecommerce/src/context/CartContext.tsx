"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { CartItem } from "@/lib/types";

const CART_STORAGE_KEY = "fashbalance_carrito";

function mismaLinea(a: { producto_id: number; variante_id: number | null }, b: { producto_id: number; variante_id: number | null }) {
  return a.producto_id === b.producto_id && a.variante_id === b.variante_id;
}

interface CartContextValue {
  items: CartItem[];
  cantidadTotal: number;
  total: number;
  agregarItem: (item: CartItem) => void;
  actualizarCantidad: (producto_id: number, variante_id: number | null, cantidad: number) => void;
  quitarItem: (producto_id: number, variante_id: number | null) => void;
  vaciarCarrito: () => void;
}

const CartContext = createContext<CartContextValue | undefined>(undefined);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [hydrated, setHydrated] = useState(false);

  // Carga inicial desde localStorage. Corre una sola vez, al montar.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(CART_STORAGE_KEY);
      if (raw) setItems(JSON.parse(raw));
    } catch {
      // localStorage corrupto/inaccesible (modo privado, etc.) — arranca vacío, no rompe la página
    }
    setHydrated(true);
  }, []);

  // Sincroniza a localStorage en cada cambio, pero solo después de terminar la carga inicial —
  // si no, este efecto también corre en el primer render (con items todavía en []) y pisa el
  // localStorage real con [] antes de que la carga de arriba tenga chance de aplicarse.
  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
  }, [items, hydrated]);

  const agregarItem = (item: CartItem) => {
    setItems((actuales) => {
      const existente = actuales.find((i) => mismaLinea(i, item));
      if (existente) {
        return actuales.map((i) =>
          mismaLinea(i, item)
            ? { ...i, cantidad: Math.min(i.cantidad + item.cantidad, i.stock_actual) }
            : i
        );
      }
      return [...actuales, { ...item, cantidad: Math.min(item.cantidad, item.stock_actual) }];
    });
  };

  const actualizarCantidad = (producto_id: number, variante_id: number | null, cantidad: number) => {
    setItems((actuales) =>
      actuales.map((i) =>
        mismaLinea(i, { producto_id, variante_id })
          ? { ...i, cantidad: Math.max(1, Math.min(cantidad, i.stock_actual)) }
          : i
      )
    );
  };

  const quitarItem = (producto_id: number, variante_id: number | null) => {
    setItems((actuales) => actuales.filter((i) => !mismaLinea(i, { producto_id, variante_id })));
  };

  const vaciarCarrito = () => setItems([]);

  const cantidadTotal = items.reduce((acc, i) => acc + i.cantidad, 0);
  const total = items.reduce((acc, i) => acc + i.precio_venta * i.cantidad, 0);

  return (
    <CartContext.Provider
      value={{ items, cantidadTotal, total, agregarItem, actualizarCantidad, quitarItem, vaciarCarrito }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart() tiene que usarse dentro de un <CartProvider>.");
  return ctx;
}
