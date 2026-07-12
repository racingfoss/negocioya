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

`GET /configuracion` devuelve la fila (la crea si no existe); `PUT /configuracion` actualiza los campos
que se manden (`exclude_unset`, así que se puede mandar solo el campo que cambia).

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
