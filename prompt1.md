Nombre real de la tienda ("Adorante", no "FashBalance") y WhatsApp/redes sociales, que pasan de
variables de entorno fijas a datos editables desde la pantalla ⚙️ Configuración de FashBalance (la que ya
existe — NO crear una pantalla nueva). Van juntos: el nombre de la tienda termina viviendo en el mismo
lugar que esos datos, así que no tiene sentido hardcodear "Adorante" en el storefront para después
sacarlo — se resuelve todo dinámico desde el vamos.

## Backend (`backend/app/`)

- Agregar a la tabla `configuracion` (singleton, ya existe): `nombre_ecommerce` (default `"Adorante"`),
  `whatsapp_numero`, `instagram_url` (nullable), `facebook_url` (nullable). Mismo bootstrap automático
  que los campos que ya están ahí. Como es una columna nueva en una tabla existente, va a hacer falta el
  `ALTER TABLE` manual de siempre (o `down -v` si es data de prueba) — no lo asumas, avisalo al terminar.
- Agregar una sección nueva a la pantalla ⚙️ Configuración del frontend de FashBalance (mismo componente,
  mismo botón de guardar que las secciones que ya existen ahí).
- **No exponer esto por `GET /configuracion`** (Admin API, sin autenticación, devuelve todos los umbrales
  internos). Agregar `GET /ecommerce/configuracion-tienda` al `routers/ecommerce.py` que ya existe (no un
  router nuevo), mismo `X-API-Key` que ya usan los otros 3 endpoints ahí. Devolvé solo esos 4 campos con
  un schema dedicado (mismo criterio que `ProductoCatalogoOut`: un schema propio que garantice por diseño
  que nunca se cuele ningún otro campo de `configuracion`, no un `dict` armado a mano).

## Storefront (`ecommerce/`)

- Sacar `WHATSAPP_NUMERO`, `INSTAGRAM_URL`, `FACEBOOK_URL` del servicio `ecommerce` en
  `docker-compose.yml` — no debe quedar una segunda fuente de verdad.
- Agregá la función de fetch a `GET /ecommerce/configuracion-tienda` en `src/lib/api.ts`, junto a las que
  ya están ahí (mismo mecanismo de `X-API-Key` que ya usa ese archivo) — no un fetch paralelo en otro
  lado. Usá `next: { revalidate: 60 }` (o similar) para no pegarle a FashBalance en cada request, pero
  que un cambio hecho en Configuración se refleje solo, sin rebuildear el contenedor.
- **Dónde se consume, con el bug del `ProductGallery` bien presente**: por lo que documenta el CLAUDE.md,
  el header/footer/botón flotante de WhatsApp viven en `app/layout.tsx` — si efectivamente es así y ese
  archivo es Server Component (sin `"use client"`), llamá ahí directo a la función de `lib/api.ts`, es
  seguro. El botón de WhatsApp de la página de producto (con el nombre del producto en el mensaje) va en
  `app/productos/[id]/page.tsx`, también Server Component — mismo criterio. **Si por lo que sea alguno de
  estos termina siendo o necesitando ser Client Component, NO leas el resultado de este fetch ahí
  adentro** — resolvé el dato en el Server Component padre y pasalo ya armado como prop, exactamente el
  mismo patrón que se usó para arreglar `ProductGallery.tsx` con `FASHBALANCE_PUBLIC_URL`. Confirmá antes
  de terminar que ninguna de las tres variables viejas (`WHATSAPP_NUMERO`, etc.) quedó referenciada en
  ningún archivo con `"use client"`.
- El nombre de la tienda (`nombre_ecommerce`) sale del mismo fetch. Grep del texto literal "FashBalance"
  en todo `ecommerce/` para no dejar ninguna aparición sin reemplazar (logo, copyright del footer, título
  por defecto).
- Acordate que `ecommerce/Dockerfile` es de producción, sin hot-reload — hace falta
  `docker compose build ecommerce` para ver estos cambios, no alcanza con reiniciar el contenedor.

## Antes de terminar

Probá que cambiar el WhatsApp o una red desde Configuración se refleje en el storefront después de
rebuildear y esperar el `revalidate`, sin tocar código de nuevo. Confirmá con `curl` que
`GET /ecommerce/configuracion-tienda` devuelve solo esos 4 campos con la key correcta y 401 sin ella.
Actualizá el CLAUDE.md: los 4 campos nuevos en `configuracion`, el endpoint nuevo, y que los placeholders
de WhatsApp/redes que quedaron pendientes de la Fase 1 ya no existen como variables de entorno.
