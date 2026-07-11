Vamos a mejorar el Punto de Equilibrio Ponderado para que el mix% no
dependa siempre de lo que se carga a mano en el Catálogo.

## El problema

Hoy `punto_equilibrio_ponderado()` usa siempre `producto.mix_pct`, un valor cargado manualmente por
producto. Eso está bien para un producto nuevo sin historial, pero una vez que hay ventas reales
cargadas, mantenerlo a mano es una carga extra y se desactualiza (nadie lo va a estar recalculando y
recargando a mano cada semana). Lo que realmente hace falta es que el mix salga solo de las ventas
reales, y que el manual quede como respaldo para cuando no hay historial todavía.

## Diseño: dos modos

- **Modo "real"** (default): el mix% de cada producto se calcula como
  `facturación_del_producto_en_la_ventana / facturación_total_de_la_ventana × 100`, usando los
  `Movimiento` tipo `"Venta"` de los últimos N días (mismo patrón de ventana que ya usa `matriz_bcg` —
  reusalo, con opciones 7/30/90 días, default 30). Un producto sin ventas en la ventana da 0% (no error,
  simplemente no pesa en el cálculo — es correcto, si no se vendió no debería influir).
- **Modo "manual"**: el comportamiento actual, usa `producto.mix_pct` tal cual está cargado en el
  Catálogo. Se mantiene sin cambios — sigue siendo necesario para productos nuevos sin historial de
  ventas, o para simular escenarios ("¿y si este producto vendiera más?").

## Backend (`calculations.py`)

- Agregar una función nueva `facturacion_por_producto(db, dias)` — mismo patrón de query que
  `unidades_vendidas_por_producto` (que ya existe y filtra por `tipo == "Venta"`), pero sumando `monto`
  en vez de `cantidad`. NO modifiques la firma ni el tipo de retorno de `unidades_vendidas_por_producto`
  — la usan BCG, Stock y Sell-through, y no quiero arriesgar romper eso. Función nueva y separada, aunque
  comparta casi toda la lógica de la query.
- `punto_equilibrio_ponderado()` pasa a recibir `modo: str = "real"` y `dias: int = 30`:
  - Si `modo == "real"`: calcular `mix_pct` de cada producto activo con `facturacion_por_producto`. Si la
    facturación total de la ventana da 0 (no hay ventas registradas en esos días), devolver el mismo tipo
    de `{"error": "..."}` que ya se usa en otros casos (ej. "No hay ventas registradas en los últimos {N}
    días. Probá con una ventana más amplia o usá el modo manual."). El resto del cálculo (margen
    ponderado, facturación mínima, unidades requeridas por producto) sigue exactamente igual que hoy,
    solo cambia de dónde sale el `mix_pct` de cada producto.
  - Si `modo == "manual"`: comportamiento actual, sin cambios.
  - Devolver en la respuesta qué modo y qué ventana de días se usó, para que el frontend lo muestre.
  - El chequeo de "el mix no suma 100%" (`mix_total_pct`) seguí calculándolo en los dos modos (es
    inofensivo), pero en modo real va a dar ~100% siempre por construcción — eso lo maneja el frontend,
    no hace falta lógica especial acá.

## Backend (router `dashboard.py`)

- `GET /dashboard/punto-equilibrio` pasa a aceptar `modo` (default `"real"`) y `dias` (default `30`) como
  query params.

## Frontend (`Dashboard.jsx`)

- Agregar un selector de modo ("Mix real (últimos N días)" / "Mix manual (catálogo)") arriba de la
  sección de Punto de Equilibrio, y cuando el modo es "real", un selector de ventana (7/30/90 días) igual
  al que ya existe en la pantalla de Análisis/BCG. Refetch al cambiar cualquiera de los dos.
- El banner de advertencia "⚠️ el mix suma X%, debería sumar 100%" que ya existe: mostrarlo únicamente
  en modo manual. En modo real no tiene sentido (matemáticamente siempre da ~100%).
- Si el backend devuelve el error de "no hay ventas en esta ventana", mostrarlo con claridad y ofrecer un
  atajo para cambiar a modo manual (botón o link que cambia el selector).
- En la tabla de detalle por producto, agregar una columna con las unidades/monto vendido en la ventana
  cuando el modo es "real", para que se entienda de dónde sale cada %  — no hace falta en modo manual.
- Etiquetar claramente en el título de la sección qué modo y qué ventana se está mostrando (ej. "Punto de
  Equilibrio Ponderado — mix real, últimos 30 días" vs "— mix manual").

## Qué NO cambiar

No toques Matriz BCG/Análisis, Stock, Contribución por categoría, Compras, Movimientos ni Importación —
esto es acotado a la pantalla de Punto de Equilibrio. Tampoco quites el campo `mix_pct` del Catálogo ni
su edición manual — sigue existiendo y sigue siendo necesario para el modo manual.

## Antes de terminar

Probalo en los dos escenarios: con ventas cargadas (el mix real tiene que reflejar la proporción real de
facturación) y con un producto activo recién creado sin ninguna venta todavía (debe dar 0% en modo real
sin romper el cálculo, mientras el resto de los productos con ventas se reparten el 100% entre ellos).
Probá también el caso sin ninguna venta en el sistema (debe devolver el error prolijo, no un cálculo con
división por cero). Actualizá el CLAUDE.md con esta decisión (mix real vs manual, y por qué).
