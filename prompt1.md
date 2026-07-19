Fase C: conectar el `Pedido` de la Fase B con el cliente de ARCA de la Fase A — botón "Facturar" real,
que pide un CAE de verdad y lo guarda. Esta fase NO genera ningún comprobante imprimible ni código QR
(eso es una fase futura, no planificada todavía) — el alcance es obtener el CAE y dejarlo persistido y
visible, nada más. Tampoco emite Nota de Crédito (eso es la Fase D parte 2, más adelante).

## 1. Tabla nueva `facturas`

`id`, `pedido_id` (FK a `Pedido`), `tipo_comprobante` (int, default `11` = Factura C — campo propio, no
hardcodeado en la query, porque una futura Nota de Crédito C usaría `13` en esta misma tabla, aunque esta
fase solo emite `11`), `punto_venta` (snapshot del valor de `configuracion` al momento de facturar, no
una referencia viva), `numero_comprobante`, `cae`, `cae_vencimiento`, `fecha_emision`, `importe_total`
(el monto realmente facturado — ver punto 4, no necesariamente igual a `Pedido.total`), `doc_tipo`/
`doc_nro` (Consumidor Final en esta fase, ver punto 5), `estado` (`"Emitida"` | `"Error"`),
`mensaje_error` (nullable), `created_at`. Un pedido puede tener más de una fila acá con el tiempo
(intentos fallidos, y a futuro una Nota de Crédito) — no uses una relación 1:1 forzada.

## 2. `backend/app/facturacion.py` (nuevo, no adentro de `arca/`)

Orquesta entre `Pedido`/`Configuracion` y el paquete `arca/` de la Fase A — `arca/` sigue sin saber qué es
un Pedido, este módulo es el que traduce.

**`calculations.monto_neto_pedido(db, pedido_id)`** (nueva, en `calculations.py` — no en
`facturacion.py`, es un cálculo de negocio reusable): `Pedido.total` menos lo que ya se devolvió de ese
pedido. **Antes de escribir esta función, revisá si en `backend/app/models.py` ya existe una clase
`Devolucion`/`DevolucionItem`** (o, si preferís confirmarlo contra la base viva, si existen las tablas
`devoluciones`/`devolucion_items`):
- **Si existen**: sumá, por cada `DevolucionItem` cuyo `PedidoItem` pertenezca a ese pedido, `cantidad ×
  precio_unitario` del `PedidoItem` original, y restalo de `Pedido.total`.
- **Si NO existen todavía**: la función devuelve directamente `Pedido.total`, sin restar nada — no hay
  ningún otro lugar del proyecto que registre devoluciones todavía, así que no hace falta contemplar ese
  caso.
No asumas ninguno de los dos escenarios de antemano — confirmalo mirando el código/la base real antes de
programar esta función.

Función principal `facturar_pedido(db, pedido_id)`:

1. Buscar el `Pedido`, 404 si no existe.
2. Si `facturar_arca` es `False`: error claro ("Este pedido no está marcado para facturar").
3. Si ya existe una `Factura` con `tipo_comprobante=11` y `estado="Emitida"` para este `pedido_id`: error
   claro ("Este pedido ya tiene una factura emitida") — evita facturar dos veces por un doble click. Sé
   específico con el filtro (`tipo_comprobante=11`, no "cualquier fila en facturas") porque más adelante
   van a convivir ahí también Notas de Crédito del mismo pedido.
4. Calcular `monto = calculations.monto_neto_pedido(db, pedido_id)`. Si `monto <= 0`: error claro ("Este
   pedido no tiene monto pendiente de facturar — fue devuelto o cancelado en su totalidad").
5. Leer `arca_cuit`/`arca_punto_venta_defecto` de `configuracion`. Si `arca_cuit` es `null`: error claro
   ("Configurá el CUIT de ARCA en ⚙️ Configuración antes de facturar").
6. `FECompUltimoAutorizado` (de `arca/wsfe.py`, reusado tal cual) para tipo `11`, ese punto de venta.
7. `FECAESolicitar` con `ImpNeto = monto` (el neto del punto 4, NO `Pedido.total` a secas), Consumidor
   Final (`DocTipo=99`, `DocNro=0`).
8. **Éxito**: crear `Factura` (`estado="Emitida"`, `importe_total=monto`, con el CAE/vencimiento/número
   reales, `mensaje_error` con las observaciones si las hubo aunque haya salido aprobado).
9. **Rechazo de ARCA o error de conexión**: crear igual una `Factura` con `estado="Error"` y el detalle en
   `mensaje_error` (no numero/CAE, esos quedan `null`) — así queda historial del intento fallido. Devolver
   el error al caller igual, para que el router lo propague.

## 3. Endpoint

`POST /pedidos/{id}/facturar` (en `routers/pedidos.py`, llama a `facturacion.facturar_pedido`). Devuelve
el resultado de la `Factura` creada (o el error 400 correspondiente si falló alguna validación de los
pasos 2-5, o 502 si ARCA rechazó/no respondió, con el detalle real del error, no uno genérico).

## 4. Consumidor Final — explícito, no un olvido

Esta fase siempre factura con `DocTipo=99`/`DocNro=0` (Consumidor Final), sin pedirle a nadie un DNI/CUIT
del comprador. Es válido y suficiente para venta minorista anónima. Que un comprador pueda pedir factura
con sus propios datos (DNI/CUIT) queda explícitamente afuera — anotalo como pendiente en el CLAUDE.md, no
lo implementes ahora.

## 5. Frontend — `Pedidos.jsx`

- Botón **"Facturar"** en cada fila donde `facturar_arca=true`, no tiene ya una `Factura` tipo `11` con
  `estado="Emitida"`, y `monto_neto_pedido > 0` (si el backend igual lo rechaza por este último motivo,
  mostrá el error tal cual, no hace falta duplicar la validación en el frontend si no la tenés a mano ahí
  — el backend ya la hace). Al confirmar, llama al endpoint del punto 3; en éxito muestra el CAE, la
  fecha de vencimiento, y el monto facturado (que puede ser menor al total del pedido si hubo una
  devolución previa — mostralo así de claro, no solo el CAE pelado); en error, el mensaje real con
  `getErrorMessage`, sin tocar el resto de la fila.
- **Contador destacado arriba de la tabla**: "X pedidos pendientes de facturar" — cuenta los pedidos con
  `facturar_arca=true`, sin `Factura` tipo `11` emitida, y con `monto_neto_pedido > 0` (un pedido
  totalmente devuelto antes de facturarse no debería aparecer acá, no hay nada que facturar). Sumale un
  filtro rápido (toggle o botón) que muestre solo esos, si no complica demasiado el componente que ya
  existe.

## Qué NO hacer

Nada de comprobante imprimible ni código QR — eso es una fase futura. No implementes Nota de Crédito
todavía — es la Fase D parte 2, que se apoya en lo que construyas acá pero se hace después, cuando esto ya
esté probado. No toques `Compras.jsx`, `Análisis`, `Importación`, `reservas_stock`, ni el storefront
Next.js.

## Antes de terminar

Contra ARCA real (homologación), no simulado: crear un `Pedido` de prueba (local, `facturar_arca=true`)
vía `POST /pedidos` ya existente, facturarlo con el endpoint nuevo y confirmar CAE real obtenido.
Intentar facturarlo una segunda vez y confirmar el rechazo por "ya tiene factura emitida". Intentar
facturar un pedido con `facturar_arca=false` y confirmar el rechazo correspondiente. **Si `Devolucion`/
`DevolucionItem` ya existen en el proyecto** (revisalo igual que hiciste antes de programar
`monto_neto_pedido`), probá además: un pedido con una devolución parcial ya procesada, facturarlo, y
confirmar que el CAE se pide por el monto neto (no el total original) — si esas tablas todavía no
existen, salteá esta prueba puntual y dejalo documentado como pendiente de verificar cuando se agregue
esa funcionalidad. Avisame qué probar a mano en el navegador (el botón "Facturar" y el
contador de pendientes, sobre todo). Actualizá el CLAUDE.md con esta sección nueva, y agregá a la lista de
"ideas mencionadas pero no implementadas" el comprobante imprimible con QR y la opción de facturar con
datos reales del comprador en vez de Consumidor Final.
