# Resumen de la última modificación — Fase E: PDF de Factura/Nota de Crédito con QR (ARCA)

Implementación de `prompt1.md`: hasta ahora `facturas` solo guardaba el CAE real que devuelve ARCA, sin
ningún artefacto imprimible para entregarle a la clienta. Esta fase agrega la generación de ese PDF
(Factura C y Nota de Crédito C, con el mismo código parametrizado) con el código QR obligatorio según la
RG 4892 de ARCA. Es puramente aditiva: solo **lee** una `Factura` ya emitida, no toca el flujo de emisión
(`facturacion.py`, `arca/wsfe.py`/`wsaa.py`, `reservas_stock`, `Compras.jsx`, ni el storefront).

Como pedía `prompt1.md` explícitamente, antes de escribir código de `reportlab` se armó un mockup ASCII
del layout completo (uno para Factura C, uno para Nota de Crédito C — emisor arriba, datos de comprobante
+ CAE, receptor, tabla de ítems, totales, QR abajo del todo) y se esperó aprobación antes de implementar.
Los dos mockups se aprobaron tal cual, sin ajustes.

## 1. Backend — módulos nuevos

- **`backend/app/arca/qr.py`** (nuevo): `construir_url_qr(...)` arma
  `https://www.arca.gob.ar/fe/qr/?p={JSON en Base64}` exactamente según el mapeo de campos de la
  especificación (`ver, fecha, cuit, ptoVta, tipoCmp, nroCmp, importe, moneda="PES", ctz=1, tipoDocRec,
  nroDocRec, tipoCodAut="E", codAut`). Módulo puro, sin acceso a DB — mismo criterio de aislamiento que
  `wsaa.py`/`wsfe.py`.
- **`backend/app/facturas_pdf.py`** (nuevo, mismo nivel que `facturacion.py`): `generar_pdf_factura(db,
  factura) -> bytes`. Valida `estado == "Emitida"` y que `Configuracion.arca_razon_social`/
  `arca_domicilio_fiscal` estén cargados (lanza `ValueError`, no `HTTPException` — mismo criterio que
  `calculations.py`). Arma el QR (PNG con `qrcode`) y el PDF (`reportlab.platypus`, A4) siguiendo el
  mockup aprobado. Ítems: de `Pedido.items` para Factura C, o de `Devolucion.items` (join a su
  `PedidoItem` original) más la línea "Comprobante que rectifica" para Nota de Crédito C.
- **`GET /pedidos/{pedido_id}/facturas/{factura_id}/pdf`** (`routers/pedidos.py`): 404 si no
  corresponden, 400 si `generar_pdf_factura` rechaza, `Response` con `media_type="application/pdf"` e
  `inline` (abre en pestaña nueva). Se genera al vuelo, no se persiste nada en disco — mismo criterio que
  `GET /importacion/plantilla`.

## 2. Configuración — 2 campos nuevos

`Configuracion.arca_condicion_iva` (default `"RESPONSABLE MONOTRIBUTO"`) y `arca_inicio_actividades`
(fecha, opcional — si no está cargada, esa línea se omite del PDF). `ALTER TABLE` manual ya aplicado
sobre la base real (sin Alembic, como el resto del proyecto). Reflejados en `models.py`, `schemas.py`
(`ConfiguracionBase`/`ConfiguracionUpdate`) y en `Configuracion.jsx` (grupo "ARCA / Facturación
electrónica"). El input genérico data-driven de esa pantalla ganó un tercer `tipo: 'fecha'`
(`<input type="date">`), antes solo distinguía texto vs. numérico.

## 3. Frontend — link "Ver PDF" (`Pedidos.jsx`)

Dos `<a target="_blank">` nuevos, sin estado de React nuevo: en la columna "Facturar" (junto a
CAE/Vto/importe) y en el historial de devoluciones (junto al CAE de la Nota de Crédito ya emitida). Usan
`api.defaults.baseURL` en vez de exportar una constante `API_URL` nueva solo para esto.

## 4. Dependencias nuevas

`reportlab==4.2.5` y `qrcode[pil]==7.4.2` en `requirements.txt`. `python:3.11-slim` resolvió wheels
prearmadas para ambas sin necesitar `build-essential` (mismo chequeo que `zeep`/`cryptography` en la Fase
A) — build de la imagen backend confirmado sin errores.

## Verificado contra la API real

- Rebuild de la imagen `backend`, `ALTER TABLE` aplicado, contenedor arrancado sin errores.
- `GET /pedidos/31/facturas/17/pdf` (Factura C real, ya facturada en homologación) y
  `GET /pedidos/30/facturas/16/pdf` (Nota de Crédito C real) devuelven PDFs válidos (magic bytes
  `%PDF-1.4`…`%%EOF`, no vacíos). Texto extraído del PDF (vía `pypdf`, instalado temporalmente solo para
  verificar) confirma emisor, CAE, vencimiento, ítems con formato es-AR, total, y en la Nota de Crédito la
  línea "Comprobante que rectifica: Factura C 0001-00000013" con el número correcto.
- QR decodificado a mano: el JSON codificado coincide exactamente con el spec. **El usuario escaneó el QR
  con un lector real de celular y confirmó que resuelve correctamente contra `arca.gob.ar`.**
- Casos de error probados: `Factura` con `estado="Error"` → 400; pedido inexistente → 404; `factura_id`
  que no pertenece al `pedido_id` de la ruta → 404; `Configuracion` con `arca_domicilio_fiscal` vacío →
  400 pidiendo completar ⚙️ Configuración (probado antes de cargar los datos reales, como pedía el
  testing plan).
- `vite build` del frontend sin errores.
- Datos de prueba (fila temporal en `facturas` con `estado="Error"`, valor de prueba en
  `arca_domicilio_fiscal`) limpiados/restaurados al terminar — la base quedó como estaba antes de probar,
  salvo por los 2 campos de config nuevos (`arca_condicion_iva` con su default, `arca_inicio_actividades`
  en `null`, iguales para cualquier instalación nueva).

## `CLAUDE.md` actualizado

- **Raíz**: tabla de `configuracion` con las 2 filas nuevas (`arca_condicion_iva`,
  `arca_inicio_actividades`) y las descripciones de `arca_razon_social`/`arca_domicilio_fiscal`
  actualizadas (ya no dicen "sin uso en código"). Sacada de "Ideas mencionadas pero no implementadas" la
  entrada de comprobante imprimible con QR (ya implementada); agregada la de envío del PDF por
  email/WhatsApp (eso sigue pendiente, explícitamente fuera de alcance de esta fase).
- **`backend/CLAUDE.md`**: sección nueva "Fase E — PDF de Factura/Nota de Crédito con código QR (ARCA)".
- **`frontend/CLAUDE.md`**: sección nueva "Fase E — link 'Ver PDF' (`Pedidos.jsx`)" y nota sobre el
  `tipo: 'fecha'` en `Configuracion.jsx`.

## Qué probar a mano en el navegador

Abrir `Pedidos.jsx`, click en "Ver PDF" desde la columna Facturar y desde el historial de devoluciones —
debería abrir el PDF en una pestaña nueva. **Ya confirmado por el usuario**: el QR del PDF escaneado con
el celular resuelve contra `arca.gob.ar` correctamente.

## Qué NO se tocó

`ecommerce/` (storefront), `backend/app/arca/wsfe.py`/`wsaa.py`, `facturacion.py` (solo se lee `Factura`),
`reservas_stock`, `Compras.jsx`. Nada de envío por email/WhatsApp ni persistencia del PDF en disco.
