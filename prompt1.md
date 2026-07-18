Fase A de facturación electrónica: integración técnica con ARCA (WSAA + WSFEv1) para Factura C
(monotributista), aislada — todavía no se conecta con ningún Pedido ni pantalla nueva. El objetivo de
esta fase es validar que FashBalance puede autenticarse y pedir un CAE real contra el ambiente de
homologación, antes de construir nada más encima.

## Contexto de negocio, para que no se pierda al codificar

Florencia es monotributista, emite Factura C. WSFEv1 (el servicio real a usar) es el más simple de los
que ofrece ARCA para este caso: no lleva desglose de IVA (prohibido informarlo para tipo C), la fórmula
es `ImpTotal = ImpNeto + ImpTrib` (`ImpNeto` es el subtotal de la operación, no "neto gravado" como en
Factura A/B), y **no lleva detalle de ítem** — se factura el total de una operación, no producto por
producto. Concepto = 1 (Productos), porque Adorante vende indumentaria física.

## 1. Certificados y configuración

Los certificados están en arca_certs/ en la raíz del repo.

Dos certificados X.509 (uno de testing, gestionado vía WSASS con Clave Fiscal; uno de producción, vía
"Administrador de Certificados Digitales"). El código tiene que
esperarlos como archivos en un volumen/carpeta montada (mismo criterio que ya se usa para las fotos de
producto: secreto de infraestructura, nunca en el repo, `.gitignore`).

Variables de entorno nuevas: `ARCA_ENTORNO` (`testing` | `produccion`), `ARCA_CUIT` (el CUIT de
Florencia), y las rutas a certificado/clave privada correspondientes al entorno activo. Según
`ARCA_ENTORNO`, el código elige las URLs correctas:
- Testing: WSAA `https://wsaahomo.afip.gov.ar/ws/services/LoginCms`, WSFEv1
  `https://wswhomo.afip.gov.ar/wsfev1/service.asmx`
- Producción: WSAA `https://wsaa.afip.gov.ar/ws/services/LoginCms`, WSFEv1
  `https://servicios1.afip.gov.ar/wsfev1/service.asmx`

Nada de branches para esto — es 100% configuración, mismo código para los dos entornos.

## 2. Cliente WSAA (autenticación)

Módulo nuevo (`backend/app/arca/wsaa.py` o similar, aislado del resto de `calculations.py`/routers —
esto es integración externa, no lógica de negocio del catálogo). Responsabilidades:
- Armar el `TRA` (Ticket de Requerimiento de Acceso) pidiendo el servicio `"wsfe"` (así, no "wsfev1" —
  es el nombre de servicio que espera WSAA).
- Firmarlo con el certificado/clave privada del entorno activo (CMS/PKCS#7).
- Pedirle el Ticket de Acceso a WSAA, obteniendo `Token` y `Sign`.
- **Cachear el resultado 12 horas** (duración real del ticket) y reusarlo — no pedir uno nuevo en cada
  llamada a WSFEv1. Un archivo o tabla chica alcanza para el caché, no hace falta nada elaborado.

## 3. Cliente WSFEv1 (facturación)

Módulo nuevo (`backend/app/arca/wsfe.py` o similar), usando el Token/Sign del punto 2. Solo estos
métodos, no implementes el resto del catálogo enorme de WSFEv1 que no aplica a Factura C:
- `FEDummy`: chequeo de que el servicio está arriba, útil para un test rápido de conectividad.
- `FECompUltimoAutorizado`: consulta el último número de comprobante autorizado para un
  tipo/puntoVenta — hay que llamarlo SIEMPRE antes de `FECAESolicitar` para saber el próximo número
  (`CbteDesde = CbteHasta = último + 1`). No mantengas un contador propio en la base que pueda
  desincronizarse de ARCA — ARCA es la fuente de verdad del número de comprobante.
- `FECAESolicitar`: pide el CAE. Para Factura C (`CbteTipo = 11`), armá el request con:
  - `Concepto = 1`
  - `CbteDesde = CbteHasta` (obligatorio para tipo C, un solo comprobante por request)
  - `ImpTotConc = 0`, `ImpOpEx = 0`, `ImpIVA = 0` (todos en cero, es lo que exige tipo C)
  - `ImpNeto` = el subtotal de la operación
  - `ImpTrib` = 0 (no hay tributos/percepciones en este negocio por ahora)
  - `ImpTotal = ImpNeto + ImpTrib`
  - **NO mandar el array `<Iva>`** — está prohibido para tipo C, lo rechaza si lo mandás.
  - `MonId = "PES"`, `MonCotiz = 1`
  - `DocTipo`/`DocNro`: parametrizables por la función (en esta fase, probalo con Consumidor Final —
    `DocTipo = 99`, `DocNro = 0` — que va a ser el caso más común en la práctica).
- Función que interprete la respuesta: si `Resultado = "A"` (aprobado), devolver CAE + fecha de
  vencimiento; si viene con `Observaciones`, devolverlas igual (se aprobó pero con avisos, no es un
  error); si `Resultado = "R"` (rechazado) o viene `<Errors>`, devolver el detalle del error de forma
  clara — no una excepción genérica sin contexto.

## Qué NO hacer en esta fase

No toques `Pedido`, `OrdenEcommerce`, Caja, ni ninguna pantalla del frontend. No implementes CAEA (solo
CAE, que es lo que corresponde acá). No implementes ningún otro tipo de comprobante que no sea Factura C
(11), ni Nota de Débito/Crédito C todavía. No hardcodees el CUIT ni ningún dato de Florencia en el código
— todo sale de las variables de entorno del punto 1.

## Antes de terminar

Escribí un script de prueba que, contra el ambiente de testing/homologación:
1. Llame a `FEDummy` y confirme que el servicio responde.
2. Obtenga un Token/Sign válido de WSAA.
3. Consulte `FECompUltimoAutorizado` para Factura C, punto de venta de prueba.
4. Pida un CAE real con `FECAESolicitar` para una Factura C de prueba (ej. `ImpNeto = 1000`,
   Consumidor Final) y muestre el CAE y la fecha de vencimiento obtenidos.
5. Pruebe un caso que debería rechazar (ej. mandar el array de IVA en un comprobante tipo C) y confirme
   que se recibe el error esperado, no una excepción sin manejar.

Esto va a requerir que yo tenga generado el certificado de testing y la variable `ARCA_CUIT` cargada
antes de que puedas correr el script — avisame si llegás a ese punto y todavía no está listo de mi lado.
Actualizá el CLAUDE.md con una sección nueva "Facturación electrónica (Fase A — integración ARCA)"
documentando la arquitectura, por qué WSFEv1 sin detalle de ítem simplifica el diseño, y las decisiones
específicas de Factura C (sin IVA, ImpNeto=subtotal, etc.).
