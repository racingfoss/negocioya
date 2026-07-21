# FashBalance — backend (FastAPI + SQLAlchemy + calculations.py)

Este archivo se carga junto con el `CLAUDE.md` de la raíz cuando se trabaja dentro de `backend/`. Tiene
el modelo de datos completo y todas las reglas de negocio — el detalle que no hace falta ver cuando se
está tocando solo `frontend/` o `ecommerce/`. Toda la lógica de negocio vive en `calculations.py`, los
routers son delgados (validan y llaman a `calculations`). Nombres de tablas, campos, funciones y
mensajes de error en español. Uso de `Decimal` para plata en los schemas Pydantic, convertido a `float`
en las respuestas de los endpoints "calculados" (`/dashboard/*`, `/stock/*`) porque no son operaciones
contables exactas, son reportes. Sin Alembic — ver la nota sobre `create_all()` en el `CLAUDE.md` de la
raíz, sección "Cómo correr en dev": cada campo nuevo en un modelo existente necesita un `ALTER TABLE`
manual.

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
  caja; además `variante_id` si el producto tiene variantes), `"Ingreso"` (otro ingreso sin producto),
  `"Egreso"` (gasto, puede atarse a un `costo_fijo_id`) o `"Devolucion"` (suma stock, resta caja — ver
  Fase D parte 1 más abajo). `fecha` es editable por la usuaria (default: momento actual), `concepto` es
  opcional. **`Movimiento.tipo` es `String(10)`** — `"Devolucion"` entra justo (10 caracteres); cualquier
  tipo nuevo que se agregue tiene que entrar en ese largo o requiere migrar la columna.
- **`costos_fijos`**: gastos operativos mensuales (alquiler, servicios, etc), usados en el punto de
  equilibrio.
- **`atributos` / `valores_atributo` / `producto_atributos` / `variantes` / `variante_valores`**: patrón
  Atributo + Valor + Variante (Shopify/VTEX) para talle/color/etc definidos por la usuaria. Ver sección
  "Variantes de producto" más abajo.
- **`configuracion`**: fila única (singleton) con los "números mágicos" de `calculations.py`, editable
  desde la pantalla ⚙️ Configuración del frontend. La tabla completa de campos está en el `CLAUDE.md` de
  la raíz (es dato operativo, no de modelo). `get_configuracion(db)` devuelve esa fila, creándola con
  los defaults la primera vez que se necesita.
- **`mix_snapshots`**: histórico de fotos periódicas del mix% real de facturación, para graficar su
  evolución. Ver sección "Snapshots del mix real" más abajo.
- **`producto_fotos`, `pedidos`/`pedido_items`, `reservas_stock`, `facturas`, `devoluciones`/
  `devolucion_items`**: tablas de las fases de e-commerce/facturación/reservas/devoluciones, cada una
  documentada en su sección más abajo.

## Decisiones de negocio importantes (no reinventar sin releer esto)

- **Punto de equilibrio ponderado**: `mix_pct` de cada producto es **% de la facturación** (no de
  unidades vendidas). `facturación_mínima = costos_fijos_totales / margen_ponderado`, y las unidades
  requeridas por producto se derivan de ahí, no al revés.
- **Punto de equilibrio ponderado — modo "real" vs "manual" del mix%**: `punto_equilibrio_ponderado(db,
  modo, dias)` soporta dos modos. **"real"** (default): el `mix_pct` de cada producto sale de
  `facturacion_por_producto(db, dias)` (mismo patrón de query que `unidades_vendidas_por_producto` pero
  sumando `monto` en vez de `cantidad` — función separada a propósito, no se tocó
  `unidades_vendidas_por_producto` porque la usan BCG/Stock/Sell-through) sobre la ventana de días
  elegida (7/30/90, default 30, mismo patrón que `matriz_bcg`). Un producto sin ventas en la ventana da 0%
  mix (no error). Si la facturación total de la ventana es 0, devuelve `{"error": ...}` en vez de dividir
  por cero, con sugerencia de ampliar la ventana o usar modo manual. **"manual"**: usa `producto.mix_pct`
  cargado a mano — sigue existiendo para productos nuevos sin historial de ventas y para simular
  escenarios. El banner de "el mix no suma 100%" solo tiene sentido en modo manual (en modo real siempre
  da ~100% por construcción). La respuesta incluye `modo` y `dias` usados.
- **Costo promedio ponderado (PPP)**: cada vez que se crea/edita/borra una `Compra`, se recalcula
  `producto.costo` como promedio ponderado de TODAS las compras de ese producto
  (`recalcular_costo_promedio`) — sin importar si el producto tiene variantes, agrega sin filtrar por
  `variante_id`, mismo camino para productos con y sin variantes.
- **Antigüedad de stock / rotación (regla de 90 días, configurable)**: se calcula con **FIFO** — se
  asume que se vende primero el lote más viejo, y `dias_en_stock` se mide desde la compra más vieja que
  todavía tiene unidades sin vender (`_fifo_dias_en_stock`). Alerta si supera `rotacion_alerta_dias`.
- **Días de cobertura / alerta de quedarse sin stock**: **Days-of-Cover**, no el modelo estadístico con
  desvío estándar (con pocas ventas por SKU el σ da ruido, no señal). Fórmula:
  `demanda_media_diaria = ventas últimos N días (config `demanda_ventana_dias`) / N` ·
  `dias_cobertura = stock_actual / demanda_media_diaria`. Colores: verde por encima de `stock_dias_verde`,
  rojo por debajo de `stock_dias_rojo`, ámbar en el medio. Además, `necesita_reponer` se activa si
  `dias_cobertura <= lead_time_dias (o `lead_time_default_dias`) + safety_days` — más preciso que el color
  genérico porque usa el lead time real de cada producto.
- **Matriz BCG**: cuadrantes por **mediana** de margen% y de volumen vendido (no percentiles fijos).
- **Motor vs Decoración (por categoría)**: se ordenan las categorías por margen generado (desc) y se
  acumula; son "Motor" las que, en ese orden, todavía no cubrieron el total de `costos_fijos_totales` del
  negocio. Si no hay costos fijos cargados, cae a Pareto (`motor_decoracion_pareto_pct`, default 80/20)
  como fallback. Esto está en `analisis_combinado()` — vista que combina BCG + contribución de margen en
  una sola pantalla (gráfico de burbujas: eje X volumen, eje Y margen%, tamaño de burbuja = margen
  generado en $).
- **Candidato a renegociación**: margen% < `renegociacion_margen_umbral_pct` (default 15) Y volumen >=
  percentil `renegociacion_percentil_volumen` (default 0.7) de todos los productos activos. Señala
  productos "Vaca" que convendría renegociar con el proveedor.
- **Cambio de costo al comprar stock — se dispara contra la ÚLTIMA COMPRA, no contra el promedio**: el
  aviso de "¿actualizamos `precio_venta`?" compara el `costo_unitario` de la Compra nueva contra el de la
  **última Compra registrada** de ese producto (`diferencia_vs_ultima_compra_pct`), no contra el costo
  promedio ponderado — con mucho stock acumulado a costo viejo, una compra nueva bastante más cara casi
  no mueve el promedio y el aviso no se disparaba aunque el costo de reposición hubiera saltado fuerte. El
  promedio ponderado sigue existiendo para TODO lo contable (punto de equilibrio, BCG, márgenes) y se
  sigue mostrando como dato informativo adicional (`diferencia_vs_promedio_pct`), pero ya no decide el
  umbral ni el precio sugerido. Umbral `umbral_cambio_costo_pct` (default ±2%, en `configuracion`) se
  evalúa sobre `diferencia_vs_ultima_compra_pct`. Si es la primera Compra del producto, esta diferencia es
  `None` y el aviso no se dispara. Mismo criterio replicado en la importación de Excel
  (`routers/importacion.py`, tabla `cambios_costo`). Endpoint `POST /compras/simular` calcula esto **sin
  escribir en la base**. El frontend sincroniza dos inputs (% y precio) — ver `frontend/CLAUDE.md`.
- **Markup editable en Catálogo**: `PUT` de producto recalcula `precio_venta = costo * (1 + pct/100)`
  cuando se edita el % de markup — el click-to-edit en la grilla es del lado del frontend, ver
  `frontend/CLAUDE.md`.

## Subcategorías (jerarquía en `categorias`)

- Adjacency list simple (`parent_id`) + recursión en Python en `calculations.py` (se descartó
  materialized path y nested sets: con el volumen de datos de un negocio unipersonal, la complejidad
  extra no se justifica).
- `validar_no_ciclo()` camina la cadena de ancestros antes de aceptar un cambio de `parent_id` y rechaza si
  la categoría terminaría siendo ancestro de sí misma. Se llama desde `PUT /categorias/{id}` (no hace
  falta en `POST` porque una categoría recién creada no puede ser ancestro de nada todavía).
  `GET /categorias/arbol` devuelve la estructura anidada para la vista de árbol del frontend.
- Los productos se siguen asociando a UNA categoría (la hoja), sin cambios en `productos.categoria_id`.
- **Rollup hacia arriba**: `stock_por_categoria`, `contribucion_por_categoria` y `analisis_combinado`
  (la parte de categorías) aceptan un parámetro `rollup: bool = False`. Internamente se agrupa por
  `categoria_id` (antes se agrupaba por nombre) y, en modo rollup, cada categoría acumula también lo de
  **todos sus descendientes** (se sube la cadena de ancestros por cada producto y se suma a cada nivel).
  Sin el flag, el comportamiento es idéntico al de nivel hoja exacto. Los endpoints correspondientes
  exponen `?rollup=true`.

## Variantes de producto (talle, color, u otros atributos definidos por la usuaria)

Patrón Atributo + Valor + Variante (igual que Shopify/VTEX), para no hardcodear "talle"/"color" como
columnas fijas. La lógica de UI que consume todo esto (Compras.jsx, Movimientos.jsx, Productos.jsx) está
documentada en `frontend/CLAUDE.md`.

- `atributos` (ej. "Talle") y `valores_atributo` (ej. "S"/"M"/"L") se definen una vez y se reutilizan entre
  productos, con CRUD propio en `routers/atributos.py`.
- `producto_atributos` (producto_id, atributo_id, `orden`) define qué atributos aplican a un producto
  puntual y en qué orden. El `orden` no es cosmético: el atributo con `orden=1` agrupa el stock en
  subtotales (ver árbol de stock más abajo).
- `variantes` (producto_id, activo) es la unidad real con stock. **No tiene columna de costo propia**:
  se descartó un costo promedio ponderado por variante apenas se probó en el catálogo real (el costo de
  una prenda no varía entre talles/colores, y mostrar costos distintos por variante fue confuso). El
  costo se trackea **solo a nivel producto** (`productos.costo`), compartido por todas sus variantes,
  igual que un producto sin variantes.
- `variante_valores` es la tabla puente que permite combinar N atributos por variante (no limitado a 2).
- `productos.tiene_variantes` (bool) separa los dos caminos por completo:
  - `False`: Compras y Movimientos van directo a `producto_id`, sin variante.
  - `True`: `POST /compras` y `POST /movimientos` (tipo Venta) **rechazan** con 400 si no viene
    `variante_id`, y validan que la variante pertenezca al producto indicado. El `variante_id` solo se usa
    para trackear stock, no para el costo.
- **Costo único por producto** (`recalcular_costo_promedio`): sin importar si el producto tiene
  variantes, `producto.costo` se recalcula siempre como el promedio ponderado de TODAS las compras del
  producto (sin filtrar por `variante_id`). El flujo de aviso de cambio de costo (`/compras/simular`,
  `umbral_cambio_costo_pct`) también se evalúa 100% a nivel producto, sin ninguna distinción por variante.
- **`stock_por_producto` y `stock_por_categoria` agregan por `producto_id`**, que siempre está poblado
  (con o sin variante), así que ya dan el total correcto sin necesidad de tocarlos por variantes.
- **`stock_por_variante(db, considerar_reservas=False)`**: mismo cálculo que `stock_por_producto` pero
  agrupado por `variante_id`. Ver "Reserva de stock" más abajo para el parámetro `considerar_reservas`.
- **`stock_por_producto_arbol()`** (expuesta en `GET /stock/productos/arbol`) arma el árbol de 3 niveles:
  Producto (total) → valor del atributo `orden=1` (subtotal) → variante individual (detalle, con el resto
  de sus atributos). Si el producto solo tiene un atributo configurado, el árbol queda de 2 niveles.
  Productos sin variantes devuelven la misma fila de siempre.
- **BCG/Contribución de margen NO bajan a nivel variante** (aclaración explícita del pedido original, no
  improvisar): `analisis_combinado` sigue 100% a nivel producto, una sola burbuja por producto con el
  agregado de todas sus variantes.
- La importación por Excel (`routers/importacion.py`) **sí soporta variantes** — ver sección
  "Importación de Excel" más abajo.
- **`GET /productos/{id}/variantes`** (`routers/productos.py`, `listar_variantes`) devuelve cada variante
  con su `stock_actual`, calculado con `calculations.stock_por_variante()` — lo consume tanto Compras.jsx
  como Movimientos.jsx del frontend (con criterios distintos de UI, ver `frontend/CLAUDE.md`). El backend
  no distingue: siempre devuelve el campo.
- **Tope de cantidad, validado en el backend**: `calculations.stock_disponible(db, producto_id,
  variante_id, excluir_sesion=None)` (mismo cálculo `total_comprado - total_vendido`, ver también
  "Reserva de stock" más abajo) es usado por `_validar()`/`validar_movimiento` para rechazar con 400
  cualquier Venta (`POST` o `PUT`) cuya `cantidad` supere el stock disponible. En el `PUT` (edición),
  recibe el `Movimiento` original y le sobresuma su `cantidad` vieja si el `producto_id`/`variante_id` no
  cambiaron, para no bloquear la edición de una Venta ya existente por su propia cantidad. La validación
  del frontend (inputs con `max`) es solo cosmética — la real es esta.
- **Alta de producto nuevo con variantes es atómica, en un solo paso**: `POST /productos/con-variantes`
  (`backend/app/routers/productos.py`) crea el producto, sus `producto_atributos` y sus `Variante` en una
  única transacción — si algo falla a mitad de camino no queda un producto a medio configurar. Reusa la
  misma lógica de validación que los endpoints de dos pasos usados por la edición
  (`POST /productos/{id}/atributos` y `POST /productos/{id}/variantes/generar`), refactorizada a los
  helpers privados `_set_atributos` y `_generar_variantes` (sin commit propio, el caller controla la
  transacción). **El camino de edición de un producto ya existente sigue siendo dos pasos** (guardar
  atributos, después generar variantes) — el producto ya existe, tiene sentido ahí.
- **Desactivar variantes (`tiene_variantes: true → false`) se bloquea con 400 si el producto ya tiene
  compras o ventas registradas** (`PUT /productos/{id}`) — para que no se pueda perder la trazabilidad de
  stock/costo por variante con un solo click sin vuelta atrás. Si no tiene compras ni ventas, el `PUT` sí
  se aplica y de paso limpia los `producto_atributos`/`Variante` huérfanos que hubiera configurados.

## Importación de Excel (`backend/app/routers/importacion.py`)

Consumida por una pantalla propia del frontend — ver nota corta en `frontend/CLAUDE.md`.

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
- Reutiliza el mismo umbral `umbral_cambio_costo_pct` de `calculations.py` para armar la tabla de
  `cambios_costo` que se aprueba fila por fila (o todas juntas) en el frontend.
- Devuelve siempre 4 secciones: `productos_creados`, `compras_registradas`, `cambios_costo`, `errores`.
- **Soporte de atributos/variantes en la planilla**: cualquier columna del encabezado que no sea una de
  las fijas se interpreta como un atributo (ej. "Talle", "Color"). Solo se reconocen atributos que **ya
  existen** en el sistema (tabla `atributos`) — si hay una columna que no matchea ningún atributo
  existente, **se cancela toda la importación con 400 antes de escribir nada**. El orden de las columnas
  de atributo en el encabezado define el `orden` de `producto_atributos` cuando se configura un producto
  por primera vez (la primera columna de atributo = `orden=1`).
  - Si una celda de una columna-atributo válida trae un valor que no existe como `valor_atributo` para
    ese atributo, **solo se saltea esa fila** (a `errores`) — no aborta el resto de la planilla.
  - **Producto nuevo con atributos completos en la fila**: se crea directamente con
    `tiene_variantes=True`, se configuran sus `producto_atributos`, se resuelve/crea la `Variante` y la
    compra inicial queda con `variante_id`.
  - **Producto YA existente con `tiene_variantes=False`** que recibe una fila con atributos: se activan
    las variantes **sobre la marcha** y se le suma stock a esa variante puntual. **Limitación aceptada**:
    las compras viejas de ese producto (previas a esta activación) quedan sin `variante_id` — no se
    reasignan retroactivamente. El stock total sigue sumando bien (agrega por `producto_id`), pero en el
    árbol de Stock por variante esas unidades viejas aparecen "sueltas".
  - **Producto YA existente con `tiene_variantes=True`**: la fila debe traer un valor para **todos** los
    atributos ya configurados de ese producto (si falta alguno → error de esa fila); columnas de
    atributo ajenas a su configuración se ignoran. Con los valores completos, se resuelve o crea la
    variante puntual (`calculations.resolver_o_crear_variante`, la misma función que usa
    `POST /productos/{id}/variantes/generar`) y la compra queda con `variante_id`.
  - Si el mismo producto nuevo aparece en más de una fila con un conjunto de atributos distinto al de su
    primera aparición, la segunda fila da error de fila — no se reconfiguran los atributos a mitad de la
    importación.
  - `recalcular_costo_promedio` no se modificó para esto: sigue operando 100% a nivel producto.
  - `productos_creados` y `compras_registradas` incluyen `variante_id` y `variante_descripcion` (ej.
    "M / Verde") cuando corresponde.
  - Endpoint hermano `GET /importacion/plantilla` genera un .xlsx de ejemplo **100% dinámico** con
    `openpyxl`: agrega una columna al header por cada `Atributo` que exista en el momento de la descarga,
    y completa 1-2 filas de ejemplo con valores reales ya cargados en `valores_atributo`.

## Configuración del negocio — endpoints (`configuracion`, singleton)

La tabla completa de campos (con sus defaults y qué controla cada uno) está en el `CLAUDE.md` de la
raíz, sección "Configuración del negocio" — es dato operativo que aplica a todo el proyecto, no solo al
backend. Acá va el detalle de implementación:

- `GET /configuracion` devuelve la fila (la crea si no existe); `PUT /configuracion` actualiza los campos
  que se manden (`exclude_unset`, así que se puede mandar solo el campo que cambia).
- **`GET /ecommerce/configuracion-tienda`** (`backend/app/routers/ecommerce.py`), con el mismo
  `X-API-Key` que los otros endpoints públicos de ese router, y un schema dedicado
  `schemas.ConfiguracionTiendaOut` (mismo criterio que `ProductoCatalogoOut`: garantiza por diseño que
  nunca se cuele otro campo de `configuracion` — umbrales de negocio, márgenes, percentiles — que no
  tienen por qué llegar a un servicio de cara al público). Expone `nombre_ecommerce`,
  `whatsapp_numero`, `instagram_url`, `facebook_url`, `email_contacto`. Lo consume `ecommerce/` — ver
  `ecommerce/CLAUDE.md` para el lado cliente (incluye un gotcha real de Next.js sobre dónde se puede leer
  esta info).

## Snapshots del mix real (`mix_snapshots`)

La parte de UI (`Dashboard.jsx`) está en `frontend/CLAUDE.md`.

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
  `snapshot_periodo_dias` (o si nunca se tomó ninguno), toma uno nuevo. Para un negocio unipersonal que
  abre la app todos los días, el atraso máximo real es de un día de uso, no semanas — no se justificaba
  la complejidad de un scheduler de verdad. Este mismo criterio "lazy sin scheduler" se repite en
  "Reserva de stock" más abajo (vencimiento de reservas) — es un patrón deliberado del proyecto.
- El `BackgroundTask` abre su propia sesión de base (`SessionLocal()` en `routers/dashboard.py`) en vez de
  reusar la del request, porque para cuando corre el background task la sesión del request ya se cerró.
- `POST /mix-snapshots/tomar` fuerza un snapshot ahora mismo, sin importar si "tocaba" según el período
  configurado.
- `GET /mix-snapshots?producto_id=&categoria=` devuelve el historial ordenado por fecha, opcionalmente
  filtrado.
- Un producto activo sin facturación en la ventana simplemente no genera fila ese día.
- **El frontend agrupa las filas por el timestamp exacto de cada tanda** (todas las filas de una misma
  "tomada" comparten el mismo `fecha` al milisegundo, ver `tomar_snapshot_mix`), nunca por día truncado
  — detalle completo de por qué en `frontend/CLAUDE.md`.

## E-commerce (Fase 0 — base para el storefront consumidor)

La pantalla de administración de este momento (`OrdenesEcommerce.jsx`) se reemplazó después por
`Pedidos.jsx` en la Fase B — ver `frontend/CLAUDE.md`.

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
  decodifica la imagen (no hay Pillow en el proyecto). `DELETE /productos/{id}/fotos/{foto_id}` borra la
  fila y recién después el archivo en disco. `PUT /productos/{id}/fotos/orden` recibe la lista completa
  de IDs en el nuevo orden y reasigna `orden` 1..N.
- **Autenticación de los endpoints públicos**: header `X-API-Key` contra la env var
  `ECOMMERCE_API_KEY` (en `.env`, nunca en la base). Dependency reusable en `backend/app/auth.py`
  (`require_ecommerce_api_key`, usa `APIKeyHeader` en vez de `Header()` a mano para que Swagger en
  `/docs` muestre el candado). Los endpoints internos del panel (`GET /pedidos`, etc.) quedan sin este
  chequeo, como el resto del panel.
- **Único camino de alta de una Venta**: `calculations.validar_movimiento()` y
  `calculations.registrar_venta()` — lo usan tanto `POST /movimientos` como cada línea de
  `POST /ecommerce/ordenes` (y `POST /pedidos` de Fase B). `validar_movimiento` (junto con
  `facturacion.py`, ver Fase C más abajo) son las **únicas dos** funciones del proyecto que lanzan
  `HTTPException` directo — el resto de `calculations.py` calcula y deja que el router decida el código
  de error (excepción deliberada a "los routers validan, calculations calcula": se aceptó porque varios
  routers necesitan exactamente la misma regla de negocio). El ajuste de "sumar la cantidad vieja al
  editar" sigue siendo exclusivo del `PUT /movimientos` (vía el parámetro `actual`) — un alta nunca lo
  necesita.
- **Reuso del árbol de variantes en el catálogo**: `routers/productos.py` separa el cuerpo de
  `listar_variantes` en un helper `_formatear_variantes(db, producto_id, stock_por_id)` que recibe el mapa
  de stock ya calculado. `GET /ecommerce/catalogo` calcula `stock_por_variante(db)` **una sola vez** para
  todo el catálogo y llama ese helper por cada producto con variantes. Una variante se informa igual
  aunque tenga stock 0 (no se filtra en el backend).
- **`GET /ecommerce/catalogo`**: solo productos `activo=True` y `visible_ecommerce=True`. Usa un schema
  dedicado (`schemas.ProductoCatalogoOut`, no reusa `schemas.Producto`) para garantizar por diseño que
  `costo`, `mix_pct`, `lead_time_dias` y cualquier otro dato interno nunca se expongan.
- **`POST /ecommerce/ordenes`**: valida CADA línea (producto activo+visible, variante corresponde si
  aplica, stock suficiente vía `calculations.stock_disponible`) ANTES de escribir nada; si cualquiera
  falla, devuelve `400` con el detalle de esa línea y no crea nada — ni la orden, ni el movimiento, ni
  toca el stock (mismo criterio atómico que la Importación de Excel y el alta de producto con variantes).
  Con todo validado, crea en una única transacción la `OrdenEcommerce` (hoy `Pedido`, ver Fase B), un
  ítem por línea (con `precio_unitario` guardado como valor propio, no como referencia al producto —
  mismo criterio de denormalización deliberada que `MixSnapshot`) y el `Movimiento` Venta vía
  `registrar_venta()`.
- **Qué NO hace esta fase**: no hay medios de pago, no hay cálculo de envío real (`forma_entrega` es texto
  fijo sin lógica detrás).
- **Migraciones ya aplicadas**: 2 columnas agregadas a `productos` (`visible_ecommerce`,
  `descripcion_ecommerce`, `ALTER TABLE` manual) y 3 tablas nuevas (`producto_fotos`,
  `ordenes_ecommerce`, `orden_ecommerce_items` — hoy renombradas a `pedidos`/`pedido_items`, ver Fase B),
  que se crearon solas.

## Storefront público (Fase 1) — endpoints consumidos por `ecommerce/`

El resto del detalle de esta fase (arquitectura Next.js, env vars, TypeScript, docker) está en
`ecommerce/CLAUDE.md` — acá solo lo que se implementó en el backend.

- **`GET /ecommerce/catalogo/{producto_id}`** (`backend/app/routers/ecommerce.py`): mismo criterio de
  visibilidad que el listado (404 si no existe, no está `activo`, o no está `visible_ecommerce` — sin
  distinguir el motivo, para no filtrar por inferencia que un producto existe pero está oculto). El
  armado del dict de respuesta se extrajo a un helper `_producto_a_catalogo_dict` (reusado por ambos
  endpoints), mismo criterio que `_formatear_variantes` en `productos.py`. Sigue usando
  `stock_por_variante(db)` (todas las variantes del sistema) en vez de escribir una función acotada a un
  producto — no hay volumen que lo justifique.

## Carrito y checkout (Fase 2) — cambios de backend

El resto de esta fase (carrito, checkout, Server Actions) es 100% `ecommerce/` — ver
`ecommerce/CLAUDE.md`. El único cambio de este lado:

- **`metodo_pago_preferido`** (columna nueva en `OrdenEcommerce`/hoy `Pedido`, nullable): qué opción
  visual tildó el cliente en el checkout — puramente informativo, no dispara ninguna lógica de pago real.
  `ALTER TABLE` manual (columna agregada a tabla existente). Se agregó a
  `OrdenEcommerceCreate`/`OrdenEcommerceOut` (hoy `PedidoCreate`/`PedidoOut`).
- **`email_contacto` en `configuracion`** (columna nullable, sin default, `ALTER TABLE` manual, expuesta
  vía `GET /ecommerce/configuracion-tienda`): destino del `mailto:` del formulario de Contacto del
  storefront.
- `POST /ecommerce/ordenes` no se tocó — ya estaba bien para este caso de uso.

## Facturación electrónica (Fase A — integración ARCA)

Primer paso hacia facturación electrónica real: autenticarse contra ARCA (WSAA) y pedir un CAE real
para Factura C (WSFEv1) contra homologación. **Esta fase es 100% integración técnica aislada** — no
toca `Pedido`, Caja, ni ninguna pantalla de facturación. Todavía no hay ningún camino que convierta una
Orden/Venta real en una Factura en esta fase — eso llega en la Fase C.

- **Contexto de negocio**: Florencia es monotributista, emite Factura C. WSFEv1 es el servicio más
  simple de ARCA para este caso porque **no lleva desglose de IVA** (prohibido informarlo para tipo
  C — mandar el array `<Iva>` lo rechaza) y **no lleva detalle de ítem**: se factura el total de una
  operación, no producto por producto. No hace falta mapear líneas de un pedido a líneas de un
  comprobante, ni en ninguna fase futura mientras se siga facturando por Factura C.
- **Paquete aislado `backend/app/arca/`**: primer módulo del proyecto que no es ni router ni parte de
  `calculations.py` — es integración externa pura (SOAP contra ARCA). **No se importa desde `main.py`**,
  así que un problema de configuración acá (certificado faltante, CUIT no cargado) nunca puede romper el
  arranque del resto de la API.
  - `config.py`: constantes de entorno (`ARCA_ENTORNO`, `ARCA_CERT_PATH`, `ARCA_KEY_PATH`,
    `ARCA_CACHE_DIR`), estilo `os.getenv(...)` a nivel de módulo (no hay capa de `Settings` en
    FashBalance). Resuelve las URLs de WSAA/WSFEv1 según `ARCA_ENTORNO` (`testing` | `produccion`) sin
    ningún branch de lógica en el resto del código.
  - `wsaa.py`: arma la TRA (Ticket de Requerimiento de Acceso, pidiendo el servicio `"wsfe"`), la
    firma como CMS/PKCS#7 con `cryptography.hazmat.primitives.serialization.pkcs7`
    (`PKCS7SignatureBuilder`, sin `DetachedSignature` porque WSAA exige el contenido embebido —
    "nodetach"), y llama `loginCms` de WSAA vía `zeep`. El ticket (Token/Sign) dura 12hs reales y se
    cachea en disco (`{ARCA_CACHE_DIR}/ticket_{entorno}_{servicio}.json`, un JSON simple, no hace falta
    tabla en la base).
  - `wsfe.py`: cliente WSFEv1 acotado a lo que necesita Factura C — `FEDummy` (chequeo de conectividad,
    sin auth), `FECompUltimoAutorizado` (se llama siempre antes de pedir un CAE; ARCA es la fuente de
    verdad del número de comprobante, nunca se mantiene un contador propio en la base) y
    `FECAESolicitar`. Para Factura C (`CbteTipo=11`): `Concepto=1`, `CbteDesde=CbteHasta` (un solo
    comprobante por request, obligatorio para tipo C), `ImpTotConc=ImpOpEx=ImpIVA=ImpTrib=0`, `ImpNeto` =
    subtotal de la operación (no "neto gravado" como en Factura A/B), `ImpTotal = ImpNeto + ImpTrib`, sin
    la clave `Iva` en el dict en absoluto. **`CondicionIVAReceptorId`** (default `5` = Consumidor Final)
    es un campo que ARCA exige hoy en `FECAEDetRequest` y sin él rechaza el comprobante. `cuit`/`pto_vta`
    son parámetros explícitos de cada función, nunca constantes de módulo — el paquete `arca/` es
    agnóstico de la base de datos, quien resuelve esos valores desde `configuracion` es el caller
    (`facturacion.py`, ver Fase C).
  - **Gotcha real de zeep**: para elementos opcionales ausentes en la respuesta SOAP (ej. `Errors` cuando
    no hay errores, `Observaciones` cuando no hay observaciones), zeep no devuelve `None` al acceder al
    atributo — lanza `AttributeError`. Por eso `_interpretar_respuesta` usa `getattr(resultado, "Errors",
    None)` / `getattr(det, "Observaciones", None)` en vez de acceso directo. También el nombre del campo
    en `FECAEDetResponse` es **`Observaciones`** (no `Obs` — ese es el nombre del elemento *dentro* de
    `ArrayOfObs`).
  - `probar_conexion.py`: script de prueba manual, vive dentro de `arca/` para reusar el bind mount
    existente de `app/`. Se corre con `docker compose exec backend python -m app.arca.probar_conexion`.
    Corre los 5 pasos de esta fase (FEDummy, ticket WSAA, último autorizado, CAE real, caso de rechazo a
    propósito mandando `<Iva>` en una Factura C) contra el ambiente activo.
- **Certificados — bind mount de solo lectura, no named volume**: a diferencia de
  `fashbalance_fotos_data` (named volume que la app puebla en runtime), los certificados de ARCA los
  genera/renueva Florencia a mano (WSASS en testing, Administrador de Certificados Digitales en
  producción) — viven en `arca_certs/` en la raíz del repo (gitignored) y se montan de solo lectura:
  `./arca_certs:/app/arca_certs:ro` en `docker-compose.yml`. El cache de ticket WSAA sí necesita
  escritura, así que va en un named volume separado (`fashbalance_arca_cache:/app/arca_cache`) — nunca
  se mezcla estado runtime escribible con el mount de solo lectura de secretos.
- **Qué va en `.env` vs. qué va en `configuracion`/DB**: el CUIT, el punto de venta, la Razón Social y el
  Domicilio Fiscal viven en la tabla `configuracion` (`arca_cuit`, `arca_punto_venta_defecto`,
  `arca_razon_social`, `arca_domicilio_fiscal` — tabla completa en el `CLAUDE.md` de la raíz), editables
  desde ⚙️ Configuración sin acceso a la infraestructura del servidor. Solo lo que depende del
  filesystem/red del contenedor (`ARCA_ENTORNO`, rutas de certificado) sigue en `.env` — cambiarlas
  requiere reiniciar el contenedor de todos modos porque son archivos/URLs, no datos que Florencia deba
  poder tocar sin ayuda técnica. `arca_razon_social`/`arca_domicilio_fiscal` **no los usa
  `FECAESolicitar`** (WSFEv1 no los necesita) — los usa el comprobante impreso, ver Fase E más abajo.
- **Dependencias nuevas**: `zeep` (cliente SOAP, resuelve el WSDL de WSAA/WSFEv1 solo) y `cryptography`
  (firma CMS/PKCS#7). `lxml` no se agregó como dependencia directa — la TRA y la respuesta de `loginCms`
  se arman/parsean con `xml.etree.ElementTree` de la stdlib, `zeep` ya trae `lxml` transitivamente.
  `python:3.11-slim` resolvió wheels prearmadas para ambas sin necesitar `build-essential` — si algún día
  eso deja de ser cierto, ahí sí hay que agregar el `apt-get install` correspondiente, no antes.
- **Qué NO hace esta fase**: nada de CAEA (solo CAE). Ningún otro tipo de comprobante que Factura C (11),
  ni Nota de Débito/Crédito C (eso es Fase D parte 2). CUIT nunca hardcodeado en código — sale de
  `configuracion`.

## Fase B — Pedido unificado (canal e-commerce + local, Caja como carrito)

Unifica lo que hasta acá eran dos caminos de venta desconectados (`OrdenEcommerce`/`OrdenEcommerceItem`
del canal online, y un `Movimiento` tipo Venta suelto por cada carga en Caja) en un solo concepto
`Pedido`/`PedidoItem` que sirve a los dos canales. Esta fase NO conecta con ARCA (`backend/app/arca/`
queda intacto) ni implementa reversión/cancelación real de stock (`Cancelado` es un estado disponible en
el selector, sin efecto de devolución de stock hasta la Fase D). El storefront Next.js (`ecommerce/`) no
se tocó — ver la parte frontend (Movimientos.jsx / Pedidos.jsx) en `frontend/CLAUDE.md`.

- **Se renombró/extendió la tabla existente, no se creó una tabla nueva** (`OrdenEcommerce` →
  `Pedido`, `OrdenEcommerceItem` → `PedidoItem`, vía `ALTER TABLE ... RENAME` — ya aplicado, cero
  movimiento de datos, las órdenes viejas conservan su `id` y `movimiento_id`).
- **Campos nuevos en `Pedido`**: `canal` (`"ecommerce"` | `"local"`, sin default de columna — se setea
  explícito en cada router que crea un pedido). `facturar_arca` (bool): siempre `True` para
  `canal="ecommerce"` (`POST /ecommerce/ordenes` lo fija explícito, sin opción en el storefront), lo
  decide un checkbox en Caja para `canal="local"`. `cliente_nombre` y `forma_entrega` son nullable (no
  aplican igual a un pedido de mostrador).
- **Estados de logística** (`calculations.ESTADOS_PEDIDO_VALIDOS`): `Pendiente → Preparando → Listo para
  retirar / Enviado → Entregado`, más `Cancelado` como alternativa en cualquier punto antes de Entregado.
  "Listo para retirar" y "Enviado" son ambos valores válidos para cualquier pedido — no se acopla la
  validación de backend a `forma_entrega` (eso es del lado del frontend). No hay una función en
  `calculations.py` que valide el estado y lance `HTTPException` — el chequeo de `estado in
  ESTADOS_PEDIDO_VALIDOS` vive inline en el router `PUT /pedidos/{id}/estado`. **Default de estado según
  canal, no el mismo para los dos**: `canal="ecommerce"` arranca en `Pendiente`. `canal="local"` arranca
  directo en `Entregado` (la clienta se lo lleva puesto en el momento) — se puede cambiar a mano después
  si hiciera falta.
- **`backend/app/routers/ecommerce.py`**: `crear_orden` (`POST /ecommerce/ordenes`) sigue aceptando y
  devolviendo el mismo contrato JSON que antes (los campos nuevos son aditivos, el storefront solo lee
  `data.id` de la respuesta). Internamente crea un `models.Pedido(canal="ecommerce", facturar_arca=True,
  estado="Pendiente", ...)` explícito. **`GET /ecommerce/ordenes` se retiró** de este router (lo
  reemplazó `GET /pedidos`).
- **`backend/app/routers/pedidos.py`** (nuevo): `GET /pedidos` (todos los pedidos de ambos canales).
  `POST /pedidos` (alta de un pedido `canal="local"` desde Caja — mismo criterio de validación atómica
  por línea que `POST /ecommerce/ordenes`, reusando `calculations.stock_disponible` y
  `calculations.registrar_venta` tal cual, pero **sin** el chequeo de `visible_ecommerce` — una venta de
  mostrador puede vender un producto no publicado — ni de `forma_entrega`/`direccion_envio`).
  `PUT /pedidos/{id}/estado` (valida contra `ESTADOS_PEDIDO_VALIDOS`, 400 si no corresponde).
- **`monto_neto` en `PedidoOut`**: no es un atributo del ORM, así que `PedidoOut.model_validate(pedido)`
  sin completarlo a mano cae **silenciosamente** al default `Decimal("0")` (confirmado con prueba directa
  contra pydantic 2.9.2), sin error — por eso hay un helper `_pedido_out(db, pedido)` en
  `routers/pedidos.py` usado en los 3 endpoints que devuelven un Pedido (`listar`, `crear_local`,
  `cambiar_estado`), no solo en el listado. `POST /ecommerce/ordenes` tiene el mismo fix inline (no se
  comparte el helper entre routers, mismo criterio del proyecto de no compartir helpers privados entre
  routers). `monto_neto_pedido(db, pedido)` (Fase C) es la función que efectivamente lo calcula.
- **Migración SQL ya aplicada** (referencia, por si hace falta rehacerla en otro ambiente):
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
- **Qué NO se tocó**: `backend/app/arca/`, `ecommerce/` (storefront Next.js), la interfaz pública de
  `calculations.registrar_venta`/`validar_movimiento`/`stock_disponible` (se reusan sin cambiar firma).
  `Compras.jsx` (tiene su propia copia de la lógica de selectores, independiente de `Movimientos.jsx`).

## Reserva de stock (pedido en armado en Caja)

La parte de frontend (Movimientos.jsx: generación de `sesionId`, llamadas a estos endpoints,
reconstrucción del carrito) está en `frontend/CLAUDE.md`.

Mientras se arma un pedido tipo Venta con varias líneas en Caja, esas unidades tienen que dejar de estar
disponibles para cualquier otra venta (e-commerce u otro pedido local) mientras se termina de armar y
confirmar, sin bloquear el stock para siempre si el pedido nunca se confirma. Sin scheduler ni worker de
limpieza — mismo criterio "lazy" que los snapshots del mix real.

- **Tabla `reservas_stock`** (`models.ReservaStock`): `sesion_id` (string, UUID generado en el frontend
  al arrancar un pedido nuevo), `producto_id`, `variante_id` (nullable), `cantidad`, `creado_en`,
  `expira_en`, y 3 columnas denormalizadas (`nombre_producto`, `descripcion_variante`,
  `precio_unitario`). Sin relationships hacia `Producto`/`Variante` (mismo criterio minimalista que
  `MixSnapshot`).
- **`reserva_stock_minutos`** (config, default 20): TTL de una reserva. Tabla completa de config en el
  `CLAUDE.md` de la raíz.
- **Vencimiento 100% pasivo, sin borrado activo**: una reserva vence sola por tiempo. Cualquier cálculo
  de disponibilidad simplemente ignora las filas con `expira_en <= now()`
  (`calculations.stock_disponible` filtra `ReservaStock.expira_en > func.now()`, comparación hecha del
  lado de la base para no depender de que el reloj de la app y el de Postgres coincidan). El borrado
  físico de filas viejas es oportunista: `calculations.reservar_stock()`, cada vez que crea/actualiza una
  reserva, de paso borra las que vencieron hace más de un día. No hay cron ni `BackgroundTask`.
- **`stock_disponible` (extendida, no duplicada)**: ganó un parámetro `excluir_sesion: Optional[str] =
  None`, retrocompatible (los call sites existentes — `validar_movimiento`, `routers/pedidos.py`,
  `routers/ecommerce.py` — no lo pasan y automáticamente pasan a ser reservation-aware: cuentan TODAS las
  reservas activas de cualquier sesión). Además de lo que ya restaba (comprado - vendido), resta la suma
  de reservas activas del mismo producto/variante, excluyendo las de `excluir_sesion` si se pasa (para
  que una sesión no se vea bloqueada por sus propias reservas al querer agregar más del mismo producto).
- **`calculations.reservar_stock(db, sesion_id, producto_id, variante_id, cantidad)`**: valida contra
  `stock_disponible(..., excluir_sesion=sesion_id)`; si alcanza, crea o actualiza (upsert manual en
  Python — busca por `sesion_id`+`producto_id`+`variante_id`, mismo criterio que
  `resolver_o_crear_variante`, sin `UniqueConstraint` de Postgres porque `NULL` no colisiona en un UNIQUE
  compuesto) la fila con la `cantidad` nueva **reemplazando** el valor (no sumándolo) y `expira_en`
  renovado a `now() + reserva_stock_minutos`. Si no alcanza, lanza `ValueError` (no `HTTPException`) —
  mantiene el invariante de que `validar_movimiento` y `facturacion.py` son las únicas funciones que
  lanzan `HTTPException` directo; el router (`POST /reservas`) capta el `ValueError` y arma el 400. No
  hace `commit()` (solo `flush()`), el caller controla la transacción.
- **`calculations.liberar_reserva(db, sesion_id, producto_id=None, variante_id=None)`**: borra la reserva
  puntual si se pasan `producto_id`/`variante_id`, o todas las de esa `sesion_id` si no. Tampoco
  commitea.
- **Endpoints — `backend/app/routers/reservas.py`**: `POST /reservas` (`{sesion_id, producto_id,
  variante_id, cantidad}` → `reservar_stock`, 400 con el detalle si no alcanza), `DELETE /reservas`
  (query params `sesion_id` obligatorio + `producto_id`/`variante_id` opcionales → `liberar_reserva`), y
  `GET /reservas` (query param opcional `sesion_id`; sin filtrar devuelve TODAS las reservas activas —
  la usa el frontend para reconstruir el carrito al refrescar, ver `frontend/CLAUDE.md`).
- **`POST /pedidos` (`routers/pedidos.py`, `crear_local`) — gotcha real de orden de operaciones**: hay que
  llamar `liberar_reserva(db, payload.sesion_id)` como el PRIMER paso de la función, ANTES del loop de
  validación de líneas — sigue siendo la MISMA transacción sin commit intermedio (si cualquier línea
  falla después, todo se revierte junto), pero para el momento en que el resto del flujo valida stock
  (vía `registrar_venta` → `validar_movimiento` → `stock_disponible` **sin** `excluir_sesion`, esa función
  no cambió de firma pública), las reservas de esa sesión ya no existen y no se cuentan dos veces contra
  sí mismas. Si se libera después, una confirmación 100% legítima (cantidad == cantidad reservada) se
  rechaza con "no hay stock suficiente". `PedidoLocalCreate` tiene un campo `sesion_id: Optional[str] =
  None` para esto.

### Reconstrucción del carrito al refrescar (backend)

La fuente de verdad para "hay un pedido en armado" es `reservas_stock` — alcanza con poder reconstruir
el carrito visual del frontend a partir de esa tabla en vez de depender de un `sesionId` que solo vivía
en memoria (el panel tiene convención de no usar `localStorage`, ver `frontend/CLAUDE.md`).

- **Columnas denormalizadas en `ReservaStock`**: `nombre_producto`, `descripcion_variante`,
  `precio_unitario` (mismo criterio ya documentado para `PedidoItem`/`MixSnapshot`). Se completan en
  `calculations.reservar_stock()` — busca el `Producto` (nombre, precio_venta) y arma la descripción de
  variante con `descripcion_variante(db, variante_id)` tanto al crear como al actualizar la fila. Así
  `GET /reservas` alcanza para reconstruir el carrito sin round-trips extra a `/productos` ni
  `/productos/{id}/variantes`.
- **`calculations.descripcion_variante(db, variante_id)`**: arma el texto legible de una variante (ej.
  "M / Verde") a partir de sus valores de atributo ordenados por `ProductoAtributo.orden`. La usan
  `ReservaStock` y `routers/importacion.py` (2 call sites), sin duplicar la query.
- **`calculations.listar_reservas_activas(db, sesion_id=None)`**: reservas vigentes (`expira_en >
  now()`), opcionalmente acotadas a una sesión, más recientes primero.

### Catálogo de e-commerce reservation-aware

**`stock_por_producto(db, considerar_reservas: bool = False)` y `stock_por_variante(db,
considerar_reservas: bool = False)`**: nuevo parámetro opcional, retrocompatible. Con `False` (el
default, para TODOS los call sites que ya existían: pantalla de Stock, dashboard, BCG/
`analisis_combinado`) siguen mostrando stock físico puro — son para decisiones de reposición, no de venta
en el instante, una reserva momentánea de Caja no tiene por qué mover esos números. Con `True`, restan
además la suma de reservas activas de cada producto/variante — UNA sola query agregada (`group_by`) para
todo el catálogo de una vez, mismo criterio de performance que ya se cuidó al armar `stock_por_variante(db)`
una sola vez para todo el catálogo en la Fase 0.

`routers/ecommerce.py`: `catalogo()` y `catalogo_detalle()` pasan `considerar_reservas=True` en sus
llamadas a `stock_por_producto`/`stock_por_variante`. `crear_orden()` no se tocó — ya usaba
`stock_disponible` (reservation-aware desde el día 1 de esta feature), así que el checkout final del
storefront **nunca tuvo un problema de integridad de datos** — el gap real (ya corregido acá) era que el
catálogo (`GET /ecommerce/catalogo*`) todavía no avisaba de una reserva activa ANTES de llegar al
checkout. **Nada de `ecommerce/` se tocó** para este fix — confirmado por investigación de código antes
de implementar (todo el número de stock que usa el storefront sale directo de estos dos campos, sin
ningún cómputo propio de ese lado).

## Facturación electrónica (Fase C — conectar Pedido con ARCA)

Conecta el `Pedido` unificado (Fase B) con el cliente ARCA WSFEv1 ya probado en homologación (Fase A)
para pedir un CAE real y persistirlo. Alcance acotado a propósito: **solo** obtener y guardar el CAE.
Nada de comprobante imprimible ni código QR, y nada de Nota de Crédito (eso es Fase D parte 2). Siempre
se factura como Consumidor Final (`DocTipo=99`/`DocNro=0`), sin pedirle datos al comprador. La parte de
UI (`Pedidos.jsx`: botón Facturar, protección de doble click) está en `frontend/CLAUDE.md`.

- **Tabla nueva `facturas`** (`models.Factura`): `id`, `pedido_id` (FK, CASCADE), `tipo_comprobante`
  (default 11 = Factura C — campo propio, no hardcodeado en la query, porque una Nota de Crédito C
  usaría 13 en esta misma tabla, ver Fase D parte 2), `punto_venta` (snapshot de `configuracion` al
  momento de facturar, no una referencia viva), `numero_comprobante`, `cae`, `cae_vencimiento` (Date,
  parseado del string `YYYYMMDD` que manda ARCA), `fecha_emision`, `importe_total` (el monto realmente
  facturado, ver `monto_neto_pedido` más abajo), `doc_tipo`/`doc_nro` (Consumidor Final en esta fase),
  `estado` (`"Emitida"` | `"Error"`), `mensaje_error` (nullable — también guarda las observaciones de
  ARCA aunque haya salido aprobado, no solo errores reales), `created_at`. Un pedido puede tener más de
  una fila con el tiempo (intentos fallidos, y una Nota de Crédito) — no es una relación 1:1 forzada.
  Tabla nueva → se autocrea con `Base.metadata.create_all()`, sin `ALTER TABLE`.
- **`calculations.monto_neto_pedido(db, pedido)`**: resta de `Pedido.total`, vía join
  `DevolucionItem` → `PedidoItem` → `Devolucion` filtrado por `pedido_id`, `cantidad × precio_unitario`
  del `PedidoItem` original (ver Fase D parte 1). Recibe el objeto `Pedido` ya cargado (no un id) para no
  volver a consultarlo — se llama en loop desde `GET /pedidos`.
- **`backend/app/facturacion.py`** (nuevo, no adentro de `arca/`): orquesta entre `Pedido`/
  `Configuracion` y el paquete `arca/` de la Fase A — `arca/` sigue sin saber qué es un Pedido.
  `facturar_pedido(db, pedido_id)` valida en orden (404 si no existe el pedido; 400 si `facturar_arca` es
  `False`; 400 si `estado == "Cancelado"`; 400 si ya hay una `Factura` con `tipo_comprobante=11` y
  `estado="Emitida"` para este pedido; 400 si `monto_neto_pedido <= 0`; 400 si no hay `arca_cuit` cargado
  en Configuración), pide el CAE (`wsfe.fe_cae_solicitar` con `ImpNeto = monto_neto_pedido`, NO
  `Pedido.total` a secas, y con `doc_tipo`/`doc_nro` pasados explícitos) y persiste el resultado. En
  éxito crea la `Factura` con `estado="Emitida"` y el CAE/vencimiento/número reales. En rechazo de ARCA o
  error de conexión, crea igual una `Factura` con `estado="Error"` — **con commit inmediato**, antes de
  lanzar el `HTTPException` (así queda historial del intento fallido aunque el request termine en error;
  `get_db()` solo hace `close()` en el `finally`, sin rollback implícito, así que ese commit no se
  pierde). Es el único módulo del proyecto, además de `calculations.validar_movimiento`, que lanza
  `HTTPException` directo — `facturacion.py` funciona como un router grueso, no como una función de
  cálculo reusable.
- **`arca/wsfe.py`** (único archivo de la Fase A tocado en esta ronda, cambio aditivo): la rama aprobada
  de `_interpretar_respuesta` también devuelve `cbte_nro` (`det.CbteDesde`, el número real que ARCA
  asignó) — evita que `facturacion.py` tenga que llamar `fe_comp_ultimo_autorizado` una segunda vez solo
  para enterarse del número (esa función ya se llama, una sola vez, adentro de `fe_cae_solicitar`).
- **Endpoint `POST /pedidos/{id}/facturar`** (`routers/pedidos.py`): llama a
  `facturacion.facturar_pedido`, `response_model=schemas.FacturaOut`. Devuelve 400 si falló alguna
  validación previa, 502 si ARCA rechazó el comprobante o hubo un error de conexión.
- **Endpoints `def` sincrónicos, no `async def`**: FastAPI/Starlette los corre en un thread aparte del
  pool de workers automáticamente, así que mientras se factura un pedido (llamada SOAP real que puede
  tardar varios segundos) el resto del sistema (storefront incluido) sigue respondiendo normal — no hizo
  falta ningún cambio de concurrencia del lado del backend.

## Fase D, parte 1 — reversión de ventas (devoluciones y cancelaciones)

Permite revertir una Venta ya confirmada de un `Pedido`: cancelación (antes de entregar) o devolución
(después), con soporte de devolución **parcial por línea**. Esta ronda **no toca ARCA** — la Nota de
Crédito es Fase D parte 2. La parte de UI (`Pedidos.jsx`: panel de devolución) está en
`frontend/CLAUDE.md`.

- **Evento nuevo, nunca una edición retroactiva**: mismo criterio ya aplicado en todo el proyecto (nunca
  se edita un `Movimiento` de Venta para "corregir" algo después). Se modela con un `Movimiento` tipo
  `"Devolucion"` nuevo, espejo de `"Venta"`: donde `"Venta"` resta stock y suma caja, `"Devolucion"` suma
  stock y resta caja.
- **Modelo nuevo**: `Devolucion` (`pedido_id`, `fecha`, `motivo` nullable, `tipo` `"Cancelacion"` |
  `"Devolucion"` — solo para UI, la mecánica es idéntica) y `DevolucionItem` (`devolucion_id`,
  `pedido_item_id` FK al `PedidoItem` que se revierte, `cantidad`, `movimiento_id` FK al `Movimiento`
  "Devolucion" que generó — mismo patrón de trazabilidad que `PedidoItem.movimiento_id`). Dos tablas
  nuevas, autocreadas por `Base.metadata.create_all()`, sin `ALTER TABLE`.
- **Neteo contra `"Devolucion"` en las queries que agregan por tipo de Movimiento**, vía un helper nuevo
  `calculations._neto_venta_devolucion(columna)` (un `case()` de SQLAlchemy: Venta suma la columna,
  Devolucion la resta) reusado en 4 lugares: `unidades_vendidas_por_producto`,
  `unidades_vendidas_por_variante`, `facturacion_por_producto` (estas tres alimentan BCG, Análisis, Stock
  y el mix real del Punto de Equilibrio — una venta revertida ya no infla volumen ni facturación en esas
  pantallas) y `stock_disponible`. `stock_por_producto`/`stock_por_variante` no se tocaron directo — ya
  consumen las funciones de arriba, así que netean automáticamente. `get_caja_actual`: `"Devolucion"`
  resta de la caja, mismo lado que `"Egreso"`. `TIPOS_MOVIMIENTO_VALIDOS` ganó `"Devolucion"`.
  `validar_movimiento`/`registrar_venta` no cambiaron de comportamiento para `tipo="Venta"`.
- **`calculations.procesar_devolucion(db, pedido_id, items, motivo=None, tipo="Devolucion")`**: valida que
  cada `pedido_item_id` pertenezca a ese `pedido_id` y que la `cantidad` a devolver no supere
  `cantidad_original - ya_devuelto_antes` (sumando TODAS las devoluciones previas de esa misma línea).
  Si algo no cierra, **lanza `ValueError`** (no `HTTPException`) sin escribir nada — mismo patrón que
  `reservar_stock`/`liberar_reserva`, mantiene el invariante de que `validar_movimiento` y
  `facturacion.py` son las únicas dos funciones que lanzan `HTTPException` directo. Si todo valida, en
  una única transacción (con su propio commit): crea `Devolucion`, y por cada línea un `Movimiento` tipo
  `"Devolucion"` (`monto = cantidad × precio_unitario` **del `PedidoItem` original**, no el `precio_venta`
  actual del producto) + su `DevolucionItem`. Al final, si la suma de todo lo devuelto en la vida del
  pedido iguala la cantidad original de TODAS sus líneas, `Pedido.estado` pasa a `"Cancelado"` solo — sin
  agregar ningún estado nuevo tipo "parcialmente devuelto".
- **`PUT /pedidos/{id}/estado` no se tocó**: seguir permitiendo poner `"Cancelado"` a mano desde ahí sin
  reversión de stock/caja es el comportamiento ya existente — la única vía que dispara reversión real es
  el endpoint nuevo de abajo.
- **Endpoints** (`routers/pedidos.py`): `POST /pedidos/{id}/devoluciones` (404 si el pedido no existe, 400
  con el detalle si `procesar_devolucion` rechaza algo) y `GET /pedidos/{id}/devoluciones` (historial
  completo, más reciente primero).
- **`PedidoItemOut.variante_descripcion`** (nuevo, opcional): no es un atributo del ORM — se completa en
  `_pedido_out` con `calculations.descripcion_variante(db, item.variante_id)`.
- **Qué NO se tocó**: `backend/app/arca/`, `facturacion.py`, `Compras.jsx`, el storefront (`ecommerce/`),
  `reservas_stock`/`reservar_stock`/`liberar_reserva` (una devolución de un pedido ya confirmado no
  interactúa con reservas de un pedido en armado — son mecanismos independientes). Ningún estado nuevo de
  `Pedido` más allá de reusar `"Cancelado"`.
- **Probado end-to-end contra la API real**: devolución parcial de una línea (stock sube, caja baja,
  `GET /stock/productos` y el mix real de `GET /dashboard/punto-equilibrio?modo=real` reflejan el neto,
  no la venta bruta); intento de devolver más de lo disponible en una línea con una devolución parcial
  previa (rechazado con 400, sin escribir nada); devolución que completa el 100% de todas las líneas de
  un pedido (`Pedido.estado` pasa a `"Cancelado"` solo); cierre de punta a punta con Fase C (`GET
  /pedidos` de un pedido con devolución parcial ya procesada muestra `monto_neto` correcto).

## Fase D, parte 2 — Nota de Crédito C

Conecta la reversión de ventas (Fase D parte 1) con ARCA (Fase C): cuando una `Devolucion` corresponde a
un `Pedido` que ya tenía una Factura C emitida, el CAE real queda por un monto que ya no coincide con lo
efectivamente cobrado, sin forma de corregirlo ante ARCA. Manual, un botón "Emitir Nota de Crédito"
— igual que "Facturar", nunca se dispara solo al procesar la devolución (ver botón en
`frontend/CLAUDE.md`). Esta ronda no toca CAEA ni ningún otro tipo de comprobante fuera de Nota de
Crédito C (13).

- **Cuándo corresponde (y cuándo no)**: una `Devolucion` necesita Nota de Crédito si y solo si el
  `Pedido` tiene una `Factura` (`tipo_comprobante=11`, `estado="Emitida"`) cuyo `created_at` es
  **anterior** a la `fecha` de esa `Devolucion` (si la factura no existe, o se emitió DESPUÉS de la
  devolución, `facturar_pedido` ya cobró el neto correcto vía `monto_neto_pedido` y no corresponde nada),
  Y esa `Devolucion` todavía no tiene su propia Nota de Crédito emitida. Como la Fase C ya impide una
  segunda Factura C para el mismo pedido, en la práctica alcanza con la relación 1 devolución → 1 Nota de
  Crédito. **`calculations.devolucion_requiere_nota_credito(db, devolucion) -> bool`** encapsula
  exactamente esta regla — se usa tanto en la validación del endpoint como en lo que recibe el frontend
  (`DevolucionOut.requiere_nota_credito`) para decidir si mostrar el botón, sin duplicar la regla ahí.
  **`calculations.monto_devolucion(db, devolucion) -> Decimal`** suma `cantidad × precio_unitario` (del
  `PedidoItem` original) de cada `DevolucionItem` de ESA devolución puntual — a diferencia de
  `monto_neto_pedido`, que calcula el neto acumulado de todo el pedido, no sirve para el monto de una
  devolución individual. Ambas constantes de tipo de comprobante (`TIPO_COMPROBANTE_FACTURA_C = 11`,
  `TIPO_COMPROBANTE_NOTA_CREDITO_C = 13`) están duplicadas como literales locales en `calculations.py`
  (además de las ya existentes en `facturacion.py`) a propósito: `facturacion.py` ya importa
  `calculations.py`, así que importarlas al revés generaría un ciclo — mismo criterio de no compartir
  constantes/helpers chicos entre módulos que ya usa el proyecto (`_pedido_out` duplicado entre
  `routers/pedidos.py` y `routers/ecommerce.py`).
- **`models.Factura` — dos columnas nuevas** (`ALTER TABLE` manual, tabla ya existente):
  `devolucion_id` (FK a `devoluciones.id`) y `factura_original_id` (FK a `facturas.id`,
  autorreferencial) — las dos se completan SOLO en filas `tipo_comprobante=13`. `devolucion_id`
  identifica a qué devolución corresponde la Nota de Crédito; `factura_original_id` apunta a la Factura C
  que se está acreditando (necesario para armar `CbtesAsoc` contra ARCA). Sin relationships nuevas —
  mismo criterio minimalista que `ReservaStock`.
- **`arca/wsfe.py::fe_cae_solicitar` — extendida, no duplicada**: gana un parámetro opcional
  `cbtes_asoc: list[dict] | None = None`; cuando se pasa, arma `detalle["CbtesAsoc"] = {"CbteAsoc":
  cbtes_asoc}`, cada dict con las claves `"Tipo"`, `"PtoVta"`, `"Nro"` (mismos nombres de campo que ya usa
  `detalle` para hablarle a ARCA). `fe_comp_ultimo_autorizado` ya recibía `cbte_tipo` como parámetro
  simple, así que la numeración de la Nota de Crédito (secuencia independiente de la de Factura C en
  ARCA) sale bien sin ningún cambio ahí. **Signo de los importes: `ImpNeto`/`ImpTotal` se informan en
  positivo, igual que en una Factura** — es el `cbte_tipo` (13) el que le indica a ARCA que es una nota
  de crédito, no el signo del importe (confirmado contra los ejemplos oficiales de FECAESolicitar para
  Nota de Crédito C y contra homologación real con `FECompConsultar`).
- **`backend/app/facturacion.py`**: se extrajo un helper privado compartido
  `_solicitar_cae_y_persistir(db, *, pedido_id, tipo_comprobante, monto, cuit, pto_vta, cbtes_asoc=None,
  devolucion_id=None, factura_original_id=None)` que encapsula "llamar a `wsfe.fe_cae_solicitar`,
  interpretar la respuesta, persistir la `Factura` (Emitida o Error, con commit)" — usado tanto por
  `facturar_pedido` como por `emitir_nota_credito(db, devolucion_id)`. Esta última: 404 si la
  `Devolucion` no existe; 400 (con el motivo específico) si `devolucion_requiere_nota_credito` da
  `False`; calcula `monto = calculations.monto_devolucion(...)`; valida `arca_cuit` de Configuración;
  ubica la Factura C original con el helper `_factura_original_de` (mismo filtro que la regla de
  elegibilidad) para armar `cbtes_asoc` con sus datos reales; llama al helper compartido con
  `tipo_comprobante=13`.
- **Endpoint**: `POST /pedidos/{pedido_id}/devoluciones/{devolucion_id}/nota-credito`
  (`routers/pedidos.py`, `response_model=schemas.FacturaOut`), delega en `facturacion.emitir_nota_credito`
  — `pedido_id` en la ruta es solo por el anidamiento consistente, la validación real es contra
  `devolucion_id`. Helper `_devolucion_out(db, devolucion)` (mismo criterio que `_pedido_out` con
  `monto_neto`) completa `DevolucionOut.requiere_nota_credito` y `DevolucionOut.nota_credito`.
- **Qué NO se tocó**: `reservas_stock`, `Compras.jsx`, el storefront (`ecommerce/`). Nada de CAEA. Ningún
  estado nuevo de `Pedido`. Sigue siendo un botón manual, igual que "Facturar".
- **Probado end-to-end contra ARCA real (homologación)**: pedido facturado de verdad (Factura C, CAE
  real) con una devolución parcial posterior → Nota de Crédito emitida con CAE real, confirmado con
  `FECompConsultar` que `CbtesAsoc` referencia exactamente la Factura original y que los importes viajan
  en positivo. Reintento de una segunda Nota de Crédito para la misma devolución → rechazado con 400.
  Devolución procesada ANTES de facturar el pedido → intento de Nota de Crédito rechazado con 400 y el
  motivo correcto, mismo resultado para una devolución de un pedido que nunca se facturó.

## Fase E — PDF de Factura/Nota de Crédito con código QR (ARCA)

Conecta la Fase C (Factura C) y la Fase D parte 2 (Nota de Crédito C) con un comprobante imprimible
real: PDF con los datos exigidos por RG 1415 + código QR según RG 4892 de ARCA. Hasta acá `facturas`
solo guardaba el CAE — no existía ningún artefacto imprimible. Puramente aditiva: solo **lee** `Factura`
ya emitida, no toca el flujo de emisión (`facturacion.py`, `arca/wsfe.py`/`wsaa.py`). Antes de escribir
código de `reportlab` se armó y aprobó con la usuaria un mockup ASCII del layout completo (uno para
Factura C, uno para Nota de Crédito C) — el layout implementado es ese, sin iterar a ciegas.

- **`backend/app/arca/qr.py`** (nuevo): módulo puro, sin acceso a DB — mismo criterio de aislamiento que
  `wsaa.py`/`wsfe.py` (`arca/` sigue sin saber qué es un Pedido/Factura). `construir_url_qr(*,
  fecha_emision, cuit, punto_venta, tipo_comprobante, numero_comprobante, importe_total, doc_tipo,
  doc_nro, cae) -> str` arma `https://www.arca.gob.ar/fe/qr/?p={JSON en Base64}` exactamente según la
  especificación (campos `ver=1, fecha, cuit, ptoVta, tipoCmp, nroCmp, importe, moneda="PES", ctz=1,
  tipoDocRec, nroDocRec, tipoCodAut="E", codAut`). Solo `json`/`base64` de stdlib — no importa `qrcode`
  acá a propósito, eso es responsabilidad de la capa de presentación.
- **`backend/app/facturas_pdf.py`** (nuevo, mismo nivel que `facturacion.py`, no adentro de `arca/`):
  `generar_pdf_factura(db, factura) -> bytes`. **Lanza `ValueError`** (no `HTTPException`) — sigue el
  criterio de `calculations.py`, no se suma a las dos únicas excepciones documentadas del proyecto que
  lanzan `HTTPException` directo (`calculations.validar_movimiento` y `facturacion.py`); el router
  traduce el `ValueError` a 400. Valida en orden: `factura.estado == "Emitida"` (no se imprime un
  intento fallido); `Configuracion.arca_razon_social`/`arca_domicilio_fiscal` cargados (sin sentido
  emitir un comprobante legalmente incompleto). Arma la URL del QR con `arca.qr.construir_url_qr(...)` y
  la renderiza a PNG con `qrcode.make(...)` en un `BytesIO`; arma el PDF con `reportlab.platypus`
  (`SimpleDocTemplate` + `Table`/`Paragraph`/`Image`, A4). Contenido según `tipo_comprobante`: **11
  (Factura C)** — ítems de `factura.pedido.items` (usa `calculations.descripcion_variante` para
  variantes, precio unitario y subtotal del `PedidoItem` denormalizado, no del producto actual). **13
  (Nota de Crédito C)** — ítems de `factura.devolucion.items` (`DevolucionItem`, join a su `PedidoItem`
  original vía la relationship `pedido_item`; la cantidad sale de `DevolucionItem.cantidad`, que puede
  ser menor a la original si la devolución fue parcial) más una línea "Comprobante que rectifica: Factura
  C {pv:04d}-{nro:08d}" leyendo `factura.factura_original_id`. `Factura` no tiene relationships hacia
  `devolucion`/`factura_original` (criterio minimalista ya documentado en Fase D parte 2), así que se
  resuelven con `db.get(models.Devolucion, factura.devolucion_id)` /
  `db.get(models.Factura, factura.factura_original_id)` explícitos. En ningún caso se discrimina IVA
  (leyenda fija "Responsable Monotributo — IVA no discriminado", igual que WSFEv1). Formato de moneda
  es-AR armado a mano (`_money`, punto de miles/coma decimal) — no hay ninguna librería de formato de
  moneda en el proyecto.
- **`GET /pedidos/{pedido_id}/facturas/{factura_id}/pdf`** (`routers/pedidos.py`): 404 si el pedido no
  existe o la `Factura` no existe/no pertenece a ese `pedido_id`; `try/except ValueError as e: raise
  HTTPException(400, str(e))` alrededor de `facturas_pdf.generar_pdf_factura` (mismo patrón que
  `crear_devolucion`); en éxito, `Response(content=pdf_bytes, media_type="application/pdf",
  headers={"Content-Disposition": 'inline; filename="..."'})` — `inline` a propósito para que abra en una
  pestaña nueva en vez de forzar descarga. Se genera al vuelo en cada request, sin persistir nada en
  disco — mismo criterio que `GET /importacion/plantilla`.
- **`models.Configuracion` — dos columnas nuevas** (`ALTER TABLE` manual, tabla ya existente):
  `arca_condicion_iva` (`String(50)`, default `"RESPONSABLE MONOTRIBUTO"`) y `arca_inicio_actividades`
  (`Date`, nullable — si no está cargada, esa línea se omite del PDF sin romperlo). Reflejadas en
  `ConfiguracionBase`/`ConfiguracionUpdate` (`schemas.py`). Tabla completa de campos de `configuracion`
  en el `CLAUDE.md` de la raíz.
- **Dependencias nuevas**: `reportlab` (armado del PDF) y `qrcode[pil]` (PNG del QR, usa Pillow como
  backend de imagen). `python:3.11-slim` resolvió wheels prearmadas para ambas sin necesitar
  `build-essential` — mismo chequeo ya hecho con `zeep`/`cryptography` en la Fase A.
- **Probado end-to-end contra la API real** (pedidos ya facturados en homologación): PDF de Factura C y
  de Nota de Crédito C descargados y validados como PDF real (magic bytes `%PDF-1.4`…`%%EOF`, texto
  extraído confirma emisor/CAE/ítems/total, y en la Nota de Crédito la línea "Comprobante que rectifica"
  con el número correcto de la Factura C original); QR decodificado a mano confirma el JSON exacto del
  spec, y escaneado con un lector real de celular resuelve contra `arca.gob.ar`. Casos de error
  confirmados: `Factura` con `estado="Error"` → 400; pedido inexistente → 404; `factura_id` que no
  pertenece al `pedido_id` de la ruta → 404; `Configuracion` con `arca_domicilio_fiscal` vacío → 400 con
  el mensaje pidiendo completar ⚙️ Configuración.
- **Qué NO se tocó**: `ecommerce/` (storefront), `backend/app/arca/wsfe.py`/`wsaa.py`, `facturacion.py`
  (solo se lee `Factura`, no se modifica el flujo de emisión), `reservas_stock`, `Compras.jsx`. Nada de
  envío por email/WhatsApp ni persistencia del PDF en disco — explícitamente fuera de alcance de esta
  fase.

## Convenciones de código (backend)

Nombres de tablas, campos, funciones y mensajes de error en español. Sin Alembic (ver nota de
migraciones al principio de este archivo). Toda la lógica de negocio vive en `calculations.py`, los
routers son delgados (validan y llaman a `calculations`). Uso de `Decimal` para plata en los schemas
Pydantic, convertido a `float` en las respuestas de los endpoints "calculados" (`/dashboard/*`,
`/stock/*`) porque no son operaciones contables exactas, son reportes.
