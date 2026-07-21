# FashBalance — Contexto del proyecto

Software de gestión para un negocio unipersonal de venta de indumentaria femenina. Combina punto de
equilibrio ponderado, gestión de stock por compras (no manual), Matriz BCG + contribución de margen,
alertas de reposición de stock, y carga masiva por Excel. Incluye además un storefront público de
e-commerce (solo lectura + carrito/checkout) y facturación electrónica real contra ARCA.

**Quién lo usa:** una sola persona, dueña del negocio (Florencia), sin conocimientos técnicos. Todo el
texto de la UI del panel interno está en español rioplatense (voseo). El código (variables, tablas,
endpoints) también está en español a propósito, para que el negocio y el modelo de datos hablen el mismo
idioma.

## Cómo está organizada esta documentación

Este archivo (`CLAUDE.md`, en la raíz) se carga siempre, en cualquier sesión, sin importar en qué parte
del proyecto se trabaje — tiene solo lo transversal a todo el proyecto. El detalle de reglas de negocio,
modelo de datos y comportamiento de cada pantalla vive en 3 archivos `CLAUDE.md` anidados, uno por
carpeta, que Claude Code carga **automáticamente** en cuanto se lee/edita un archivo de esa carpeta (no
hace falta pedirlo a mano):

- **`backend/CLAUDE.md`** — FastAPI + SQLAlchemy + `calculations.py`: modelo de datos completo, todas
  las decisiones de negocio (punto de equilibrio, PPP, BCG, etc.), variantes de producto, importación de
  Excel, ARCA/facturación, pedidos, reservas de stock, devoluciones/Nota de Crédito.
- **`frontend/CLAUDE.md`** — panel interno (React + Vite, sin TypeScript): convenciones de pantallas,
  Caja/Movimientos, Pedidos, Configuración, y el lado UI de todo lo de arriba.
- **`ecommerce/CLAUDE.md`** — storefront público (Next.js + TypeScript): catálogo, carrito, checkout,
  ARCA no lo toca esta carpeta.

Donde un mismo tema necesita entenderse desde los dos lados (ej. Variantes de producto, Reserva de
stock), cada archivo tiene su parte completa **más** el contrato mínimo del otro lado ya reescrito ahí —
duplicación deliberada para que cada archivo se sostenga solo sin tener que abrir el otro.

## Stack

- **PostgreSQL 16** — base relacional.
- **Backend**: FastAPI + SQLAlchemy (Python). Hace todos los cálculos de negocio en `backend/app/calculations.py`.
- **Frontend** (panel interno): React 18 + Vite + Tailwind + Recharts. Tema oscuro, sin librerías de
  componentes (todo hecho a mano con clases Tailwind, estilo consistente: `bg-[#0b0f19]` fondo general,
  `bg-[#151b2b]` cards).
- **Ecommerce** (storefront público): Next.js (App Router, TypeScript), proyecto aislado, build de
  producción propia.
- **Docker Compose** con 4 servicios: `db`, `backend`, `frontend`, `ecommerce`. Backend y frontend montan
  el código como volumen para hot-reload (no hace falta rebuild en cada cambio de código, solo si cambian
  dependencias); `ecommerce` es build de producción, sí hay que rebuildear su imagen ante cada cambio.

## Cómo correr en dev

```bash
docker compose up --build
```
Frontend (panel): `:5173` · Ecommerce (storefront): `:3000` · API + Swagger docs: `:8000/docs` ·
Postgres: `:5432` (user/pass/db: `fashbalance`).

**Importante sobre el esquema de la base**: el backend usa `Base.metadata.create_all()`, que solo crea
tablas nuevas — **no migra** tablas existentes (no agrega columnas, no las borra). Cada vez que se agrega
un campo a un modelo existente, hay que o bien `docker compose down -v` (si los datos son de prueba) o
correr un `ALTER TABLE` manual antes de levantar. No hay Alembic ni migraciones automáticas — es una
decisión consciente por el tamaño del proyecto, pero hay que tenerlo presente en cada cambio de modelo.

**Red LAN / VM**: `docker-compose.yml` usa `VITE_API_URL: ${VITE_API_URL:-http://localhost:8000}` y el
storefront usa `FASHBALANCE_API_URL`/`FASHBALANCE_PUBLIC_URL` (ver `ecommerce/CLAUDE.md`) — si Docker
corre en un server distinto de donde se abre el navegador (caso real: VM Alpine sobre Hyper-V), hay que
setear estas variables a la IP/dominio real del server en un `.env` en la raíz del repo, si no el
frontend/storefront intentan pegarle a `localhost` del lado del navegador y fallan en silencio.

## Modelo de datos (resumen — detalle completo en `backend/CLAUDE.md`)

Tablas principales: `categorias` (con `parent_id`, jerárquica), `productos` (ficha maestra, costo
calculado), `compras` (reposición de stock, de acá se derivan stock y costo promedio), `movimientos`
(caja: Venta/Ingreso/Egreso/Devolucion), `costos_fijos`, `atributos`/`valores_atributo`/
`producto_atributos`/`variantes`/`variante_valores` (talle/color definidos por la usuaria),
`configuracion` (singleton, ver tabla abajo), `mix_snapshots` (histórico del mix% real), `producto_fotos`,
`pedidos`/`pedido_items` (unifica venta e-commerce + local), `reservas_stock` (pedido en armado en Caja),
`facturas` (CAE de ARCA), `devoluciones`/`devolucion_items`.

## Configuración del negocio (`configuracion`, singleton)

Los "números mágicos" de `calculations.py` viven en una fila única de la tabla `configuracion` (id fijo
= 1), editable desde la pantalla ⚙️ Configuración sin reiniciar nada. `calculations.get_configuracion(db)`
devuelve esa fila, creándola con los defaults de abajo la primera vez que se necesita.

| Campo | Default | Qué controla |
|---|---|---|
| `demanda_ventana_dias` | 90 | Ventana (días) para calcular demanda media diaria (Days-of-Cover), en `stock_por_producto`/`stock_por_variante`. |
| `lead_time_default_dias` | 7 | Plazo de reposición asumido cuando el producto no tiene `lead_time_dias` propio cargado. |
| `safety_days` | 3 | Colchón fijo sumado al lead time antes de marcar `necesita_reponer`. |
| `stock_dias_verde` | 30 | Por encima de estos días de cobertura, estado "OK" (verde) en `_estado_stock`. |
| `stock_dias_rojo` | 7 | Por debajo de estos días de cobertura, estado "Crítico" (rojo) en `_estado_stock`. |
| `rotacion_alerta_dias` | 90 | A partir de cuántos días sin venderse se marca una prenda como estancada (alerta FIFO en `stock_por_producto`). |
| `umbral_cambio_costo_pct` | 2.0 | % de cambio de costo (vs. última compra) que dispara el aviso de "¿actualizamos precio de venta?" en `simular_compra` y en la Importación de Excel. |
| `renegociacion_margen_umbral_pct` | 15.0 | Margen% por debajo del cual un producto es candidato a "renegociación" en `analisis_combinado`. |
| `renegociacion_percentil_volumen` | 0.7 | Percentil de volumen (0 a 1) que además tiene que cumplir ese producto para contar como candidato. |
| `motor_decoracion_pareto_pct` | 80.0 | % de Pareto usado como fallback de "Motor vs Decoración" en `analisis_combinado` cuando no hay costos fijos cargados. |
| `mix_real_ventana_dias_default` | 30 | Solo afecta al frontend: con cuántos días viene tildado por defecto el selector de ventana al abrir el Punto de Equilibrio. |
| `snapshot_periodo_dias` | 30 | Cada cuántos días corresponde tomar un snapshot del mix real. |
| `reserva_stock_minutos` | 20 | Minutos de vida de una reserva de stock para un pedido en armado en Caja. |
| `arca_cuit` | `null` | CUIT que se usa para pedir el CAE a ARCA (WSFEv1). |
| `arca_punto_venta_defecto` | 1 | Punto de venta habilitado en ARCA usado para `FECompUltimoAutorizado`/`FECAESolicitar`. |
| `arca_razon_social` | `null` | Nombre completo para el comprobante. Usado por el PDF imprimible (`GET /pedidos/{id}/facturas/{id}/pdf`, Fase E) — obligatorio, sin él el endpoint rechaza con 400. |
| `arca_domicilio_fiscal` | `null` | Domicilio para el comprobante. Mismo uso/obligatoriedad que `arca_razon_social` (Fase E). |
| `arca_condicion_iva` | `"RESPONSABLE MONOTRIBUTO"` | Condición frente al IVA mostrada en el bloque emisor del PDF imprimible (Fase E). |
| `arca_inicio_actividades` | `null` | Fecha de inicio de actividades mostrada en el bloque emisor del PDF imprimible (Fase E); opcional, si no está cargada esa línea se omite sin romper el PDF. |
| `nombre_ecommerce` | `"Adorante"` | Nombre real de la tienda pública (`FashBalance` es el nombre de este software de gestión, no se muestra al público). |
| `whatsapp_numero` | — | Número de WhatsApp mostrado en el storefront. |
| `instagram_url` / `facebook_url` | `null` | Redes sociales del storefront (nullable). |
| `email_contacto` | `null` | Destino del `mailto:` del formulario de Contacto del storefront. |

`GET /configuracion` devuelve la fila (la crea si no existe); `PUT /configuracion` actualiza los campos
que se manden (`exclude_unset`). El storefront **no** lee `GET /configuracion` directo (expondría
umbrales de negocio internos) — usa `GET /ecommerce/configuracion-tienda`, ver `backend/CLAUDE.md` y
`ecommerce/CLAUDE.md`.

## Testing

No intentes verificación visual con navegador (chromium-cli, Playwright, Claude in Chrome, ni instalar
chromium/chromium-browser vía apk u otro gestor) bajo ninguna circunstancia. Este proyecto corre en una
VM Alpine headless sin entorno gráfico — no hay forma de que un navegador real ande ahí, y el intento
de instalarlo/usarlo solo quema tiempo y tokens sin resultado útil.

Para verificar cambios de backend: probá contra la API real con curl o scripts Python (como ya se viene
haciendo en todo este proyecto) — levantá el stack con docker compose, pegale a los endpoints, confirmá
las respuestas.

Para verificar cambios de frontend o ecommerce: no se puede confirmar visualmente en esta sesión. Asumí
que el build sin errores (`docker compose exec frontend ...`, o `docker compose build ecommerce` para el
storefront) es suficiente para dar el cambio por terminado, y avisale explícitamente a Javier/Florencia
qué pantalla y qué flujo hay que probar a mano en el navegador antes de dar el cambio por bueno.

## Ideas mencionadas pero no implementadas (posibles próximos pasos)

- Sugerencias de compra automáticas ("a este ritmo te quedás sin stock de Remeras en 15 días") — ya
  existe la base (`dias_cobertura`), falta un módulo de proyección de compra por categoría.
- Reportes Best/Worst Sellers semanales.
- Proyección de flujo de caja estacional (compra de invierno se financia con venta de verano, etc).
- Normalización de tildes en el matching de importación de Excel (ver "gap conocido" en `backend/CLAUDE.md`).
- Columna `CodigoProducto` opcional en la planilla de importación, como fallback de búsqueda si el
  matching por nombre empieza a dar falsos duplicados.
- Opción de facturar con los datos reales del comprador (DNI/CUIT) en vez de Consumidor Final
  fijo — la Fase C siempre factura como Consumidor Final, sin pedirle datos a nadie.
- Envío del PDF de Factura/Nota de Crédito por email/WhatsApp (Fase E solo genera el PDF al vuelo
  para descarga manual desde `Pedidos.jsx`, explícitamente fuera de alcance).
