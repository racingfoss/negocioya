# Resumen de la última modificación — Fase 0 e-commerce

Implementación de `prompt1.md`: dejar FashBalance listo para que un futuro servicio de e-commerce
(todavía no existe) consuma el catálogo y registre órdenes. Ronda 100% dentro del repo actual, sin
infraestructura nueva.

## Backend

- `models.py`: `visible_ecommerce` / `descripcion_ecommerce` en `Producto`, y tablas nuevas
  `ProductoFoto`, `OrdenEcommerce`, `OrdenEcommerceItem`.
- `calculations.py`: `validar_movimiento()` + `registrar_venta()` extraídas como único camino de alta
  de una Venta (única función del módulo que lanza `HTTPException`, deliberado).
- `movimientos.py` refactorizado para delegar en esas funciones — verificado con curl que POST/PUT
  siguen funcionando idéntico a antes.
- `productos.py`: endpoints de fotos (`POST/DELETE/PUT /productos/{id}/fotos...`) + helper
  `_formatear_variantes` extraído de `listar_variantes` y reusado por el catálogo público.
- `auth.py` (nuevo): dependency de `X-API-Key` contra la env var `ECOMMERCE_API_KEY`.
- `routers/ecommerce.py` (nuevo): `GET /ecommerce/catalogo`, `POST /ecommerce/ordenes` (ambos con
  API key), `GET /ecommerce/ordenes` (admin, sin key).
- `main.py`: mount de `StaticFiles` en `/fotos`.
- `docker-compose.yml`: volumen `fashbalance_fotos_data` + env var `ECOMMERCE_API_KEY`.
- Migración manual: `ALTER TABLE productos ADD COLUMN visible_ecommerce ...` /
  `descripcion_ecommerce` corrida contra la base de dev (las 3 tablas nuevas las creó solas
  `create_all()`).

## Frontend

- `Productos.jsx`: checkbox "Visible en e-commerce", textarea de descripción, sección de fotos.
- `components/FotosProducto.jsx` (nuevo): subir/borrar/reordenar fotos con botones.
- `pages/OrdenesEcommerce.jsx` (nuevo) + nav link nuevo en `App.jsx`.

## Terminología clave respetada

Una venta por e-commerce crea un `Movimiento` tipo `"Venta"` (mismo mecanismo que Caja) — **nunca**
una `Compra`.

## Verificado contra la API real

- Producto marcado visible + foto subida/servida/reordenada/borrada.
- `GET /ecommerce/catalogo`: 401 sin `X-API-Key`, 200 con la key correcta, sin exponer
  `costo`/`mix_pct`/`lead_time_dias`.
- Orden completa creada (con y sin variantes) → genera `Movimiento` tipo Venta, stock baja
  correctamente en `stock_por_producto`.
- Orden con cantidad mayor al stock disponible: rechazada con 400, sin crear nada (ni orden, ni
  movimiento, ni tocar stock).
- `PUT /movimientos` (edición) sigue funcionando igual tras el refactor.

`CLAUDE.md` actualizado con la sección "E-commerce" documentando todas estas decisiones.

## Pendiente de tu parte

- Probar a mano en el navegador: checkbox/textarea/fotos en Productos, y que las órdenes de prueba
  (creadas por curl) aparezcan bien en la pantalla "🛒 Órdenes E-commerce".
- Se generó una `ECOMMERCE_API_KEY` en tu `.env` local (gitignoreado) para poder probar — rotala si
  querés generar la tuya propia más adelante.
