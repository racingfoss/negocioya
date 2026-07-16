# Resumen de la última modificación — Nombre real de la tienda y WhatsApp/redes editables

Implementación de `prompt1.md`: el nombre real de la tienda ("Adorante", no "FashBalance") y el
WhatsApp/redes sociales pasan de variables de entorno fijas a datos editables desde la pantalla
⚙️ Configuración de FashBalance (la que ya existía).

**Backend**
- 4 columnas nuevas en `configuracion`: `nombre_ecommerce`, `whatsapp_numero`, `instagram_url`,
  `facebook_url` (modelo + `ALTER TABLE` ya aplicado a la DB corriendo, sin `down -v`).
- Se agregaron a `ConfiguracionBase`/`ConfiguracionUpdate` (mismo `GET`/`PUT /configuracion` que usa el
  panel admin, sin cambiar su patrón).
- Endpoint nuevo `GET /ecommerce/configuracion-tienda` con `X-API-Key` y schema dedicado
  `ConfiguracionTiendaOut` (solo esos 4 campos, nunca se cuela nada más).
- Nueva sección "Tienda Online" en `Configuracion.jsx` (inputs de texto, mismo botón de guardar).

**Storefront**
- Sacadas `WHATSAPP_NUMERO`/`INSTAGRAM_URL`/`FACEBOOK_URL` de `docker-compose.yml` y `.env`.
- `layout.tsx` (Server Component) hace el único fetch a `getConfiguracionTienda()` y pasa los datos como
  props a `Header`, `Footer`, `SocialLinks`, `WhatsAppButton` — ninguno lee env vars ni hace fetch
  propio.
- `productos/[id]/page.tsx` hace su propio fetch (ya era Server Component) para el botón de WhatsApp con
  el nombre del producto.
- Reemplazado "FashBalance" por el nombre dinámico en logo, copyright y `<title>`.
- Tuve que agregar `export const dynamic = "force-dynamic"` en `layout.tsx`: al ser ahora async con
  fetch, `next build` intentaba pre-renderizar `/_not-found` en build time y fallaba (no hay backend ni
  env vars ahí todavía). Con eso el build pasó.

**Verificado con curl**: 401 sin API key, 200 con key devolviendo solo los 4 campos; un cambio hecho vía
`PUT /configuracion` se reflejó en el storefront después de rebuildear y, luego, un segundo cambio se
reflejó solo (sin tocar código) tras esperar el `revalidate: 60`. Dejé la config de vuelta en sus valores
por defecto (`Adorante`, resto en null).

CLAUDE.md actualizado con la sección nueva en "Configuración del negocio" y el bullet de placeholders
reemplazado.
