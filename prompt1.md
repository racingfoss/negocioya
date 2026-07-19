Reserva de stock con vencimiento corto, para el pedido que se está armando en Caja (FashBalance) — así un
producto/variante que ya está en un carrito local no se lo puede "robar" una venta de e-commerce mientras
se termina de armar y confirmar. Alcance acotado a propósito, sin scheduler ni worker de limpieza — el
mismo criterio "lazy" que ya se usa en el proyecto para los snapshots del mix real.

## El mecanismo (léelo antes de programar, no improvises otro)

- Las reservas vencen solas por tiempo (TTL corto, ver más abajo) — **no hace falta un proceso que las
  borre activamente**. Cualquier cálculo de stock disponible simplemente ignora las reservas cuyo
  `expira_en` ya pasó (`WHERE expira_en > now()`), así que una reserva vencida deja de "contar" en el
  instante exacto en que vence, sin que nadie tenga que borrarla para que deje de bloquear. Borrado físico
  de filas viejas: hacelo de forma oportunista (al crear una reserva nueva, de paso borrá las que ya
  vencieron hace rato) — no un cron, no un `BackgroundTask` periódico.
- Cada "pedido en armado" en Caja tiene un `sesion_id` (UUID generado en el frontend al arrancar un pedido
  nuevo tipo Venta), que viaja en cada reserva — así se sabe qué reservas pertenecen al mismo carrito en
  construcción.

## 1. Tabla nueva `reservas_stock`

`id`, `sesion_id` (string), `producto_id`, `variante_id` (nullable), `cantidad`, `creado_en` (default
now), `expira_en` (default now + `reserva_stock_minutos`, ver punto 2).

## 2. Configuración

Agregar `reserva_stock_minutos` (int, default `20`) a `configuracion` — mismo patrón que el resto de los
"números mágicos" del proyecto, editable desde ⚙️ Configuración sin tocar código.

## 3. `calculations.py`

- **`stock_disponible(db, producto_id, variante_id=None, excluir_sesion=None)`**: extender la función que
  ya existe (no crear una paralela) para que reste, además de lo que ya resta hoy, la suma de
  `reservas_stock` activas (`expira_en > now()`) para ese producto/variante — **excluyendo** las reservas
  de `excluir_sesion` si se pasa ese parámetro (una sesión no debe verse bloqueada por sus propias
  reservas al querer agregar más del mismo producto). Parámetro nuevo con default `None`, así todos los
  call sites existentes (`_validar()` en `movimientos.py`, etc.) siguen funcionando sin tocarlos.
- **`reservar_stock(db, sesion_id, producto_id, variante_id, cantidad)`**: valida contra
  `stock_disponible(..., excluir_sesion=sesion_id)`; si alcanza, crea o actualiza (upsert por
  `sesion_id`+`producto_id`+`variante_id`) la fila de `reservas_stock` con la `cantidad` nueva (no
  sumada — es "quiero tener reservado N en total para esta línea", reemplaza el valor, no lo acumula) y
  `expira_en` renovado a `now() + reserva_stock_minutos`; si no alcanza, error claro con el detalle. De
  paso, borra oportunistamente filas de `reservas_stock` con `expira_en` muy vencido (ej. más de un día)
  — limpieza liviana, no una tarea aparte.
- **`liberar_reserva(db, sesion_id, producto_id=None, variante_id=None)`**: borra la reserva puntual si se
  pasan `producto_id`/`variante_id`, o todas las de esa `sesion_id` si no se pasan — para "sacar un ítem
  del carrito en armado" y para "cancelar el pedido completo" respectivamente.
- **`registrar_venta`** (ya existe, no cambiar su firma pública): que internamente use la versión
  reservation-aware de `stock_disponible` — así una venta de e-commerce que intente llevarse unidades ya
  reservadas por un pedido local en armado se rechaza igual que si el stock ya estuviera vendido de
  verdad. Al confirmar un pedido local (ver punto 4), las reservas de esa `sesion_id` se liberan en la
  MISMA transacción que crea los `Movimiento` reales — no antes, no en un paso aparte.

## 4. Endpoints nuevos (`routers/reservas.py` o dentro de `pedidos.py`, a tu criterio)

- `POST /reservas`: `{sesion_id, producto_id, variante_id, cantidad}` → llama `reservar_stock`, 400 con
  el detalle si no alcanza.
- `DELETE /reservas`: por query params `sesion_id` (obligatorio) + `producto_id`/`variante_id`
  (opcionales) → llama `liberar_reserva`.

`POST /pedidos` (ya existe, de la Fase B): agregar `sesion_id` opcional al payload — si viene, después de
confirmar el pedido con éxito, liberar todas las reservas de esa sesión en la misma transacción (ya
convertidas en `Movimiento` real, no hace falta que sigan "reservadas").

## 5. Frontend — `Movimientos.jsx`

- Al arrancar a armar un pedido nuevo tipo Venta (primer "+ Agregar al pedido" de un carrito vacío),
  generar un `sesionId` nuevo (`crypto.randomUUID()`) y guardarlo en el estado del componente.
- "+ Agregar al pedido" pasa a llamar `POST /reservas` con ese `sesionId` antes de empujar el ítem al
  carrito visual — si el backend rechaza (no alcanza contando reservas de otras sesiones), mostrar el
  error y no agregar la línea. El tope de cantidad que ya se calculaba en el frontend sigue existiendo
  como primera barrera visual, pero la reserva real del backend es la que importa.
- "Sacar" un ítem del carrito en armado llama `DELETE /reservas` para esa línea puntual.
- Al confirmar (`POST /pedidos`), mandar el `sesionId` en el payload.
- Agregar un botón "Cancelar pedido" que vacíe el carrito visual y llame `DELETE /reservas` para toda la
  sesión — para no depender solo del vencimiento por tiempo si Florencia decide no continuar.

## Qué NO hacer

Nada de reserva para el carrito del e-commerce (`ecommerce/`) — ese sigue sin servidor detrás hasta el
checkout, tal como está diseñado; la mejora de revalidación que armamos aparte es la mitigación de ese
lado, no una reserva real. Nada de scheduler, worker, ni tarea en segundo plano para expirar reservas —
el vencimiento es pasivo, por comparación de fecha en cada consulta.

## Antes de terminar

Probá el escenario real que motivó esto: reservar stock desde un pedido local en armado (`POST
/reservas`), y mientras esa reserva sigue activa, intentar una compra de e-commerce por esas mismas
unidades — confirmar que se rechaza. Confirmar el pedido local y verificar que la reserva se liberó y el
`Movimiento` real se creó. Probar que una reserva vencida (esperá el TTL, o bajalo temporalmente para la
prueba) deja de bloquear sola, sin que nadie la borre a mano. Avisame qué probar en el navegador (armar un
pedido en Caja, sacar un ítem, cancelar el pedido completo). Actualizá el CLAUDE.md con esta sección
nueva, documentando el mecanismo de vencimiento pasivo y por qué no hace falta un scheduler.
