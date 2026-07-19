# Resumen de la última modificación — Storefront: revalidar stock al abrir /carrito

Implementación de `prompt1.md`: al abrir `/carrito`, ya no se confía solo en el `stock_actual`
guardado en `localStorage` al momento de agregar cada línea (puede estar viejo si el carrito quedó
abierto un rato) — se revalida contra el stock real de FashBalance. Solo toca `ecommerce/` (storefront
Next.js). No implementa reserva de stock (eso queda para Caja/FashBalance, fuera de alcance).

**Cambios**
- Nuevo `ecommerce/src/app/carrito/actions.ts` (`"use server"`): `obtenerStockFresco(productoIds)`
  pide, por cada `producto_id` distinto del carrito, `GET /ecommerce/catalogo/{id}` (endpoint ya
  existente, no se creó uno nuevo) con `fetch(..., { cache: "no-store" })` — a propósito no reusa
  `getProducto()`/`apiFetch()` de `lib/api.ts`, que trae `next: { revalidate: 60 }` y devolvería el
  mismo stock viejo hasta 60s, justo el caso que esta revalidación existe para cubrir. Devuelve un
  `Record<producto_id, StockFrescoProducto | null>` (`null` = producto ya no existe o dejó de estar
  activo/`visible_ecommerce`, tratado como stock 0).
- `ecommerce/src/app/carrito/page.tsx`: un único `useEffect` al montar llama a `obtenerStockFresco`
  con los `producto_id` distintos presentes en el carrito (no hay polling). `stockFrescoDeLinea()`
  resuelve el stock real por línea (de la variante puntual si corresponde, si no del producto) y
  decide el aviso:
  - Alcanza → nada.
  - Alcanza parcial (>0 pero < cantidad en el carrito) → aviso ámbar "Solo quedan N disponibles", no
    bloquea (el checkout ya rechaza atómicamente si se confirma de más).
  - 0 → aviso rojo "Ya no hay stock de este producto/variante" y el link a `/checkout` se reemplaza
    por un botón deshabilitado hasta que se ajuste o saque esa línea.
  - Mientras no llegó la revalidación, ningún aviso (sin spinner agresivo, es aceptable que aparezca
    un instante después de que la página ya se vio).
- `CLAUDE.md` actualizado (sección Fase 2 → bajo `/carrito`) documentando esta mejora.

**Verificado**
- `docker compose build ecommerce`: `next build` compiló y pasó el chequeo de tipos sin errores
  (`✓ Compiled successfully`, sin warnings de lint).
- `docker compose up -d ecommerce`: contenedor recreado con la nueva imagen, arrancó bien
  (`✓ Ready`), sin errores en logs.
- No se pudo probar en navegador (VM headless, sin Chromium — restricción del proyecto). Verificación
  de frontend limitada a build + type-check exitoso, según la convención ya establecida en este
  proyecto para cambios de storefront/frontend.

**Falta probar a mano en el navegador**: agregar al carrito una variante con poco stock real (ej.
"Calza Dua" talle S / Verde), bajarle el stock desde FashBalance (Movimientos → Venta) mientras el
carrito queda abierto, y confirmar que al volver a `/carrito` aparece el aviso correcto ("Solo quedan
N" o "Ya no hay stock", con el botón de checkout deshabilitado en el segundo caso).

**No se tocó**: backend (`backend/`), `frontend/` (panel), `backend/app/arca/`, checkout/carrito
existentes salvo lo descrito arriba.
