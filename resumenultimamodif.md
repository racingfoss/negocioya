# Resumen de la última modificación — Reserva de stock para pedidos en armado en Caja

Implementación de `prompt1.md`: mientras se arma un pedido tipo Venta en Caja (`Movimientos.jsx`),
las unidades agregadas quedan reservadas por un tiempo corto para que una venta de e-commerce (u
otra venta) no se las lleve mientras el pedido se termina de armar y confirmar. Vencimiento 100%
pasivo (por comparación de fecha en cada consulta) — sin scheduler ni worker de limpieza, mismo
criterio "lazy" que ya usa el proyecto para los snapshots del mix real. Incluye además dos fixes
encontrados al probar el flujo a mano.

## Ronda 1 — mecanismo base

**Backend**
- Tabla nueva `reservas_stock` (modelo `ReservaStock`): `sesion_id`, `producto_id`, `variante_id`,
  `cantidad`, `creado_en`, `expira_en`.
- `configuracion.reserva_stock_minutos` (default 20) — nuevo "número mágico" editable desde
  ⚙️ Configuración (grupo "Stock y Reposición"), mismo patrón que el resto de esa pantalla.
- `calculations.stock_disponible` extendida con parámetro `excluir_sesion` (retrocompatible,
  default `None`): resta reservas activas (`expira_en > now()`, comparado del lado de la base) —
  todos los call sites existentes (`validar_movimiento`, `routers/pedidos.py`,
  `routers/ecommerce.py`) pasan a ser reservation-aware automáticamente, sin tocarlos.
- `calculations.reservar_stock`/`liberar_reserva` (nuevas), endpoints `POST`/`DELETE /reservas`
  (`routers/reservas.py`).
- `POST /pedidos` acepta `sesion_id` opcional; al confirmar, libera las reservas de esa sesión
  como PRIMER paso de la transacción (no al final) — gotcha real encontrado al probar: liberarlas
  al final hacía que `registrar_venta()` (que valida stock internamente sin conocer
  `excluir_sesion`) restara la propia reserva dos veces y rechazara una confirmación legítima.

**Frontend (`Movimientos.jsx`)**
- `sesionId` (`crypto.randomUUID()` con fallback) generado al primer ítem de un carrito vacío.
- "+ Agregar al pedido" reserva contra el backend antes de tocar el carrito visual; "Sacar" libera
  esa línea puntual; nuevo botón "Cancelar pedido" libera toda la sesión; "Confirmar venta" manda
  `sesion_id` en el `POST /pedidos`.

## Ronda 2 — dos fixes encontrados en prueba manual

**Fix 1: el carrito se perdía al refrescar la página, pero la reserva seguía bloqueando stock.**
Solución sin `localStorage` (convención explícita del panel, todo vive en Postgres):
- `ReservaStock` ganó 3 columnas denormalizadas (`nombre_producto`, `descripcion_variante`,
  `precio_unitario`), completadas por `reservar_stock()` — mismo criterio ya usado en
  `PedidoItem`/`MixSnapshot`.
- Se extrajo el helper `calculations.descripcion_variante(db, variante_id)` desde una closure
  duplicada en `routers/importacion.py` (ahora la reusa en vez de tener su propia copia).
- `GET /reservas` (nuevo, admite `sesion_id` opcional).
- `Movimientos.jsx`: nuevo `useEffect` al montar que llama `GET /reservas` y, si hay reservas
  activas, reconstruye `itemsPedido`/`sesionId` directo desde los campos denormalizados (sin
  round-trips extra) y muestra un aviso ámbar de "pedido recuperado".

**Fix 2: el storefront de e-commerce no descontaba las reservas de Caja.**
Investigación de código antes de tocar nada: `POST /ecommerce/ordenes` ya usaba
`stock_disponible` (reservation-aware desde la Ronda 1) — el checkout final nunca tuvo bug de
integridad de datos. El problema real era que `GET /ecommerce/catalogo` y
`GET /ecommerce/catalogo/{id}` armaban su `stock_actual` con `stock_por_producto`/
`stock_por_variante`, que no restan reservas.
- `stock_por_producto`/`stock_por_variante` ganaron el parámetro `considerar_reservas: bool =
  False` (retrocompatible — la pantalla de Stock, el dashboard y BCG siguen mostrando stock físico
  puro a propósito, sin descontar reservas momentáneas). `routers/ecommerce.py` pasa
  `considerar_reservas=True` solo en los dos endpoints de catálogo.
- **Cero cambios en `ecommerce/`**: se confirmó por lectura de código que todo el stock que usa el
  storefront (tope al agregar al carrito, aviso de revalidación en `/carrito`) sale de esos mismos
  dos campos — arreglando el backend alcanzó.

**`CLAUDE.md`** actualizado con el mecanismo completo (secciones "Reserva de stock", "Reconstrucción
del carrito al refrescar" y "Catálogo de e-commerce reservation-aware").

## Verificado

- Por API (`docker compose exec backend python` + curl, sin navegador — política del proyecto):
  reserva activa bloquea a otra sesión y al e-commerce; la propia sesión no se autobloquea
  (`excluir_sesion`); confirmar el pedido libera la reserva en la misma transacción; una reserva
  vencida deja de contar sin que nadie la borre; limpieza oportunista de filas vencidas hace más de
  un día; `GET /ecommerce/catalogo/{id}` baja el stock mostrado al reservar, mientras
  `GET /stock/productos` (panel interno) sigue mostrando el stock físico completo.
- **Confirmado a mano por Florencia en el navegador**: armar un pedido en Caja, refrescar la
  página (el carrito reaparece con el aviso de recuperación), sacar un ítem, cancelar el pedido, y
  confirmar un pedido completo — todo funcionando.

## No se tocó

- `stock_por_producto`/`stock_por_variante` sin el flag (Stock, dashboard, BCG).
- `POST /ecommerce/ordenes` (`crear_orden`) — ya estaba bien.
- Ningún archivo de `ecommerce/` (storefront Next.js).
- `registrar_venta`/`validar_movimiento` — sin cambios de firma pública.
- `backend/app/arca/`, `Compras.jsx`.
