Fase 2 del storefront: carrito de compras + checkout que genera órdenes reales contra
`POST /ecommerce/ordenes` (ya construido y probado en Fase 0). Medios de pago y forma de envío quedan
**visuales, sin funcionalidad real** — nada de integración con pasarelas de pago ni cálculo de costo de
envío, eso es una fase futura todavía no planificada. Nada de nginx tampoco — se sigue probando en red
local, salir a producción es una decisión aparte que tomamos cuando esto ya funcione bien probado acá.

## 0. Dos decisiones de arquitectura, léelas antes de escribir código

- **El carrito usa `localStorage`, a propósito.** El CLAUDE.md tiene documentada la convención de "sin
  localStorage" para el panel de FashBalance (`frontend/`) — esa regla es específica del panel interno,
  donde toda la data de negocio tiene que vivir en Postgres. Acá es distinto: es estado de sesión de un
  comprador anónimo, no un dato de negocio, y perder el carrito al recargar la página es una mala
  experiencia de compra real. Documentá esto como excepción deliberada en el CLAUDE.md al terminar, no
  como que se te pasó la regla.
- **El checkout va con Server Action (`"use server"`), patrón moderno de Next.js — PERO con la lógica
  real separada en una función propia, testeable sin navegador.** Armá `src/lib/checkout.ts` con una
  función simple (ej. `procesarCheckout(carrito, datosContacto)`) que arma el payload real y le pega a
  `POST /ecommerce/ordenes` de FashBalance con la `X-API-Key` (nunca en código de cliente), devolviendo
  éxito con el id de la orden, o el detalle de qué línea falló. La Server Action que invoca el formulario
  es solo una envoltura fina alrededor de esa función — no le metas lógica propia ahí. Esto te permite
  probar `procesarCheckout` directo con un script (`npx tsx` o equivalente, mismo espíritu que los
  scripts de Python que ya se usan para probar el backend) sin pasar por el navegador ni por el protocolo
  interno de invocación de Server Actions (que no es practicable armar a mano con `curl`).

## 1. Backend: un campo chico nuevo

Agregar `metodo_pago_preferido` (texto, nullable) a `OrdenEcommerce` — es solo informativo (qué opción
tildó el cliente entre las visuales del punto 4), no dispara ninguna lógica de pago real. Incluilo en el
payload de `POST /ecommerce/ordenes` y en lo que devuelve/muestra `GET /ecommerce/ordenes` /
`OrdenesEcommerce.jsx`, para que la dueña vea qué esperaba el cliente al revisar el pedido.

## 2. Carrito: estado global del storefront

- Context + Provider en un Client Component cerca de la raíz (envolviendo `children` en `layout.tsx`,
  sin convertir `layout.tsx` en sí a Client Component — ese sigue siendo Server Component como ya está,
  solo agregale el Provider como wrapper).
- Cada línea: `producto_id`, `variante_id` (si aplica), `nombre`, `foto` (portada), `precio_venta`
  (snapshot al agregar), `cantidad`, y el `stock_actual` conocido de esa variante/producto en el momento
  de agregar (para acotar la cantidad en el carrito, mismo criterio de "tope contra stock" que ya existe
  en `Movimientos.jsx` del panel — no hace falta que sea perfecto acá, el checkout revalida en el
  servidor igual, es solo para no dejar que el comprador cargue un número disparatado).
  Sincronizado con `localStorage` en cada cambio, hidratado al montar.
- Badge de cantidad en el header: como el dato es 100% estado de cliente (no depende de ninguna env var
  server-only), un `CartBadge.tsx` chico como Client Component anidado dentro de `Header` está bien —
  `Header` sigue recibiendo por props lo que ya recibe de `layout.tsx` (nombre de tienda, redes), no hace
  falta convertir todo `Header` a cliente por esto.

## 3. Agregar al carrito (página de producto)

En `app/productos/[id]/page.tsx` / `VariantSelector.tsx`: botón "Agregar al carrito" con selector de
cantidad. Si el producto tiene variantes, deshabilitado hasta que se haya elegido una combinación válida
con stock (reusa el estado que `VariantSelector` ya maneja). Al agregar, si ya había una línea igual
(mismo producto+variante) en el carrito, sumar cantidades en vez de duplicar la línea.

## 4. `/carrito`

Lista de líneas con foto, nombre, variante (si aplica), cantidad editable (tope contra el
`stock_actual` guardado en la línea), subtotal por línea, botón de sacar, total general, y link a
`/checkout`. Si está vacío, mensaje + link a `/`.

## 5. `/checkout`

Formulario: nombre, email (opcional), teléfono (opcional), `forma_entrega` ("Retiro en persona" /
"Envío", ya soportado por el backend), `direccion_envio` (solo si eligió Envío), notas (opcional), y una
sección "Método de pago" con opciones visuales fijas (ej. "Efectivo al retirar", "Transferencia
bancaria") que solo alimentan `metodo_pago_preferido` — no dispara nada más. Resumen del pedido (líneas
del carrito + total) antes de confirmar.

Al confirmar: el formulario invoca la Server Action directo (sin `fetch` a mano, es el mecanismo nativo
de Next.js para esto), que a su vez llama a `procesarCheckout()` de `src/lib/checkout.ts`.

- **Éxito**: vaciar el carrito (localStorage + estado), mostrar confirmación con el número de pedido
  (una página `/pedido-confirmado` con el id por query param está bien).
- **Error de stock en alguna línea** (el backend ya valida esto de forma atómica — podés agregar una
  revalidación de stock al cargar `/carrito` como mejora, pero no es obligatorio para esta fase): mostrar
  el error apuntando a la línea puntual que falló (el backend devuelve el detalle por línea), sin
  vaciar el carrito, para que el comprador pueda ajustar cantidad o sacar ese producto y reintentar.

## 6. Formulario de contacto

Página o sección simple (nombre, email, mensaje) que arma un link `mailto:` pre-cargado al confirmar —
sin backend propio, sin envío real de mail server-side. Es deliberadamente liviano, coherente con que el
canal de contacto principal ya es el botón de WhatsApp que existe desde la Fase 1.

## Qué NO hacer

Nada de pasarela de pago real, nada de cálculo de costo de envío, nada de nginx/TLS. No toques Compras,
Movimientos, Análisis ni Importación del panel de FashBalance — el único cambio de ese lado es el campo
chico del punto 1.

## Antes de terminar

Probá `procesarCheckout()` con un script directo (no por HTTP): un pedido válido (confirmá que crea la
orden, el `Movimiento` Venta, y que el stock baja) y uno con cantidad mayor al stock disponible (confirmá
que rechaza sin crear nada, igual que ya probamos en Fase 0). Como esto genera movimientos reales de
venta y descuenta stock real, al terminar avisame explícitamente qué pedidos de prueba quedaron creados
—si conviene los revertís vos, no los borres por tu cuenta sin avisar. Decime también qué tengo que
probar a mano en el navegador — acá en particular importa confirmar que el formulario de checkout invoca
bien la Server Action de punta a punta (es lo único que el script no puede confirmar), además de la
persistencia del carrito al recargar y que el badge del header se actualice. Actualizá el CLAUDE.md con
esta sección nueva, incluyendo la excepción del `localStorage` y por qué `procesarCheckout()` está
separada de la Server Action que la invoca.
