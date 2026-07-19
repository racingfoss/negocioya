# FashBalance — Contexto del proyecto

Software de gestión para un negocio unipersonal de venta de indumentaria femenina. Combina punto de
equilibrio ponderado, gestión de stock por compras (no manual), Matriz BCG + contribución de margen,
alertas de reposición de stock, y carga masiva por Excel.

**Quién lo usa:** una sola persona, dueña del negocio, sin conocimientos técnicos. Todo el texto de la UI
está en español rioplatense (voseo). El código (variables, tablas, endpoints) también está en español a
propósito, para que el negocio y el modelo de datos hablen el mismo idioma.

## Stack

- **PostgreSQL 16** — base relacional.
- **Backend**: FastAPI + SQLAlchemy (Python). Hace todos los cálculos de negocio en `backend/app/calculations.py`.
- **Frontend**: React 18 + Vite + Tailwind + Recharts. Tema oscuro, sin librerías de componentes (todo
  hecho a mano con clases Tailwind, estilo consistente: `bg-[#0b0f19]` fondo general, `bg-[#151b2b]` cards).
- **Docker Compose** con 3 servicios: `db`, `backend`, `frontend`. Backend y frontend montan el código como
  volumen para hot-reload (no hace falta rebuild en cada cambio de código, solo si cambian dependencias).

## Cómo correr en dev

```bash
docker compose up --build
```
Frontend: `:5173` · API + Swagger docs: `:8000/docs` · Postgres: `:5432` (user/pass/db: `fashbalance`).

**Importante sobre el esquema de la base**: el backend usa `Base.metadata.create_all()`, que solo crea
tablas nuevas — **no migra** tablas existentes (no agrega columnas, no las borra). Cada vez que se agrega
un campo a un modelo existente, hay que o bien `docker compose down -v` (si los datos son de prueba) o
correr un `ALTER TABLE` manual antes de levantar. No hay Alembic ni migraciones automáticas — es una
decisión consciente por el tamaño del proyecto, pero hay que tenerlo presente en cada cambio de modelo.

## Modelo de datos — por qué está separado así

Tres entidades separadas a propósito, no es sobre-ingeniería:

- **`categorias`**: definidas 100% por la usuaria, nunca hardcodeadas. CRUD simple. Tiene `parent_id`
  (self-referencial, adjacency list) para subcategorías sin límite de profundidad — ver sección
  "Subcategorías" más abajo.
- **`productos`**: ficha maestra de cada prenda, se carga **una sola vez**. Campos: `nombre`, `codigo`
  (SKU opcional, no obligatorio, no se usa para importar), `categoria_id`, `precio_venta`, `costo`
  (**calculado**, no se edita a mano salvo carga inicial en 0), `mix_pct`, `lead_time_dias` (opcional,
  plazo de reposición del proveedor, default 7 si no se carga), `activo`, `tiene_variantes` (bool, default
  False — ver sección "Variantes de producto" más abajo).
- **`compras`**: cada reposición de stock de un producto. `producto_id`, `variante_id` (nullable, solo si
  el producto tiene variantes), `fecha`, `cantidad`, `costo_unitario`, `proveedor` (texto libre). El stock
  y el costo promedio del producto se derivan de acá, nunca se cargan directo.
- **`movimientos`**: caja. `tipo` es `"Venta"` (siempre con `producto_id` y `cantidad`, resta stock, suma
  caja; además `variante_id` si el producto tiene variantes), `"Ingreso"` (otro ingreso sin producto) o
  `"Egreso"` (gasto, puede atarse a un `costo_fijo_id`). `fecha` es editable por la usuaria (default:
  momento actual), `concepto` es opcional.
- **`costos_fijos`**: gastos operativos mensuales (alquiler, servicios, etc), usados en el punto de
  equilibrio.
- **`atributos` / `valores_atributo` / `producto_atributos` / `variantes` / `variante_valores`**: patrón
  Atributo + Valor + Variante (Shopify/VTEX) para talle/color/etc definidos por la usuaria. Ver sección
  "Variantes de producto" más abajo.
- **`configuracion`**: fila única (singleton) con los "números mágicos" de `calculations.py`, editable
  desde la pantalla ⚙️ Configuración. Ver sección "Configuración del negocio" más abajo.
- **`mix_snapshots`**: histórico de fotos periódicas del mix% real de facturación, para graficar su
  evolución. Ver sección "Snapshots del mix real" más abajo.

## Decisiones de negocio importantes (no reinventar sin releer esto)

Todas están en `backend/app/calculations.py`, con comentarios explicando el razonamiento. Resumen:

- **Punto de equilibrio ponderado**: `mix_pct` de cada producto es **% de la facturación** (no de
  unidades vendidas). `facturación_mínima = costos_fijos_totales / margen_ponderado`, y las unidades
  requeridas por producto se derivan de ahí, no al revés.
- **Punto de equilibrio ponderado — modo "real" vs "manual" del mix%**: `punto_equilibrio_ponderado(db,
  modo, dias)` soporta dos modos. **"real"** (default): el `mix_pct` de cada producto sale de
  `facturacion_por_producto(db, dias)` (nueva función en `calculations.py`, mismo patrón de query que
  `unidades_vendidas_por_producto` pero sumando `monto` en vez de `cantidad` — función separada a
  propósito, no se tocó `unidades_vendidas_por_producto` porque la usan BCG/Stock/Sell-through) sobre la
  ventana de días elegida (7/30/90, default 30, mismo patrón que `matriz_bcg`). Se cambió el default de
  manual a real porque mantener `mix_pct` actualizado a mano una vez que hay ventas reales es una carga
  que nadie sostiene semana a semana y se desactualiza solo. Un producto sin ventas en la ventana da 0%
  mix (no error — simplemente no pesa). Si la facturación total de la ventana es 0 (nada vendido en esos
  días), devuelve `{"error": ...}` en vez de dividir por cero, con sugerencia de ampliar la ventana o usar
  modo manual. **"manual"**: comportamiento original, usa `producto.mix_pct` cargado a mano — sigue
  existiendo para productos nuevos sin historial de ventas y para simular escenarios. El banner de "el mix
  no suma 100%" solo tiene sentido en modo manual (en modo real siempre da ~100% por construcción), así
  que el frontend (`Dashboard.jsx`) lo oculta en modo real. La respuesta incluye `modo` y `dias` usados
  para que el frontend los muestre en el título de la sección.
- **Costo promedio ponderado (PPP)**: cada vez que se crea/edita/borra una `Compra`, se recalcula
  `producto.costo` como promedio ponderado de TODAS las compras de ese producto
  (`recalcular_costo_promedio`). Se eligió sobre FIFO-de-costo porque es mucho más simple de mantener a
  mano para una sola persona.
- **Antigüedad de stock / rotación (regla de 90 días)**: se calcula con **FIFO** — se asume que se vende
  primero el lote más viejo, y `dias_en_stock` se mide desde la compra más vieja que todavía tiene
  unidades sin vender (`_fifo_dias_en_stock`). Alerta si supera 90 días.
- **Días de cobertura / alerta de quedarse sin stock**: **Days-of-Cover**, no el modelo estadístico con
  desvío estándar (se descartó a propósito: con pocas ventas por SKU el σ da ruido, no señal). Fórmula:
  `demanda_media_diaria = ventas últimos 90 días / 90` · `dias_cobertura = stock_actual / demanda_media_diaria`.
  Colores: verde >30 días, ámbar 7–30, rojo <7. Además, `necesita_reponer` se activa si
  `dias_cobertura <= lead_time_dias (o 7 default) + 3 días de colchón fijo` — esto es más preciso que el
  color genérico porque usa el lead time real de cada producto.
- **Matriz BCG**: cuadrantes por **mediana** de margen% y de volumen vendido (no percentiles fijos).
- **Motor vs Decoración (por categoría)**: se ordenan las categorías por margen generado (desc) y se
  acumula; son "Motor" las que, en ese orden, todavía no cubrieron el total de `costos_fijos_totales` del
  negocio. Si no hay costos fijos cargados, cae a Pareto 80/20 como fallback. Esto está en
  `analisis_combinado()` — es la vista que combina BCG + contribución de margen en una sola pantalla
  (gráfico de burbujas: eje X volumen, eje Y margen%, tamaño de burbuja = margen generado en $).
- **Candidato a renegociación**: margen% < 15 Y volumen >= percentil 70 de todos los productos activos.
  Señala productos "Vaca" que convendría renegociar con el proveedor.
- **Cambio de costo al comprar stock — se dispara contra la ÚLTIMA COMPRA, no contra el promedio**: el
  aviso de "¿actualizamos `precio_venta`?" compara el `costo_unitario` de la Compra nueva contra el de la
  **última Compra registrada** de ese producto (`diferencia_vs_ultima_compra_pct`), no contra el costo
  promedio ponderado. Se cambió de criterio (v1 comparaba contra el promedio) porque con mucho stock
  acumulado a costo viejo, una compra nueva bastante más cara casi no mueve el promedio y el aviso no se
  disparaba aunque el costo de reposición hubiera saltado fuerte (caso real: promedio $12.433, costo
  nuevo +7,7% vs. la última compra, pero el promedio apenas se movía). El promedio ponderado sigue
  existiendo para TODO lo contable (punto de equilibrio, BCG, márgenes — no se toca) y se sigue mostrando
  como dato informativo adicional (`diferencia_vs_promedio_pct`), pero ya no decide el umbral ni el
  precio sugerido. Umbral **±2%** (`UMBRAL_CAMBIO_COSTO_PCT` en `calculations.py`) ahora se evalúa sobre
  `diferencia_vs_ultima_compra_pct`. Si es la primera Compra del producto (no hay última contra qué
  comparar), esta diferencia es `None` y el aviso no se dispara. Mismo criterio replicado en la
  importación de Excel (`routers/importacion.py`, tabla `cambios_costo`). Endpoint `POST /compras/simular`
  calcula esto **sin escribir en la base**. El front sincroniza dos inputs (% y precio) — cambiar uno
  recalcula el otro.
- **Markup editable en Catálogo**: en la tabla de productos se puede click-editar el % de markup sobre
  costo, y al confirmar recalcula `precio_venta = costo * (1 + pct/100)`.

## Subcategorías (jerarquía en `categorias`)

- Adjacency list simple (`parent_id`) + recursión en Python en `calculations.py`. Se descartó a propósito
  materialized path y nested sets: con el volumen de datos de un negocio unipersonal, la complejidad extra
  no se justifica.
- `validar_no_ciclo()` camina la cadena de ancestros antes de aceptar un cambio de `parent_id` y rechaza si
  la categoría terminaría siendo ancestro de sí misma. Se llama desde `PUT /categorias/{id}` (no hace
  falta en `POST` porque una categoría recién creada no puede ser ancestro de nada todavía).
  `GET /categorias/arbol` devuelve la estructura anidada para la vista de árbol del frontend.
- Los productos se siguen asociando a UNA categoría (la hoja), sin cambios en `productos.categoria_id`.
- **Rollup hacia arriba**: `stock_por_categoria`, `contribucion_por_categoria` y `analisis_combinado`
  (la parte de categorías) aceptan un parámetro `rollup: bool = False`. Internamente se agrupa por
  `categoria_id` (antes se agrupaba por nombre) y, en modo rollup, cada categoría acumula también lo de
  **todos sus descendientes** (se sube la cadena de ancestros por cada producto y se suma a cada nivel).
  Sin el flag, el comportamiento es idéntico al de antes de esta ronda (nivel hoja exacto). Los endpoints
  correspondientes exponen `?rollup=true`.

## Variantes de producto (talle, color, u otros atributos definidos por la usuaria)

Patrón Atributo + Valor + Variante (igual que Shopify/VTEX), para no hardcodear "talle"/"color" como
columnas fijas.

- `atributos` (ej. "Talle") y `valores_atributo` (ej. "S"/"M"/"L") se definen una vez y se reutilizan entre
  productos, con CRUD propio en `routers/atributos.py`.
- `producto_atributos` (producto_id, atributo_id, `orden`) define qué atributos aplican a un producto
  puntual y en qué orden. El `orden` no es cosmético: el atributo con `orden=1` agrupa el stock en
  subtotales (ver árbol de stock más abajo).
- `variantes` (producto_id, activo) es la unidad real con stock. **No tiene columna de costo propia**:
  la primera versión de esta feature calculaba un costo promedio ponderado por variante (con el
  argumento de que un talle XL podría consumir más tela), pero se descartó apenas se probó en el
  catálogo real — el costo de "Calza Dua" no varía entre M/Verde y L/Verde, y mostrar costos distintos
  por variante fue confuso en la práctica. El costo se trackea **solo a nivel producto**
  (`productos.costo`), compartido por todas sus variantes, igual que un producto sin variantes.
- `variante_valores` es la tabla puente que permite combinar N atributos por variante (no limitado a 2).
- `productos.tiene_variantes` (bool) separa los dos caminos por completo:
  - `False`: comportamiento idéntico a como era antes de esta ronda — Compras y Movimientos van directo a
    `producto_id`, sin variante.
  - `True`: `POST /compras` y `POST /movimientos` (tipo Venta) **rechazan** con 400 si no viene
    `variante_id`, y validan que la variante pertenezca al producto indicado. El `variante_id` solo se usa
    para trackear stock (qué combinación se compró/vendió), no para el costo.
- **Costo único por producto** (`recalcular_costo_promedio` en `calculations.py`): sin importar si el
  producto tiene variantes, `producto.costo` se recalcula siempre como el promedio ponderado de TODAS
  las compras del producto (sin filtrar por `variante_id`) — mismo camino para productos con y sin
  variantes. El flujo de aviso de cambio de costo (`/compras/simular`, `UMBRAL_CAMBIO_COSTO_PCT`) también
  se evalúa 100% a nivel producto, sin ninguna distinción por variante.
- **`stock_por_producto` y `stock_por_categoria` NO se tocaron**: agregan por `producto_id`, que siempre
  está poblado (con o sin variante), así que ya daban el total correcto sin reescribirles una línea —
  verificado con pruebas por API antes de dar el punto por cerrado.
- **`stock_por_variante()`** (nueva) es el mismo cálculo que `stock_por_producto` pero agrupado por
  `variante_id`.
- **`stock_por_producto_arbol()`** (nueva, expuesta en `GET /stock/productos/arbol`) arma el árbol de 3
  niveles para el frontend: Producto (total) → valor del atributo `orden=1` (subtotal) → variante
  individual (detalle, con el resto de sus atributos). Si el producto solo tiene un atributo configurado,
  el árbol queda de 2 niveles (no se fuerza un tercer nivel vacío). Productos sin variantes devuelven la
  misma fila de siempre.
- **BCG/Contribución de margen NO bajan a nivel variante** (aclaración explícita del pedido, no
  improvisar): `analisis_combinado` sigue 100% a nivel producto, una sola burbuja por producto con el
  agregado de todas sus variantes.
- La importación por Excel (`routers/importacion.py`) **sí soporta variantes** (columnas de atributo en
  la planilla) — ver sección "Importación de Excel" más abajo para el detalle completo.
- **Compras filtra los combos de atributo por las variantes que YA EXISTEN del producto elegido**
  (`frontend/src/pages/Compras.jsx`, función `opcionesParaAtributo`): el combo del primer atributo
  (ej. Talle) solo lista los valores que aparecen en alguna `Variante` real de ese producto puntual —
  no todos los `valores_atributo` del sistema. Al elegir un valor ahí, el siguiente combo (ej. Color) se
  filtra además a los valores que, combinados con lo ya elegido, correspondan a una variante real
  (se recorre `variantesProducto`, que ya se traía del backend pero no se usaba para filtrar). Esto es
  deliberado: desde Compras **no se crean variantes nuevas**, solo se registra stock contra una que ya
  existe — si hace falta una combinación realmente nueva, el alta es en Catálogo (ver punto siguiente).
  Si el producto tiene `tiene_variantes=True` pero cero `Variante` cargadas (quedó a medio configurar),
  Compras lo avisa explícitamente ("Este producto no tiene variantes cargadas todavía, configuralas en
  Catálogo antes de registrar stock") en vez de mostrar combos vacíos, tanto al elegir el producto como
  si se intenta guardar la compra igual.
- **Movimientos (Ventas) replica el mismo filtro por existencia que Compras, y encima le suma stock**
  (`frontend/src/pages/Movimientos.jsx`, misma función `opcionesParaAtributo` que en `Compras.jsx`): los
  combos de atributo al cargar una Venta solo listan valores que existen en alguna `Variante` real del
  producto (mismo criterio, misma cascada). La diferencia con Compras (que sigue sin tocarse) es que acá
  cada opción se marca además con `conStock` — `true` si al menos una `Variante` candidata con ese valor
  tiene `stock_actual > 0`. Las opciones sin stock **no se ocultan**, quedan como `<option disabled>` con
  " (sin stock)" en el texto (la vendedora ve que el talle "existe" aunque hoy no haya). Elegir un valor
  en un atributo resetea la selección de los atributos siguientes (mismo `elegirValorAtributo` que
  Compras). Si TODAS las opciones del primer atributo quedan sin stock, se oculta el bloque de combos
  entero y se muestra un mensaje único ("Este producto no tiene stock disponible en ninguna variante") en
  vez de un combo lleno de opciones grises. El aviso de "variantes no cargadas todavía" (mismo texto que
  Compras) también se replicó acá. **Backend**: no hay endpoint paralelo — se extendió
  `GET /productos/{id}/variantes` (`backend/app/routers/productos.py`, `listar_variantes`) para que cada
  variante devuelta incluya `stock_actual`, calculado con `calculations.stock_por_variante()` (la misma
  función que ya usaba la pantalla de Stock). Compras consume el mismo endpoint y sigue ignorando ese
  campo — el criterio de habilitar/deshabilitar por stock queda 100% del lado del frontend de Ventas, no
  del backend. **Tope de cantidad contra stock, en frontend y backend** (agregado en la misma ronda):
  el input de cantidad de `Movimientos.jsx` tiene `max={stockDisponible}` — `stock_actual` de la variante
  elegida si el producto tiene variantes, o `stock_actual` del producto entero (`GET /stock/productos`,
  ya cargado en `cargar()`) si no. `guardar()` valida lo mismo antes de pegarle a la API y muestra un
  aviso si la cantidad cargada supera el disponible. Al **editar** una Venta ya registrada, se le suma de
  vuelta su propia `cantidad` original (`ventaOriginal`, capturado en `editar()`) antes de comparar,
  porque esa cantidad ya está descontada del `stock_actual` actual — si no, no se podría ni re-guardar el
  mismo registro sin tocarlo. Esto es solo cosmético (se puede saltear llamando a la API directo), así
  que la validación real está en el **backend**: `calculations.stock_disponible(db, producto_id,
  variante_id)` (nueva función, mismo cálculo `total_comprado - total_vendido` que `stock_por_producto`/
  `stock_por_variante` pero acotado a un solo id, sin recorrer todo el catálogo) es usada por `_validar()`
  en `backend/app/routers/movimientos.py` para rechazar con 400 cualquier Venta (`POST` o `PUT`) cuya
  `cantidad` supere el stock disponible. En el `PUT` (edición), `_validar` recibe el `Movimiento` original
  (`actual`) y le sobresuma su `cantidad` vieja si el `producto_id`/`variante_id` no cambiaron, mismo
  criterio que el frontend, para no bloquear la edición de una Venta ya existente por su propia cantidad.
- **Alta de producto nuevo con variantes es atómica, en un solo paso** (antes había que guardar el
  producto primero y recién en la edición aparecía el apartado de atributos/variantes — mal UX, dos
  pantallas para una sola operación lógica). En el formulario de ALTA de `frontend/src/pages/Productos.jsx`,
  tildar "¿Tiene variantes?" despliega ahí mismo (sin guardar nada todavía) el mismo bloque de
  atributos/valores que ya existía para edición, más un preview local de la grilla de combinaciones
  (`previewVariantes`, calculado 100% en el cliente, sin pegarle al backend). Al confirmar "+ Añadir
  Prenda" se llama a `POST /productos/con-variantes` (`backend/app/routers/productos.py`), que crea el
  producto, sus `producto_atributos` y sus `Variante` en una única transacción — si algo falla a mitad de
  camino no queda un producto a medio configurar. Ese endpoint reusa la misma lógica de validación que
  los endpoints de dos pasos usados por la edición (`POST /productos/{id}/atributos` y
  `POST /productos/{id}/variantes/generar`), refactorizada a los helpers privados `_set_atributos` y
  `_generar_variantes` (sin commit propio, así el caller controla la transacción). **El camino de edición
  de un producto ya existente no se tocó** — sigue siendo dos pasos (guardar atributos, después generar
  variantes) porque ahí sí tiene sentido: el producto ya existe, y por eso el bug original solo aplicaba al
  alta.
- **Desactivar variantes (`tiene_variantes: true → false`) se bloquea con 400 si el producto ya tiene
  compras o ventas registradas** (`PUT /productos/{id}`): se decidió bloquear directo en vez de permitirlo
  con una confirmación tipo `window.confirm`, para que no se pueda perder la trazabilidad de stock/costo
  por variante con un solo click sin vuelta atrás. Si no tiene compras ni ventas (nunca se llegó a usar en
  serio), el `PUT` sí se aplica y de paso limpia los `producto_atributos`/`Variante` huérfanos que hubiera
  configurados, para no dejar variantes fantasma si más adelante se reactiva. El frontend, si el `PUT`
  falla por este motivo, vuelve a tildar el checkbox "¿Tiene variantes?" (estaba destildado en el intento
  fallido) para reflejar el estado real que quedó en la base.

## Importación de Excel (`backend/app/routers/importacion.py`)

- Matchea productos existentes **por nombre** (case-insensitive, trim). Deliberadamente sin código de
  producto obligatorio — con ~100 SKU y una sola persona armando la planilla, matchear por nombre es más
  práctico. El campo `codigo` existe en el modelo para uso futuro (código de barras, disambiguación) pero
  hoy no se usa en la importación.
- **Gap conocido, no resuelto todavía**: el matching no normaliza tildes/acentos. "Top Basico" vs
  "Top Básico" se tratan como productos distintos y crea un duplicado. Si esto empieza a pasar seguido en
  el uso real, hay que agregarle normalización Unicode (`unicodedata.normalize`) a la función `_norm` /
  la comparación de claves en `productos_cache`.
- Columnas: `Producto` (obligatoria), `Costo` (obligatoria), `Cantidad` (obligatoria), `Categoria` (para
  altas nuevas), `Descuento` (%, opcional, se aplica sobre `Costo`), `FechaCompra` (default: hoy),
  `PrecioVenta` (obligatoria solo para productos nuevos, se ignora si el producto ya existe).
- Si el mismo producto nuevo aparece en más de una fila de la misma planilla, la segunda fila ya lo
  reconoce como existente (se resuelve fila por fila, con un cache local `productos_cache` que se va
  actualizando).
- Reutiliza el mismo umbral de ±2% de `calculations.py` para armar la tabla de `cambios_costo` que se
  aprueba fila por fila (o todas juntas) en el frontend.
- Devuelve siempre 4 secciones: `productos_creados`, `compras_registradas`, `cambios_costo`, `errores`.
- **Soporte de atributos/variantes en la planilla**: cualquier columna del encabezado que no sea una de
  las fijas se interpreta como un atributo (ej. "Talle", "Color"). Solo se reconocen atributos que **ya
  existen** en el sistema (tabla `atributos`) — si hay una columna que no matchea ningún atributo
  existente, **se cancela toda la importación con 400 antes de escribir nada** (error estructural de la
  planilla, no de una fila puntual). El orden de las columnas de atributo en el encabezado define el
  `orden` de `producto_atributos` cuando se configura un producto por primera vez (la primera columna de
  atributo = `orden=1`, agrupa el stock en subtotales).
  - Si una celda de una columna-atributo válida trae un valor que no existe como `valor_atributo` para
    ese atributo (ej. "XXL" sin estar cargado), **solo se saltea esa fila** (a `errores`) — no aborta el
    resto de la planilla, mismo criterio que otros datos inválidos por fila.
  - **Producto nuevo con atributos completos en la fila**: se crea directamente con
    `tiene_variantes=True`, se configuran sus `producto_atributos` a partir de esa fila, se resuelve/crea
    la `Variante` y la compra inicial queda con `variante_id`.
  - **Producto YA existente con `tiene_variantes=False`** que recibe una fila con atributos: se activan
    las variantes **sobre la marcha** (mismo criterio que un producto nuevo — no hace falta pasar antes
    por Catálogo) y se le suma stock a esa variante puntual. **Limitación aceptada**: las compras viejas
    de ese producto (previas a esta activación) quedan sin `variante_id` — no se reasignan
    retroactivamente. El stock total (`stock_por_producto`) sigue sumando bien porque agrega por
    `producto_id`, pero en el árbol de Stock por variante esas unidades viejas aparecen "sueltas", fuera
    de cualquier variante puntual.
  - **Producto YA existente con `tiene_variantes=True`** (configurado por Catálogo o por una fila anterior
    de este mismo import): la fila debe traer un valor para **todos** los atributos ya configurados de ese
    producto (si falta alguno → error de esa fila); columnas de atributo ajenas a su configuración se
    ignoran para ese producto. Con los valores completos, se resuelve o crea la variante puntual
    (`calculations.resolver_o_crear_variante`, la misma función que usa
    `POST /productos/{id}/variantes/generar`) y la compra queda con `variante_id`.
  - Si el mismo producto nuevo aparece en más de una fila con un conjunto de atributos distinto al de su
    primera aparición (ej. la primera trae Talle+Color, la segunda solo Talle), la segunda fila da error
    de fila — no se reconfiguran los atributos de un producto a mitad de la importación.
  - `recalcular_costo_promedio` no se modificó para esto: sigue operando 100% a nivel producto (todas las
    compras, sin filtrar por variante), así que no hizo falta tocarlo.
  - `productos_creados` y `compras_registradas` incluyen `variante_id` y `variante_descripcion` (ej.
    "M / Verde") cuando corresponde.
  - Endpoint hermano `GET /importacion/plantilla` genera un .xlsx de ejemplo **100% dinámico** con
    `openpyxl`: agrega una columna al header por cada `Atributo` que exista en el momento de la descarga,
    y completa 1-2 filas de ejemplo con valores reales ya cargados en `valores_atributo` (no inventados).

## Configuración del negocio (`configuracion`, singleton)

Los "números mágicos" que antes eran constantes de módulo hardcodeadas en `calculations.py`
(`DEMANDA_VENTANA_DIAS`, `LEAD_TIME_DEFAULT_DIAS`, `SAFETY_DAYS`, `UMBRAL_CAMBIO_COSTO_PCT`, y varios
hardcodeados sueltos en Stock/Análisis) ahora viven en una fila única de la tabla `configuracion` (id
fijo = 1), editable desde la pantalla ⚙️ Configuración sin reiniciar nada. `calculations.get_configuracion(db)`
devuelve esa fila, creándola con los defaults de abajo la primera vez que se necesita (bootstrap, no hace
falta migración de datos ni tocar nada al actualizar). Ninguna fórmula de negocio cambió — solo de dónde
sale el número.

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
| `mix_real_ventana_dias_default` | 30 | Solo afecta al frontend: con cuántos días viene tildado por defecto el selector de ventana al abrir el Punto de Equilibrio (el selector 7/30/90 sigue existiendo igual, esto no lo reemplaza). |
| `snapshot_periodo_dias` | 30 | Cada cuántos días corresponde tomar un snapshot del mix real (ver sección siguiente). |
| `reserva_stock_minutos` | 20 | Minutos de vida de una reserva de stock para un pedido en armado en Caja. Ver sección "Reserva de stock" más abajo. |
| `arca_cuit` | `null` | CUIT que se usa para pedir el CAE a ARCA (WSFEv1). Ver sección "Facturación electrónica (Fase A)" más abajo. |
| `arca_punto_venta_defecto` | 1 | Punto de venta habilitado en ARCA usado para `FECompUltimoAutorizado`/`FECAESolicitar`. |
| `arca_razon_social` | `null` | Nombre completo para el comprobante. Todavía sin uso en código (fase pendiente del PDF/impresión). |
| `arca_domicilio_fiscal` | `null` | Domicilio para el comprobante. Todavía sin uso en código (fase pendiente del PDF/impresión). |

`GET /configuracion` devuelve la fila (la crea si no existe); `PUT /configuracion` actualiza los campos
que se manden (`exclude_unset`, así que se puede mandar solo el campo que cambia).

**Identidad de la tienda (nombre, WhatsApp, redes) — vive acá también, no son "números mágicos" de
negocio, pero son el mismo tipo de dato editable sin rebuild**: `nombre_ecommerce` (default `"Adorante"`
— el nombre real de la tienda; "FashBalance" es el nombre de este software de gestión, no se muestran
al público), `whatsapp_numero`, `instagram_url` (nullable), `facebook_url` (nullable). Reemplazan a las
env vars fijas `WHATSAPP_NUMERO`/`INSTAGRAM_URL`/`FACEBOOK_URL` que existían en el `docker-compose.yml`
del servicio `ecommerce` (Fase 1) — esas variables **ya no existen**, ni en `docker-compose.yml` ni en
`.env`. Se editan desde la misma sección "Tienda Online" de la pantalla ⚙️ Configuración, con el mismo
`GET`/`PUT /configuracion` y el mismo botón de guardar que el resto de los campos de esta tabla — por eso
viven en `ConfiguracionBase`/`ConfiguracionUpdate` igual que los demás.
**Pero el storefront (`ecommerce/`) NO los lee de `GET /configuracion`** — ese endpoint es la Admin API
interna, sin autenticación, y devuelve además todos los umbrales de negocio (márgenes, percentiles, etc.)
que no tienen por qué llegar a un servicio de cara al público. Para eso existe
`GET /ecommerce/configuracion-tienda` (`backend/app/routers/ecommerce.py`), con el mismo `X-API-Key` que
los otros 3 endpoints de ese router, y un schema dedicado `schemas.ConfiguracionTiendaOut` (mismo criterio
que `ProductoCatalogoOut`: garantiza por diseño que nunca se cuele otro campo de `configuracion`, sin
armar un `dict` a mano). `ecommerce/src/lib/api.ts` expone `getConfiguracionTienda()` con el mismo
mecanismo de `X-API-Key` y `revalidate: 60` que `getCatalogo()`/`getProducto()`. Se consume una sola vez
en `app/layout.tsx` (Server Component, junto con `generateMetadata` para el `<title>`) y se pasa como
props ya resueltas a `Header`/`Footer`/`SocialLinks`/`WhatsAppButton` — ninguno de esos componentes lee
la env var ni hace fetch propio. `app/productos/[id]/page.tsx` hace su propio fetch (mismo `Promise.all`
que ya usaba para `getProducto`) porque el botón de WhatsApp de esa pantalla necesita el nombre del
producto en el mensaje. **`layout.tsx` tiene `export const dynamic = "force-dynamic"`**: sin eso,
`next build` intenta pre-renderizar estáticamente rutas como `/_not-found` y falla en build time (no hay
backend ni env vars de runtime disponibles todavía en esa etapa).

## Snapshots del mix real (`mix_snapshots`)

Guarda una foto periódica del mix% real de facturación de cada producto activo (misma función
`facturacion_por_producto` que usa el modo "real" del Punto de Equilibrio — no se duplica lógica), para
poder graficar su evolución en el tiempo desde el Dashboard. `producto_id` es nullable y
`producto_nombre`/`categoria_nombre` se guardan como texto plano (no se leen por join) a propósito: el
histórico tiene que seguir siendo legible aunque el producto se borre, se renombre o cambie de categoría
más adelante.

- **Detección "lazy", sin scheduler/cron nuevo**: en vez de agregar infraestructura de tareas en segundo
  plano (Celery, APScheduler, un worker separado — nada de eso existe hoy en el proyecto), cada apertura
  de las pantallas de rutina (`GET /dashboard/resumen` y `GET /dashboard/punto-equilibrio`) dispara
  `calculations.verificar_y_tomar_snapshot_si_corresponde(db)` como
  [BackgroundTask](https://fastapi.tiangolo.com/tutorial/background-tasks/) de FastAPI (no bloquea la
  respuesta del endpoint). Esa función mira cuándo fue el último snapshot y, si ya pasaron
  `snapshot_periodo_dias` (o si nunca se tomó ninguno), toma uno nuevo. No hace falta que sea puntual al
  día exacto — alcanza con que se dispare la primera vez que se detecta que ya tocaba. Para un negocio
  unipersonal que abre la app todos los días, el atraso máximo real es de un día de uso, no semanas, así
  que no se justificaba la complejidad de un scheduler de verdad.
- El `BackgroundTask` abre su propia sesión de base (`SessionLocal()` en `routers/dashboard.py`) en vez de
  reusar la del request, porque para cuando corre el background task la sesión del request ya se cerró.
- `POST /mix-snapshots/tomar` fuerza un snapshot ahora mismo (para la usuaria, o para pruebas), sin
  importar si "tocaba" según el período configurado.
- `GET /mix-snapshots?producto_id=&categoria=` devuelve el historial ordenado por fecha, opcionalmente
  filtrado.
- Un producto activo sin facturación en la ventana simplemente no genera fila ese día (no tiene sentido
  graficar 0% mix indefinidamente para productos que no rotan).
- **Frontend (`Dashboard.jsx`)**: agrupa las filas devueltas por `GET /mix-snapshots` por el **timestamp
  exacto** de cada tanda (todas las filas de una misma "tomada" comparten el mismo `fecha` al
  milisegundo, ver `tomar_snapshot_mix`), nunca por día truncado — si se agrupara por día, dos snapshots
  tomados el mismo día (ej. el automático y uno manual) sumarían sus mix% en un solo punto e inflarían el
  total por encima de 100%. Las categorías se acotan a las 8 con más mix% acumulado (paleta categórica
  fija de 8 colores) y el resto se agrupa en "Otras" en vez de generar más colores.

## E-commerce (Fase 0 — base para un servicio consumidor, todavía no existe)

FashBalance no tiene tienda online propia. Esta ronda deja el backend listo para que un servicio de
e-commerce separado (Next.js, nginx, etc. — infraestructura que se agrega recién en fases posteriores, no
acá) lo consuma vía dos endpoints públicos. Todo lo demás del panel (`/productos`, `/movimientos`, etc.)
sigue sin autenticación, exactamente como hoy.

- **Terminología importante**: una venta por e-commerce genera un `Movimiento` tipo `"Venta"`, el mismo
  mecanismo que cargar una venta a mano en Caja. **No** es una `Compra` (eso es reposición de stock, suma
  unidades — lo opuesto).
- **Catálogo publicado**: `productos.visible_ecommerce` (default `False`, opt-in explícito) y
  `productos.descripcion_ecommerce` controlan qué se muestra y con qué texto — son independientes de
  `activo` (un producto puede estar activo en el negocio pero todavía no publicado). Las fotos viven en
  `producto_fotos` (una fila por foto, `orden` define el orden de visualización, `orden=1` es la portada,
  `ondelete="CASCADE"` a diferencia de Compra/Movimiento porque una foto sin producto no tiene valor
  histórico) y se sirven como archivos estáticos en `/fotos/...` (`StaticFiles` de FastAPI, montado en
  `main.py`) desde un volumen Docker separado (`fashbalance_fotos_data`, montado en
  `/app/fotos_productos`, hermano de `/app/app` para que el bind-mount de código no lo pise). Al subir una
  foto (`POST /productos/{id}/fotos`, multipart) se valida extensión (jpg/png/webp, por el nombre de
  archivo — el `content_type` del navegador no es confiable como único chequeo) y tamaño (5MB); no se
  decodifica la imagen (no hay Pillow en el proyecto, se consideró innecesario para esta fase).
  `DELETE /productos/{id}/fotos/{foto_id}` borra la fila y recién después el archivo en disco (si el
  borrado del archivo falla, la base ya quedó consistente). `PUT /productos/{id}/fotos/orden` recibe la
  lista completa de IDs en el nuevo orden y reasigna `orden` 1..N.
- **Autenticación de los 2 endpoints públicos**: header `X-API-Key` contra la env var
  `ECOMMERCE_API_KEY` (en `.env`, nunca en la base — no hay tabla de API keys ni multiusuario para esto).
  Dependency reusable en `backend/app/auth.py` (`require_ecommerce_api_key`, usa `APIKeyHeader` en vez de
  `Header()` a mano para que Swagger en `/docs` muestre el candado). `GET /ecommerce/ordenes` (para el
  panel admin) queda sin este chequeo, como el resto del panel.
- **Refactor de la creación de una Venta**: la validación que antes vivía en `_validar()` (privada de
  `routers/movimientos.py`) se movió a `calculations.validar_movimiento()`, y se agregó
  `calculations.registrar_venta()` como único camino de alta de un `Movimiento` tipo Venta — lo usan tanto
  `POST /movimientos` como cada línea de `POST /ecommerce/ordenes`. Es la única función de
  `calculations.py` que lanza `HTTPException`, excepción deliberada a la regla de "los routers validan,
  calculations calcula": se aceptó porque dos routers necesitaban exactamente la misma regla de negocio, y
  duplicarla en dos archivos era peor que la inconsistencia de estilo. El ajuste de "sumar la cantidad
  vieja al editar" sigue siendo exclusivo del `PUT /movimientos` (vía el parámetro `actual`) — un alta
  (e-commerce o `POST /movimientos`) nunca lo necesita.
- **Reuso del árbol de variantes en el catálogo**: `routers/productos.py` separó el cuerpo de
  `listar_variantes` en un helper `_formatear_variantes(db, producto_id, stock_por_id)` que recibe el mapa
  de stock ya calculado. `GET /ecommerce/catalogo` calcula `stock_por_variante(db)` **una sola vez** para
  todo el catálogo y llama ese helper por cada producto con variantes, en vez de recalcular el stock de
  todas las variantes del sistema una vez por producto listado. Mismo criterio que en Ventas: una variante
  se informa igual aunque tenga stock 0 (no se filtra en el backend, decisión de quien consuma el
  catálogo).
- **`GET /ecommerce/catalogo`**: solo productos `activo=True` y `visible_ecommerce=True`. Usa un schema
  dedicado (`schemas.ProductoCatalogoOut`, no reusa `schemas.Producto`) para garantizar por diseño que
  `costo`, `mix_pct`, `lead_time_dias` y cualquier otro dato interno nunca se expongan, sin depender de que
  nadie los agregue por error a `Producto` más adelante — es un endpoint público, cualquiera puede ver la
  respuesta JSON en el navegador.
- **`POST /ecommerce/ordenes`**: valida CADA línea (producto activo+visible, variante corresponde si
  aplica, stock suficiente vía `calculations.stock_disponible`) ANTES de escribir nada; si cualquiera
  falla, devuelve `400` con el detalle de esa línea y no crea nada — ni la orden, ni el movimiento, ni
  toca el stock (mismo criterio atómico que ya usan la Importación de Excel y el alta de producto con
  variantes). Con todo validado, crea en una única transacción la `OrdenEcommerce`, un
  `OrdenEcommerceItem` por línea (con `precio_unitario` guardado como valor propio, no como referencia al
  producto — mismo criterio de denormalización deliberada que `MixSnapshot`, para que el histórico no
  dependa de que el precio no haya cambiado después) y el `Movimiento` Venta correspondiente vía
  `registrar_venta()`, guardando su id en `OrdenEcommerceItem.movimiento_id` para trazabilidad.
- **Pantalla de administración**: `OrdenesEcommerce.jsx` lista lo que devuelve `GET /ecommerce/ordenes`
  (interno, sin `X-API-Key`) en una tabla simple, sin filtros.
- **Qué NO hace esta fase**: no hay medios de pago, no hay cálculo de envío real (`forma_entrega` es texto
  fijo entre "Retiro en persona"/"Envío", sin lógica detrás), no hay servicio de e-commerce corriendo
  todavía, no hay nginx ni Next.js — todo eso es fase 1 en adelante.
- **Migraciones**: se agregaron 2 columnas a `productos` (tabla existente, requirió `ALTER TABLE` manual —
  ver sección de arriba sobre `create_all()`) y 3 tablas nuevas (`producto_fotos`, `ordenes_ecommerce`,
  `orden_ecommerce_items`), que se crearon solas.

## Storefront público (Fase 1 — Next.js, solo lectura)

Carpeta nueva `ecommerce/`, hermana de `backend/`/`frontend/`, mismo repo. Es un storefront de **solo
lectura** — sin carrito, checkout ni pagos (eso sería una fase posterior, no decidida todavía). No hay
CLAUDE.md aparte adentro de `ecommerce/`, todo documentado acá.

- **Arquitectura**: Headless Commerce / BFF (Backend-for-Frontend). FashBalance es el Commerce Core; el
  storefront es un Next.js (App Router, TypeScript) que consume los mismos 2 endpoints públicos protegidos
  con `X-API-Key` que ya existían de la Fase 0 (`GET /ecommerce/catalogo`) más uno nuevo de esta ronda
  (`GET /ecommerce/catalogo/{producto_id}`, para que la página de detalle no traiga el catálogo completo).
  TypeScript porque el contrato JSON del catálogo (variantes opcionales, fotos, valores anidados) es
  justo donde tipar evita bugs de acceso — es un proyecto aislado, no comparte build con `frontend/`, así
  que no hay tensión real con que el resto del repo sea JS/Python sin tipos.
- **Endpoint nuevo `GET /ecommerce/catalogo/{producto_id}`** (`backend/app/routers/ecommerce.py`): mismo
  criterio de visibilidad que el listado (404 si no existe, no está `activo`, o no está
  `visible_ecommerce` — sin distinguir el motivo, para no filtrar por inferencia que un producto existe
  pero está oculto). El armado del dict de respuesta se extrajo a un helper `_producto_a_catalogo_dict`
  (reusado por ambos endpoints) para no duplicar la lógica que ya arma `catalogo()`, mismo criterio que
  `_formatear_variantes` en `productos.py`. Sigue usando `stock_por_variante(db)` (todas las variantes del
  sistema) en vez de escribir una función nueva acotada a un producto — no hay volumen que lo justifique.
- **Dos variables de entorno para llegar a FashBalance, no una — son cosas distintas**:
  `FASHBALANCE_API_URL` (`http://backend:8000`, red interna de Docker) es la única que usa el servidor de
  Next.js para hacer `fetch` en Server Components, con el header `X-API-Key` — nunca llega al navegador.
  `FASHBALANCE_PUBLIC_URL` (misma IP/puerto que ya usa `VITE_API_URL` para el panel, ej.
  `http://192.168.100.50:8000`) es la URL que sí tiene que poder resolver el navegador del cliente final,
  para bajar las fotos (`/fotos/...`) y para armar la URL **absoluta** de `og:image` (WhatsApp/Facebook
  necesitan URL pública para generar el preview de un link, no relativa). Ninguna de las dos lleva el
  prefijo `NEXT_PUBLIC_` porque ambas se resuelven 100% server-side (fetch, `generateMetadata`, o props ya
  armadas que se pasan a Client Components) — la diferencia es red interna de Docker vs. red externa/LAN,
  no "server vs. cliente" en el sentido de Next.js. Cuando se agregue nginx en una fase posterior esto se
  simplifica (mismo origen que el storefront), no se adelantó esa solución acá.
- **Bug real ya corregido — nunca leer `process.env.FASHBALANCE_PUBLIC_URL` (ni ninguna env var sin
  `NEXT_PUBLIC_`) dentro de un Client Component**: `ProductGallery.tsx` originalmente llamaba a
  `fotoUrl()` directo para armar el `src` de la imagen en foco y las miniaturas. Como el componente
  tiene `"use client"`, Next.js reemplaza en build-time cualquier `process.env.X` sin prefijo
  `NEXT_PUBLIC_` por `undefined` en el código que termina en el bundle de cliente — rompía **ambas**
  imágenes (foco y miniaturas) en `/productos/[id]`, mientras que `ProductCard.tsx` (la grilla de `/`,
  Server Component) mostraba las fotos bien porque ahí `fotoUrl()` corre en el servidor con la env var
  disponible en runtime. Fix aplicado: `ProductGallery` ya no recibe `Foto[]` ni llama a `fotoUrl()`
  él mismo — recibe `FotoResuelta[]` (`{id, url}`) con las URLs ya armadas por `page.tsx` (Server
  Component) y pasadas como prop. Regla general para cualquier componente nuevo: si necesita una URL
  construida con `FASHBALANCE_PUBLIC_URL` (u otra env var server-only) y es o puede terminar siendo un
  Client Component, resolvé la URL en el Server Component padre y pasala ya armada — nunca llames
  `fotoUrl()` ni leas esas env vars desde un archivo con `"use client"`.
- **Selector de atributos en cascada sin endpoint dedicado** (`ecommerce/src/lib/attributes.ts`): el
  storefront no tiene acceso a `GET /productos/{id}/atributos` (interno del panel, sin `X-API-Key`) ni al
  `orden` real de `ProductoAtributo`. `derivarAtributosProducto()` deriva la lista de atributos por orden
  de **primera aparición** recorriendo `producto.variantes[].valores[]` — determinístico (no depende de
  que cada variante liste sus valores en el mismo orden interno, que de hecho no está garantizado por la
  query de `_formatear_variantes`), pero no es necesariamente el orden de negocio real de
  `ProductoAtributo.orden`. Es una limitación aceptada, no un bug: alcanza para 1-2 atributos tipo
  talle/color. `opcionesParaAtributo()` y `elegirValorAtributo()` son un port directo (mismo
  comportamiento, con tipos) de las funciones homónimas en `frontend/src/pages/Movimientos.jsx` — mismo
  criterio de opciones sin stock deshabilitadas con " (sin stock)" (nunca ocultas), mismo mensaje único
  si todas las opciones del primer atributo quedan sin stock, mismo aviso si el producto tiene
  `tiene_variantes=true` pero cero `Variante` cargadas.
- **Nombre de la tienda, WhatsApp y redes ya NO son env vars — se sacaron del todo**: en una ronda
  posterior se dieron de baja `WHATSAPP_NUMERO`, `INSTAGRAM_URL`, `FACEBOOK_URL` del servicio `ecommerce`
  en `docker-compose.yml` y de `.env` (eran placeholders de ejemplo obvios que había que completar a
  mano y rebuildear para cambiar). Pasaron a vivir en `configuracion` (columnas `nombre_ecommerce`,
  `whatsapp_numero`, `instagram_url`, `facebook_url`), editables desde ⚙️ Configuración del panel y
  expuestas al storefront vía `GET /ecommerce/configuracion-tienda` — ver el detalle completo en la
  sección "Configuración del negocio" más arriba. Un cambio ahí se refleja solo (respetando el
  `revalidate: 60` del fetch), sin rebuildear `ecommerce/`.
- **Docker**: `ecommerce/Dockerfile` es multi-stage de **producción** (`next build` con
  `output: "standalone"` + `node server.js` en el runner), a diferencia de `frontend/Dockerfile` (dev
  puro, `npm run dev`, bind-mount) — no hay hot-reload acá, hay que rebuildear la imagen
  (`docker compose build ecommerce`) ante cada cambio de código. Servicio `ecommerce` en
  `docker-compose.yml`, puerto `3000`, `depends_on: backend` (sin `condition: service_healthy` porque
  `backend` no tiene healthcheck definido, mismo nivel que ya usa `frontend`).
- **Qué NO hace esta fase**: nada de carrito, checkout, medios de pago ni cálculo de envío (ver
  "Carrito y checkout (Fase 2)" más abajo — carrito y checkout ya existen, medios de pago y envío
  siguen sin funcionalidad real). Nada de nginx ni TLS — el storefront se prueba en red local igual
  que el panel, apuntando al puerto expuesto desde la IP de la VM.

## Carrito y checkout (Fase 2 — Next.js, con estado de cliente)

Agrega al storefront de solo lectura de la Fase 1 un carrito de compras y un checkout que genera
órdenes reales contra `POST /ecommerce/ordenes` (el mismo endpoint construido y probado en la Fase
0 — no hizo falta tocarlo para persistir órdenes, solo agregarle un campo informativo, ver más
abajo). Sigue sin haber pasarela de pago real, cálculo de envío real, ni nginx/TLS — eso queda para
una fase futura no planificada todavía.

- **Excepción deliberada a "sin `localStorage`"**: la convención de no usar `localStorage`/
  `sessionStorage` (ver "Convenciones de código" más abajo) es específica del panel interno
  (`frontend/`), donde toda la data de negocio tiene que vivir en Postgres. El carrito del
  storefront es distinto a propósito: es estado de sesión de un comprador anónimo, no un dato de
  negocio, y perder el carrito al recargar la página sería mala experiencia de compra real. Es una
  decisión consciente, no que se pasó por alto la regla del panel.
- **`CartContext`/`CartProvider`** (`ecommerce/src/context/CartContext.tsx`, Client Component):
  estado `items: CartItem[]` (cada línea con `producto_id`, `variante_id` opcional, `nombre`,
  `foto` ya resuelta, `variante_descripcion`, `precio_venta` snapshot numérico al agregar,
  `cantidad`, y `stock_actual` conocido al agregar para acotar la cantidad client-side — no hace
  falta que sea perfecto, el checkout revalida en el servidor igual). Acciones: `agregarItem`
  (suma cantidades si ya existe la línea por `producto_id`+`variante_id`, en vez de duplicarla, con
  tope contra `stock_actual`), `actualizarCantidad`, `quitarItem`, `vaciarCarrito`. Derivados
  `cantidadTotal`/`total` expuestos por el hook `useCart()` para no recalcular la suma en cada
  consumidor.
  - **Gotcha de hidratación evitado**: sincronizar a `localStorage` en un único `useEffect([items])`
    también correría en el primer render (con `items` todavía `[]`, antes de que la carga inicial
    tuviera chance de aplicar lo guardado), pisando el localStorage real con `[]`. Se resuelve con
    un flag `hydrated` interno: un primer efecto (solo al montar) lee `localStorage` y lo vuelca a
    `items`; el efecto de sync a `localStorage` solo escribe si `hydrated` ya es `true`.
  - **`CartProvider` envuelve Header + `{children}` + Footer + `WhatsAppButton` en `layout.tsx`,
    no solo `children`**: el spec original pedía envolver `children`, pero `CartBadge` (el ícono
    con contador en el header) vive dentro de `Header`, que en `layout.tsx` es hermano de
    `{children}`, no descendiente — si el Provider solo envolviera `children`, `CartBadge` quedaría
    fuera de su alcance. `layout.tsx` sigue siendo Server Component (async, `generateMetadata`,
    `dynamic = "force-dynamic"` intactos): solo se envuelve su JSX de salida con `<CartProvider>`,
    patrón soportado de Next.js (un Server Component puede pasar JSX ya renderizado como hijo de un
    Client Component sin que ese JSX se vuelva cliente).
- **Agregar al carrito** (`app/productos/[id]/AddToCartButton.tsx`, nuevo): reemplaza el bloque que
  antes solo mostraba disponibilidad. `VariantSelector.tsx` ganó un prop opcional
  `onSeleccionChange` (cambio aditivo, no se duplicó su lógica de cascada) que reporta hacia arriba
  la variante resuelta, su stock y su descripción (ej. "M / Verde") cada vez que cambia la
  selección — vía un `useEffect` ubicado **antes** de los `return` tempranos del componente (los de
  "sin variantes cargadas" / "sin stock en ninguna combinación"), para no violar las reglas de
  hooks llamándolo condicionalmente. `AddToCartButton` es quien realmente sabe agregar al carrito
  (`useCart().agregarItem(...)`), con un input de cantidad topado contra el stock conocido, mismo
  criterio de "tope contra stock" que ya usa `Movimientos.jsx` del panel.
- **`/carrito`** (Client Component completo, necesita `useCart()`): lista de líneas con foto,
  nombre, variante, cantidad editable (tope por línea), subtotal, botón "Sacar", total general y
  link a `/checkout`. Vacío: mensaje + link a `/`.
  - **Revalidación de stock al montar `/carrito`** (ronda posterior): el `stock_actual` guardado en
    cada `CartItem` es un snapshot de cuando se agregó el producto — si el carrito queda abierto un
    rato, puede estar viejo. `app/carrito/actions.ts` (`"use server"`) expone
    `obtenerStockFresco(productoIds)`, que por cada `producto_id` **distinto** presente en el
    carrito pega a `GET /ecommerce/catalogo/{id}` (el mismo endpoint de siempre, sin endpoint nuevo)
    con `fetch(..., { cache: "no-store" })` — a propósito no reusa `getProducto()`/`apiFetch()` de
    `lib/api.ts`, que trae `next: { revalidate: 60 }`: sin bypasear esa cache, esta revalidación
    podría devolver el mismo stock viejo que ya está en el carrito durante hasta 60s, justo el caso
    que existe para cubrir. `page.tsx` la llama en un único `useEffect` al montar (no en cada cambio
    de `items`, no hace falta pooling) y guarda el resultado en un `Record<producto_id,
    StockFrescoProducto | null>` (`null` = el producto ya no existe o dejó de estar
    activo/`visible_ecommerce`, se trata como stock 0). Por línea: `stockFrescoDeLinea()` resuelve
    el stock fresco (de la variante puntual si tiene, si no del producto) y decide el aviso — nada
    si alcanza, "Solo quedan N disponibles" (ámbar, no bloquea) si alcanza parcial, "Ya no hay
    stock..." (rojo) si es 0. Con cualquier línea en 0, el link a `/checkout` se reemplaza por un
    botón deshabilitado hasta que se ajuste o saque esa línea — el checkout ya rechaza atómicamente
    de más, pero no tiene sentido dejar avanzar a algo que se sabe que va a fallar. Mientras la
    revalidación no llegó (`undefined` en el record) no se muestra ningún aviso, sin spinner —
    aceptable que aparezca un instante después de que la página ya se vio. **No implementa reserva
    de stock** (eso sería para el lado de FashBalance/Caja, no para el storefront) — es solo refrescar
    el dato para avisar mejor.
- **`/checkout` — Server Action con lógica real separada, a propósito**: `src/lib/checkout.ts`
  expone `procesarCheckout(carrito, datosContacto)`, que arma el payload real y le pega a
  `POST /ecommerce/ordenes` con la `X-API-Key` (nunca en código de cliente) usando `fetch` con
  `cache: "no-store"` — no reutiliza el `apiFetch` de `lib/api.ts` porque ese helper está atado a
  GET + `revalidate: 60` + semántica "404 → null", que no aplica a una mutación. La Server Action
  (`app/checkout/actions.ts`, `"use server"`) es una envoltura fina: `FormData` → objeto → delega
  100% en `procesarCheckout`. Esta separación es lo que permite probar `procesarCheckout` con un
  script (`scripts/test-checkout.ts`, ver abajo) sin navegador ni el protocolo interno de invocación
  de Server Actions, que no es practicable armar a mano con `curl`. `app/checkout/CheckoutForm.tsx`
  (Client) usa `useFormState`/`useFormStatus` de `react-dom` (estable en React 18.3.1 + Next
  14.2.x); el carrito (`items`) viaja **bindeado** a la Server Action
  (`crearOrdenAction.bind(null, items)`, mecanismo nativo de Next.js para pasar datos no-formulario
  a un `<form action>`), el resto de los campos son inputs nativos leídos de `FormData`. El vaciado
  del carrito ocurre **client-side**, en un `useEffect` que reacciona al resultado devuelto —
  nunca dentro de la Server Action, que corre en el servidor sin acceso a `localStorage`. Si el
  backend rechaza una línea puntual por stock insuficiente, el `detail` del error se muestra tal
  cual en el formulario y el carrito **no se vacía** (solo se vacía en el branch de éxito), para
  que el comprador ajuste cantidad o saque el producto y reintente.
- **`/pedido-confirmado`**: Server Component simple, lee `?id=` de la URL, sin fetch propio.
- **`metodo_pago_preferido`** (nuevo campo en `OrdenEcommerce`, nullable): qué opción visual tildó
  el cliente en el checkout (ej. "Efectivo al retirar", "Transferencia bancaria") — puramente
  informativo, no dispara ninguna lógica de pago real. Mismo patrón de siempre para columnas
  nuevas en una tabla existente: `ALTER TABLE ordenes_ecommerce ADD COLUMN metodo_pago_preferido
  VARCHAR(50);` manual (`create_all()` no migra tablas existentes). Se agregó a
  `OrdenEcommerceCreate`/`OrdenEcommerceOut` y se muestra en `OrdenesEcommerce.jsx` del panel
  (columna "Pago", `—` para órdenes viejas con el campo en `NULL`).
- **`email_contacto` en `configuracion`** (desvío puntual acordado, no parte del plan original):
  el formulario de Contacto (punto siguiente) arma un `mailto:` pero no había ningún email de
  destino disponible en ningún lado del sistema. En vez de una env var nueva en `ecommerce/` o un
  valor hardcodeado, se agregó como un campo más de "Tienda Online" en ⚙️ Configuración del panel
  (mismo patrón que `nombre_ecommerce`/`whatsapp_numero`/`instagram_url`/`facebook_url`: columna
  nullable en `configuracion`, sin default, `ALTER TABLE configuracion ADD COLUMN email_contacto
  VARCHAR(150);` manual, expuesto al storefront vía `GET /ecommerce/configuracion-tienda`). Se
  edita sin rebuild, igual que el resto de esa sección.
- **Formulario de contacto** (`app/contacto/`): página liviana (nombre, email, mensaje) que arma un
  link `mailto:` al destino de `email_contacto` — sin backend propio, sin envío real de mail
  server-side. Si `email_contacto` todavía no está configurado (`null`), `ContactForm.tsx` oculta
  el formulario y muestra un mensaje apuntando al botón de WhatsApp, coherente con que ese ya es el
  canal de contacto principal desde la Fase 1.
- **`scripts/test-checkout.ts`**: prueba `procesarCheckout()` directo contra el backend real (sin
  pasar por Next.js ni por HTTP al storefront). Busca automáticamente en el catálogo publicado un
  producto (con o sin variantes) con stock suficiente, corre un caso válido (confirma que crea la
  orden y muestra su id bien visible) y un caso de cantidad mayor al stock disponible (confirma que
  se rechaza sin crear nada). **Nunca borra nada automáticamente** — los pedidos válidos que crea
  quedan como órdenes reales (con su Movimiento de Venta real y stock descontado real) en la base.
  Como el proyecto no tiene `node`/`npm` en el host (todo corre en contenedores) y el servicio
  `ecommerce` corre la build de producción sin bind-mount de código, se ejecuta con un contenedor
  descartable de Node en la red de Docker Compose del proyecto (`docker run --rm --network
  negocioya_default -v "$(pwd)/ecommerce:/app" -w /app -e FASHBALANCE_API_URL=http://backend:8000
  -e ECOMMERCE_API_KEY=... node:20-alpine sh -c "npm install && npm run test:checkout"`). `tsx` es
  devDependency de `ecommerce/package.json` (no entra a la imagen de producción, que solo copia
  `.next/standalone`).
- **Qué NO se tocó**: Compras, Movimientos, Análisis e Importación del panel siguen exactamente
  igual — el único cambio de ese lado además de lo de arriba es el campo `metodo_pago_preferido` en
  la pantalla de Órdenes E-commerce.

## Facturación electrónica (Fase A — integración ARCA)

Primer paso hacia facturación electrónica real: autenticarse contra ARCA (WSAA) y pedir un CAE real
para Factura C (WSFEv1) contra homologación. **Esta fase es 100% integración técnica aislada** — no
toca `Pedido`, `OrdenEcommerce`, Caja, ni ninguna pantalla de facturación (la única excepción es la
sección nueva de ⚙️ Configuración descrita más abajo, pedido explícito posterior al alcance original).
Todavía no hay ningún camino que convierta una Orden/Venta real en una Factura — eso es una fase
futura no planificada todavía.

- **Contexto de negocio**: Florencia es monotributista, emite Factura C. WSFEv1 es el servicio más
  simple de ARCA para este caso porque **no lleva desglose de IVA** (prohibido informarlo para tipo
  C — mandar el array `<Iva>` lo rechaza) y **no lleva detalle de ítem**: se factura el total de una
  operación, no producto por producto. Esto simplifica mucho el diseño — no hace falta mapear líneas
  de un pedido a líneas de un comprobante en esta fase, ni en ninguna futura mientras se siga
  facturando por Factura C.
- **Paquete aislado `backend/app/arca/`**: primer módulo del proyecto que no es ni router ni parte de
  `calculations.py` — es integración externa pura (SOAP contra ARCA), no lógica de negocio del
  catálogo. No se importa desde `main.py`, así que un problema de configuración acá (certificado
  faltante, CUIT no cargado) nunca puede romper el arranque del resto de la API.
  - `config.py`: constantes de entorno (`ARCA_ENTORNO`, `ARCA_CERT_PATH`, `ARCA_KEY_PATH`,
    `ARCA_CACHE_DIR`), estilo `os.getenv(...)` a nivel de módulo igual que el resto del proyecto (no
    hay capa de `Settings`/`BaseSettings` en FashBalance). Resuelve las URLs de WSAA/WSFEv1 según
    `ARCA_ENTORNO` (`testing` | `produccion`) sin ningún branch de lógica en el resto del código — todo
    lo que cambia entre entornos son estas constantes.
  - `wsaa.py`: arma la TRA (Ticket de Requerimiento de Acceso, pidiendo el servicio `"wsfe"`), la
    firma como CMS/PKCS#7 con `cryptography.hazmat.primitives.serialization.pkcs7`
    (`PKCS7SignatureBuilder`, sin `DetachedSignature` porque WSAA exige el contenido embebido —
    "nodetach"), y llama `loginCms` de WSAA vía `zeep`. El ticket (Token/Sign) dura 12hs reales y se
    cachea en disco (`{ARCA_CACHE_DIR}/ticket_{entorno}_{servicio}.json`, un JSON simple, no hace
    falta tabla en la base) para no pedir uno nuevo en cada llamada a WSFEv1.
  - `wsfe.py`: cliente WSFEv1 acotado a lo que necesita Factura C — `FEDummy` (chequeo de
    conectividad, sin auth), `FECompUltimoAutorizado` (se llama siempre antes de pedir un CAE; ARCA es
    la fuente de verdad del número de comprobante, nunca se mantiene un contador propio en la base que
    se pueda desincronizar) y `FECAESolicitar`. Para Factura C (`CbteTipo=11`): `Concepto=1`,
    `CbteDesde=CbteHasta` (un solo comprobante por request, obligatorio para tipo C),
    `ImpTotConc=ImpOpEx=ImpIVA=ImpTrib=0`, `ImpNeto` = subtotal de la operación (no "neto gravado"
    como en Factura A/B), `ImpTotal = ImpNeto + ImpTrib`, sin la clave `Iva` en el dict en absoluto.
    **`CondicionIVAReceptorId`** (default `5` = Consumidor Final) se agregó aunque no estaba en el
    detalle original de esta fase — es un campo que ARCA exige hoy en `FECAEDetRequest` y sin él
    rechaza el comprobante; se detectó al pedirlo explícitamente antes de programar. `cuit`/`pto_vta`
    son parámetros explícitos de cada función, nunca constantes de módulo — el paquete `arca/` es
    agnóstico de la base de datos, quien resuelve esos valores desde `configuracion` es el caller
    (`probar_conexion.py` en esta fase).
  - **Gotcha real de zeep, ya corregido**: para elementos opcionales ausentes en la respuesta SOAP
    (ej. `Errors` cuando no hay errores, `Observaciones` cuando no hay observaciones), zeep no
    devuelve `None` al acceder al atributo — lanza `AttributeError`. Por eso `_interpretar_respuesta`
    usa `getattr(resultado, "Errors", None)` / `getattr(det, "Observaciones", None)` en vez de acceso
    directo. También el nombre del campo en `FECAEDetResponse` es **`Observaciones`** (no `Obs` — ese
    es el nombre del elemento *dentro* de `ArrayOfObs`), confundirlos rompe el parseo silenciosamente
    con una excepción al primer comprobante sin observaciones.
  - `probar_conexion.py`: script de prueba manual (no es parte de la API), vive dentro de `arca/`
    para reusar el bind mount existente de `app/` sin tocar Dockerfile ni compose. Se corre con
    `docker compose exec backend python -m app.arca.probar_conexion`. Corre los 5 pasos de esta fase
    (FEDummy, ticket WSAA, último autorizado, CAE real, caso de rechazo a propósito mandando `<Iva>`
    en una Factura C) contra el ambiente activo. Confirmado funcionando end-to-end contra homologación
    real: CAE obtenido, y el caso de rechazo devuelve el error real de ARCA ("Para comprobantes tipo C
    el objeto IVA no debe informarse", código 10071) en vez de una excepción sin manejar.
- **Certificados — bind mount de solo lectura, no named volume**: a diferencia de
  `fashbalance_fotos_data` (named volume que la app puebla en runtime), los certificados de ARCA los
  genera/renueva Florencia a mano vía WSASS (testing) o el Administrador de Certificados Digitales
  (producción) — viven en `arca_certs/` en la raíz del repo (gitignored) y se montan de solo lectura:
  `./arca_certs:/app/arca_certs:ro` en `docker-compose.yml`. El cache de ticket WSAA sí necesita
  escritura, así que va en un named volume separado (`fashbalance_arca_cache:/app/arca_cache`) — nunca
  se mezcla estado runtime escribible con el mount de solo lectura de secretos.
- **Qué va en `.env` (infra) vs. qué va en `configuracion`/DB (negocio) — desvío deliberado del plan
  original**: la primera versión de esta fase preveía `ARCA_CUIT` como variable de entorno. Se cambió
  a pedido explícito posterior: el CUIT, el punto de venta, la Razón Social y el Domicilio Fiscal viven
  en la tabla `configuracion` (ver tabla de campos en la sección "Configuración del negocio" más
  arriba), editables desde ⚙️ Configuración sin acceso a la infraestructura del servidor. Solo lo que
  depende del filesystem/red del contenedor (`ARCA_ENTORNO`, rutas de certificado) sigue en `.env` —
  cambiarlas si requiere reiniciar el contenedor de todos modos porque son archivos/URLs, no datos que
  Florencia deba poder tocar sin ayuda técnica. `arca_razon_social`/`arca_domicilio_fiscal` se crearon
  en esta fase pero **todavía no los usa ningún código** (`FECAESolicitar` no los necesita, van en el
  comprobante impreso, no en el request a WSFEv1) — quedan cargados para no rehacer esta pantalla
  cuando llegue esa fase futura.
- **Dependencias nuevas**: `zeep` (cliente SOAP, resuelve el WSDL de WSAA/WSFEv1 solo) y
  `cryptography` (firma CMS/PKCS#7). `lxml` no se agregó como dependencia directa — la TRA y la
  respuesta de `loginCms` se arman/parsean con `xml.etree.ElementTree` de la stdlib, `zeep` ya trae
  `lxml` transitivamente para el SOAP de WSFEv1. `python:3.11-slim` resolvió wheels prearmadas para
  ambas sin necesitar `build-essential`/headers de compilación — si algún día eso deja de ser cierto
  (otra arquitectura, otra versión), ahí sí hay que agregar el `apt-get install` correspondiente al
  Dockerfile, no antes.
- **Qué NO hace esta fase** (explícito, no reinventar): nada de CAEA (solo CAE). Ningún otro tipo de
  comprobante que Factura C (11), ni Nota de Débito/Crédito C. CUIT nunca hardcodeado en código — sale
  de `configuracion`, cargado por Florencia desde la pantalla. No hay ningún camino desde una Orden o
  Venta real hacia una Factura — eso es la fase que sigue, no planificada todavía.

## Fase B — Pedido unificado (canal e-commerce + local, Caja como carrito)

Unifica lo que hasta acá eran dos caminos de venta desconectados (`OrdenEcommerce`/`OrdenEcommerceItem`
del canal online, y un `Movimiento` tipo Venta suelto por cada carga en Caja para el canal mostrador) en
un solo concepto `Pedido`/`PedidoItem` que sirve a los dos canales. Esta fase NO conecta con ARCA
(`backend/app/arca/` queda intacto y sin ninguna llamada nueva) ni implementa reversión/cancelación real
de stock — `Cancelado` es un estado disponible en el selector, sin ningún efecto de devolución de stock
todavía (eso es una fase futura). El storefront Next.js (`ecommerce/`) no se tocó.

- **Decisión: renombrar/extender la tabla existente, no crear una tabla nueva.** Se evaluaron ambas
  opciones y se optó por transformar `OrdenEcommerce`/`OrdenEcommerceItem` en lugar (`ALTER TABLE ...
  RENAME`) en vez de crear un `Pedido` paralelo, por: (1) el propio criterio de la fase era generalizar
  el concepto existente, no duplicarlo — mantener dos tablas casi idénticas habría contradicho
  "unificar"; (2) cero movimiento de datos: renombrar tabla + agregar columnas nullable/con default no
  mueve ni una fila, así que las órdenes de e-commerce ya probadas contra la API real (incluidas las
  generadas por `ecommerce/scripts/test-checkout.ts`) conservan su `id` y su `movimiento_id` de
  trazabilidad sin ningún script de copia; (3) la superficie de código que tocaba el modelo viejo era
  chica y estaba mapeada de antemano (`models.py`, `schemas.py`, `routers/ecommerce.py`,
  `OrdenesEcommerce.jsx`, este último reemplazado en la misma fase de todos modos). El `ALTER TABLE`
  aplicado (además de renombrar tabla/columna, se renombraron también secuencia/índices/constraints por
  prolijidad, ya que un `RENAME TABLE` de Postgres no los renombra solo):
  ```sql
  ALTER TABLE ordenes_ecommerce RENAME TO pedidos;
  ALTER TABLE orden_ecommerce_items RENAME TO pedido_items;
  ALTER TABLE pedido_items RENAME COLUMN orden_id TO pedido_id;
  ALTER SEQUENCE ordenes_ecommerce_id_seq RENAME TO pedidos_id_seq;
  ALTER SEQUENCE orden_ecommerce_items_id_seq RENAME TO pedido_items_id_seq;
  ALTER INDEX ordenes_ecommerce_pkey RENAME TO pedidos_pkey;
  ALTER INDEX ix_ordenes_ecommerce_id RENAME TO ix_pedidos_id;
  ALTER INDEX orden_ecommerce_items_pkey RENAME TO pedido_items_pkey;
  ALTER INDEX ix_orden_ecommerce_items_id RENAME TO ix_pedido_items_id;
  ALTER TABLE pedido_items RENAME CONSTRAINT orden_ecommerce_items_orden_id_fkey TO pedido_items_pedido_id_fkey;
  ALTER TABLE pedido_items RENAME CONSTRAINT orden_ecommerce_items_producto_id_fkey TO pedido_items_producto_id_fkey;
  ALTER TABLE pedido_items RENAME CONSTRAINT orden_ecommerce_items_variante_id_fkey TO pedido_items_variante_id_fkey;
  ALTER TABLE pedido_items RENAME CONSTRAINT orden_ecommerce_items_movimiento_id_fkey TO pedido_items_movimiento_id_fkey;
  ALTER TABLE pedidos ADD COLUMN canal VARCHAR(20) NOT NULL DEFAULT 'ecommerce';
  ALTER TABLE pedidos ADD COLUMN facturar_arca BOOLEAN NOT NULL DEFAULT TRUE;
  ALTER TABLE pedidos ALTER COLUMN cliente_nombre DROP NOT NULL;
  ALTER TABLE pedidos ALTER COLUMN forma_entrega DROP NOT NULL;
  UPDATE pedidos SET estado = 'Entregado' WHERE estado = 'Confirmada';
  ```
  El `UPDATE` final reescribe el valor legado `"Confirmada"` (todas las filas que existían antes de esta
  fase eran datos de prueba, sin ningún cliente real todavía) a `"Entregado"`, porque `"Confirmada"` no
  es parte de la cadena de estados nueva y no había ningún dato real en riesgo.
- **Campos nuevos en `Pedido`** (`backend/app/models.py`): `canal` (`"ecommerce"` | `"local"`, sin
  default de columna — se setea explícito en cada router que crea un pedido). `facturar_arca` (bool):
  siempre `True` para `canal="ecommerce"` (`POST /ecommerce/ordenes` lo fija explícito, sin opción en el
  storefront — toda venta online se factura), lo decide un checkbox visible en Caja para `canal="local"`.
  `cliente_nombre` y `forma_entrega` pasaron a nullable (no aplican igual a un pedido de mostrador).
- **Estados de logística** (`calculations.ESTADOS_PEDIDO_VALIDOS`): `Pendiente → Preparando → Listo para
  retirar / Enviado → Entregado`, más `Cancelado` como alternativa en cualquier punto antes de Entregado.
  "Listo para retirar" y "Enviado" son ambos valores válidos para cualquier pedido — no se acopla la
  validación de backend a `forma_entrega` (eso queda del lado del frontend, que solo ofrece la opción que
  corresponde en el selector de `Pedidos.jsx`), para no sumar una quinta categoría rara. **Default de
  estado según canal, no el mismo para los dos**: `canal="ecommerce"` arranca en `Pendiente` (falta
  prepararlo/enviarlo). `canal="local"` arranca directo en `Entregado` (la clienta se lo lleva puesto en
  el momento) — sin bloquear que se pueda cambiar a mano después si hiciera falta un caso raro. No hay
  una función nueva en `calculations.py` que valide el estado y lance `HTTPException` —
  `validar_movimiento` sigue siendo la única función del módulo con esa excepción documentada; el chequeo
  de `estado in ESTADOS_PEDIDO_VALIDOS` vive inline en el router `PUT /pedidos/{id}/estado`, mismo nivel
  de trivialidad que la validación de `forma_entrega` que ya vivía inline en `routers/ecommerce.py`.
- **`backend/app/routers/ecommerce.py`**: `crear_orden` (`POST /ecommerce/ordenes`) sigue aceptando y
  devolviendo el mismo contrato JSON que antes — el storefront (`ecommerce/src/lib/checkout.ts`) solo lee
  `data.id` de la respuesta y no renderiza `estado` en ningún lado, así que los campos nuevos (`canal`,
  `facturar_arca`) son aditivos y el cambio de valor de `estado` (de siempre `"Confirmada"` a
  `"Pendiente"`) no rompe nada de ese lado. Internamente ahora crea un `models.Pedido(canal="ecommerce",
  facturar_arca=True, estado="Pendiente", ...)` explícito. **`GET /ecommerce/ordenes` se retiró** de este
  router (solo lo consumía `OrdenesEcommerce.jsx`, que se reemplazó por `Pedidos.jsx` en la misma fase; el
  storefront nunca lo llamaba).
- **Nuevo `backend/app/routers/pedidos.py`**: `GET /pedidos` (todos los pedidos de ambos canales,
  reemplaza al viejo `GET /ecommerce/ordenes`). `POST /pedidos` (alta de un pedido `canal="local"` desde
  Caja — el carrito armado en `Movimientos.jsx` se confirma acá de una sola vez; mismo criterio de
  validación atómica por línea que `POST /ecommerce/ordenes`, reusando `calculations.stock_disponible` y
  `calculations.registrar_venta` tal cual, sin reimplementar nada, pero **sin** el chequeo de
  `visible_ecommerce` — una venta de mostrador puede vender un producto no publicado en la tienda online
  — ni de `forma_entrega`/`direccion_envio`, que no aplican a este canal). `PUT /pedidos/{id}/estado`
  (valida contra `ESTADOS_PEDIDO_VALIDOS`, 400 si no corresponde).
- **Caja (`Movimientos.jsx`) pasa de "un producto = un movimiento" a "un pedido = varios ítems"**, solo
  para tipo Venta (Ingreso/Egreso no cambiaron, siguen siendo una carga rápida de una sola línea vía
  `POST /movimientos` directo, y la edición/borrado de un `Movimiento` ya existente tampoco cambió). El
  selector de categoría→producto→atributos→variante con el filtro por stock (`opcionesParaAtributo`,
  `elegirValorAtributo`, `varianteResuelta`) se reusó tal cual, sin reescribirlo. Flujo de dos fases: (1)
  **Armar** — un botón "+ Agregar al pedido" empuja el ítem resuelto a un carrito en memoria
  (`itemsPedido`), contra un tope de cantidad que además de `stock_disponible` real descuenta lo que ya
  está en el carrito para esa misma variante/producto (si no, se podrían agregar dos líneas de la misma
  variante sumando más que el stock real sin que el frontend avise antes de confirmar — el backend de
  todos modos lo rechazaría igual gracias a que `registrar_venta` valida secuencialmente contra el estado
  ya flusheado dentro de la misma transacción, mismo mecanismo que ya usa `POST /ecommerce/ordenes` con
  líneas múltiples). (2) **Confirmar** — checkbox "Facturar (ARCA)" (arranca **destildado** por default:
  a diferencia del canal ecommerce, que siempre factura por regla de negocio separada, una venta de
  mostrador no siempre la pide la clienta, y tildarlo debería ser un acto explícito cuando corresponde) +
  input de cliente opcional + botón que llama `POST /pedidos` con las líneas del carrito. En error (ej.
  una venta concurrente consumió el stock entre armar y confirmar), el carrito **no se vacía** — la
  usuaria puede sacar el ítem problemático y reintentar, mismo criterio que ya usa el checkout del
  storefront.
  - **Bug real ya corregido — agregar dos veces el mismo producto+variante duplicaba la línea en vez de
    sumar la cantidad**: la primera versión de `agregarAlCarrito` armaba siempre un ítem nuevo con una
    `key` única, sin buscar si ya había una línea con el mismo `producto_id`+`variante_id` en
    `itemsPedido`. Caso real detectado por la usuaria: agregar "Calza Dua M/Verde" x2 y después, en el
    mismo pedido, agregar otra vez "Calza Dua M/Verde" x1 dejaba dos líneas separadas en vez de una sola
    de x3. Fix: antes de agregar, busca en `itemsPedido` una línea con el mismo `producto_id` y
    `variante_id` (`null` si no tiene variantes) y, si existe, le suma la cantidad nueva en vez de
    empujar una línea más; si no existe, recién ahí crea la línea nueva. El tope de stock
    (`stockDisponibleEfectivo`, que ya descontaba lo acumulado en el carrito para esa
    variante/producto) no necesitó cambios — seguía siendo correcto, el bug era solo de presentación
    (dos filas en vez de una), no de validación de stock.
- **`OrdenesEcommerce.jsx` se reemplazó por `Pedidos.jsx`** (ruta `/pedidos`): lista TODOS los pedidos sin
  importar el canal, con columna de canal (badge), fecha, cliente (o "Mostrador" si no se cargó nombre en
  uno local), items, total, `facturar_arca` (badge sí/no), y estado editable ahí mismo con un `<select>`
  que dispara `PUT /pedidos/{id}/estado` al cambiar (revierte el valor si la API rechaza el cambio). Sin
  botón de "Facturar" — explícitamente fuera de alcance, es de la Fase C.
- **Qué NO se tocó**: `backend/app/arca/`, `ecommerce/` (storefront Next.js), la interfaz pública de
  `calculations.registrar_venta`/`validar_movimiento`/`stock_disponible` (se reusan sin cambiar firma),
  `Compras.jsx` (tiene su propia copia de la lógica de selectores, independiente de `Movimientos.jsx`).

## Reserva de stock (pedido en armado en Caja)

Mientras Florencia arma un pedido tipo Venta con varias líneas en Caja (`Movimientos.jsx`), esas
unidades tienen que dejar de estar disponibles para cualquier otra venta (e-commerce u otro pedido
local) mientras el pedido se termina de armar y confirmar, sin bloquear el stock para siempre si el
pedido nunca se confirma. Alcance acotado a propósito: sin scheduler ni worker de limpieza — mismo
criterio "lazy" que ya usa el proyecto para los snapshots del mix real.

- **Tabla `reservas_stock`** (`backend/app/models.py`, clase `ReservaStock`): `sesion_id` (string,
  UUID generado en el frontend al arrancar un pedido nuevo en Caja — ver más abajo), `producto_id`,
  `variante_id` (nullable), `cantidad`, `creado_en`, `expira_en`, y 3 columnas denormalizadas
  (`nombre_producto`, `descripcion_variante`, `precio_unitario`, agregadas en una ronda posterior
  — ver más abajo "Reconstrucción del carrito al refrescar"). Sin relationships hacia
  `Producto`/`Variante` (no hace falta navegar desde ahí, mismo criterio minimalista que
  `MixSnapshot`). Tabla nueva → no necesitó `ALTER TABLE` en su alta original, pero las 3 columnas
  denormalizadas sí (tabla ya existente para ese momento): `ALTER TABLE reservas_stock ADD COLUMN
  nombre_producto VARCHAR(200); ALTER TABLE reservas_stock ADD COLUMN descripcion_variante
  VARCHAR(255); ALTER TABLE reservas_stock ADD COLUMN precio_unitario NUMERIC(12,2);`.
- **`reserva_stock_minutos`** (config, default 20): TTL de una reserva. Ver tabla de "Configuración
  del negocio" más arriba. Editable desde ⚙️ Configuración (`frontend/src/pages/Configuracion.jsx`,
  grupo "Stock y Reposición") — se agregó como un campo más de ese formulario genérico
  data-driven (`GRUPOS`), mismo patrón que el resto de los campos numéricos de esa pantalla, sin
  lógica especial.
- **Vencimiento 100% pasivo, sin borrado activo**: una reserva vence sola por tiempo. Cualquier
  cálculo de disponibilidad simplemente ignora las filas con `expira_en <= now()`
  (`calculations.stock_disponible` filtra `ReservaStock.expira_en > func.now()`, comparación hecha
  del lado de la base para no depender de que el reloj de la app y el de Postgres coincidan) — una
  reserva vencida deja de "contar" en el instante exacto en que vence, sin que nadie tenga que
  borrarla. El borrado físico de filas viejas es oportunista: `calculations.reservar_stock()`, cada
  vez que crea/actualiza una reserva, de paso borra las que vencieron hace más de un día. No hay
  cron ni `BackgroundTask` — mismo argumento ya usado para `verificar_y_tomar_snapshot_si_corresponde`
  en la sección de snapshots del mix real: el atraso máximo real (hasta que alguien vuelva a tocar
  `POST /reservas`) no justifica la complejidad de un scheduler de verdad.
- **`stock_disponible` (extendida, no duplicada)**: ganó un parámetro `excluir_sesion:
  Optional[str] = None`, retrocompatible (default `None`, los call sites existentes —
  `validar_movimiento`, `routers/pedidos.py`, `routers/ecommerce.py` — no lo pasan y automáticamente
  pasan a ser reservation-aware: cuentan TODAS las reservas activas de cualquier sesión). Además de
  lo que ya restaba (comprado - vendido), resta la suma de reservas activas del mismo
  producto/variante, excluyendo las de `excluir_sesion` si se pasa (para que una sesión no se vea
  bloqueada por sus propias reservas al querer agregar más del mismo producto). Con esto, una venta
  de e-commerce que intente llevarse unidades ya reservadas por un pedido local en armado se rechaza
  igual que si el stock ya estuviera vendido de verdad — sin tocar `registrar_venta` ni
  `validar_movimiento`. `POST /ecommerce/ordenes` (`crear_orden`) ya usaba `stock_disponible`, así
  que el checkout final del storefront siempre rechazó correctamente una compra que chocara con una
  reserva activa, desde el primer día de esta feature — el gap real (corregido en la ronda
  siguiente, ver "Catálogo de e-commerce reservation-aware" más abajo) era que el catálogo
  (`GET /ecommerce/catalogo*`) todavía no avisaba de eso ANTES de llegar al checkout.
- **`calculations.reservar_stock(db, sesion_id, producto_id, variante_id, cantidad)`**: valida
  contra `stock_disponible(..., excluir_sesion=sesion_id)`; si alcanza, crea o actualiza (upsert
  manual en Python — busca por `sesion_id`+`producto_id`+`variante_id`, mismo criterio que
  `resolver_o_crear_variante`, sin `UniqueConstraint` de Postgres porque `NULL` no colisiona en un
  UNIQUE compuesto) la fila con la `cantidad` nueva **reemplazando** el valor (no sumándolo — es "quiero
  tener reservado N en total para esta línea") y `expira_en` renovado a `now() + reserva_stock_minutos`.
  Si no alcanza, lanza `ValueError` (no `HTTPException`) — decisión deliberada para mantener el
  invariante ya documentado de que `validar_movimiento` es la única función de `calculations.py` que
  lanza `HTTPException`; el router (`POST /reservas`) capta el `ValueError` y arma el 400. No hace
  `commit()` (solo `flush()`), el caller controla la transacción, mismo criterio que
  `registrar_venta`.
- **`calculations.liberar_reserva(db, sesion_id, producto_id=None, variante_id=None)`**: borra la
  reserva puntual si se pasan `producto_id`/`variante_id`, o todas las de esa `sesion_id` si no —
  "sacar un ítem del carrito en armado" y "cancelar el pedido completo" respectivamente. Tampoco
  commitea.
- **Endpoints — `backend/app/routers/reservas.py`**: `POST /reservas` (`{sesion_id, producto_id,
  variante_id, cantidad}` → `reservar_stock`, 400 con el detalle si no alcanza) y `DELETE /reservas`
  (query params `sesion_id` obligatorio + `producto_id`/`variante_id` opcionales → `liberar_reserva`).
- **`POST /pedidos` (`routers/pedidos.py`, `crear_local`) — gotcha real encontrado al probar el
  flujo end-to-end, no solo el diseño de arriba**: la primera versión liberaba las reservas de la
  sesión recién antes del `db.commit()` final (después de crear los `Movimiento`). Eso rompía la
  confirmación de un pedido cuya cantidad coincidía con lo reservado: `registrar_venta()` valida el
  stock internamente vía `validar_movimiento()`, que llama a `stock_disponible()` **sin**
  `excluir_sesion` (esa función no cambió de firma pública) — con la reserva propia todavía activa
  en ese momento, se restaba dos veces contra sí misma y una confirmación 100% legítima se
  rechazaba con "no hay stock suficiente". Fix: `liberar_reserva(db, payload.sesion_id)` se llama
  como el PRIMER paso de la función, antes del loop de validación de líneas — sigue siendo la MISMA
  transacción sin commit intermedio (si cualquier línea falla después, todo se revierte junto,
  incluida esa liberación), así que no hay ninguna ventana de carrera nueva; simplemente para el
  momento en que el resto del flujo valida stock, las reservas de esa sesión ya no existen y no se
  cuentan dos veces. `PedidoLocalCreate` ganó un campo `sesion_id: Optional[str] = None` para esto.
- **Frontend (`Movimientos.jsx`)**: al primer "+ Agregar al pedido" de un carrito vacío se genera un
  `sesionId` (`crypto.randomUUID()` con fallback a un id `Date.now()+Math.random()` si esa API no
  está disponible — este panel se accede seguido por IP de LAN sobre `http`, no `https`/`localhost`,
  contexto en el que `crypto.randomUUID` puede no existir en algunos navegadores). `agregarAlCarrito`
  pasa a `async`: antes de tocar el carrito visual llama `POST /reservas` con la cantidad TOTAL que
  va a quedar reservada para esa línea (si ya había una línea del mismo producto+variante, es
  `existente + agregado`, no solo el incremento — `reservar_stock` reemplaza el valor, no lo suma);
  si el backend rechaza, se muestra el error y no se agrega la línea. `sacarDelCarrito` llama
  `DELETE /reservas` para esa línea puntual antes de sacarla (best-effort: si el DELETE falla, la
  línea se saca igual del carrito visual — la reserva vieja se autolimpia sola por TTL, no tiene
  sentido trabar a la usuaria por un error de red en un cleanup no crítico). Nuevo botón "Cancelar
  pedido" llama `DELETE /reservas` para toda la sesión y vacía el carrito — para no depender solo
  del vencimiento por tiempo si Florencia decide no continuar. `confirmarPedido` manda `sesion_id` en
  el body de `POST /pedidos` y resetea `sesionId` a `null` al confirmar con éxito.
- **Qué NO hace esta funcionalidad**: nada de reserva real para el carrito del storefront
  (`ecommerce/`) — sigue sin servidor detrás hasta el checkout, tal como está diseñado; ver
  "Catálogo de e-commerce reservation-aware" más abajo para la mitigación real que sí se hizo de
  ese lado. Nada de scheduler, worker ni tarea en segundo plano para expirar reservas.
  `Compras.jsx` no se tocó. `registrar_venta`/`validar_movimiento` no cambiaron de firma pública.

### Reconstrucción del carrito al refrescar (sin `localStorage`)

Bug real encontrado al probar a mano: si se refrescaba la página de Caja mientras había un pedido
en armado, el carrito visual desaparecía (vivía solo en memoria de React) pero la reserva de stock
en Postgres seguía activa — bloqueaba esas unidades hasta el TTL o hasta cancelarla a mano por API,
sin que la usuaria pudiera verlo ni actuar desde la UI. El panel tiene una convención explícita de
no usar `localStorage`/`sessionStorage` (ver "Convenciones de código" más abajo) — la solución la
respeta: la fuente de verdad para "hay un pedido en armado" ya es `reservas_stock`, así que alcanza
con poder reconstruir el carrito visual a partir de esa tabla en vez de depender de un `sesionId`
que solo vivía en memoria.

- **Columnas denormalizadas en `ReservaStock`**: `nombre_producto`, `descripcion_variante`,
  `precio_unitario` (mismo criterio ya documentado para `PedidoItem`/`MixSnapshot`). Se completan
  en `calculations.reservar_stock()` — busca el `Producto` (nombre, precio_venta) y arma la
  descripción de variante con el helper `descripcion_variante(db, variante_id)` (ver punto
  siguiente) tanto al crear como al actualizar la fila. Así `GET /reservas` alcanza para
  reconstruir el carrito sin round-trips extra a `/productos` ni `/productos/{id}/variantes`.
- **`calculations.descripcion_variante(db, variante_id)`** (nueva función de módulo): arma el
  texto legible de una variante (ej. "M / Verde") a partir de sus valores de atributo ordenados
  por `ProductoAtributo.orden`. Extraída de una closure local que vivía duplicada (armaba
  exactamente la misma query) dentro de `routers/importacion.py` — ese archivo ahora importa y
  usa `calculations.descripcion_variante(db, variante_id)` en sus 2 call sites, sin cambiar el
  resultado (misma query, mismo join, mismo orden).
- **`calculations.listar_reservas_activas(db, sesion_id=None)`** (nueva): reservas vigentes
  (`expira_en > now()`), opcionalmente acotadas a una sesión, más recientes primero.
- **`GET /reservas`** (nuevo, `routers/reservas.py`, junto a `POST`/`DELETE`): query param
  opcional `sesion_id`; sin filtrar devuelve TODAS las reservas activas de cualquier sesión.
- **Frontend (`Movimientos.jsx`)**: nuevo `useEffect` al montar el componente que llama
  `GET /reservas` sin filtrar. Si hay filas activas, se agrupan por `sesion_id` y se toma la más
  reciente (primera del array, ya viene ordenado por `creado_en` desc) — cubre el caso raro de dos
  sesiones activas a la vez (ej. dos pestañas) sin agregar más sofisticación, dado que es software
  de una sola usuaria. Se reconstruye `itemsPedido` directo desde los campos denormalizados de esas
  filas (sin llamar a ningún otro endpoint) y se restaura `sesionId`. Se muestra un aviso
  ("Recuperamos un pedido que tenías en armado...") para que no sea un cambio silencioso — estado
  `carritoRecuperado`, se resetea a `false` al confirmar o cancelar el pedido. El resto del flujo
  (agregar/sacar/confirmar/cancelar) no cambió: una vez reconstruido el estado, funciona igual que
  con un carrito armado en la sesión actual.

### Catálogo de e-commerce reservation-aware

Segundo bug real encontrado al probar a mano: el storefront (`ecommerce/`) dejaba agregar al
carrito y mostraba como disponibles unidades que en realidad ya estaban reservadas por un pedido
en armado en Caja. Investigación de código confirmó el alcance exacto: `POST /ecommerce/ordenes`
(`crear_orden`) ya usaba `stock_disponible` (reservation-aware desde el día 1 de esta feature), así
que el checkout final **nunca tuvo un problema de integridad de datos** — una compra que chocara
con una reserva activa siempre se rechazó correctamente. El problema real estaba acotado a
`GET /ecommerce/catalogo` y `GET /ecommerce/catalogo/{id}` (`routers/ecommerce.py`), que arman su
`stock_actual` con `calculations.stock_por_producto`/`stock_por_variante` — funciones que no restan
reservas (a propósito, ver abajo). Se confirmó además (leyendo `ecommerce/src/lib/api.ts`,
`AddToCartButton.tsx`, `VariantSelector.tsx` y `carrito/actions.ts`) que absolutamente todo el
número de stock que usa el storefront —tope al agregar al carrito, aviso "Solo quedan N
disponibles"/"Ya no hay stock" en la revalidación de `/carrito`— sale directo de esos dos campos,
sin ningún cómputo propio del lado de `ecommerce/`. Consecuencia: arreglando esos dos GET en el
backend alcanzaba, sin tocar ni un archivo de `ecommerce/`.

- **`stock_por_producto(db, considerar_reservas: bool = False)` y `stock_por_variante(db,
  considerar_reservas: bool = False)`**: nuevo parámetro opcional, retrocompatible. Con `False`
  (el default, para TODOS los call sites que ya existían: pantalla de Stock, dashboard,
  BCG/`analisis_combinado`) siguen mostrando stock físico puro — decisión deliberada: son para
  decisiones de reposición, no de venta en el instante, así que una reserva momentánea de Caja no
  tiene por qué mover esos números. Con `True`, restan además la suma de reservas activas de cada
  producto/variante — UNA sola query agregada (`group_by`) para todo el catálogo de una vez, mismo
  criterio de performance que ya se cuidó al armar `stock_por_variante(db)` una sola vez para todo
  el catálogo en la Fase 0.
- **`routers/ecommerce.py`**: `catalogo()` y `catalogo_detalle()` pasan `considerar_reservas=True`
  en sus llamadas a `stock_por_producto`/`stock_por_variante`. `crear_orden()` no se tocó — ya
  estaba bien.
- **Nada de `ecommerce/` se tocó** — confirmado por investigación de código antes de implementar,
  no una suposición.

## Convenciones de código

- **Backend**: nombres de tablas, campos, funciones y mensajes de error en español. Sin Alembic (ver nota
  de migraciones arriba). Toda la lógica de negocio vive en `calculations.py`, los routers son delgados
  (validan y llaman a `calculations`). Uso de `Decimal` para plata en los schemas Pydantic, convertido a
  `float` en las respuestas de los endpoints "calculados" (`/dashboard/*`, `/stock/*`) porque no son
  operaciones contables exactas, son reportes.
- **Frontend**: cada página es un componente en `src/pages/`, sin estado global (todo con `useState` +
  `useEffect` + llamadas directas a `src/api.js`). El cliente axios (`api.js`) expone `getErrorMessage(e)`
  que **siempre** hay que usar en los `catch` — nunca `e.response?.data?.detail` directo, porque FastAPI
  devuelve `detail` como string en errores de negocio pero como **array de objetos** en errores de
  validación 422, y renderizar ese array directo en JSX rompe la página en blanco sin avisar.
- Confirmaciones destructivas (borrar producto/categoría/compra/movimiento) usan `window.confirm(...)`
  antes de llamar al DELETE — no hay modal custom para eso.
- Sin `localStorage`/`sessionStorage` en el frontend (no aplica acá porque no es un artifact de
  claude.ai, pero se mantuvo la convención de no usar storage del navegador de todos modos — todo el
  estado persistente vive en Postgres).

## Historial de decisiones de UX relevantes

- El primer diseño tenía "stock inicial" y "fecha de ingreso" como campos directos del producto. Se
  reemplazó por la tabla `compras` porque el negocio repone stock del mismo producto varias veces a
  distinto costo, y el modelo viejo no lo soportaba (un solo costo fijo por producto).
- El primer diseño de movimientos tenía tipo genérico "Ingreso/Egreso". Se agregó el tipo `"Venta"`
  específico porque el flujo real de la usuaria es: elegir categoría → producto → cantidad, con precio
  precargado del catálogo y monto auto-calculado (cantidad × precio, editable a mano para descuentos).
- Hubo un bug real de UX (no de lógica): los `catch` de errores en el frontend mostraban `undefined`
  cuando el error no tenía `response` (ej. el front apuntando a `localhost:8000` desde un navegador en
  otra máquina que la que corre Docker) — quedaba "silencioso" sin avisar nada. Se resolvió con
  `getErrorMessage()` en `api.js`. Si se agregan nuevas pantallas, replicar ese patrón.
- `docker-compose.yml` usa `VITE_API_URL: ${VITE_API_URL:-http://localhost:8000}` — si Docker corre en un
  server distinto de donde se abre el navegador (este es el caso real: VM Alpine sobre Hyper-V), hay que
  setear `VITE_API_URL` a la IP/dominio real del server en un archivo `.env` en la raíz del repo, si no
  el frontend intenta pegarle a `localhost` del lado del navegador y falla en silencio.

## Testing

No intentes verificación visual con navegador (chromium-cli, Playwright, Claude in Chrome, ni instalar
chromium/chromium-browser vía apk u otro gestor) bajo ninguna circunstancia. Este proyecto corre en una
VM Alpine headless sin entorno gráfico — no hay forma de que un navegador real ande ahí, y el intento
de instalarlo/usarlo solo quema tiempo y tokens sin resultado útil.

Para verificar cambios de backend: probá contra la API real con curl o scripts Python (como ya se viene
haciendo en todo este proyecto) — levantá el stack con docker compose, pegale a los endpoints, confirmá
las respuestas.

Para verificar cambios de frontend: no se puede confirmar visualmente en esta sesión. Asumí que el
build sin errores (`docker compose exec frontend ...` o el chequeo de compilación que ya hacés) es
suficiente para dar el cambio por terminado, y avisame explícitamente qué pantalla y qué flujo tengo
que probar yo a mano en mi navegador antes de dar el cambio por bueno.

## Ideas mencionadas pero no implementadas (posibles próximos pasos)

- Sugerencias de compra automáticas ("a este ritmo te quedás sin stock de Remeras en 15 días") — ya
  existe la base (`dias_cobertura`), falta un módulo de proyección de compra por categoría.
- Reportes Best/Worst Sellers semanales.
- Proyección de flujo de caja estacional (compra de invierno se financia con venta de verano, etc).
- Normalización de tildes en el matching de importación (ver "gap conocido" arriba).
- Columna `CodigoProducto` opcional en la planilla de importación, como fallback de búsqueda si el
  matching por nombre empieza a dar falsos duplicados.
