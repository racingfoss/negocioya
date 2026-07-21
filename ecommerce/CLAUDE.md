# FashBalance — storefront público (`ecommerce/`, Next.js App Router, TypeScript)

Este archivo se carga junto con el `CLAUDE.md` de la raíz cuando se trabaja dentro de `ecommerce/`. Es
el storefront público de solo lectura + carrito/checkout — no confundir con `frontend/` (panel interno
de gestión, React + Vite, sin TypeScript). Es un proyecto aislado: no comparte build con `frontend/`, así
que no hay tensión real con que el resto del repo sea JS/Python sin tipos. Para el detalle de los
endpoints backend que consume, ver `backend/CLAUDE.md`.

## Contrato con el backend (resumen — implementación completa en `backend/CLAUDE.md`)

- **Terminología**: una venta acá genera un `Movimiento` tipo `"Venta"` (mismo mecanismo que cargar una
  venta a mano en Caja del panel interno). **No** es una `Compra`.
- **Auth**: header `X-API-Key` contra la env var `ECOMMERCE_API_KEY`, nunca expuesta al navegador —
  siempre se usa server-side (Server Components, Server Actions).
- **Endpoints públicos consumidos**: `GET /ecommerce/catalogo`, `GET /ecommerce/catalogo/{producto_id}`,
  `GET /ecommerce/configuracion-tienda`, `POST /ecommerce/ordenes`.
- El stock que muestra el catálogo (`stock_actual` de cada producto/variante) **ya resta reservas activas
  de pedidos en armado en Caja** (`considerar_reservas=True` del lado del backend) — ver "Reserva de
  stock — catálogo reservation-aware" más abajo.

## Storefront público (Fase 1) — solo lectura

- **Arquitectura**: Headless Commerce / BFF (Backend-for-Frontend). FashBalance es el Commerce Core; el
  storefront es un Next.js (App Router, TypeScript) que consume los endpoints públicos protegidos con
  `X-API-Key`. TypeScript porque el contrato JSON del catálogo (variantes opcionales, fotos, valores
  anidados) es justo donde tipar evita bugs de acceso.
- **`GET /ecommerce/catalogo/{producto_id}`**: para que la página de detalle no traiga el catálogo
  completo. Mismo criterio de visibilidad que el listado (404 si no existe, no está activo, o no está
  publicado — sin distinguir el motivo).
- **Dos variables de entorno para llegar a FashBalance, no una — son cosas distintas**:
  `FASHBALANCE_API_URL` (`http://backend:8000`, red interna de Docker) es la única que usa el servidor de
  Next.js para hacer `fetch` en Server Components, con el header `X-API-Key` — nunca llega al navegador.
  `FASHBALANCE_PUBLIC_URL` (misma IP/puerto que ya usa `VITE_API_URL` para el panel, ej.
  `http://192.168.100.50:8000`) es la URL que sí tiene que poder resolver el navegador del cliente final,
  para bajar las fotos (`/fotos/...`) y para armar la URL **absoluta** de `og:image` (WhatsApp/Facebook
  necesitan URL pública para generar el preview de un link, no relativa). Ninguna de las dos lleva el
  prefijo `NEXT_PUBLIC_` porque ambas se resuelven 100% server-side (fetch, `generateMetadata`, o props
  ya armadas que se pasan a Client Components) — la diferencia es red interna de Docker vs. red
  externa/LAN, no "server vs. cliente" en el sentido de Next.js. Cuando se agregue nginx en una fase
  posterior esto se simplifica (mismo origen que el storefront), no se adelantó esa solución acá.
- **Regla general — nunca leer una env var sin `NEXT_PUBLIC_` (ej. `FASHBALANCE_PUBLIC_URL`) dentro de un
  Client Component**: bug real ya corregido. `ProductGallery.tsx` originalmente llamaba a `fotoUrl()`
  directo para armar el `src` de la imagen en foco y las miniaturas. Como el componente tiene
  `"use client"`, Next.js reemplaza en build-time cualquier `process.env.X` sin prefijo `NEXT_PUBLIC_`
  por `undefined` en el bundle de cliente — rompía **ambas** imágenes en `/productos/[id]`, mientras que
  `ProductCard.tsx` (la grilla de `/`, Server Component) mostraba las fotos bien porque ahí `fotoUrl()`
  corre en el servidor con la env var disponible en runtime. Fix aplicado: `ProductGallery` ya no recibe
  `Foto[]` ni llama a `fotoUrl()` él mismo — recibe `FotoResuelta[]` (`{id, url}`) con las URLs ya
  armadas por `page.tsx` (Server Component) y pasadas como prop. **Para cualquier componente nuevo**: si
  necesita una URL construida con `FASHBALANCE_PUBLIC_URL` (u otra env var server-only) y es o puede
  terminar siendo un Client Component, resolvé la URL en el Server Component padre y pasala ya armada —
  nunca llames `fotoUrl()` ni leas esas env vars desde un archivo con `"use client"`.
- **Selector de atributos en cascada sin endpoint dedicado** (`src/lib/attributes.ts`): el storefront no
  tiene acceso a `GET /productos/{id}/atributos` (interno del panel, sin `X-API-Key`) ni al `orden` real
  de `ProductoAtributo`. `derivarAtributosProducto()` deriva la lista de atributos por orden de
  **primera aparición** recorriendo `producto.variantes[].valores[]` — determinístico, pero no
  necesariamente el orden de negocio real de `ProductoAtributo.orden`. Limitación aceptada, no un bug:
  alcanza para 1-2 atributos tipo talle/color. `opcionesParaAtributo()` y `elegirValorAtributo()` son un
  port directo (mismo comportamiento, con tipos) de las funciones homónimas en
  `frontend/src/pages/Movimientos.jsx` — mismo criterio de opciones sin stock deshabilitadas con " (sin
  stock)" (nunca ocultas), mismo mensaje único si todas las opciones del primer atributo quedan sin
  stock, mismo aviso si el producto tiene `tiene_variantes=true` pero cero `Variante` cargadas.
- **Docker**: `ecommerce/Dockerfile` es multi-stage de **producción** (`next build` con
  `output: "standalone"` + `node server.js` en el runner), a diferencia de `frontend/Dockerfile` (dev
  puro, `npm run dev`, bind-mount) — no hay hot-reload acá, hay que rebuildear la imagen
  (`docker compose build ecommerce`) ante cada cambio de código. Servicio `ecommerce` en
  `docker-compose.yml`, puerto `3000`, `depends_on: backend` (sin `condition: service_healthy` porque
  `backend` no tiene healthcheck definido, mismo nivel que ya usa `frontend`).
- **Qué NO hace esta fase**: nada de nginx ni TLS — el storefront se prueba en red local igual que el
  panel, apuntando al puerto expuesto desde la IP de la VM.

## Configuración de la tienda (nombre, WhatsApp, redes, email de contacto)

El endpoint que expone esto (`GET /ecommerce/configuracion-tienda`, schema `ConfiguracionTiendaOut`) y
la pantalla donde Florencia lo edita (⚙️ Configuración del panel) están en `backend/CLAUDE.md` y
`frontend/CLAUDE.md` respectivamente. Acá el lado consumidor:

- `src/lib/api.ts` expone `getConfiguracionTienda()` con el mismo mecanismo de `X-API-Key` y
  `revalidate: 60` que `getCatalogo()`/`getProducto()`. Se consume una sola vez en `app/layout.tsx`
  (Server Component, junto con `generateMetadata` para el `<title>`) y se pasa como props ya resueltas a
  `Header`/`Footer`/`SocialLinks`/`WhatsAppButton` — ninguno de esos componentes lee la env var ni hace
  fetch propio. `app/productos/[id]/page.tsx` hace su propio fetch (mismo `Promise.all` que ya usaba para
  `getProducto`) porque el botón de WhatsApp de esa pantalla necesita el nombre del producto en el
  mensaje.
- **`layout.tsx` tiene `export const dynamic = "force-dynamic"`**: sin eso, `next build` intenta
  pre-renderizar estáticamente rutas como `/_not-found` y falla en build time (no hay backend ni env
  vars de runtime disponibles todavía en esa etapa).
- Nombre de la tienda, WhatsApp y redes **ya no son env vars** — se dieron de baja `WHATSAPP_NUMERO`,
  `INSTAGRAM_URL`, `FACEBOOK_URL` del servicio `ecommerce` en `docker-compose.yml` y de `.env` (eran
  placeholders de ejemplo obvios que había que completar a mano y rebuildear para cambiar). Un cambio en
  ⚙️ Configuración se refleja solo (respetando el `revalidate: 60` del fetch), sin rebuildear
  `ecommerce/`.

## Carrito y checkout (Fase 2)

Agrega al storefront de solo lectura un carrito de compras y un checkout que genera órdenes reales
contra `POST /ecommerce/ordenes` (el mismo endpoint de la Fase 0, sin cambios para soportar esto — solo
un campo informativo nuevo, ver `metodo_pago_preferido` más abajo). Sigue sin haber pasarela de pago
real, cálculo de envío real, ni nginx/TLS.

- **Excepción deliberada a "sin `localStorage`"**: la convención de no usar `localStorage`/
  `sessionStorage` (ver `frontend/CLAUDE.md`) es específica del panel interno, donde toda la data de
  negocio tiene que vivir en Postgres. El carrito acá es distinto a propósito: es estado de sesión de un
  comprador anónimo, no un dato de negocio, y perder el carrito al recargar la página sería mala
  experiencia de compra real.
- **`CartContext`/`CartProvider`** (`src/context/CartContext.tsx`, Client Component): estado `items:
  CartItem[]` (cada línea con `producto_id`, `variante_id` opcional, `nombre`, `foto` ya resuelta,
  `variante_descripcion`, `precio_venta` snapshot numérico al agregar, `cantidad`, y `stock_actual`
  conocido al agregar para acotar la cantidad client-side — no hace falta que sea perfecto, el checkout
  revalida en el servidor igual). Acciones: `agregarItem` (suma cantidades si ya existe la línea por
  `producto_id`+`variante_id`, con tope contra `stock_actual`), `actualizarCantidad`, `quitarItem`,
  `vaciarCarrito`. Derivados `cantidadTotal`/`total` expuestos por el hook `useCart()`.
  - **Gotcha de hidratación evitado**: sincronizar a `localStorage` en un único `useEffect([items])`
    también correría en el primer render (con `items` todavía `[]`, antes de que la carga inicial tuviera
    chance de aplicar lo guardado), pisando el localStorage real con `[]`. Se resuelve con un flag
    `hydrated` interno: un primer efecto (solo al montar) lee `localStorage` y lo vuelca a `items`; el
    efecto de sync a `localStorage` solo escribe si `hydrated` ya es `true`.
  - **`CartProvider` envuelve Header + `{children}` + Footer + `WhatsAppButton` en `layout.tsx`, no solo
    `children`**: `CartBadge` (el ícono con contador en el header) vive dentro de `Header`, que en
    `layout.tsx` es hermano de `{children}`, no descendiente — si el Provider solo envolviera `children`,
    `CartBadge` quedaría fuera de su alcance. `layout.tsx` sigue siendo Server Component (async,
    `generateMetadata`, `dynamic = "force-dynamic"` intactos): solo se envuelve su JSX de salida con
    `<CartProvider>`, patrón soportado de Next.js (un Server Component puede pasar JSX ya renderizado
    como hijo de un Client Component sin que ese JSX se vuelva cliente).
- **Agregar al carrito** (`app/productos/[id]/AddToCartButton.tsx`): reemplaza el bloque que antes solo
  mostraba disponibilidad. `VariantSelector.tsx` ganó un prop opcional `onSeleccionChange` (cambio
  aditivo) que reporta hacia arriba la variante resuelta, su stock y su descripción cada vez que cambia
  la selección — vía un `useEffect` ubicado **antes** de los `return` tempranos del componente (los de
  "sin variantes cargadas" / "sin stock en ninguna combinación"), para no violar las reglas de hooks
  llamándolo condicionalmente. `AddToCartButton` es quien realmente sabe agregar al carrito
  (`useCart().agregarItem(...)`), con un input de cantidad topado contra el stock conocido.
- **`/carrito`** (Client Component completo, necesita `useCart()`): lista de líneas con foto, nombre,
  variante, cantidad editable (tope por línea), subtotal, botón "Sacar", total general y link a
  `/checkout`. Vacío: mensaje + link a `/`.
  - **Revalidación de stock al montar `/carrito`**: el `stock_actual` guardado en cada `CartItem` es un
    snapshot de cuando se agregó el producto — si el carrito queda abierto un rato, puede estar viejo.
    `app/carrito/actions.ts` (`"use server"`) expone `obtenerStockFresco(productoIds)`, que por cada
    `producto_id` **distinto** presente en el carrito pega a `GET /ecommerce/catalogo/{id}` con
    `fetch(..., { cache: "no-store" })` — a propósito no reusa `getProducto()`/`apiFetch()` de
    `lib/api.ts`, que trae `next: { revalidate: 60 }`: sin bypasear esa cache, esta revalidación podría
    devolver el mismo stock viejo que ya está en el carrito durante hasta 60s. `page.tsx` la llama en un
    único `useEffect` al montar (no en cada cambio de `items`) y guarda el resultado en un
    `Record<producto_id, StockFrescoProducto | null>` (`null` = el producto ya no existe o dejó de estar
    activo/publicado, se trata como stock 0). Por línea: `stockFrescoDeLinea()` resuelve el stock fresco
    (de la variante puntual si tiene, si no del producto) y decide el aviso — nada si alcanza, "Solo
    quedan N disponibles" (ámbar, no bloquea) si alcanza parcial, "Ya no hay stock..." (rojo) si es 0. Con
    cualquier línea en 0, el link a `/checkout` se reemplaza por un botón deshabilitado. Mientras la
    revalidación no llegó (`undefined` en el record) no se muestra ningún aviso, sin spinner. **No
    implementa reserva de stock** (eso es del lado de FashBalance/Caja, ver "Reserva de stock" en
    `backend/CLAUDE.md`) — es solo refrescar el dato para avisar mejor.
- **`/checkout` — Server Action con lógica real separada, a propósito**: `src/lib/checkout.ts` expone
  `procesarCheckout(carrito, datosContacto)`, que arma el payload real y le pega a
  `POST /ecommerce/ordenes` con la `X-API-Key` (nunca en código de cliente) usando `fetch` con
  `cache: "no-store"` — no reutiliza el `apiFetch` de `lib/api.ts` porque ese helper está atado a GET +
  `revalidate: 60` + semántica "404 → null", que no aplica a una mutación. La Server Action
  (`app/checkout/actions.ts`, `"use server"`) es una envoltura fina: `FormData` → objeto → delega 100% en
  `procesarCheckout`. Esta separación es lo que permite probar `procesarCheckout` con un script
  (`scripts/test-checkout.ts`, ver abajo) sin navegador ni el protocolo interno de invocación de Server
  Actions. `app/checkout/CheckoutForm.tsx` (Client) usa `useFormState`/`useFormStatus` de `react-dom`
  (estable en React 18.3.1 + Next 14.2.x); el carrito (`items`) viaja **bindeado** a la Server Action
  (`crearOrdenAction.bind(null, items)`, mecanismo nativo de Next.js para pasar datos no-formulario a un
  `<form action>`), el resto de los campos son inputs nativos leídos de `FormData`. El vaciado del
  carrito ocurre **client-side**, en un `useEffect` que reacciona al resultado devuelto — nunca dentro de
  la Server Action, que corre en el servidor sin acceso a `localStorage`. Si el backend rechaza una línea
  puntual por stock insuficiente, el `detail` del error se muestra tal cual en el formulario y el carrito
  **no se vacía**.
- **`/pedido-confirmado`**: Server Component simple, lee `?id=` de la URL, sin fetch propio.
- **`metodo_pago_preferido`** (campo en `Pedido`/`OrdenEcommerce`, backend, nullable): qué opción visual
  tildó el cliente en el checkout (ej. "Efectivo al retirar", "Transferencia bancaria") — puramente
  informativo, no dispara ninguna lógica de pago real.
- **`email_contacto` en `configuracion`** (backend, nullable): el formulario de Contacto arma un
  `mailto:` pero no había ningún email de destino disponible en ningún lado del sistema — se agregó como
  un campo más de "Tienda Online" en ⚙️ Configuración del panel en vez de una env var nueva acá.
- **Formulario de contacto** (`app/contacto/`): página liviana (nombre, email, mensaje) que arma un link
  `mailto:` al destino de `email_contacto` — sin backend propio, sin envío real de mail server-side. Si
  `email_contacto` todavía no está configurado (`null`), `ContactForm.tsx` oculta el formulario y muestra
  un mensaje apuntando al botón de WhatsApp, coherente con que ese ya es el canal de contacto principal.
- **`scripts/test-checkout.ts`**: prueba `procesarCheckout()` directo contra el backend real (sin pasar
  por Next.js ni por HTTP al storefront). Busca automáticamente en el catálogo publicado un producto (con
  o sin variantes) con stock suficiente, corre un caso válido (confirma que crea la orden y muestra su id
  bien visible) y un caso de cantidad mayor al stock disponible (confirma que se rechaza sin crear nada).
  **Nunca borra nada automáticamente** — los pedidos válidos que crea quedan como órdenes reales (con su
  Movimiento de Venta real y stock descontado real) en la base. Como el proyecto no tiene `node`/`npm` en
  el host (todo corre en contenedores) y el servicio `ecommerce` corre la build de producción sin
  bind-mount de código, se ejecuta con un contenedor descartable de Node en la red de Docker Compose del
  proyecto (`docker run --rm --network negocioya_default -v "$(pwd)/ecommerce:/app" -w /app -e
  FASHBALANCE_API_URL=http://backend:8000 -e ECOMMERCE_API_KEY=... node:20-alpine sh -c "npm install &&
  npm run test:checkout"`). `tsx` es devDependency de `ecommerce/package.json` (no entra a la imagen de
  producción, que solo copia `.next/standalone`).
- **Qué NO se tocó**: Compras, Movimientos, Análisis e Importación del panel interno — el único cambio de
  ese lado además de lo de arriba es el campo `metodo_pago_preferido` en la pantalla de Pedidos.

## Reserva de stock — catálogo reservation-aware

El backend de "Reserva de stock" (tabla `reservas_stock`, `stock_disponible`, TTL) está en
`backend/CLAUDE.md`. Investigación de código confirmó el alcance exacto de un bug real: el storefront
dejaba agregar al carrito y mostraba como disponibles unidades que en realidad ya estaban reservadas por
un pedido en armado en Caja (panel interno). `POST /ecommerce/ordenes` (`crear_orden`) ya usaba
`stock_disponible` (reservation-aware desde el día 1 de esa feature), así que el checkout final **nunca
tuvo un problema de integridad de datos** — una compra que chocara con una reserva activa siempre se
rechazó correctamente. El problema real estaba acotado a `GET /ecommerce/catalogo` y
`GET /ecommerce/catalogo/{id}`, que armaban su `stock_actual` con funciones que no restaban reservas (a
propósito, para no afectar los reportes internos de Stock/Dashboard/BCG, ver `backend/CLAUDE.md`). Se
confirmó (leyendo `src/lib/api.ts`, `AddToCartButton.tsx`, `VariantSelector.tsx` y `carrito/actions.ts`)
que absolutamente todo el número de stock que usa el storefront —tope al agregar al carrito, aviso "Solo
quedan N disponibles"/"Ya no hay stock" en la revalidación de `/carrito`— sale directo de esos dos campos,
sin ningún cómputo propio del lado de `ecommerce/`. Consecuencia: el fix se hizo 100% en el backend
(parámetro `considerar_reservas=True` en `stock_por_producto`/`stock_por_variante`, ver
`backend/CLAUDE.md`) — **nada de `ecommerce/` se tocó**, confirmado por investigación de código antes de
implementar, no una suposición.
