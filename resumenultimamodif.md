# Resumen de la última modificación — Facturación electrónica (Fase C, conectar Pedido con ARCA)

Implementación de `prompt1.md`: conecta el `Pedido` unificado (Fase B) con el cliente ARCA WSFEv1
ya probado en homologación (Fase A) para pedir un CAE real y persistirlo. Alcance acotado a
propósito: solo obtener y guardar el CAE — nada de comprobante imprimible/QR ni Nota de Crédito
(fases futuras). Siempre se factura como Consumidor Final (`DocTipo=99`/`DocNro=0`).

## Backend

- **Tabla nueva `facturas`** (modelo `Factura`): `pedido_id`, `tipo_comprobante` (default 11 =
  Factura C, campo propio para que a futuro convivan Notas de Crédito en la misma tabla),
  `punto_venta` (snapshot, no referencia viva), `numero_comprobante`, `cae`, `cae_vencimiento`,
  `fecha_emision`, `importe_total`, `doc_tipo`/`doc_nro`, `estado` (`"Emitida"` | `"Error"`),
  `mensaje_error`. Un pedido puede tener más de una fila (intentos fallidos, a futuro Nota de
  Crédito) — no es 1:1.
- **`calculations.monto_neto_pedido(db, pedido)`**: hoy es simplemente `Pedido.total` —
  `Devolucion`/`DevolucionItem` no existen todavía en el proyecto (confirmado por búsqueda en todo
  el repo), así que no hay nada que restar. Documentado como pendiente para cuando esa tabla
  exista.
- **`backend/app/facturacion.py`** (nuevo): orquesta entre `Pedido`/`Configuracion` y `arca/`
  (que sigue sin saber qué es un Pedido). `facturar_pedido(db, pedido_id)` valida en orden: pedido
  existe, `facturar_arca=True`, **`estado != "Cancelado"`** (guard agregado durante el diseño, no
  estaba en el pedido original — única red de seguridad posible hasta que exista Nota de Crédito),
  no tiene ya una Factura tipo 11 emitida, `monto_neto_pedido > 0`, hay `arca_cuit` cargado. Pide
  el CAE con `ImpNeto = monto_neto_pedido` (no `Pedido.total` a secas) y `doc_tipo`/`doc_nro`
  pasados explícitos (no los defaults de la función ni de la columna, para que lo grabado siempre
  coincida con lo mandado a ARCA). En éxito o en rechazo/error de conexión, persiste igual una
  `Factura` (con commit inmediato en el caso de error, antes de lanzar la excepción, para que quede
  historial del intento fallido).
- **`arca/wsfe.py`** (único archivo de la Fase A tocado, cambio aditivo): la respuesta aprobada
  ahora también incluye `cbte_nro` (el número real que ARCA asignó, leído de la propia respuesta)
  — evita que `facturacion.py` tenga que consultar `FECompUltimoAutorizado` una segunda vez y la
  carrera teórica que eso implicaba.
- **Endpoint `POST /pedidos/{id}/facturar`** (`routers/pedidos.py`): 400 si falla alguna
  validación previa, 502 si ARCA rechaza o hay error de conexión (con el detalle real).
- **`PedidoOut` ganó `monto_neto` y `facturas`**: como `monto_neto` no es un atributo del ORM,
  `model_validate` sin completarlo a mano cae silenciosamente a `0` (confirmado con una prueba
  directa) — se agregó un helper `_pedido_out()` usado en los 3 endpoints de `routers/pedidos.py`,
  y el mismo fix inline en `routers/ecommerce.py` (`POST /ecommerce/ordenes` usa el mismo
  `PedidoOut` y tenía el mismo riesgo).

## Frontend (`Pedidos.jsx`)

- Columna "Facturar" pasa a ser condicional: si ya hay una Factura emitida, muestra CAE +
  vencimiento + importe; si el pedido está pendiente (`facturar_arca=true`, sin factura, no
  cancelado, `monto_neto>0`), botón "Facturar"; si no, el badge Sí/No de siempre.
- Protección de doble click (**obligatoria, no cosmética**: facturar pide un CAE real, efecto
  externo irreversible sin Nota de Crédito todavía) — el botón se deshabilita mientras la request
  está en curso.
- Banner ámbar arriba de la tabla con la cuenta de pedidos pendientes de facturar y toggle "ver
  solo pendientes".

**`CLAUDE.md`** actualizado con la sección completa ("Facturación electrónica — Fase C") y dos
ideas nuevas en "pendientes": comprobante imprimible con QR, facturar con datos reales del
comprador en vez de Consumidor Final.

## Verificado

- **Contra ARCA homologación real** (no simulado, vía curl): pedido de prueba facturado → CAE real
  obtenido (`86290598422205`, comprobante N°4); reintento sobre el mismo pedido → 400 "ya tiene
  factura emitida"; pedido `facturar_arca=false` → 400; pedido `Cancelado` → 400 (guard nuevo,
  confirmado que se evalúa antes que el chequeo de "ya emitida"); `GET /pedidos` devuelve
  `monto_neto` y `facturas` correctos.
- `Devolucion`/`DevolucionItem` no existen → esa prueba puntual (CAE por monto neto tras una
  devolución parcial) quedó documentada como pendiente en `CLAUDE.md`, no se pudo ejercitar.
- **Confirmado a mano por Florencia en el navegador**: el botón "Facturar" funciona en `/pedidos`.

## Incidente durante la sesión (documentado por transparencia)

Un agente en segundo plano, lanzado originalmente para una consulta trivial de una línea (una
firma de función), siguió corriendo sin dirección y terminó re-ejecutando por su cuenta buena
parte de la implementación y verificación contra el backend real y ARCA homologación —
duplicando pedidos de prueba (#20, #21, #22) y una Factura adicional real, sin autorización para
esa acción puntual. Se verificó que el impacto quedó acotado a homologación (ambiente de prueba de
ARCA, sin consecuencia fiscal real) y, a pedido explícito, esos registros de prueba se dejaron
como están (mismo criterio que los pedidos #18/#19 creados en la verificación original).

## No se tocó

- `arca/` más allá del agregado aditivo de `cbte_nro` — sigue sin saber qué es un Pedido.
- `Compras.jsx`, Análisis, Importación, `reservas_stock`, storefront Next.js (`ecommerce/`).
- Nota de Crédito — queda para la Fase D parte 2, apoyada en esto pero no implementada todavía.
