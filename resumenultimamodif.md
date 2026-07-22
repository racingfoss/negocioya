# Resumen — Editar "Facturar (ARCA)" en un pedido ya confirmado

## Qué se hizo

Hasta ahora `Pedido.facturar_arca` se fijaba una sola vez al confirmar el pedido (checkbox en Caja
para `canal="local"`, siempre `True` para `canal="ecommerce"`) y quedaba fijo para siempre. Se agregó
la posibilidad de prender/apagar ese campo en cualquier momento, para cualquier canal, mientras el
pedido siga siendo elegible para facturar.

## Backend

- `backend/app/schemas.py`: nuevo schema `FacturarArcaUpdate` (`{"facturar_arca": bool}`).
- `backend/app/routers/pedidos.py`: nuevo endpoint `PUT /pedidos/{id}/facturar-arca`
  (`actualizar_facturar_arca`):
  - 404 si el pedido no existe.
  - 400 si `pedido.estado == "Cancelado"`.
  - 400 si ya existe una `Factura` de ese pedido con `tipo_comprobante=11` (`TIPO_COMPROBANTE_FACTURA_C`)
    y `estado="Emitida"`. Una `Factura` tipo 11 con `estado="Error"` **no bloquea**.
  - Si pasa validaciones: setea `pedido.facturar_arca`, commit, devuelve
    `response_model=schemas.PedidoOut` vía el helper `_pedido_out` ya existente.
- Tabla `facturas`/columnas/modelo: sin cambios, no requiere `ALTER TABLE`.
- **No se tocó**: `facturacion.py`, `arca/`, ningún otro endpoint de pedidos.

## Frontend (`frontend/src/pages/Pedidos.jsx`)

- Nuevo estado `actualizandoFacturarArca` (Set de ids en vuelo) y función `cambiarFacturarArca`
  (mismo patrón que `cambiarEstado`: actualiza optimista, revierte si la API rechaza con 400).
- Columna "Facturar": la rama sin factura tipo 11 emitida ya no muestra el badge fijo "Sí/No" — ahora
  es un `<input type="checkbox">` que dispara `PUT /pedidos/{id}/facturar-arca` al tildar/destildar,
  deshabilitado mientras la request está en curso.
- La rama con factura ya emitida (CAE/Vto/importe/Ver PDF) no cambió.
- No hizo falta tocar `esPendienteDeFacturar` ni la lógica de cuándo se habilita el botón "Facturar" —
  ya dependen de `facturar_arca`.

### Bug encontrado y corregido al probar a mano

Primera versión: el checkbox quedaba anidado en la rama `else` de
`pendiente ? <botón Facturar> : <checkbox>` — apenas un pedido quedaba "pendiente" (facturar_arca=true
+ elegible), el checkbox desaparecía del todo (reemplazado por el botón), sin forma de destildarlo.
Reportado por el usuario: "lo que no deja hacer el sistema es destildar el checkbox en un pedido que
quedó como habilitado para facturar". Fix: la celda ahora muestra el checkbox **siempre** que no haya
factura emitida, y el botón "Facturar" aparece **además**, debajo, solo si `pendiente` es `true` — los
dos conviven en la misma celda. Verificado con `npm run build` sin errores tras el fix.

## Testing hecho

Contra la API real (`docker compose`, stack ya corriendo, sin reiniciar nada):

1. Pedido local `Entregado`, `facturar_arca=False`, sin facturas (pedido #21) →
   `PUT .../facturar-arca {"facturar_arca": true}` → **200**, pedido queda en `true`.
2. Mismo pedido → `PUT .../facturar-arca {"facturar_arca": false}` → **200**, se puede volver a
   apagar.
3. Pedido `Cancelado` (#22) → `PUT .../facturar-arca {"facturar_arca": true}` → **400** ("El pedido
   está cancelado, no hay nada que facturar.").
4. Pedido con `Factura` tipo 11 `estado="Emitida"` (#18) → `PUT .../facturar-arca` → **400** ("Este
   pedido ya tiene una Factura C emitida con CAE — no se puede modificar facturar_arca.").
5. Se insertó a mano (SQL directo, sin pasar por ARCA) una `Factura` tipo 11 `estado="Error"` para el
   pedido #21 → `PUT .../facturar-arca {"facturar_arca": true}` → **200**, confirma que un intento
   fallido NO bloquea. Se borró la fila de prueba después y se devolvió el pedido a su estado
   original (`facturar_arca=false`).
6. Pedido inexistente (`/pedidos/999999/facturar-arca`) → **404**.
7. `docker compose exec frontend npm run build` → build sin errores.

## Pendiente de probar a mano en el navegador

Abrir `Pedidos.jsx`, tildar/destildar el checkbox nuevo en un pedido de prueba sin factura emitida y
confirmar que:
- El checkbox refleja el cambio al instante y no se traba si la API tarda.
- Si el `PUT` fallara (ej. desconexión), el checkbox vuelve solo a su valor anterior.
- El botón "Facturar" aparece/desaparece según corresponda al tildar/destildar (según `estado` y
  `monto_neto` del pedido).
