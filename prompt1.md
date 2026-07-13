Fase 0 del sub-proyecto de e-commerce: dejar FashBalance listo para que un servicio de e-commerce
separado (que se construye en fases posteriores, todavía no) lo consuma. Esta ronda es 100% dentro de
FashBalance — no se toca infraestructura nueva, no hay servicio de e-commerce todavía.

## Corrección de terminología importante, para que no se cuele un error

Cuando se vende algo por el e-commerce, hay que crear un `Movimiento` tipo `"Venta"` — el mismo mecanismo
que ya existe para cargar una venta a mano en Caja. **NO es una `Compra`** (`Compra` es reposición de
stock, suma unidades — es lo opuesto de lo que necesitamos acá). Prestale atención especial a esto en
todo el código de esta ronda.

## 1. Catálogo: qué se publica y con qué contenido

- `productos`: agregar `visible_ecommerce` (bool, default `False` — opt-in explícito, nada se publica
  solo) y `descripcion_ecommerce` (texto largo, nullable — descripción para el público, distinta de
  cualquier dato interno).
- Tabla nueva `producto_fotos`: `id`, `producto_id` (FK), `ruta_archivo`, `orden` (entero, define cuál es
  la foto de portada — la de `orden=1`), `created_at`.
- Backend: endpoint para subir fotos de un producto (`POST /productos/{id}/fotos`, multipart), que
  guarde el archivo en un volumen nuevo (agregalo al `docker-compose.yml`, montado en el backend, algo
  como `fashbalance_fotos_data:/app/fotos_productos`) y sirva esos archivos vía un mount de
  `StaticFiles` de FastAPI en `/fotos/...`. Validá tipo de archivo (jpg/png/webp) y un tamaño máximo
  razonable (5MB) antes de guardar. Endpoint para borrar una foto y para reordenarlas
  (`PUT /productos/{id}/fotos/orden`, recibe el nuevo orden de IDs).
- Frontend (`Productos.jsx`): checkbox "Visible en e-commerce", textarea "Descripción para e-commerce", y
  una sección de fotos (subir, ver miniaturas, borrar, subir/bajar orden — no hace falta drag and drop,
  con botones alcanza).

## 2. Autenticación entre servicios

Los dos endpoints públicos de la sección 3 (no el resto del backend, que sigue sin autenticación como
hoy) tienen que validar un header `X-API-Key` contra un valor guardado en una variable de entorno nueva
(`ECOMMERCE_API_KEY` en `docker-compose.yml`/`.env`, NO en la base de datos — es un secreto de
infraestructura). Si no viene o no matchea, `401`. Armá un dependency de FastAPI reusable para esto, no
lo repitas a mano en cada endpoint.

## 3. Endpoints públicos para el e-commerce (`routers/ecommerce.py`, nuevo)

### `GET /ecommerce/catalogo`

Devuelve solo productos `activo=True` y `visible_ecommerce=True`, con: nombre, `descripcion_ecommerce`,
`precio_venta`, nombre de categoría, fotos (ordenadas), y:
- Si el producto NO tiene variantes: `stock_actual` (reusá `stock_por_producto`, no la reescribas).
- Si tiene variantes: la lista de variantes con sus valores de atributo y `stock_actual` cada una —
  mismo dato que ya devuelve `GET /productos/{id}/variantes` (`listar_variantes` en
  `routers/productos.py`, que ya usa `calculations.stock_por_variante()` para esto desde la ronda de
  Ventas). Reusá esa misma función/lógica, no la reescribas. Mismo criterio que ya se aplicó en Ventas:
  la variante se informa igual aunque tenga stock 0 (para que el frontend del e-commerce pueda decidir
  mostrarla como "sin stock" en vez de ocultarla), no la filtres acá — dejale esa decisión a quien
  consuma el endpoint.
- **NO exponer** `costo`, `mix_pct`, `lead_time_dias`, ni ningún otro dato interno de negocio — es un
  endpoint público, cualquiera puede ver la respuesta JSON en el navegador.

### `POST /ecommerce/ordenes`

Recibe: datos de contacto del cliente (nombre, email opcional, teléfono opcional), forma de entrega
("Retiro en persona" o "Envío", si es Envío requiere dirección), notas opcionales, y una lista de líneas
(producto_id, variante_id si corresponde, cantidad).

Antes de escribir nada en la base, validar CADA línea:
- El producto existe, está `activo=True` y `visible_ecommerce=True`.
- Si tiene variantes, viene `variante_id` y pertenece a ese producto.
- Stock suficiente: usá `calculations.stock_disponible(db, producto_id, variante_id)` (ya existe, de la
  ronda de Ventas — mismo cálculo `total_comprado - total_vendido` acotado a un solo id, no lo
  reimplementes) y compará contra la `cantidad` pedida.

Si CUALQUIER línea falla, rechazar la orden completa con `400` y el detalle de qué línea falló — no crear
nada parcial (mismo criterio atómico que ya se usa en Importación y en el alta de producto con
variantes). Con todo válido, en una única transacción:
1. Crear `OrdenEcommerce` (tabla nueva: `id`, `fecha`, `estado` — usá `"Confirmada"` acá, no hace falta
   más estados por ahora —, `cliente_nombre`, `cliente_email`, `cliente_telefono`, `forma_entrega`,
   `direccion_envio`, `notas`, `total`).
2. Por cada línea, crear un `OrdenEcommerceItem` (`orden_id`, `producto_id`, `variante_id`, `cantidad`,
   `precio_unitario` — el `precio_venta` del producto en ESE momento, guardado como valor propio, no
   como referencia — mismo criterio de denormalización que ya se usa en `mix_snapshots` para que el
   histórico no dependa de que el precio no haya cambiado después).
3. Por cada línea, crear el `Movimiento` tipo `"Venta"` correspondiente (ver punto siguiente sobre
   reusar el mecanismo existente), y guardar su `id` en `OrdenEcommerceItem.movimiento_id` para
   trazabilidad.

**Sobre reusar la creación de la Venta**: `backend/app/routers/movimientos.py` ya tiene una función
`_validar()` que hace exactamente la validación de arriba (incluido `stock_disponible()`) para
`POST /movimientos` y su `PUT`. NO reimplementes esa validación en `routers/ecommerce.py`. Si `_validar()`
hoy vive como función privada del router (no en `calculations.py`), movela ahí (o extraé su lógica a una
función pública, ej. `calculations.validar_venta(...)`) junto con la creación real del `Movimiento`, en
una función tipo `calculations.registrar_venta(db, producto_id, variante_id, cantidad, monto, ...)` que
tanto `POST /movimientos` como este endpoint nuevo llamen — un solo camino de validación y creación de
Venta, no dos que puedan desincronizarse con el tiempo. Fijate también el detalle de `_validar()` sobre
sumar de vuelta la cantidad original al editar (`PUT`) — no aplica acá (las órdenes de e-commerce solo se
crean, no se editan en esta fase), pero no rompas ese camino al refactorizar.

## 4. Pantalla de administración: Órdenes E-commerce

Página nueva en el frontend, `OrdenesEcommerce.jsx`, que lista lo que devuelve `GET /ecommerce/ordenes`
(este SÍ es un endpoint interno normal, sin `X-API-Key`, como el resto del panel) — fecha, cliente, forma
de entrega, items, total. Sin filtros complejos por ahora, una tabla alcanza. Nav link nuevo.

## Qué NO hacer en esta ronda

No toques nada de infraestructura nueva (nginx, Next.js, un servicio de e-commerce separado) — eso es
Fase 1 en adelante, todavía no existe. No implementes ningún medio de pago ni cálculo de envío real —
`forma_entrega` es solo un texto elegido entre dos opciones fijas, sin lógica detrás.

## Antes de terminar

Probá contra la API real: marcar un producto como visible, subirle una foto, pegarle a
`GET /ecommerce/catalogo` sin `X-API-Key` (debe dar 401) y con la key correcta (debe traer el producto
con su foto y su stock). Crear una orden completa con `POST /ecommerce/ordenes` y confirmar que se creó
el `Movimiento` Venta correspondiente y que el stock bajó en `stock_por_producto`. Probar una orden con
una cantidad mayor al stock disponible y confirmar que se rechaza sin crear nada (ni la orden, ni el
movimiento, ni tocar el stock). Actualizá el CLAUDE.md con una sección nueva "E-commerce" documentando
todo esto — es la base sobre la que van a construirse las fases siguientes.
