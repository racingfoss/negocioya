Fase B: unificar el concepto de Pedido entre e-commerce y ventas locales, rediseñar Caja para armar un
pedido de varios ítems antes de confirmar, y agregar estados de logística. Esta fase NO conecta con ARCA
todavía — eso es la Fase C. Al terminar, un pedido queda confirmado (stock descontado, caja actualizada)
pero sin ninguna facturación disparada.

## 0. Restricción dura, no negociable

**El contrato de la Storefront API no cambia.** `GET /ecommerce/catalogo`, `GET /ecommerce/catalogo/{id}`
y `POST /ecommerce/ordenes` tienen que seguir aceptando y devolviendo exactamente el mismo JSON que hoy,
sin importar qué le hagas por dentro al modelo de datos. El storefront de Next.js (`ecommerce/`) no se
toca en esta fase — si algo de lo que planeás requeriría cambiarlo, replanteá el enfoque del lado de
FashBalance en vez de tocar el storefront.

## 1. Pedido unificado

Generalizar `OrdenEcommerce`/`OrdenEcommerceItem` a un concepto de `Pedido`/`PedidoItem` que sirva para
los dos canales. **Antes de decidir cómo**, mirá el código real de esos modelos y de todo lo que ya los
usa (`routers/ecommerce.py`, `OrdenesEcommerce.jsx`, la validación de `POST /ecommerce/ordenes`) y elegí
entre renombrar/extender la tabla existente o crear una nueva — con el criterio de "menos riesgo de
romper lo que ya funciona y está probado contra ARCA/e-commerce real", no por preferencia estética.
Mostrame qué elegiste y por qué antes de aplicarlo.

Campos nuevos sobre lo que ya existe:
- `canal`: `"ecommerce"` | `"local"`.
- `facturar_arca` (bool): para pedidos de canal `ecommerce`, siempre `True`, sin opción en la UI (una
  venta online se factura siempre). Para canal `local`, lo decide un checkbox al confirmar el pedido en
  Caja (ver punto 2) — default a tu criterio, pero que sea explícito y visible, no un valor oculto.
- `estado`: ampliar de la única opción `"Confirmada"` que hay hoy a una cadena real:
  `Pendiente → Preparando → Listo para retirar / Enviado (según forma_entrega) → Entregado`, más
  `Cancelado` como estado alternativo en cualquier punto antes de Entregado. **Default según canal, no
  el mismo para los dos**: un pedido `canal="ecommerce"` arranca en `Pendiente` (falta prepararlo/
  enviarlo). Un pedido `canal="local"` arranca directo en `Entregado` (la clienta se lo lleva puesto en
  el momento) — sin bloquear que se pueda cambiar a mano si hiciera falta un caso raro.
- `cliente_nombre` en pedidos locales queda opcional (no todo mostrador necesita registrar quién compró).

`POST /ecommerce/ordenes` sigue creando pedidos con `canal="ecommerce"`, `facturar_arca=True`,
`estado="Pendiente"` — automático, sin que el comprador vea ni elija nada de esto.

## 2. Caja: de "una venta = un producto" a "un pedido = varios ítems"

Hoy `Movimientos.jsx`, con tipo Venta, crea un `Movimiento` por cada carga (un producto, confirma,
listo). Pasa a funcionar como un carrito: se van agregando ítems a un pedido en curso (reusando tal cual
el selector de categoría → producto → variante con el filtro por stock que ya existe —
`opcionesParaAtributo`, tope de cantidad contra `stock_disponible`, todo eso se mantiene igual, no lo
reescribas) y recién al final se confirma todo junto.

- Mientras se arma: lista de ítems agregados (producto, variante si aplica, cantidad, subtotal), poder
  sacar un ítem antes de confirmar, total corriendo.
- Al confirmar: checkbox "Facturar" (ver `facturar_arca` del punto 1), nombre de cliente opcional,
  crea el `Pedido` (`canal="local"`) + un `PedidoItem` por línea + el `Movimiento` Venta correspondiente
  por cada línea, vía `registrar_venta()` — la misma función que ya existe y ya valida stock, no la
  reimplementes.
- `Ingreso`/`Egreso` en Caja **no cambian** — siguen siendo carga rápida de una sola línea, como hoy. El
  concepto de "armar varios ítems antes de confirmar" aplica solo a Venta.

## 3. Pantalla de Pedidos unificada

`OrdenesEcommerce.jsx` pasa a ser (o se reemplaza por) `Pedidos.jsx`: lista TODOS los pedidos sin
importar el canal, con columna de canal, fecha, cliente (o "Mostrador" si no se cargó nombre en uno
local), items, total, `facturar_arca` (badge sí/no), y `estado` — editable ahí mismo con un selector,
para que puedas ir moviendo un pedido por la cadena a medida que lo procesás. **Sin botón de "Facturar"
todavía** — no lo agregues, es explícitamente de la Fase C.

## Qué NO hacer

No llames a nada de `backend/app/arca/` desde ningún lado en esta fase — el módulo de la Fase A queda
intacto y sin conectar. No toques `ecommerce/` (ver punto 0). No implementes lógica de reversión/
cancelación real todavía (eso es la Fase D) — `Cancelado` es un estado disponible en el selector, nada
más, no dispara ninguna devolución de stock por ahora.

## Antes de terminar

Probá contra la API real: un pedido local con 3 ítems distintos (2 con variante, 1 sin) armado como
carrito y confirmado, verificando que se crearon los 3 `Movimiento` correctos y el stock bajó bien en
cada uno. Un pedido de e-commerce de prueba (reusando `POST /ecommerce/ordenes` tal cual) y confirmá que
sigue funcionando idéntico a como lo dejó la Fase 2, con `canal="ecommerce"` y `estado="Pendiente"`
puestos solos. Cambiar el estado de un pedido desde la pantalla nueva y confirmar que persiste. Avisame
qué tengo que probar a mano en el navegador (el flujo completo de armar un pedido en Caja con varios
ítems es lo más nuevo, ahí es donde más vale la pena que lo mires vos). Actualizá el CLAUDE.md con esta
sección nueva, documentando la decisión de renombrar vs. tabla nueva y por qué, y los defaults de estado
por canal.
