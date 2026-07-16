/**
 * Prueba procesarCheckout() directo (sin navegador, sin HTTP a Next.js) contra el backend real.
 * Corre con `npm run test:checkout`, con FASHBALANCE_API_URL y ECOMMERCE_API_KEY en el entorno.
 *
 * Dos casos:
 *   1. Pedido válido -> confirma que crea la orden (imprime el id para que quede registrado).
 *   2. Cantidad mayor al stock disponible -> confirma que rechaza sin crear nada.
 *
 * Este script NUNCA borra nada. Los pedidos válidos que crea quedan en la base real.
 */
import { getCatalogo } from "../src/lib/api";
import { procesarCheckout } from "../src/lib/checkout";
import type { CartItem } from "../src/lib/types";

async function main() {
  console.log(`FASHBALANCE_API_URL=${process.env.FASHBALANCE_API_URL}`);

  const catalogo = await getCatalogo();

  // Preferimos un producto sin variantes; si no hay ninguno publicado con stock, buscamos un
  // producto con variantes que tenga alguna variante con stock >= 2.
  const sinVariantes = catalogo.find((p) => !p.tiene_variantes && (p.stock_actual ?? 0) >= 2);

  let productoId: number;
  let varianteId: number | null = null;
  let nombre: string;
  let precioVenta: string;
  let stockDisponible: number;

  if (sinVariantes) {
    productoId = sinVariantes.id;
    nombre = sinVariantes.nombre;
    precioVenta = sinVariantes.precio_venta;
    stockDisponible = sinVariantes.stock_actual ?? 0;
    console.log(`Producto de prueba: #${productoId} "${nombre}" (sin variantes, stock ${stockDisponible})`);
  } else {
    const conVariantes = catalogo
      .filter((p) => p.tiene_variantes && p.variantes)
      .map((p) => ({ producto: p, variante: p.variantes!.find((v) => v.stock_actual >= 2) }))
      .find((x) => x.variante);

    if (!conVariantes || !conVariantes.variante) {
      console.error("No se encontró en el catálogo ningún producto (con o sin variantes) con stock >= 2.");
      console.error("Publicá (visible_ecommerce=True) algún producto con stock para poder correr esta prueba.");
      process.exit(1);
      return;
    }

    productoId = conVariantes.producto.id;
    varianteId = conVariantes.variante.id;
    nombre = conVariantes.producto.nombre;
    precioVenta = conVariantes.producto.precio_venta;
    stockDisponible = conVariantes.variante.stock_actual;
    const descripcionVariante = conVariantes.variante.valores.map((v) => v.valor).join(" / ");
    console.log(
      `Producto de prueba: #${productoId} "${nombre}" variante #${varianteId} (${descripcionVariante}), stock ${stockDisponible}`
    );
  }

  // --- Caso 1: pedido válido ---
  const itemValido: CartItem = {
    producto_id: productoId,
    variante_id: varianteId,
    nombre,
    foto: null,
    variante_descripcion: null,
    precio_venta: Number(precioVenta),
    cantidad: 1,
    stock_actual: stockDisponible,
  };

  const resultadoValido = await procesarCheckout([itemValido], {
    cliente_nombre: "Script de prueba (test-checkout.ts)",
    forma_entrega: "Retiro en persona",
    metodo_pago_preferido: "Efectivo al retirar",
    notas: "Orden de prueba generada automáticamente — revisar si conviene revertirla.",
  });

  if (!resultadoValido.ok) {
    console.error("FALLO Caso 1 (pedido válido): se esperaba éxito pero se rechazó.");
    console.error(resultadoValido.error);
    process.exit(1);
  }
  console.log(`>>> ORDEN DE PRUEBA CREADA: #${resultadoValido.ordenId}`);

  // --- Caso 2: cantidad mayor al stock disponible ---
  const stockRestante = stockDisponible - 1; // ya descontamos 1 unidad en el Caso 1
  const itemInvalido: CartItem = {
    ...itemValido,
    cantidad: stockRestante + 1000,
    stock_actual: stockRestante + 1000, // el tope client-side no aplica acá, se testea la validación del backend
  };

  const resultadoInvalido = await procesarCheckout([itemInvalido], {
    cliente_nombre: "Script de prueba (test-checkout.ts) — caso stock insuficiente",
    forma_entrega: "Retiro en persona",
  });

  if (resultadoInvalido.ok) {
    console.error("FALLO Caso 2 (stock insuficiente): se esperaba un rechazo pero se creó la orden "
      + `#${resultadoInvalido.ordenId}. Revisar validación de stock en el backend.`);
    process.exit(1);
  }
  console.log("Caso 2 OK — rechazado como se esperaba:", resultadoInvalido.error);

  console.log("\nTodo OK. Recordá: la orden de prueba del Caso 1 quedó creada de verdad (Movimiento");
  console.log("de Venta real, stock descontado real) — no se borró nada automáticamente.");
}

main();
