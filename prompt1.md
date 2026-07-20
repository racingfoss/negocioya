Fase D, parte 1: reversión de ventas — devoluciones (después de entregado) y cancelaciones (antes de
entregar), con soporte de devolución PARCIAL por línea (no solo cancelar el pedido entero completo — es
el caso más común en indumentaria: "me quedo con una prenda, devuelvo otra"). Esta ronda NO toca ARCA —
la Nota de Crédito es una parte 2 aparte, para cuando esto ya esté probado funcionando.

## El mecanismo (léelo antes de programar)

**No delegues ninguna parte de esta implementación ni de las pruebas a agentes en segundo plano sin
supervisión** (subagentes/Task para "verificar" o "confirmar" algo puntual que terminen actuando por su
cuenta). Esta fase toca funciones centrales del sistema (stock, caja, BCG, mix real) — si necesitás
confirmar algo, hacelo vos mismo, en el hilo principal, visible. Nada de esto se prueba contra ARCA (esta
fase no lo toca), pero sí contra la base real del negocio — el mismo cuidado aplica.

Una devolución/cancelación es un evento **nuevo**, no una edición de la venta original — mismo criterio
ya aplicado en todo el proyecto (nunca se edita retroactivamente un `Movimiento` de Venta para "corregir"
una devolución). Se modela con un `Movimiento` tipo `"Devolucion"` nuevo, espejo de `"Venta"`: donde
`"Venta"` resta stock y suma caja, `"Devolucion"` suma stock y resta caja. Esto obliga a tocar las
funciones centrales que agregan por tipo de movimiento — hacelo, es necesario para que Stock, BCG y el
mix real dejen de contar una venta que en los hechos se revirtió, no es opcional.

## 1. Modelo de datos

`Devolucion`: `id`, `pedido_id` (FK), `fecha`, `motivo` (nullable), `tipo` (`"Cancelacion"` |
`"Devolucion"` — solo para mostrar en la UI, la mecánica es idéntica para los dos).

`DevolucionItem`: `id`, `devolucion_id` (FK), `pedido_item_id` (FK al `PedidoItem` original que se está
revirtiendo), `cantidad` (cuántas unidades de esa línea se devuelven — puede ser menor a la cantidad
original), `movimiento_id` (FK al `Movimiento` tipo Devolución que generó, mismo patrón de trazabilidad
que ya usa `PedidoItem.movimiento_id`).

## 2. `calculations.py` — extender, no duplicar

- **`TIPOS_MOVIMIENTO_VALIDOS`**: agregar `"Devolucion"`.
- **`stock_por_producto`, `stock_por_variante`, `stock_disponible`**: donde hoy restan
  `total_vendido = sum(cantidad WHERE tipo="Venta")`, pasan a restar el neto:
  `total_vendido - sum(cantidad WHERE tipo="Devolucion")`. Mismo criterio para las reservas ya
  existentes (`excluir_sesion`, `considerar_reservas`) — no toques esa lógica, solo el cálculo base sobre
  el que actúan.
- **`get_caja_actual`**: `"Devolucion"` resta de la caja, mismo lado que `"Egreso"` (es plata que sale).
- **`unidades_vendidas_por_producto`/`facturacion_por_producto`** (usadas por BCG, Análisis, y el mix real
  del Punto de Equilibrio): también netean contra `"Devolucion"` — una venta revertida no debe inflar
  volumen ni facturación en esas pantallas.
- **`validar_movimiento`/`registrar_venta`**: no deberían necesitar cambios de comportamiento para
  `tipo="Venta"` — confirmalo con una prueba, no asumas. La creación del `Movimiento` tipo `Devolucion` en
  sí puede ir directo (no pasa por las mismas validaciones de stock que una Venta, porque va en sentido
  contrario — no hace falta "verificar que haya stock" para devolver algo).
- **Nueva función `procesar_devolucion(db, pedido_id, items, motivo=None, tipo="Devolucion")`**: valida
  que cada `pedido_item_id` pertenezca a ese `pedido_id`, y que la `cantidad` a devolver no supere
  `cantidad_original - cantidad_ya_devuelta_antes` (sumá las devoluciones previas de esa misma línea, si
  las hay). Si algo no cierra, error claro sin escribir nada (mismo criterio atómico de siempre). Si todo
  valida, en una transacción: crea `Devolucion`, por cada línea un `Movimiento` tipo `Devolucion`
  (`monto = cantidad × precio_unitario` — usá el `precio_unitario` **del `PedidoItem` original**, no el
  `precio_venta` actual del producto, por la misma razón de denormalización ya documentada en todo el
  proyecto) + su `DevolucionItem`. Al final, si la suma de todo lo devuelto en la vida de ese pedido
  iguala la cantidad original de TODAS sus líneas, actualizá `Pedido.estado` a `"Cancelado"` — si es
  parcial, dejá el estado como está (no hace falta un estado nuevo tipo "parcialmente devuelto", alcanza
  con poder ver la lista de devoluciones de ese pedido).
- **Completá `calculations.monto_neto_pedido(db, pedido)`, no la reescribas ni le cambies la firma** — ya
  existe (Fase C, facturación ARCA), hoy devuelve `Pedido.total` sin restar nada porque estas tablas no
  existían todavía, y `PedidoOut`/`Pedidos.jsx`/`facturacion.py` ya dependen de ella tal cual está (recibe
  el objeto `Pedido` ya cargado, no un id). Agregale la resta real: por cada `DevolucionItem` cuyo
  `PedidoItem` pertenezca a este pedido, `cantidad × precio_unitario` del `PedidoItem` original, restado
  de `Pedido.total`. No hace falta tocar nada de `facturacion.py` — en cuanto esta función devuelva el
  neto real, el monto a facturar de un pedido con devolución previa se corrige solo.

## 3. Endpoint

`POST /pedidos/{id}/devoluciones`: `{motivo, tipo, items: [{pedido_item_id, cantidad}]}` → llama
`procesar_devolucion`. `GET /pedidos/{id}/devoluciones`: historial de devoluciones de ese pedido (para
saber cuánto de cada línea ya se devolvió antes, tanto en el backend para validar como en el frontend para
mostrar).

## 4. Frontend — `Pedidos.jsx`

Acción nueva por pedido ("Devolver / Cancelar") que abre el detalle de sus líneas, mostrando por cada una
cantidad original, cuánto ya se devolvió antes (si algo), y cuánto queda disponible para devolver — con
un input de cantidad por línea (tope = lo disponible) y motivo opcional. Al confirmar, llama al endpoint
del punto 3 y refresca. Sin ningún botón de Nota de Crédito todavía — eso es la parte 2.

## Qué NO hacer

Nada de ARCA (`backend/app/arca/`, `facturacion.py`) — ni tocarlos ni llamarlos. No implementes ningún
estado nuevo de `Pedido` más allá de reusar `"Cancelado"` (ya existe desde la Fase B). No toques
`Compras.jsx`, el storefront (`ecommerce/`), ni la reserva de stock (`reservas_stock`) — una devolución no
tiene por qué interactuar con reservas activas, son mecanismos independientes.

## Antes de terminar

Probá contra la API real: una devolución parcial (pedido con 2 líneas, devolver solo 1 unidad de una)
confirmando que el stock sube bien, la caja baja bien, y `GET /stock/productos`/`Análisis` reflejan el
neto (no la venta bruta). Intentar devolver más de lo disponible en una línea (contando una devolución
previa parcial de esa misma línea) y confirmar el rechazo. Una devolución que cubre el 100% de todas las
líneas de un pedido y confirmar que `Pedido.estado` pasa a `"Cancelado"` solo. **Cerrá el círculo con la
Fase C**: un pedido con una devolución parcial ya procesada, consultado por `GET /pedidos`, tiene que
mostrar `monto_neto` correcto (Fase C ya lo expone en la respuesta) — esa era la prueba que había quedado
pendiente documentada en el CLAUDE.md, ahora ya se puede ejercitar. Avisame qué probar a mano en el
navegador. Actualizá el CLAUDE.md con esta sección nueva, y sacá de "pendientes" la prueba de
`monto_neto_pedido` que ahora ya está cubierta.
