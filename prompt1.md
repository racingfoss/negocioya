Fase 1 del sub-proyecto de e-commerce, arquitectura ya confirmada: Headless Commerce — FashBalance como
Commerce Core (Admin API + Storefront API ya construida en Fase 0), un storefront Next.js nuevo que
consume esa Storefront API actuando como BFF (la API key vive server-side, nunca llega al navegador).
nginx todavía NO entra en esta fase — se agrega más adelante, cuando el storefront esté listo para salir a
internet de verdad. Por ahora se prueba en red local, mismo criterio que ya se usa con el frontend de
FashBalance (puerto expuesto, se abre desde el navegador apuntando a la IP de la VM).

**Alcance de esta fase: catálogo navegable de solo lectura.** Sin carrito, sin checkout, sin medios de
pago, sin cálculo de envío — eso es Fase 2. Acá el objetivo es: que se puedan ver los productos
publicados, con sus fotos y variantes con stock, y que desde ahí se pueda contactar por WhatsApp.

## 0. Dónde vive el código

Carpeta nueva `ecommerce/` en la raíz del repo, hermana de `backend/` y `frontend/` — mismo repo, no uno
separado. El CLAUDE.md sigue siendo uno solo en la raíz, con una sección nueva para esta parte (no crear
un CLAUDE.md aparte adentro de `ecommerce/`).

## 1. Backend: un endpoint chico nuevo en FashBalance

`GET /ecommerce/catalogo/{producto_id}`: mismo `X-API-Key`, mismo schema `ProductoCatalogoOut` que ya
existe para el listado, pero devuelve un solo producto (404 si no existe, no está `activo`, o no está
`visible_ecommerce`). Necesario para que cada página de producto en Next.js no tenga que traer el
catálogo completo solo para mostrar uno — reusá toda la lógica que ya arma la respuesta del listado
(`_formatear_variantes`, etc.), no la reescribas para este caso puntual.

## 2. Storefront Next.js (App Router)

- Páginas:
  - `/` — grilla de productos publicados (foto de portada, nombre, precio), cada uno linkeando a su
    página de detalle. Trae los datos con `GET /ecommerce/catalogo` en el servidor (Server Component,
    sin JS de fetching del lado del cliente).
  - `/productos/[id]` — galería de fotos, nombre, `descripcion_ecommerce`, precio, y si el producto tiene
    variantes, selector de atributos en cascada (Talle → Color, etc.) con el MISMO criterio ya establecido
    en `frontend/src/pages/Movimientos.jsx` de FashBalance: opciones sin stock se muestran igual pero
    deshabilitadas (" (sin stock)"), nunca ocultas; si no hay stock en ninguna variante, mensaje claro en
    vez de combos vacíos. Es una reimplementación (proyecto distinto, no se puede importar el componente
    tal cual), pero el comportamiento tiene que ser idéntico — leé ese archivo como referencia antes de
    escribir la lógica de acá.
- **Metadata para compartir en redes/WhatsApp** (la razón concreta por la que se eligió Next.js en vez de
  React+Vite para esto): cada página de producto tiene que usar `generateMetadata` de Next.js para las
  etiquetas Open Graph — `og:title` (nombre + precio), `og:description` (`descripcion_ecommerce`),
  `og:image` (la foto de portada). Sin esto, no tiene sentido haber elegido Next.js — no te lo saltees.
- **Botón de WhatsApp**: flotante, visible en todas las páginas, arma el link `https://wa.me/<numero>` con
  un mensaje pre-cargado (genérico en el home, mencionando el producto puntual en la página de detalle).
  El número sale de una variable de entorno (`WHATSAPP_NUMERO`), con un valor placeholder obvio (ej.
  `5490000000000`) — no tengo el número real a mano todavía, lo cargo yo después en el `.env`.
- **Links a redes sociales**: Instagram/Facebook/lo que corresponda, en el header o footer, también desde
  variables de entorno con placeholders (`INSTAGRAM_URL`, etc.) — mismo criterio, los completo yo después.
- **Diseño propio, no el tema oscuro de FashBalance**: FashBalance usa Tailwind con una paleta oscura de
  panel de administración (`bg-[#0b0f19]`, etc.) — el storefront es una tienda de ropa de cara al
  público, necesita su propia identidad visual (más clara, con las fotos de producto como protagonistas),
  no heredar el tema del panel interno. Usá Tailwind igual (consistencia de herramienta), pero con
  paleta/tipografía propias.

## 3. Dos variables de entorno para "cómo llegar a FashBalance", no una — son cosas distintas

- `FASHBALANCE_API_URL`: URL interna de Docker (`http://backend:8000`) — se usa SOLO server-side, en los
  Server Components/`fetch` que llevan el `X-API-Key`. Nunca debe tener el prefijo `NEXT_PUBLIC_` (eso lo
  metería en el bundle que baja al navegador, exponiendo la key).
- `FASHBALANCE_PUBLIC_URL`: la URL con la que el NAVEGADOR DEL CLIENTE puede llegar a FashBalance para
  bajar las fotos (`/fotos/...`) — no puede ser la URL interna de Docker, el navegador de un comprador no
  tiene forma de resolver `backend:8000`. Por ahora, mientras no exista nginx, esto va a ser la IP/puerto
  real de la VM donde corre FashBalance (`http://<ip-vm>:8000`), igual que ya usás `VITE_API_URL` para el
  frontend actual. Cuando se agregue nginx en una fase posterior, esto se simplifica (va a quedar bajo el
  mismo origen que el storefront), pero no te adelantes a resolver eso ahora.

## 4. Docker

- `ecommerce/Dockerfile`: build de producción de Next.js (`next build` + `next start`, no modo dev — a
  diferencia del frontend de FashBalance, que sí corre en modo dev porque es un panel interno tuyo nomás;
  esto en algún momento va a estar expuesto a cualquiera, arranca con el hábito correcto desde ahora).
- Servicio nuevo en `docker-compose.yml` (`ecommerce`), puerto `3000` expuesto para probarlo desde tu
  navegador apuntando a la IP de la VM, con las 4 variables de entorno de arriba.

## Qué NO hacer en esta ronda

Nada de carrito, checkout, medios de pago ni cálculo de envío (Fase 2). Nada de nginx ni TLS (fase
posterior, cuando el storefront esté listo para salir a internet). No toques nada de FashBalance más allá
del endpoint puntual de la sección 1.

## Antes de terminar

Como esto es un storefront con renderizado del lado del servidor, se puede verificar sin navegador: un
`curl http://localhost:3000/` (o al puerto que corresponda) tiene que devolver HTML ya con los nombres y
precios de los productos incrustados (confirma que el fetch server-side a la Storefront API funcionó), y
lo mismo contra `/productos/{id}` de un producto con variantes, revisando que el HTML incluya las
opciones de talle/color. Probá también pedir un producto que no existe o no está publicado y confirmar
que la página maneja el 404 sin romperse. Avisame explícitamente qué tengo que revisar yo a mano en el
navegador (layout, fotos, que el botón de WhatsApp abra bien) antes de dar esto por terminado. Actualizá
el CLAUDE.md con una sección nueva sobre el storefront — arquitectura (Headless Commerce, BFF), las dos
variables de entorno y por qué son distintas, y que WhatsApp/redes quedaron con placeholders a completar.
