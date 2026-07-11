Dos cosas relacionadas: centralizar los "números mágicos" que hoy
están hardcodeados como constantes en `calculations.py` en una pantalla de Configuración editable, y
agregar snapshots periódicos del mix real (para poder ver su evolución en el tiempo).

## Parte 1: Configuración del negocio

### Backend

- Nueva tabla `configuracion`: una sola fila (singleton, id fijo), con estas columnas (usá como default
  el valor que ya tiene hoy la constante equivalente en `calculations.py`, para que nadie note un cambio
  de comportamiento el día que se aplique esto):
  - `demanda_ventana_dias` (hoy `DEMANDA_VENTANA_DIAS`, default 90)
  - `lead_time_default_dias` (hoy `LEAD_TIME_DEFAULT_DIAS`, default 7)
  - `safety_days` (hoy `SAFETY_DAYS`, default 3)
  - `stock_dias_verde` (hoy el 30 hardcodeado en `_estado_stock`)
  - `stock_dias_rojo` (hoy el 7 hardcodeado en `_estado_stock`)
  - `rotacion_alerta_dias` (hoy el 90 hardcodeado en la alerta FIFO de `stock_por_producto`)
  - `umbral_cambio_costo_pct` (hoy `UMBRAL_CAMBIO_COSTO_PCT`, default 2.0)
  - `renegociacion_margen_umbral_pct` (hoy el 15 hardcodeado en `analisis_combinado`)
  - `renegociacion_percentil_volumen` (hoy el 0.7 hardcodeado en `analisis_combinado`)
  - `motor_decoracion_pareto_pct` (hoy el 80 hardcodeado como fallback en `analisis_combinado`)
  - `mix_real_ventana_dias_default` (hoy el 30 que quedó de default en punto de equilibrio)
  - `snapshot_periodo_dias` (nuevo, para la Parte 2, default 30)
- Función `get_configuracion(db)`: devuelve la fila única, creándola con los defaults de arriba si todavía
  no existe (bootstrap en el primer uso, no hace falta migración de datos).
- Recorrer `calculations.py` y reemplazar CADA referencia a las constantes de módulo listadas arriba por
  una lectura de `get_configuracion(db)` al principio de la función que las use (todas ya reciben `db`
  como parámetro, así que no hace falta cambiar firmas ni tocar los routers que las llaman). No cambies
  ninguna fórmula ni la lógica de negocio en sí — el valor que usaban antes como constante fija ahora sale
  de la config, nada más.
- Endpoints: `GET /configuracion` (devuelve la fila, la crea si no existe) y `PUT /configuracion`
  (actualiza los campos que se manden).

### Frontend

- Página nueva `Configuracion.jsx`, con los campos agrupados en las mismas categorías que usé para
  explicarte esto (Stock y Reposición / Compras / Análisis / Punto de Equilibrio), cada campo con su
  etiqueta en criollo (nada de nombres de variable Python) y una ayuda corta debajo explicando qué efecto
  tiene. Un solo botón "Guardar cambios" al final que hace el `PUT`.
- Link de navegación nuevo "⚙️ Configuración".
- Aclaración importante para el campo `mix_real_ventana_dias_default`: sigue siendo solo el valor inicial
  con el que abre la pantalla de Punto de Equilibrio — el selector de ventana (7/30/90) que ya existe ahí
  para elegirla al vuelo NO se elimina ni se reemplaza, esto solo cambia cuál viene tildado por defecto.

## Parte 2: Snapshots del mix real

### Backend

- Nueva tabla `mix_snapshots`: `id`, `fecha` (cuándo se tomó), `ventana_dias` (la ventana usada en ese
  cálculo), `producto_id` (FK nullable — el snapshot no debe depender de que el producto siga existiendo
  después), `producto_nombre` y `categoria_nombre` (guardados como texto plano en el momento del
  snapshot, no como referencia — así el histórico se mantiene legible aunque el producto se borre, se
  renombre o cambie de categoría más adelante), `mix_pct`, `facturacion`.
- Función `verificar_y_tomar_snapshot_si_corresponde(db)`:
  1. Lee `snapshot_periodo_dias` de la configuración.
  2. Busca la fecha del snapshot más reciente en `mix_snapshots` (si no hay ninguno, corresponde tomar
     uno ya).
  3. Si pasaron `snapshot_periodo_dias` o más desde ese último snapshot (o si nunca se tomó ninguno):
     calcular el mix real de todos los productos activos con la MISMA función `facturacion_por_producto`
     que ya se usa en el Punto de Equilibrio (no dupliques esa lógica), usando `ventana_dias` = el mismo
     `snapshot_periodo_dias` de la config, e insertar una fila por producto activo con facturación > 0 en
     esa ventana.
  4. No hace falta que sea perfectamente puntual en la fecha — alcanza con que se dispare la primera vez
     que se detecta que ya tocaba, no hace falta agregar un scheduler/cron nuevo al proyecto.
- Llamar a esta función al principio de `GET /dashboard/resumen` y de `GET /dashboard/punto-equilibrio`
  (son las pantallas que más se van a abrir de rutina, así que entre las dos cubren bien la detección) —
  que corra en segundo plano respecto a la respuesta del endpoint (no debe hacer más lenta la carga del
  Dashboard si ya le tocaba tomar snapshot en ese momento; usá un
  [BackgroundTask](https://fastapi.tiangolo.com/tutorial/background-tasks/) de FastAPI para esto, no lo
  hagas bloqueante).
- Endpoint `POST /mix-snapshots/tomar`: fuerza un snapshot ahora mismo, sin importar si "tocaba" o no
  (para que la usuaria pueda tomar uno manual cuando quiera, además de los automáticos).
- Endpoint `GET /mix-snapshots?producto_id=&categoria=`: devuelve el historial (opcionalmente filtrado)
  ordenado por fecha, para graficar la evolución.

### Frontend

- Sección nueva (dentro de la pantalla de Punto de Equilibrio en el Dashboard, o una pestaña aparte si te
  parece que queda más prolijo — decidilo vos según cómo se vea) con:
  - Un botón "Tomar snapshot ahora".
  - Un gráfico de líneas (Recharts, mismo estilo que el resto de la app) mostrando la evolución del mix%
    a lo largo del tiempo — como mínimo por categoría (más legible que por cada producto individual si
    hay muchos); si querés agregar un selector para ver el detalle por producto también, mejor.

## Qué NO cambiar

No toques la fórmula de ningún cálculo (BCG, Days-of-Cover, costo promedio, etc.) — esto es mover de
dónde sale el número de configuración, no cambiar qué hace cada número. Tampoco toques Compras,
Movimientos, Importación ni Catálogo más allá de leer la config donde ya usan alguna de estas constantes.

## Antes de terminar

Probá que cambiar un valor en Configuración (por ejemplo `umbral_cambio_costo_pct`) efectivamente cambia
el comportamiento del aviso en Compras, sin reiniciar nada. Probá el snapshot: simulá que pasó el período
configurado (podés insertar un `mix_snapshots` viejo a mano en la prueba) y confirmá que
`verificar_y_tomar_snapshot_si_corresponde` toma uno nuevo al abrir el Dashboard. Actualizá el CLAUDE.md
agregando la tabla de configuración y sus defaults, y la decisión de snapshot "lazy" (sin scheduler) con
el motivo.
