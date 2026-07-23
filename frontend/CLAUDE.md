# FashBalance — frontend (panel interno, React 18 + Vite + Tailwind)

Este archivo se carga junto con el `CLAUDE.md` de la raíz cuando se trabaja dentro de `frontend/`. Es
el **panel interno** que usa Florencia (dueña del negocio) para gestión — no confundir con `ecommerce/`
(storefront público Next.js, ver `ecommerce/CLAUDE.md`). Tema oscuro, sin librerías de componentes (todo
hecho a mano con clases Tailwind, estilo consistente: `bg-[#0b0f19]` fondo general, `bg-[#151b2b]`
cards). Para el detalle de modelo de datos y reglas de negocio que consumen estas pantallas, ver
`backend/CLAUDE.md`.

## Convenciones de código (frontend)

- Cada pantalla es un componente en `src/pages/`, sin estado global (todo con `useState` + `useEffect` +
  llamadas directas a `src/api.js`).
- El cliente axios (`api.js`) expone `getErrorMessage(e)` que **siempre** hay que usar en los `catch` —
  nunca `e.response?.data?.detail` directo, porque FastAPI devuelve `detail` como string en errores de
  negocio pero como **array de objetos** en errores de validación 422, y renderizar ese array directo en
  JSX rompe la página en blanco sin avisar. Hubo un bug real de UX (no de lógica) antes de esto: los
  `catch` mostraban `undefined` cuando el error no tenía `response` (ej. el front apuntando a
  `localhost:8000` desde un navegador en otra máquina que la que corre Docker) — quedaba "silencioso" sin
  avisar nada. Si se agregan pantallas nuevas, replicar este patrón.
- Confirmaciones destructivas (borrar producto/categoría/compra/movimiento) usan `window.confirm(...)`
  antes de llamar al DELETE — no hay modal custom para eso.
- **Sin `localStorage`/`sessionStorage` en este panel** — todo el estado persistente vive en Postgres.
  Excepción deliberada: el carrito de compras del storefront (`ecommerce/`) sí usa `localStorage` a
  propósito (es estado de sesión de un comprador anónimo, no un dato de negocio) — ver
  `ecommerce/CLAUDE.md`. Esa excepción es específica de `ecommerce/`, no aplica acá.
- `docker-compose.yml` usa `VITE_API_URL: ${VITE_API_URL:-http://localhost:8000}` — si Docker corre en
  un server distinto de donde se abre el navegador (caso real: VM Alpine sobre Hyper-V), hay que setear
  `VITE_API_URL` a la IP/dominio real del server en un `.env` en la raíz del repo, si no el frontend
  intenta pegarle a `localhost` del lado del navegador y falla en silencio (mitigado en parte por
  `getErrorMessage`, pero la causa raíz es de configuración, no de código).

## Variantes de producto (talle, color, u otros atributos) — UI

El modelo de datos completo (atributos/valores/variantes, `tiene_variantes`, costo único a nivel
producto) está en `backend/CLAUDE.md`. Acá el comportamiento de las 3 pantallas que lo consumen.

- **`Compras.jsx` filtra los combos de atributo por las variantes que YA EXISTEN del producto elegido**
  (función `opcionesParaAtributo`): el combo del primer atributo (ej. Talle) solo lista los valores que
  aparecen en alguna `Variante` real de ese producto puntual — no todos los `valores_atributo` del
  sistema. Al elegir un valor ahí, el siguiente combo (ej. Color) se filtra además a los valores que,
  combinados con lo ya elegido, correspondan a una variante real (se recorre `variantesProducto`, traído
  del backend vía `GET /productos/{id}/variantes`). Esto es deliberado: desde Compras **no se crean
  variantes nuevas**, solo se registra stock contra una que ya existe — si hace falta una combinación
  realmente nueva, el alta es en Catálogo. Si el producto tiene `tiene_variantes=True` pero cero
  `Variante` cargadas, Compras avisa explícitamente ("Este producto no tiene variantes cargadas todavía,
  configuralas en Catálogo antes de registrar stock") tanto al elegir el producto como si se intenta
  guardar la compra igual.
- **`Movimientos.jsx` (Ventas) replica el mismo filtro por existencia que Compras, y encima le suma
  stock** (misma función `opcionesParaAtributo`): los combos de atributo al cargar una Venta solo listan
  valores que existen en alguna `Variante` real del producto (mismo criterio, misma cascada). La
  diferencia con Compras es que acá cada opción se marca además con `conStock` — `true` si al menos una
  `Variante` candidata con ese valor tiene `stock_actual > 0` (dato que viene del backend en
  `GET /productos/{id}/variantes`, ver `backend/CLAUDE.md`). Las opciones sin stock **no se ocultan**,
  quedan como `<option disabled>` con " (sin stock)" en el texto. Elegir un valor en un atributo resetea
  la selección de los atributos siguientes. Si TODAS las opciones del primer atributo quedan sin stock,
  se oculta el bloque de combos entero y se muestra un mensaje único ("Este producto no tiene stock
  disponible en ninguna variante"). El aviso de "variantes no cargadas todavía" (mismo texto que Compras)
  también se replica acá.
- **Tope de cantidad contra stock, en frontend y backend**: el input de cantidad de `Movimientos.jsx`
  tiene `max={stockDisponible}` — `stock_actual` de la variante elegida si el producto tiene variantes, o
  `stock_actual` del producto entero (`GET /stock/productos`) si no. `guardar()` valida lo mismo antes de
  pegarle a la API y muestra un aviso si la cantidad cargada supera el disponible. Al **editar** una
  Venta ya registrada, se le suma de vuelta su propia `cantidad` original (`ventaOriginal`, capturado en
  `editar()`) antes de comparar, porque esa cantidad ya está descontada del `stock_actual` actual. Esto
  es solo cosmético (se puede saltear llamando a la API directo) — la validación real está en el
  **backend**: `calculations.stock_disponible(db, producto_id, variante_id)` usada por `_validar()` en
  `routers/movimientos.py`, ver `backend/CLAUDE.md`.
- **Alta de producto nuevo con variantes es atómica, en un solo paso**: en el formulario de ALTA de
  `Productos.jsx`, tildar "¿Tiene variantes?" despliega ahí mismo (sin guardar nada todavía) el bloque de
  atributos/valores que ya existía para edición, más un preview local de la grilla de combinaciones
  (`previewVariantes`, calculado 100% en el cliente, sin pegarle al backend). Al confirmar "+ Añadir
  Prenda" se llama a `POST /productos/con-variantes` (endpoint atómico, ver `backend/CLAUDE.md`). **El
  camino de edición de un producto ya existente sigue siendo dos pasos** (guardar atributos, después
  generar variantes) — el producto ya existe, tiene sentido ahí.
- **Desactivar variantes**: si el `PUT /productos/{id}` falla porque el producto ya tiene compras o
  ventas registradas (bloqueo del backend, ver `backend/CLAUDE.md`), el frontend vuelve a tildar el
  checkbox "¿Tiene variantes?" (estaba destildado en el intento fallido) para reflejar el estado real que
  quedó en la base.

## Importación de Excel — pantalla

Consume `backend/app/routers/importacion.py` (ver `backend/CLAUDE.md` para el detalle completo de reglas
de matching, atributos y umbral de costo). La pantalla muestra las 4 secciones que devuelve el backend
(`productos_creados`, `compras_registradas`, `cambios_costo`, `errores`) y permite aprobar la tabla de
`cambios_costo` fila por fila o todas juntas.

## Dashboard — Snapshots del mix real (`Dashboard.jsx`)

El backend de esta feature (tabla `mix_snapshots`, detección lazy) está en `backend/CLAUDE.md`.

- Agrupa las filas devueltas por `GET /mix-snapshots` por el **timestamp exacto** de cada tanda (todas
  las filas de una misma "tomada" comparten el mismo `fecha` al milisegundo), nunca por día truncado —
  si se agrupara por día, dos snapshots tomados el mismo día (ej. el automático y uno manual) sumarían
  sus mix% en un solo punto e inflarían el total por encima de 100%.
- Las categorías se acotan a las 8 con más mix% acumulado (paleta categórica fija de 8 colores) y el
  resto se agrupa en "Otras" en vez de generar más colores.

## Configuración del negocio — pantalla ⚙️ (`Configuracion.jsx`)

La tabla completa de campos editables (con sus defaults y qué controla cada uno) está en el `CLAUDE.md`
de la raíz. La pantalla es un formulario genérico **data-driven** (constante `GRUPOS`, agrupa los campos
por sección: "Stock y Reposición", "Costos", "Tienda Online", etc.) — un campo numérico o de texto nuevo
en `configuracion` se agrega como una entrada más de `GRUPOS` (`{ key, label, ayuda, tipo }`), sin lógica
especial por campo. El input genérico distingue tres `tipo`: `'texto'` (`<input type="text">`), `'fecha'`
(`<input type="date">`, agregado en la Fase E para `arca_inicio_actividades`) y el default sin `tipo`
(`<input type="number">`) — un campo de fecha nuevo no necesita más que sumar `tipo: 'fecha'` a su
entrada de `GRUPOS`. La sección "Tienda Online" edita `nombre_ecommerce`, `whatsapp_numero`,
`instagram_url`, `facebook_url`, `email_contacto` con el mismo `GET`/`PUT /configuracion` que el resto —
esos campos los consume `ecommerce/` vía un endpoint aparte (`GET /ecommerce/configuracion-tienda`, ver
`backend/CLAUDE.md` y `ecommerce/CLAUDE.md`), pero se editan siempre desde acá.

## Fase B — Pedido unificado: Caja como carrito (`Movimientos.jsx` / `Pedidos.jsx`)

El modelo de datos y los endpoints (`Pedido`/`PedidoItem`, `POST /pedidos`, estados) están en
`backend/CLAUDE.md`.

- **`Movimientos.jsx` pasa de "un producto = un movimiento" a "un pedido = varios ítems"**, solo para
  tipo Venta (Ingreso/Egreso no cambiaron, siguen siendo una carga rápida de una sola línea vía
  `POST /movimientos` directo, y la edición/borrado de un `Movimiento` ya existente tampoco cambió). El
  selector de categoría→producto→atributos→variante con el filtro por stock (`opcionesParaAtributo`,
  `elegirValorAtributo`, `varianteResuelta`) se reusa tal cual de la sección de Variantes de arriba.
  Flujo de dos fases: (1) **Armar** — un botón "+ Agregar al pedido" empuja el ítem resuelto a un
  carrito en memoria (`itemsPedido`), contra un tope de cantidad que además de `stock_disponible` real
  descuenta lo que ya está en el carrito para esa misma variante/producto. (2) **Confirmar** — checkbox
  "Facturar (ARCA)" (arranca **destildado** por default: a diferencia del canal ecommerce, que siempre
  factura por regla de negocio separada, una venta de mostrador no siempre la pide la clienta) + input de
  cliente opcional + botón que llama `POST /pedidos` con las líneas del carrito. En error (ej. una venta
  concurrente consumió el stock entre armar y confirmar), el carrito **no se vacía** — se puede sacar el
  ítem problemático y reintentar.
  - **Bug real ya corregido — agregar dos veces el mismo producto+variante duplicaba la línea en vez de
    sumar la cantidad**: la primera versión de `agregarAlCarrito` armaba siempre un ítem nuevo con una
    `key` única, sin buscar si ya había una línea con el mismo `producto_id`+`variante_id` en
    `itemsPedido`. Caso real detectado por la usuaria: agregar "Calza Dua M/Verde" x2 y después, en el
    mismo pedido, agregar otra vez "Calza Dua M/Verde" x1 dejaba dos líneas separadas en vez de una sola
    de x3. Fix: antes de agregar, busca en `itemsPedido` una línea con el mismo `producto_id` y
    `variante_id` (`null` si no tiene variantes) y, si existe, le suma la cantidad nueva en vez de
    empujar una línea más. El tope de stock no necesitó cambios — el bug era solo de presentación (dos
    filas en vez de una), no de validación de stock.
- **`OrdenesEcommerce.jsx` se reemplazó por `Pedidos.jsx`** (ruta `/pedidos`): lista TODOS los pedidos sin
  importar el canal, con columna de canal (badge), fecha, cliente (o "Mostrador" si no se cargó nombre en
  uno local), items, total, `facturar_arca` (badge sí/no), y estado editable ahí mismo con un `<select>`
  que dispara `PUT /pedidos/{id}/estado` al cambiar (revierte el valor si la API rechaza el cambio).
- **Qué NO se tocó**: `Compras.jsx` (tiene su propia copia de la lógica de selectores, independiente de
  `Movimientos.jsx`).

## Reserva de stock — Caja (`Movimientos.jsx`)

El backend de esta feature (tabla `reservas_stock`, endpoints, `reservar_stock`/`liberar_reserva`) está
en `backend/CLAUDE.md`.

- Al primer "+ Agregar al pedido" de un carrito vacío se genera un `sesionId`
  (`crypto.randomUUID()` con fallback a un id `Date.now()+Math.random()` si esa API no está disponible
  — este panel se accede seguido por IP de LAN sobre `http`, no `https`/`localhost`, contexto en el que
  `crypto.randomUUID` puede no existir en algunos navegadores). `agregarAlCarrito` es `async`: antes de
  tocar el carrito visual llama `POST /reservas` con la cantidad TOTAL que va a quedar reservada para esa
  línea (si ya había una línea del mismo producto+variante, es `existente + agregado`, no solo el
  incremento — `reservar_stock` reemplaza el valor, no lo suma); si el backend rechaza, se muestra el
  error y no se agrega la línea. `sacarDelCarrito` llama `DELETE /reservas` para esa línea puntual antes
  de sacarla (best-effort: si el DELETE falla, la línea se saca igual del carrito visual — la reserva
  vieja se autolimpia sola por TTL). Botón "Cancelar pedido" llama `DELETE /reservas` para toda la sesión
  y vacía el carrito — para no depender solo del vencimiento por tiempo. `confirmarPedido` manda
  `sesion_id` en el body de `POST /pedidos` y resetea `sesionId` a `null` al confirmar con éxito.

### Reconstrucción del carrito al refrescar (sin `localStorage`)

Bug real encontrado al probar a mano: si se refrescaba la página de Caja mientras había un pedido en
armado, el carrito visual desaparecía (vivía solo en memoria de React) pero la reserva de stock en
Postgres seguía activa — bloqueaba esas unidades hasta el TTL o hasta cancelarla a mano por API, sin que
la usuaria pudiera verlo ni actuar desde la UI. La solución respeta la convención de no usar
`localStorage`: la fuente de verdad para "hay un pedido en armado" ya es `reservas_stock` (backend), así
que alcanza con poder reconstruir el carrito visual a partir de esa tabla.

- Nuevo `useEffect` al montar el componente que llama `GET /reservas` sin filtrar. Si hay filas activas,
  se agrupan por `sesion_id` y se toma la más reciente (primera del array, ya viene ordenado por
  `creado_en` desc) — cubre el caso raro de dos sesiones activas a la vez (ej. dos pestañas) sin agregar
  más sofisticación, dado que es software de una sola usuaria. Se reconstruye `itemsPedido` directo desde
  los campos denormalizados de esas filas (sin llamar a ningún otro endpoint) y se restaura `sesionId`.
  Se muestra un aviso ("Recuperamos un pedido que tenías en armado...") para que no sea un cambio
  silencioso — estado `carritoRecuperado`, se resetea a `false` al confirmar o cancelar el pedido. El
  resto del flujo (agregar/sacar/confirmar/cancelar) no cambió: una vez reconstruido el estado, funciona
  igual que con un carrito armado en la sesión actual.

## Facturación electrónica Fase C — botón Facturar (`Pedidos.jsx`)

El backend (`facturacion.py`, endpoint `POST /pedidos/{id}/facturar`) está en `backend/CLAUDE.md`.

- Columna "Facturar" es condicional — si el pedido ya tiene una `Factura` tipo 11 emitida, muestra
  CAE/vencimiento/importe en vez del badge Sí/No; si es `facturar_arca=true` sin factura emitida,
  `estado != "Cancelado"` y `monto_neto > 0`, muestra un botón "Facturar"; si no, el badge Sí/No de
  siempre.
- **Protección de doble click obligatoria, no cosmética**: facturar es una llamada SOAP de varios
  segundos con efecto externo irreversible (un CAE real, sin forma de anularlo hasta que exista Nota de
  Crédito) — un estado `facturando` (Set de ids en vuelo) deshabilita el botón de esa fila mientras la
  request está en curso, para que dos clicks rápidos no pasen ambos la validación de "no tiene factura
  emitida" del backend antes de que el primer commit termine.
- Banner ámbar arriba de la tabla (mismo estilo que `Movimientos.jsx`) con la cuenta de pedidos
  pendientes de facturar y un toggle "ver solo pendientes".

## Editar `facturar_arca` en un pedido ya confirmado (`Pedidos.jsx`, ronda posterior a la Fase C)

El backend (`PUT /pedidos/{id}/facturar-arca`) está en `backend/CLAUDE.md`. Caso real: un pedido local
se confirmó con el checkbox destildado y después la clienta pide factura igual — hacía falta poder
cambiar `facturar_arca` después de confirmar, no solo al crear el pedido.

- En la columna "Facturar", la rama que **no** tiene factura tipo 11 emitida ya no muestra un badge
  fijo "Sí/No" — es un `<input type="checkbox">` editable (`cambiarFacturarArca`) que dispara
  `PUT /pedidos/{id}/facturar-arca` al tildar/destildar. Mismo patrón que `cambiarEstado`: revierte el
  valor visual si la API rechaza (400), con un Set de ids en vuelo (`actualizandoFacturarArca`) para
  deshabilitar el checkbox de esa fila mientras la request está en curso — mismo criterio que
  `facturando`/`devolviendo`.
- **El checkbox se muestra SIEMPRE que no haya factura emitida, sin importar `pendiente`
  (`esPendienteDeFacturar`)** — bug real encontrado al probar a mano: la primera versión anidaba el
  checkbox en la rama `else` de `pendiente ? <botón Facturar> : <checkbox>`, así que apenas un pedido
  quedaba `pendiente` (facturar_arca=true + elegible) el checkbox desaparecía del todo, reemplazado por
  el botón "Facturar" — no había forma de destildarlo una vez tildado. Fix: la celda ahora renderiza
  el checkbox y, debajo, el botón "Facturar" **además**, solo si `pendiente` es `true` — los dos pueden
  convivir en la misma celda.
- La rama con factura tipo 11 ya emitida (CAE/Vto/importe/Ver PDF) no se tocó — ahí ya no tiene sentido
  editar `facturar_arca` (el backend lo bloquea con 400).
- No hizo falta tocar `esPendienteDeFacturar`/la lógica de cuándo el botón "Facturar" se habilita: ya
  depende de `facturar_arca`, así que al tildar el checkbox el botón aparece solo si además se cumplen
  las condiciones existentes (`estado != "Cancelado"`, `monto_neto > 0`).

## Fase D, parte 1 y 2 — panel de devolución / Nota de Crédito (`Pedidos.jsx`)

El backend (`Devolucion`/`DevolucionItem`, `procesar_devolucion`, Nota de Crédito) está en
`backend/CLAUDE.md`.

- Columna "Devolución" con un botón por pedido que abre un panel — no hay modal en el proyecto, es una
  sección condicional debajo de la tabla, mismo criterio que el bloque `enModoCarrito` de
  `Movimientos.jsx`. El panel trae el historial de devoluciones de ese pedido
  (`GET /pedidos/{id}/devoluciones`) para calcular, por línea, cuánto ya se devolvió y cuánto queda
  disponible, con un `<input type="number" max={disponible}>` por línea (deshabilitado si ya no queda
  nada disponible), un select de tipo y un motivo opcional. Confirmar llama
  `POST /pedidos/{id}/devoluciones`, refresca `GET /pedidos` entero (para que `estado` y `monto_neto` se
  actualicen). Mismo patrón `devolviendo` (Set de ids en vuelo) que ya usa `facturando`. La celda de
  Total muestra además el `monto_neto` en gris chico cuando difiere del total.
- El panel también **lista** el historial de devoluciones (fecha, tipo, motivo, resumen de ítems). Por
  cada `Devolucion` con `requiere_nota_credito === true` y sin `nota_credito` todavía: botón "Emitir
  Nota de Crédito" — mismo patrón de protección de doble-click (`Set` de estado `emitiendoNC`). En éxito,
  muestra el CAE/importe de la Nota de Crédito en esa fila del historial (reemplazando el botón); en
  error, lo muestra en `errorPanel`.
- **Qué NO se tocó**: `Compras.jsx`, el storefront (`ecommerce/`).

### Dos bugs de UX corregidos (ronda de fixes posterior)

- **El botón que abre el panel de devolución desaparecía en un pedido `Cancelado`**: la columna
  "Devolución" ocultaba el botón con la condición `p.estado !== 'Cancelado'`. Como una devolución que
  cubre el 100% de las líneas pone `Pedido.estado = "Cancelado"`, después de una devolución total quedaba
  sin forma de volver a entrar al panel para ver el historial ni el botón "Emitir Nota de Crédito". Fix:
  el botón siempre se muestra, con el texto "Ver devoluciones" en vez de "Devolver / Cancelar" cuando
  `estado === "Cancelado"`.
- **Confirmar una devolución cerraba el panel solo**: `confirmarDevolucion` llamaba
  `cerrarPanelDevolucion()` en el camino de éxito, así que el historial actualizado recién se volvía a
  pedir la próxima vez que se abría el panel. Fix: ya no se cierra — se refresca `devolucionesPanel` in
  situ (además de `GET /pedidos`) y solo se limpian los campos del formulario de carga, dejando el panel
  abierto con el historial al día.
- **Timeout del cliente HTTP cortaba `Facturar`/`Emitir Nota de Crédito` con un mensaje engañoso**: la
  instancia axios de `src/api.js` tiene un timeout global de 10s. Esas dos acciones disparan un SOAP real
  contra ARCA que en la práctica puede superar los 10s. Cuando el timeout cortaba la request,
  `getErrorMessage` mostraba "No se pudo conectar con la API..." (engañoso: el backend no tiene ningún
  timeout propio y sigue procesando y guarda la Factura/NC real igual, ver "endpoints sincrónicos" en
  `backend/CLAUDE.md`). Fix, 100% en `Pedidos.jsx`: `facturar`/`emitirNotaCredito` pasan
  `{ timeout: 30000 }` puntual en esas dos llamadas (el default global de `api.js` se deja igual para el
  resto de la app), y en el `catch` refrescan el pedido/devolución real desde el backend — si la
  Factura/NC ya existe (porque el timeout cortó una request que en realidad terminó bien), la UI se
  corrige sola mostrando el CAE real sin mostrar error.

## Fase E — link "Ver PDF" (`Pedidos.jsx`)

El backend (PDF con QR, `GET /pedidos/{id}/facturas/{id}/pdf`) está en `backend/CLAUDE.md`. Del lado del
frontend es aditivo puro: dos links `<a target="_blank">` nuevos, sin estado de React nuevo (no pasan por
`axios`, son URLs de descarga directas al backend) y sin cambios en ningún fetch existente.

- En la columna "Facturar" (rama `factura ? (...)`, junto a CAE/Vto/importe): "Ver PDF" apunta a
  `${api.defaults.baseURL}/pedidos/${p.id}/facturas/${factura.id}/pdf`.
- En el historial de devoluciones (rama `d.nota_credito ? (...)`, junto a "NC CAE ... · $..."): "Ver PDF"
  apunta a `${api.defaults.baseURL}/pedidos/${pedidoEnPanel.id}/facturas/${d.nota_credito.id}/pdf`.
- Se usa `api.defaults.baseURL` (la instancia axios ya configurada en `src/api.js`) en vez de exportar
  `API_URL` aparte solo para esto — `Pedidos.jsx` no tenía esa constante importada hasta ahora.

## Cambio de producto — wizard (`Pedidos.jsx`)

El backend (`Cambio`, `procesar_cambio`, endpoints) está en `backend/CLAUDE.md`. Botón nuevo "Cambiar
producto" junto al de "Devolver / Cancelar" (misma celda, mismo criterio de sección condicional debajo
de la tabla, sin modal). Estado propio (`panelCambioId`, `devolucionesParaCambio`, `cambiosPanel`,
`cantidadesCambiarDevolver`, `cambiando`, etc.) separado del panel de devolución, para que los dos panels
puedan coexistir en memoria sin pisarse.

- **Paso 1 (qué se devuelve)**: mismo criterio visual y de cálculo que el panel de devolución ya
  existente (`cantidadesDevolver`/`yaDevuelto`), pero recalculado sobre `devolucionesParaCambio` (un
  fetch propio de `GET /pedidos/{id}/devoluciones` al abrir el panel de cambio) — como un `Cambio` crea
  una `Devolucion` real, la disponibilidad ya sale correcta de ese mismo endpoint sin lógica extra.
- **Paso 2 (qué prenda entra)**: selector categoría→producto→atributos→variante **copiado** de
  `Movimientos.jsx` (`opcionesParaAtributo`, `elegirValorAtributo`, `varianteResuelta`, cálculo de stock
  disponible vía `stockProductos`), con sufijo `Cambio` en cada nombre (`opcionesParaAtributoCambio`,
  etc.) — mismo criterio ya usado entre `Movimientos.jsx` y `Compras.jsx`: cada pantalla tiene su propia
  copia, no un hook compartido. **Diferencia clave con la copia de Movimientos.jsx**: no llama a
  `POST/DELETE /reservas` — un cambio es una acción atómica de un solo paso, no un carrito armado en el
  tiempo, así que el tope de stock se calcula 100% client-side (stock real menos lo que ya está en el
  mini-carrito `itemsCambioNuevos`) sin tocar `reservas_stock`. `Pedidos.jsx` no traía `/productos`/
  `/categorias`/`/stock/productos` para la pantalla normal — se cargan recién al abrir el panel de
  cambio (`abrirPanelCambio`), no en el mount del componente.
- **Mini-carrito `itemsCambioNuevos`**: el schema del backend acepta una lista, así que un botón
  "+ Agregar" permite más de una prenda de reemplazo por cambio, mismo patrón que `itemsPedido` de
  Movimientos.jsx (sumar cantidad si ya existe la misma línea, en vez de duplicarla).
- **Preview de diferencia**: calculado en el cliente (cantidad × precio de lo nuevo, menos lo que se
  devuelve) solo para mostrarlo antes de confirmar — el backend recalcula de forma autoritativa al
  confirmar, así que no hay riesgo de desincronización.
- **Mensaje de confirmación con el monto real y la dirección explícita** (`diferencia_monto` que devuelve
  el `POST /pedidos/{id}/cambios`): "la clienta te debe $X más" / "hay que devolverle $X" / "cambio a
  precio igual, la Factura original sigue siendo válida" — en los dos primeros casos, si corresponde
  (`cambio.devolucion.requiere_nota_credito`), se suma un aviso señalando que se puede emitir la Nota de
  Crédito desde el historial de devoluciones — sin auto-dispararla, el botón que ya existe (Fase D parte
  2) la cubre sin cambios.
- **No se cierra el panel al confirmar**: se refresca `GET /pedidos` (para que `estado`/`monto_neto` del
  pedido original se actualicen en la tabla) + `GET /pedidos/{id}/devoluciones` + `GET
  /pedidos/{id}/cambios` del pedido en panel, mismo criterio que ya usa `confirmarDevolucion`, así el
  aviso con el monto/dirección de la diferencia se puede seguir viendo (o volver a consultar reabriendo
  el panel) sin depender de haber estado mirando la pantalla en el momento de confirmar.
- **Historial de cambios**: dentro del mismo panel (no uno aparte), listando por `Cambio` la fecha, el
  resumen ítem devuelto → pedido nuevo, y `diferencia_monto` con la misma dirección explícita de arriba.
- **Panel de devoluciones existente (sin tocar su mecánica)**: cuando `d.cambio` no es `null` (campo
  nuevo de `DevolucionOut`), se agrega una línea "🔄 Parte de un cambio → pedido #{d.cambio.pedido_nuevo_id}"
  en esa fila del historial — así se ve el vínculo aunque se entre por el panel de devolución y no por el
  de cambios.
- **Tabla principal de `Pedidos.jsx` (ronda de fixes posterior)**: cuando `p.cambio_origen` no es `null`
  (campo nuevo de `PedidoOut`), se agrega una línea "🔄 Cambio del pedido #{p.cambio_origen.pedido_original_id}"
  en la columna Cliente de ESE pedido (el nuevo, no el original) — antes el pedido que nacía de un cambio
  no tenía ninguna marca visible en la tabla principal, solo se veía el vínculo entrando al panel del
  pedido original.
- **Paso 2 (qué prenda entra) — tope de stock visible, no solo bloqueado al confirmar (bug reportado)**:
  el input de cantidad no tenía `max` ni aviso inline — el tope real ya existía en `agregarItemCambio`
  (rechaza con `setErrorCambio` si la cantidad supera `stockDisponibleCambio`), pero no había ninguna
  señal visual antes de hacer click en "+ Agregar", así que se podía escribir cualquier número sin
  feedback. Fix, mismo patrón ya usado en `Movimientos.jsx` (`max={stockDisponibleEfectivo ?? undefined}`
  + párrafo de aviso rojo cuando la cantidad cargada supera el disponible): se agregó `max={stockDisponibleCambio
  ?? undefined}` al input, se deshabilita el input y el botón "+ Agregar" cuando `stockDisponibleCambio <= 0`,
  y se agregó el mismo párrafo de aviso inline.
- **Qué NO se tocó**: `Compras.jsx`, el storefront (`ecommerce/`), el mecanismo de reserva de stock de
  `Movimientos.jsx`.

### Reporte — tarjeta "Cambios vs. reembolsos" (`BCG.jsx`, pantalla Análisis)

El backend (`GET /dashboard/cambios-devoluciones`) está en `backend/CLAUDE.md`. Reusa el estado `dias`
que ya existe en esa pantalla (selector 7/30/90) — sin selector propio. Tarjeta nueva con el mismo estilo
`bg-[#151b2b] rounded-xl p-5` que ya usan el scatter/tablas de esa pantalla, mostrando devoluciones
totales, cambios, reembolsos, tasa %, monto cambiado y monto reembolsado.
