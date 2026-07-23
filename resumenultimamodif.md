# Resumen — Cambio de producto (devolución + reposición con pedido nuevo)

## Ronda de fixes posterior (reportado por el usuario probando a mano)

Dos problemas encontrados al usar el wizard en el navegador:

1. **El combo de cantidad del Paso 2 (qué prenda entra) dejaba cargar cualquier número, sin avisar del
   stock disponible.** El tope real ya existía (`agregarItemCambio` rechazaba con un error si la cantidad
   superaba `stockDisponibleCambio`), pero no había ninguna señal visual antes de tocar "+ Agregar" —
   se podía escribir 999 sin que nada lo indicara. Fix en `frontend/src/pages/Pedidos.jsx`, mismo patrón
   que ya usa `Movimientos.jsx` para su propio input de cantidad: se agregó `max={stockDisponibleCambio}`
   al input, se deshabilita el input y el botón cuando el stock disponible es 0, y se agregó un párrafo de
   aviso rojo cuando la cantidad cargada supera el disponible.
2. **El pedido nuevo que origina un cambio no mostraba ningún vínculo con el cambio/devolución que lo
   generó** al mirarlo en la tabla principal de Pedidos — el vínculo solo se veía entrando al panel del
   pedido *original*. Fix: nuevo campo `PedidoOut.cambio_origen` (backend, `schemas.py` +
   `routers/pedidos.py::_pedido_out`, mismo criterio que ya existía para `DevolucionOut.cambio` pero del
   otro lado), completado buscando un `Cambio` con `pedido_nuevo_id == este pedido`. En la tabla de
   `Pedidos.jsx`, cuando está presente se muestra "🔄 Cambio del pedido #X" en la columna Cliente de la
   fila del pedido nuevo.

Verificado contra la API real: `GET /pedidos/` ahora devuelve `cambio_origen` con `pedido_original_id`
correcto en los pedidos que nacieron de un cambio (confirmado sobre los pedidos de prueba ya generados).
`docker compose exec frontend npm run build` sin errores tras el fix.

## Qué se hizo (ronda original)

Hasta ahora, si la clienta no quería el reembolso sino cambiar la prenda por otra, había que hacer dos
operaciones sueltas sin ningún vínculo entre sí: una Devolución (Fase D parte 1) + un Pedido nuevo cargado
aparte. Se agregó un "Cambio de producto" que orquesta las dos cosas ya existentes (no se reimplementó
nada de eso) y las vincula con una fila liviana `Cambio`, sin editar nunca el pedido original.

## Backend

- **Paso 0 (investigación antes de tocar código)**: se confirmó contra el código real que la lógica de
  alta de pedido vivía inline en el router `crear_local`, que `procesar_devolucion` ya commiteaba
  internamente mientras la creación de pedido commiteaba en el router, y que los nombres de campo para
  las líneas ya existían tal cual en `schemas.LineaOrdenIn`/`schemas.DevolucionItemIn` (se reusaron
  directo, sin inventar schemas nuevos). También se corrigió una suposición: no existe
  `routers/analisis.py` (el análisis vive en `routers/dashboard.py`, prefix `/dashboard`), y no todo el
  proyecto sigue el patrón "sin relationship" (`Pedido`/`Devolucion` sí tienen `relationship`, solo
  `ReservaStock`/`MixSnapshot`/las columnas cruzadas de `Factura` no).
- **Tabla nueva `cambios`** (`models.Cambio`): `pedido_original_id`, `devolucion_id`, `pedido_nuevo_id`,
  `diferencia_monto` (positivo = pagó de más, negativo = se le devolvió), `fecha`, `motivo`. Autocreada,
  sin `ALTER TABLE`.
- **`calculations.procesar_devolucion`**: ganó `commit: bool = True` (retrocompatible).
- **`calculations.crear_pedido_con_items`** (nueva): extraída de `crear_local`, mismo comportamiento
  exacto, con `commit: bool = True` y validaciones que lanzan `ValueError` en vez de `HTTPException`.
  `crear_local` quedó como wrapper delgado.
- **`calculations.procesar_cambio`**: encadena las dos de arriba con `commit=False` y hace un único
  `db.commit()` al final — atomicidad completa (probado: stock insuficiente en la prenda de reemplazo
  aborta todo, sin dejar una Devolución huérfana).
- **Endpoints nuevos**: `POST /pedidos/{id}/cambios`, `GET /pedidos/{id}/cambios`.
- **`DevolucionOut.cambio`** (nuevo, opcional): el panel de devoluciones que ya existe ahora puede saber
  si esa devolución fue en realidad parte de un cambio.
- **Reporte**: `GET /dashboard/cambios-devoluciones?dias=30` — tasa de cambios vs. reembolsos puros sobre
  las devoluciones de la ventana.
- **No se tocó**: `arca/`, `facturacion.py`, `reservas_stock`, `ecommerce/`.

## Frontend (`Pedidos.jsx` y `BCG.jsx`)

- Botón "Cambiar producto" nuevo en `Pedidos.jsx`, junto al de "Devolver / Cancelar". Panel con Paso 1
  (qué se devuelve, mismo criterio visual que el panel de devolución) y Paso 2 (qué prenda entra, selector
  categoría→producto→atributos→variante copiado de `Movimientos.jsx`, sin el mecanismo de reserva de
  stock — un cambio es atómico, no un carrito armado en el tiempo).
- Mini-carrito de ítems nuevos, preview de diferencia en el cliente, mensaje de confirmación con el monto
  real y la dirección explícita ("te debe $X más" / "hay que devolverle $X" / "precio igual").
- Panel de devoluciones existente: línea nueva "🔄 Parte de un cambio → pedido #X" cuando corresponde.
- Historial de cambios dentro del mismo panel.
- `BCG.jsx` (pantalla Análisis): tarjeta nueva "Cambios vs. reembolsos", reusando el selector de días
  (7/30/90) que ya existía ahí.

## Bug encontrado y corregido al probar contra la API real

`_cambio_out` intentaba `schemas.CambioOut.model_validate(cambio)` — igual que el resto de los helpers
del router — pero `Cambio` no tiene `relationship` hacia `Pedido`/`Devolucion` (a propósito, es una fila
de cruce minimalista), así que Pydantic rechazaba la validación por los campos `devolucion`/`pedido_nuevo`
faltantes (`Field required`), tirando 500 en el primer `POST /pedidos/{id}/cambios` de prueba. La
operación en sí ya había commiteado bien (se pudo confirmar leyendo la fila real en la tabla `cambios`) —
el bug era solo de serialización de la respuesta. Fix: `_cambio_out` arma `schemas.CambioOut(...)`
directo con los campos ya resueltos, en vez de `model_validate` + parchear después.

## Testing hecho

Contra la API real (`docker compose`, stack ya corriendo, sin reiniciar nada — la tabla `cambios` se
autocreó sola al reiniciar el backend):

1. Pedido local sin facturar (#38) → `POST .../cambios` → 200, `requiere_nota_credito` de la devolución
   nueva da `false`.
2. Pedido con Factura C real emitida en homologación (#44, CAE `86290645209863`) → después del cambio, la
   devolución nueva queda con `requiere_nota_credito: true`.
3. Pedido con 2 líneas (#40), cambio de solo 1 → `Pedido.estado` sigue `"Entregado"`, no pasa a
   `"Cancelado"`.
4. Cambio a precio igual (pedido #42) → `diferencia_monto` guardado en `0.00`, sin efecto especial.
5. Prenda de cambio sin stock suficiente (pedido #39, variante con stock 0) → 400, y
   `GET /pedidos/39/devoluciones` confirma que no quedó ninguna devolución huérfana — atomicidad real.
6. `GET /dashboard/cambios-devoluciones?dias=30` → refleja correctamente cambios vs. reembolsos
   (`cantidad_cambios: 3`, `cantidad_reembolsos: 18` tras las pruebas de arriba).
7. Pedido inexistente (`/pedidos/999999/cambios`) → 404.
8. `docker compose exec frontend npm run build` → build sin errores.

## Pendiente de probar a mano en el navegador

Abrir `Pedidos.jsx`, usar el botón "Cambiar producto" en un pedido de prueba y confirmar que:
- El Paso 1 lista las líneas con la cantidad disponible correcta y el Paso 2 permite elegir
  categoría/producto/variante con el mismo criterio que Movimientos.jsx (sin stock = deshabilitado).
- El mensaje de confirmación muestra el monto y la dirección correctos, y el historial de cambios se ve
  al reabrir el panel más tarde.
- La pantalla Análisis (`/bcg`) muestra la tarjeta nueva "Cambios vs. reembolsos" con los números
  correctos al cambiar el selector de días.
