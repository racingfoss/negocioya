# Modificación chica — Editar "Facturar (ARCA)" en un pedido ya confirmado

## Contexto
`Pedido.facturar_arca` hoy se fija una sola vez al confirmar el pedido (checkbox en Caja para
`canal="local"`, siempre `True` para `canal="ecommerce"`) y después queda fijo — no hay forma de
cambiarlo. Caso real: un pedido local se confirmó con el checkbox destildado y después la clienta pide
factura igual. Hace falta poder prender (o apagar) `facturar_arca` en cualquier momento, para cualquier
canal, mientras el pedido siga siendo elegible para facturar.

**No toca**: `facturacion.py`, `arca/`, la lógica ya existente del botón "Facturar" (columna condicional
de `Pedidos.jsx`) — solo agrega una forma nueva de editar el campo que esa lógica ya lee.

## Reglas de negocio (explícitas para no dejarlas a interpretación)

- Se puede activar Y desactivar (toggle en los dos sentidos, no solo "activar").
- **Bloqueado con 400** si `Pedido.estado == "Cancelado"` (no hay nada que facturar).
- **Bloqueado con 400** si el pedido ya tiene una `Factura` con `tipo_comprobante=11` y
  `estado="Emitida"` — una vez que existe un CAE real, la decisión de si se factura o no ya se resolvió
  y no tiene sentido seguir editándola. (Un intento previo con `estado="Error"` NO bloquea — ahí sí
  puede tener sentido reactivar `facturar_arca` para reintentar.)
- Sin restricción por `canal` — aplica igual a pedidos `"local"` y `"ecommerce"`, aunque en la práctica
  el caso de uso real sea sobre todo local.

## Backend (`backend/app/routers/pedidos.py`)

Endpoint nuevo: `PUT /pedidos/{id}/facturar-arca`
- Body: `{"facturar_arca": bool}` (schema nuevo chico en `schemas.py`, ej. `FacturarArcaUpdate`).
- 404 si el pedido no existe.
- 400 (`detail` claro) si `pedido.estado == "Cancelado"`.
- 400 (`detail` claro) si ya existe `Factura` de ese pedido con `tipo_comprobante=11` y
  `estado="Emitida"`.
- Si pasa validaciones: setea `pedido.facturar_arca`, commit, devuelve `response_model=schemas.PedidoOut`
  usando el helper `_pedido_out(db, pedido)` que ya existe (mismo criterio que `cambiar_estado`).

## Frontend (`frontend/src/pages/Pedidos.jsx`)

En la columna "Facturar":
- **Sin cambios** si el pedido ya tiene Factura tipo 11 emitida (sigue mostrando CAE/vencimiento/importe
  como hoy).
- **Si todavía no tiene factura emitida**: reemplazar el badge fijo "Sí/No" por un checkbox editable
  que dispara `PUT /pedidos/{id}/facturar-arca` al tildar/destildar. Mismo patrón que el `<select>` de
  estado ya usa: revierte el valor visual si la API rechaza (400), Set de ids "en vuelo"
  (`actualizandoFacturarArca`) para deshabilitar el checkbox de esa fila mientras la request está en
  curso — mismo criterio que `facturando`/`devolviendo`.
- No hace falta tocar la lógica que decide si mostrar el botón "Facturar" — ya depende de
  `facturar_arca`, así que al tildar el checkbox el botón aparece solo si además se cumplen las
  condiciones existentes (`estado != "Cancelado"`, `monto_neto > 0`).

## Testing (curl, sin navegador)

1. Pedido local confirmado con `facturar_arca=False` → `PUT .../facturar-arca {"facturar_arca": true}`
   → confirmar 200 y que el pedido en `GET /pedidos` ya lo muestra en `true`.
2. Mismo pedido → `PUT .../facturar-arca {"facturar_arca": false}` → confirmar que se puede volver a
   apagar.
3. Pedido con `estado="Cancelado"` → confirmar 400.
4. Pedido con una `Factura` tipo 11 `estado="Emitida"` → confirmar 400 al intentar cambiar
   `facturar_arca` en cualquier sentido.
5. Pedido con una `Factura` tipo 11 `estado="Error"` (intento fallido) → confirmar que SÍ se puede
   cambiar `facturar_arca` sin bloqueo.
6. Avisar qué probar a mano en el navegador: tildar el checkbox en un pedido de prueba y confirmar que
   el botón "Facturar" aparece/desaparece según corresponda.

Escribir lo necesario en los CLAUDE.md, y además pisar el archivo resuenultimamodif.md con el resumen de lo realizado
