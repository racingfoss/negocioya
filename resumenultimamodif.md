# Resumen de la última modificación — Fase 1 e-commerce: storefront Next.js

Implementación de `prompt1.md`: storefront público de solo lectura (Next.js, App Router, TypeScript)
que consume la Storefront API de FashBalance ya construida en la Fase 0. Arquitectura Headless
Commerce — FashBalance es el Commerce Core, el storefront es un BFF nuevo. Sin carrito, checkout,
pagos ni nginx en esta ronda.

## Backend (cambio puntual)

- `backend/app/routers/ecommerce.py`: extraído el helper `_producto_a_catalogo_dict` del cuerpo de
  `catalogo()` (reusado por ambos endpoints, no se duplicó el armado del dict) y agregado
  `GET /ecommerce/catalogo/{producto_id}` — mismo `X-API-Key`, mismo schema `ProductoCatalogoOut`,
  404 si no existe / no está `activo` / no está `visible_ecommerce` (sin distinguir el motivo).
  Reusa `_formatear_variantes` igual que el listado. No se tocó nada más del backend.

## Storefront nuevo — `ecommerce/`

Carpeta hermana de `backend/`/`frontend/`, mismo repo, Next.js 14 + TypeScript + Tailwind.

- `src/lib/api.ts`: fetch server-side con header `X-API-Key`, base `FASHBALANCE_API_URL` (interna de
  Docker, nunca llega al navegador).
- `src/lib/attributes.ts`: `derivarAtributosProducto()` (deriva el orden de los selectores por
  primera aparición, ya que no hay endpoint público con el orden real de `ProductoAtributo`),
  `opcionesParaAtributo()` y `elegirValorAtributo()` — port directo (mismo comportamiento, con tipos)
  de las funciones homónimas de `frontend/src/pages/Movimientos.jsx`.
- `src/lib/urls.ts`: arma URLs de fotos con `FASHBALANCE_PUBLIC_URL` (la IP/puerto que sí resuelve el
  navegador del cliente, distinta de la URL interna de Docker).
- `/` (`app/page.tsx`): grilla server-side de productos publicados.
- `/productos/[id]`: galería de fotos, descripción, precio, selector de atributos en cascada
  (`VariantSelector.tsx`, client component) con el mismo criterio que Movimientos.jsx — opciones sin
  stock deshabilitadas con " (sin stock)" (nunca ocultas), mensaje único si no hay stock en ninguna
  variante, aviso si el producto tiene variantes activadas pero ninguna cargada. `generateMetadata`
  con Open Graph (`og:title`, `og:description`, `og:image` absoluta) para preview en WhatsApp/redes.
  404 nativo de Next.js si el producto no existe o no está publicado.
- Botón de WhatsApp flotante (mensaje genérico en home, con nombre de producto en el detalle) y links
  de Instagram/Facebook en header/footer — todos con placeholders desde variables de entorno.
- `Dockerfile` multi-stage de **producción** (`next build` con `output: standalone` + `node server.js`),
  a diferencia del `frontend/Dockerfile` (dev puro con hot-reload) — hay que rebuildear la imagen ante
  cada cambio de código acá.

## Variables de entorno nuevas (en `.env` de la raíz)

- `FASHBALANCE_PUBLIC_URL`: URL/IP real accesible desde el navegador (mismo criterio que ya usa
  `VITE_API_URL`), para fotos y `og:image` absoluta.
- `WHATSAPP_NUMERO`, `INSTAGRAM_URL`, `FACEBOOK_URL`: placeholders obvios, a completar por vos.
- `ECOMMERCE_API_KEY` (ya existía de la Fase 0): se reusa, ahora también pasada al servicio
  `ecommerce`.

`docker-compose.yml`: servicio nuevo `ecommerce`, puerto `3000`, `depends_on: backend`.

`CLAUDE.md` actualizado con la sección "Storefront público (Fase 1 — Next.js, solo lectura)".

## Verificado contra la API real y con curl (sin browser, según las reglas del proyecto)

- `GET /ecommerce/catalogo/{id}`: 200 con datos completos, 404 para inexistente y para un producto
  activo pero no publicado (`visible_ecommerce=false`), 401 sin `X-API-Key`.
- Storefront `/`: HTML servido con nombres, precios y URLs de fotos ya embebidos (confirma SSR).
- Storefront `/productos/{id}`: cascada de atributos verificada con datos reales — opciones con stock
  habilitadas, sin stock deshabilitadas ("XL (sin stock)"), y el mensaje "no tiene stock disponible en
  ninguna variante" apareciendo correctamente cuando las 12 variantes de un producto dan stock 0.
- 404 del storefront confirmado tanto para id inexistente como para producto no publicado.
- Meta tags Open Graph (`og:title`, `og:description`, `og:image`) presentes con URL absoluta.
- Build de producción (`docker compose build ecommerce`) sin errores de TypeScript ni lint.
- Sin errores en los logs del contenedor tras levantarlo.

## Pendiente de tu parte

- Revisar a mano en el navegador (`http://<ip-vm>:3000`): layout y paleta clara (no debe heredar el
  tema oscuro del panel), que las fotos carguen bien, que el botón de WhatsApp abra `wa.me`
  correctamente.
- Reemplazar los placeholders reales en `.env`: `WHATSAPP_NUMERO`, `INSTAGRAM_URL`, `FACEBOOK_URL`.
- Probar el preview del link compartido en WhatsApp/Facebook para confirmar el `og:image` en la
  práctica (curl no puede validar eso del todo, esas plataformas cachean el scrape).
- Los cambios no se commitearon — quedan en el working tree para que los revises antes.
