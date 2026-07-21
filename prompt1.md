# Fase E — PDF de Factura/Nota de Crédito con código QR (ARCA)

## Contexto
Conecta la Fase C (Factura C, tabla `facturas`) y la Fase D parte 2 (Nota de Crédito C) con un
comprobante imprimible real: PDF con todos los datos exigidos por RG 1415 + código QR según la
especificación de ARCA (RG 4892). Hasta ahora `facturas` solo guarda el CAE — no existe ningún
artefacto imprimible.

Sirve para AMBOS tipos de comprobante ya modelados en `facturas` (`tipo_comprobante=11` Factura C,
`tipo_comprobante=13` Nota de Crédito C) con la misma función, parametrizada.

**Fuera de alcance de esta fase**: exponer el PDF al storefront/cliente final (`ecommerce/` no se
toca), envío por email/WhatsApp del PDF, persistir el PDF en disco (se genera al vuelo en cada
descarga, mismo criterio que `GET /importacion/plantilla`).

## Antes de escribir código

**No escribas código de `reportlab` a ciegas.** Antes de tocar `facturas_pdf.py`, mostrame un mockup
rápido del layout completo de la página (boceto en texto/ASCII, con los bloques ubicados
aproximadamente donde van: emisor arriba, datos de comprobante y CAE, receptor, tabla de ítems,
totales, QR abajo) para que lo apruebe. Esperá mi confirmación (o los ajustes que pida) antes de
generar el PDF real con `reportlab`. Dos versiones del boceto: una para Factura C, otra para Nota de
Crédito C (con la línea de "comprobante que rectifica" incluida), ya que difieren un poco en el
encabezado y en el origen de los ítems.

## Especificación del QR (ARCA, RG 4892 — versión 1 del formato)

El QR codifica el texto `{URL}?p={JSON_BASE64}` donde:
- `URL = https://www.arca.gob.ar/fe/qr/`
- `JSON_BASE64` = el siguiente JSON, codificado en Base64 (UTF-8):

```json
{
  "ver": 1,
  "fecha": "2026-07-21",
  "cuit": 20123456789,
  "ptoVta": 1,
  "tipoCmp": 11,
  "nroCmp": 123,
  "importe": 12100.50,
  "moneda": "PES",
  "ctz": 1,
  "tipoDocRec": 99,
  "nroDocRec": 0,
  "tipoCodAut": "E",
  "codAut": 70417054367476
}
```

Mapeo exacto a campos ya existentes en el proyecto:
- `fecha` ← `Factura.fecha_emision` (formato `YYYY-MM-DD`)
- `cuit` ← `Configuracion.arca_cuit` (entero)
- `ptoVta` ← `Factura.punto_venta`
- `tipoCmp` ← `Factura.tipo_comprobante` (11 o 13)
- `nroCmp` ← `Factura.numero_comprobante`
- `importe` ← `Factura.importe_total` (float, redondeado a 2 decimales)
- `moneda` ← siempre `"PES"` (el proyecto no maneja otra moneda)
- `ctz` ← siempre `1`
- `tipoDocRec`/`nroDocRec` ← `Factura.doc_tipo`/`Factura.doc_nro` (siempre 99/0, Consumidor Final,
  igual que lo que ya se le mandó a ARCA en `FECAESolicitar` — se refleja tal cual, no se omite)
- `tipoCodAut` ← siempre `"E"` (el proyecto solo usa CAE, nunca CAEA — confirmado en Fase A)
- `codAut` ← `Factura.cae` (convertido a entero)

## Archivos nuevos

### `backend/app/arca/qr.py`
Módulo puro, sin acceso a DB — mismo criterio que el resto de `arca/` (agnóstico de `Pedido`).
Sin importar el paquete `qrcode` acá (eso es responsabilidad de la capa de presentación, ver abajo):
solo `json`/`base64` de la stdlib.

```python
def construir_url_qr(*, fecha_emision: date, cuit: int, punto_venta: int, tipo_comprobante: int,
                      numero_comprobante: int, importe_total: Decimal, doc_tipo: int, doc_nro: int,
                      cae: str) -> str:
    """Arma la URL que hay que codificar en el QR según la especificación ARCA (RG 4892, v1)."""
```
Devuelve el string completo `https://www.arca.gob.ar/fe/qr/?p=...` listo para pasarle a la librería
`qrcode`.

### `backend/app/facturas_pdf.py`
Orquestación (mismo nivel que `facturacion.py`, no adentro de `arca/`, porque necesita leer
`Pedido`/`PedidoItem`/`Devolucion`/`DevolucionItem`/`Configuracion`).

```python
def generar_pdf_factura(db: Session, factura: models.Factura) -> bytes:
```

Pasos (después de que el mockup del layout esté aprobado):
1. Si `factura.estado != "Emitida"` → `ValueError` (no se imprime un intento fallido). El router
   traduce esto a 400 — no agregues esta función a la lista de las que lanzan `HTTPException` directo
   (mismo invariante ya documentado: solo `validar_movimiento` y `facturacion.py` lo hacen).
2. Carga `Configuracion` vía `calculations.get_configuracion(db)`. Si `arca_razon_social` o
   `arca_domicilio_fiscal` es `None` → `ValueError` con mensaje claro pidiendo completar
   ⚙️ Configuración antes de imprimir (no tiene sentido emitir un comprobante legalmente incompleto).
3. Arma la URL del QR con `arca.qr.construir_url_qr(...)`, la renderiza a PNG con `qrcode` (`qrcode.make(url)`,
   guardado a un `BytesIO`).
4. Arma el PDF con `reportlab.platypus` (`SimpleDocTemplate` + `Table`/`Paragraph`/`Image`, tamaño A4),
   siguiendo el mockup aprobado en el paso anterior.
5. **Contenido, según `tipo_comprobante`**:
   - **11 (Factura C)**: ítems = todos los `PedidoItem` de `factura.pedido` (cantidad, descripción con
     `calculations.descripcion_variante` si tiene variante, precio unitario, subtotal).
   - **13 (Nota de Crédito C)**: ítems = los `DevolucionItem` de `factura.devolucion_id` (unidos a su
     `PedidoItem` original para la descripción), y una línea aparte "Comprobante que rectifica: Factura C
     {punto_venta}-{numero_comprobante}" leyendo `factura.factura_original_id`.
   - En ningún caso se discrimina IVA (leyenda fija "Responsable Monotributo — IVA no discriminado").
6. **Bloque emisor**: `arca_razon_social`, "CUIT {arca_cuit}", `arca_domicilio_fiscal`,
   `arca_condicion_iva`, "Inicio de actividades: {arca_inicio_actividades}" (si está cargada, si no
   omitir la línea sin romper el PDF).
7. **Bloque comprobante**: letra grande "C", "FACTURA" o "NOTA DE CRÉDITO" según tipo, número formateado
   `{punto_venta:04d}-{numero_comprobante:08d}`, fecha de emisión.
8. **Bloque receptor**: "Consumidor Final" (fijo, ya que `doc_tipo`/`doc_nro` siempre son 99/0 en este
   proyecto).
9. **Bloque CAE**: CAE, vencimiento, leyenda "Comprobante Autorizado".
10. QR embebido abajo del todo.
11. Devuelve los bytes del PDF (`buffer.getvalue()`).

## Endpoint nuevo (`backend/app/routers/pedidos.py`)

`GET /pedidos/{pedido_id}/facturas/{factura_id}/pdf`:
- 404 si el pedido no existe o la `Factura` no existe / no pertenece a ese `pedido_id`.
- 400 con el detalle si `facturas_pdf.generar_pdf_factura` lanza `ValueError`.
- En éxito: `Response(content=pdf_bytes, media_type="application/pdf", headers={"Content-Disposition":
  f'inline; filename="{"NC" if tipo==13 else "Factura"}C_{pto_vta:04d}-{numero:08d}.pdf"'})` — `inline`
  a propósito, para que abra en una pestaña nueva y desde ahí el navegador imprima/descargue, sin forzar
  descarga.

## Frontend (`frontend/src/pages/Pedidos.jsx`)

- Donde hoy se muestra CAE/vencimiento/importe de una Factura emitida (columna "Facturar"), agregar un
  link "Ver PDF" que abre `${API_URL}/pedidos/{id}/facturas/{factura_id}/pdf` en una pestaña nueva
  (`target="_blank"`, `<a>` simple, no hace falta axios acá).
- En el historial de devoluciones, junto a cada Nota de Crédito ya emitida (mismo lugar donde hoy se
  muestra su CAE/importe), el mismo link "Ver PDF" apuntando a su propio `factura_id`.
- No hace falta estado nuevo de React para esto — es solo un link a una URL de descarga.

## Configuración — 2 campos nuevos

`ALTER TABLE` manual (tabla ya existente):
```sql
ALTER TABLE configuracion ADD COLUMN arca_condicion_iva VARCHAR(50) NOT NULL DEFAULT 'RESPONSABLE MONOTRIBUTO';
ALTER TABLE configuracion ADD COLUMN arca_inicio_actividades DATE;
```
Agregar ambos al mismo grupo de `GRUPOS` en `Configuracion.jsx` donde ya viven `arca_cuit`,
`arca_punto_venta_defecto`, `arca_razon_social`, `arca_domicilio_fiscal`.

## Dependencias nuevas (`backend/requirements.txt`)

- `reportlab` (armado del PDF — layout con `Table`/`Paragraph`, sin dependencias nativas de sistema
  más allá de lo que ya trae Pillow).
- `qrcode[pil]` (genera el PNG del QR, usa Pillow como backend de imagen).

Verificar al levantar el build que `python:3.11-slim` resuelve wheels prearmadas para las dos (mismo
chequeo que ya se hizo con `zeep`/`cryptography` en la Fase A) — si en algún momento fuerza compilación
desde código fuente, recién ahí agregar `build-essential`, no antes.

## Testing (sin navegador, según convención del proyecto)

1. Levantar el stack, facturar un pedido de prueba en homologación (ya probado en Fase C).
2. `curl -o factura.pdf http://localhost:8000/pedidos/{id}/facturas/{factura_id}/pdf` y confirmar que
   el archivo resultante es un PDF válido no vacío (`file factura.pdf`).
3. Caso de error: pedir el PDF de una `Factura` con `estado="Error"` → confirmar 400.
4. Caso de error: con `arca_razon_social` en `null`, confirmar que el endpoint rechaza con 400 y el
   mensaje pide completar Configuración (probarlo antes de cargar los datos reales).
5. Repetir los puntos 2-3 para una Nota de Crédito C ya emitida (`tipo_comprobante=13`), confirmando que
   el PDF trae la línea "Comprobante que rectifica".
6. Avisar explícitamente qué probar a mano en el navegador antes de dar el cambio por bueno: abrir el
   link "Ver PDF" desde `Pedidos.jsx` y escanear el QR resultante con un lector real de celular para
   confirmar que el link a `arca.gob.ar` resuelve.

## Qué NO se toca

`ecommerce/` (storefront), `backend/app/arca/wsfe.py`/`wsaa.py`, `facturacion.py` (solo se lee `Factura`,
no se modifica el flujo de emisión), `reservas_stock`, `Compras.jsx`.
