Fase D, parte 2: Nota de Crédito C, para cuando una devolución/cancelación corresponde a un pedido que ya
tenía una Factura C emitida. Manual (un botón aparte, "Emitir Nota de Crédito"), nunca automática al
procesar la devolución — mismo criterio que "Facturar".

## Antes de programar nada: no deleguen a agentes en segundo plano sin supervisión

Esta fase toca ARCA real (homologación) y una tabla que ya usa la Fase C — mismo cuidado que la vez
pasada. Si necesitás confirmar algo puntual, hacelo en el hilo principal, visible.

## 1. Cuándo corresponde (y cuándo NO)

Una `Devolucion` necesita Nota de Crédito si y solo si: el `Pedido` al que pertenece tiene una `Factura`
(`tipo_comprobante=11`, `estado="Emitida"`) cuyo `created_at` es **anterior** a la `fecha` de esa
`Devolucion`, Y esa `Devolucion` todavía no tiene su propia Nota de Crédito emitida. Si la factura no
existe, o se emitió DESPUÉS de la devolución (`facturar_pedido` ya cobró el neto correcto gracias a
`monto_neto_pedido`), no corresponde nada — no muestres el botón ni dejes que se llame el endpoint en ese
caso.

Como la Fase C ya impide una segunda Factura C (`tipo_comprobante=11`) para el mismo pedido, en la
práctica hay como mucho una factura original por pedido — no hace falta contemplar varias, alcanza con la
relación 1 devolución → 1 Nota de Crédito.

**Nueva función `calculations.devolucion_requiere_nota_credito(db, devolucion) -> bool`**, encapsulando
exactamente esa regla — usala tanto en la validación del endpoint como en lo que le devuelvas al
frontend para decidir si mostrar el botón.

**Nueva función `calculations.monto_devolucion(db, devolucion) -> Decimal`**: suma, por cada
`DevolucionItem` de esa `devolucion_id`, `cantidad × precio_unitario` (del `PedidoItem` original, mismo
criterio de siempre) — es el monto de ESA devolución puntual, no del pedido entero.

## 2. `Factura` — dos columnas nuevas (tabla existente, necesita `ALTER TABLE`)

`devolucion_id` (nullable, FK a `devoluciones.id`) y `factura_original_id` (nullable, FK a `facturas.id`,
autorreferencial) — las dos se completan SOLO en filas `tipo_comprobante=13`. `devolucion_id` identifica
a qué devolución corresponde esa Nota de Crédito; `factura_original_id` apunta a la Factura C que se está
acreditando (necesario para armar `CbtesAsoc` en el pedido a ARCA, y para poder mostrar "esta NC
corresponde a la factura #X" después). Migración manual, `facturas` ya existe:
```sql
ALTER TABLE facturas ADD COLUMN devolucion_id INTEGER REFERENCES devoluciones(id);
ALTER TABLE facturas ADD COLUMN factura_original_id INTEGER REFERENCES facturas(id);
```

## 3. `backend/app/arca/wsfe.py` — extender, no duplicar

`fe_cae_solicitar` (la función que ya existe) gana un parámetro opcional `cbtes_asoc:
Optional[list[dict]] = None` — cuando se pasa, arma el array `<CbtesAsoc>` en el request (cada dict con
`tipo`, `pto_vta`, `nro`, correspondientes a la Factura original). No crees una función nueva paralela
para Nota de Crédito — es el mismo método `FECAESolicitar` de ARCA, la única diferencia real es el
`CbteTipo` (13 en vez de 11) y este array opcional. Confirmá con el `cbte_tipo` que ya recibe la función
que `FECompUltimoAutorizado` se siga consultando correctamente para tipo 13 (numeración independiente de
la de tipo 11 — cada tipo de comprobante tiene su propia secuencia en ARCA).

**Verificá el signo del importe antes de armar el request** — no lo asumas. Según lo que se leyó del
manual de WSFEv1 en la Fase A, `ImpNeto`/`ImpTotal` para un comprobante tipo 13 deberían mandarse en
positivo (el tipo de comprobante, no el signo, es lo que le dice a ARCA que es una nota de crédito) —
pero confirmalo releyendo la sección correspondiente del manual (`manual-desarrollador-ARCA-COMPG.pdf`,
ya descargado/consultado en la Fase A) antes de darlo por sentado, porque un signo incorrecto acá es el
tipo de error caro de detectar tarde.

## 4. `backend/app/facturacion.py`

`emitir_nota_credito(db, devolucion_id)`, mismo estilo que `facturar_pedido` (podés extraer un helper
compartido para la parte de "llamar a ARCA y persistir el resultado, éxito o error", ya que la lógica es
casi idéntica entre las dos — a tu criterio, no es obligatorio si preferís mantenerlas separadas y
duplicar poco):

1. Buscar la `Devolucion`, 404 si no existe.
2. Si `not devolucion_requiere_nota_credito(db, devolucion)`: 400 con el motivo correspondiente (sin
   factura emitida antes de esta devolución, o ya tiene su Nota de Crédito).
3. `monto = monto_devolucion(db, devolucion)`.
4. Leer `arca_cuit`/`arca_punto_venta_defecto` de configuración (mismo chequeo que `facturar_pedido`).
5. Ubicar la `Factura` original (`tipo_comprobante=11`, `estado="Emitida"`, `created_at` anterior a la
   devolución) para armar `cbtes_asoc=[{tipo: 11, pto_vta: ..., nro: ...}]`.
6. `wsfe.fe_cae_solicitar(..., cbte_tipo=13, cbtes_asoc=[...])`.
7. Éxito: crear `Factura(tipo_comprobante=13, pedido_id=devolucion.pedido_id, devolucion_id=...,
   factura_original_id=..., estado="Emitida", importe_total=monto, ...)`.
8. Error/rechazo: mismo criterio que `facturar_pedido` — crear igual la fila con `estado="Error"`, commit
   inmediato antes de propagar el error.

## 5. Endpoint

`POST /pedidos/{pedido_id}/devoluciones/{devolucion_id}/nota-credito` (mismo estilo de anidamiento que
`POST /pedidos/{id}/devoluciones` que ya existe), llama a `facturacion.emitir_nota_credito`.

## 6. Frontend — `Pedidos.jsx`

En el historial de devoluciones de cada pedido (el que ya se muestra en el panel de devolución), agregar
un botón "Emitir Nota de Crédito" por cada `Devolucion` donde corresponda — podés confiar en que el
backend rechace con 400 si no corresponde y mostrar ese error, no hace falta duplicar toda la regla de
elegibilidad en el frontend si te resulta más simple así. Misma protección de doble-click que ya usa
"Facturar" (`facturando`) — reusá el mismo patrón, mismo motivo (llamada SOAP externa e irreversible). En
éxito, mostrar el CAE de la Nota de Crédito en esa fila del historial.

## Qué NO hacer

Nada de CAEA. Ningún otro tipo de comprobante más allá de Nota de Crédito C (13). No toques
`reservas_stock`, `Compras.jsx`, el storefront. No conviertas esto en algo automático — sigue siendo un
botón que Florencia aprieta cuando quiere, igual que "Facturar".

## Antes de terminar

Contra ARCA real (homologación): un pedido facturado de verdad (Fase C), con una devolución posterior
(Fase D parte 1) de parte de ese pedido, emitir la Nota de Crédito y confirmar CAE real + que
`CbtesAsoc` efectivamente referencia la factura original (podés confirmarlo con `FECompConsultar` sobre
el comprobante nuevo, o revisando la respuesta). Intentar emitir una segunda Nota de Crédito para la
misma devolución y confirmar el rechazo. Intentar emitir Nota de Crédito para una devolución que no
corresponde (pedido nunca facturado, o devolución anterior a la factura) y confirmar el rechazo con el
motivo correcto. Avisame qué probar a mano en el navegador. Actualizá el CLAUDE.md con esta sección
nueva, y con esto ya se puede sacar "Nota de Crédito" de cualquier lista de pendientes donde apareciera.
Reemplazá el contenido de resumenultimamodif.md con el resumen que armes al terminar.
