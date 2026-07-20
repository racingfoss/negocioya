# Resumen de la última modificación — Fase D, parte 1: reversión de ventas (devoluciones y cancelaciones)

Implementación de `prompt1.md`: permite revertir una Venta ya confirmada de un `Pedido` —
cancelación (antes de entregar) o devolución (después) — con soporte de devolución **parcial por
línea** (el caso más común en indumentaria: "me quedo con una prenda, devuelvo otra"). Esta ronda
no toca ARCA (`backend/app/arca/`, `facturacion.py`) — la Nota de Crédito queda para una Fase D
parte 2 futura, que se apoya en esto.

## Backend

- **Tablas nuevas `Devolucion`/`DevolucionItem`** (`models.py`): `Devolucion` (`pedido_id`,
  `fecha`, `motivo` nullable, `tipo` `"Cancelacion"` | `"Devolucion"` — solo para UI, la mecánica
  es idéntica para los dos). `DevolucionItem` (`devolucion_id`, `pedido_item_id` FK al
  `PedidoItem` que se revierte, `cantidad`, `movimiento_id` FK al `Movimiento` "Devolucion" que
  generó, mismo patrón de trazabilidad que `PedidoItem.movimiento_id`). Autocreadas por
  `Base.metadata.create_all()`, sin `ALTER TABLE`.
- **Evento nuevo, nunca una edición retroactiva**: se modela con un `Movimiento` tipo
  `"Devolucion"` nuevo, espejo de `"Venta"` (suma stock, resta caja en vez de restar/sumar).
  `Movimiento.tipo` es `String(10)` — `"Devolucion"` entra justo (10 caracteres), no hizo falta
  migrar esa columna.
- **Neteo contra `"Devolucion"` en `calculations.py`**, vía un helper nuevo
  `_neto_venta_devolucion(columna)` (un `case()` de SQLAlchemy) reusado en 4 lugares:
  `unidades_vendidas_por_producto`, `unidades_vendidas_por_variante`, `facturacion_por_producto`
  (alimentan BCG, Análisis, Stock y el mix real del Punto de Equilibrio) y `stock_disponible`.
  `stock_por_producto`/`stock_por_variante` no se tocaron directo — ya consumen esas funciones,
  netean solos. `get_caja_actual`: `"Devolucion"` resta de la caja, mismo lado que `"Egreso"`.
  `TIPOS_MOVIMIENTO_VALIDOS` ganó `"Devolucion"`. `validar_movimiento`/`registrar_venta` no
  cambiaron de comportamiento para `tipo="Venta"` — confirmado con pruebas reales, no solo lectura.
- **`calculations.procesar_devolucion(db, pedido_id, items, motivo=None, tipo="Devolucion")`**
  (nueva): valida que cada `pedido_item_id` pertenezca al pedido y que la cantidad a devolver no
  supere `cantidad_original - ya_devuelto_antes` (sumando TODAS las devoluciones previas de esa
  línea). Lanza `ValueError` (no `HTTPException`) si algo no cierra, sin escribir nada — mismo
  patrón que `reservar_stock`/`liberar_reserva`, mantiene el invariante de que
  `validar_movimiento` es la única función que lanza `HTTPException` directo. Si todo valida:
  crea `Devolucion` + un `Movimiento` "Devolucion" por línea (monto = cantidad × `precio_unitario`
  **del `PedidoItem` original**, no el precio actual del producto) + su `DevolucionItem`. Si lo
  devuelto en la vida del pedido cubre el 100% de todas sus líneas, `Pedido.estado` pasa a
  `"Cancelado"` solo. Commit propio (operación atómica de punta a punta, mismo criterio que
  `facturacion.facturar_pedido`).
- **`calculations.monto_neto_pedido(db, pedido)` completada**: ya no devuelve `Pedido.total` a
  secas — resta, vía join `DevolucionItem` → `PedidoItem` → `Devolucion`, lo ya devuelto. Cierra
  el pendiente que había quedado documentado en la Fase C.
- **Endpoints** (`routers/pedidos.py`): `POST /pedidos/{id}/devoluciones` (404 si el pedido no
  existe, 400 con el detalle si `procesar_devolucion` rechaza algo) y
  `GET /pedidos/{id}/devoluciones` (historial completo, más reciente primero).
- **`PedidoItemOut.variante_descripcion`** (nuevo, opcional, no ORM): completado en `_pedido_out`
  con `calculations.descripcion_variante` (helper ya existente, usado por `ReservaStock`) para
  que el panel de devolución muestre "M / Verde" sin armar su propia query.
- **`PUT /pedidos/{id}/estado` no se tocó**: seguir permitiendo `"Cancelado"` a mano ahí sin
  reversión de stock/caja es el comportamiento ya existente — solo el endpoint nuevo revierte de
  verdad.

## Frontend (`Pedidos.jsx`)

- Columna nueva "Devolución" con botón "Devolver / Cancelar" por pedido (oculto si
  `estado === "Cancelado"`) que abre un panel — sin modal (no existe ninguno en el proyecto), es
  una sección condicional debajo de la tabla, mismo criterio que `enModoCarrito` en
  `Movimientos.jsx`.
- El panel trae `GET /pedidos/{id}/devoluciones` para calcular por línea cuánto ya se devolvió y
  cuánto queda disponible, con un input de cantidad topeado (deshabilitado si ya no queda nada),
  select de tipo y motivo opcional.
- Confirmar llama `POST /pedidos/{id}/devoluciones`, refresca `GET /pedidos` entero (para que
  `estado`/`monto_neto` se actualicen) y cierra el panel. Mismo patrón `devolviendo` (Set de ids
  en vuelo) que ya usa `facturando` para deshabilitar el botón mientras la request está en curso.
- La celda de Total muestra el `monto_neto` en gris chico cuando difiere del total.
- Build de Vite corrido sin errores (sin verificación visual posible en esta sesión — VM
  headless).

**`CLAUDE.md`** actualizado con la sección nueva ("Fase D, parte 1") y el párrafo pendiente de la
Fase C sobre `monto_neto_pedido` se marcó como resuelto.

## Verificado

Contra la API real, en el hilo principal (sin delegar a subagentes en background, según lo
pedido):

- Venta nueva se comporta igual que antes de agregar `"Devolucion"` a
  `TIPOS_MOVIMIENTO_VALIDOS`.
- Pedido de 2 líneas, devolución parcial de 1 unidad de una línea: stock sube, caja baja,
  `GET /stock/productos` y el mix real de `GET /dashboard/punto-equilibrio?modo=real` reflejan
  el neto (no la venta bruta).
- Intento de devolver más de lo disponible en una línea (con una devolución parcial previa ya
  contada) → rechazado con 400 y mensaje claro, sin escribir nada.
- Devolución que completa el 100% de todas las líneas del pedido → `Pedido.estado` pasa a
  `"Cancelado"` solo.
- Cierre de punta a punta con Fase C: `GET /pedidos` de un pedido con devolución parcial ya
  procesada muestra `monto_neto` correcto.
- **Confirmado por el usuario en el navegador**: "Funcionó todo Ok".

Quedaron en la base datos de prueba reales de esta verificación (pedido #24 cancelado, compras y
movimientos de prueba en "Vestido Corto Rojo"/"Vestido Largo Azul") — no se borraron, mismo
criterio que ya usa el proyecto con sus scripts de prueba (ej. `test-checkout.ts`).

## No se tocó

- `backend/app/arca/`, `facturacion.py` (se leyeron, no se modificaron).
- `Compras.jsx`, el storefront (`ecommerce/`).
- `reservas_stock`/`reservar_stock`/`liberar_reserva` — una devolución de un pedido ya confirmado
  no interactúa con reservas de un pedido en armado, son mecanismos independientes.
- Ningún estado nuevo de `Pedido` más allá de reusar `"Cancelado"`.
- Nota de Crédito — queda para la Fase D parte 2, apoyada en esto pero no implementada todavía.
