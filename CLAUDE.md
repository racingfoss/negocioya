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

- **`categorias`**: definidas 100% por la usuaria, nunca hardcodeadas. CRUD simple.
- **`productos`**: ficha maestra de cada prenda, se carga **una sola vez**. Campos: `nombre`, `codigo`
  (SKU opcional, no obligatorio, no se usa para importar), `categoria_id`, `precio_venta`, `costo`
  (**calculado**, no se edita a mano salvo carga inicial en 0), `mix_pct`, `lead_time_dias` (opcional,
  plazo de reposición del proveedor, default 7 si no se carga), `activo`.
- **`compras`**: cada reposición de stock de un producto. `producto_id`, `fecha`, `cantidad`,
  `costo_unitario`, `proveedor` (texto libre). El stock y el costo promedio del producto se derivan de
  acá, nunca se cargan directo.
- **`movimientos`**: caja. `tipo` es `"Venta"` (siempre con `producto_id` y `cantidad`, resta stock, suma
  caja), `"Ingreso"` (otro ingreso sin producto) o `"Egreso"` (gasto, puede atarse a un `costo_fijo_id`).
  `fecha` es editable por la usuaria (default: momento actual), `concepto` es opcional.
- **`costos_fijos`**: gastos operativos mensuales (alquiler, servicios, etc), usados en el punto de
  equilibrio.

## Decisiones de negocio importantes (no reinventar sin releer esto)

Todas están en `backend/app/calculations.py`, con comentarios explicando el razonamiento. Resumen:

- **Punto de equilibrio ponderado**: `mix_pct` de cada producto es **% de la facturación** (no de
  unidades vendidas). `facturación_mínima = costos_fijos_totales / margen_ponderado`, y las unidades
  requeridas por producto se derivan de ahí, no al revés.
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
- **Cambio de costo al comprar stock**: si una `Compra` nueva mueve el costo promedio ponderado más de
  **±2%** (`UMBRAL_CAMBIO_COSTO_PCT` en `calculations.py`), el sistema ofrece actualizar `precio_venta` en
  la misma proporción. Hay un endpoint `POST /compras/simular` que calcula esto **sin escribir en la
  base**, para mostrar el aviso antes de confirmar. El front sincroniza dos inputs (% y precio) — cambiar
  uno recalcula el otro.
- **Markup editable en Catálogo**: en la tabla de productos se puede click-editar el % de markup sobre
  costo, y al confirmar recalcula `precio_venta = costo * (1 + pct/100)`.

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
  Endpoint hermano `GET /importacion/plantilla` genera un .xlsx de ejemplo on-the-fly con `openpyxl`.

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

## Ideas mencionadas pero no implementadas (posibles próximos pasos)

- Sugerencias de compra automáticas ("a este ritmo te quedás sin stock de Remeras en 15 días") — ya
  existe la base (`dias_cobertura`), falta un módulo de proyección de compra por categoría.
- Reportes Best/Worst Sellers semanales.
- Proyección de flujo de caja estacional (compra de invierno se financia con venta de verano, etc).
- Normalización de tildes en el matching de importación (ver "gap conocido" arriba).
- Columna `CodigoProducto` opcional en la planilla de importación, como fallback de búsqueda si el
  matching por nombre empieza a dar falsos duplicados.
