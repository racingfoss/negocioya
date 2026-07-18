# Resumen de la última modificación — Fase A: integración técnica con ARCA (WSAA + WSFEv1)

Implementación de `prompt1.md`: autenticación contra ARCA (WSAA) y pedido de CAE real para Factura C
(WSFEv1) contra homologación. Fase 100% de integración técnica, aislada — no toca `Pedido`,
`OrdenEcommerce`, Caja ni ninguna pantalla de facturación (la única excepción es el agregado puntual a
⚙️ Configuración descrito abajo, pedido explícito del usuario posterior al alcance original del prompt).
Ningún camino conecta todavía una Venta/Orden real con una Factura — eso queda para una fase futura no
planificada.

**Backend — paquete nuevo `backend/app/arca/`**
- `config.py`: constantes de entorno (`ARCA_ENTORNO`, `ARCA_CERT_PATH`, `ARCA_KEY_PATH`,
  `ARCA_CACHE_DIR`), resuelve las URLs de WSAA/WSFEv1 de testing/producción sin ningún branch de
  lógica en el resto del código.
- `wsaa.py`: arma la TRA, la firma como CMS/PKCS#7 con `cryptography` (sin `DetachedSignature`,
  contenido embebido tal como exige WSAA), pide el ticket vía `zeep` y lo cachea 12hs en disco
  (`/app/arca_cache/ticket_{entorno}_{servicio}.json`).
- `wsfe.py`: `FEDummy`, `FECompUltimoAutorizado` (siempre se llama antes de pedir un CAE, ARCA es la
  fuente de verdad del número), `FECAESolicitar` armado para Factura C (`Concepto=1`,
  `CbteDesde=CbteHasta`, `ImpTotConc=ImpOpEx=ImpIVA=ImpTrib=0`, `ImpNeto`=subtotal,
  `ImpTotal=ImpNeto+ImpTrib`, sin la clave `Iva`). Incluye `CondicionIVAReceptorId` (default 5 =
  Consumidor Final) — campo que ARCA exige hoy y no estaba en el detalle original del prompt, se
  agregó a pedido explícito del usuario antes de programar.
- `probar_conexion.py`: script de prueba manual (`docker compose exec backend python -m
  app.arca.probar_conexion`), corre los 5 pasos pedidos (FEDummy, ticket WSAA, último autorizado, CAE
  real, caso de rechazo mandando `<Iva>` en una Factura C a propósito).
- Dos bugs reales de integración con `zeep`, encontrados corriendo el script contra ARCA real y ya
  corregidos: (1) zeep lanza `AttributeError` en vez de devolver `None` para elementos opcionales
  ausentes en la respuesta SOAP; (2) el campo de observaciones en `FECAEDetResponse` se llama
  `Observaciones`, no `Obs` (ese es el nombre del elemento *dentro* del array).

**Backend — `configuracion` (4 campos nuevos, pedido explícito del usuario que amplía el alcance
original del prompt)**
- `arca_cuit`, `arca_punto_venta_defecto` (default 1), `arca_razon_social`, `arca_domicilio_fiscal` en
  `models.py`/`schemas.py`. `ALTER TABLE` ya aplicado a la DB corriendo.
- Desvío deliberado respecto del prompt original (que pedía el CUIT solo por variable de entorno): el
  usuario pidió que CUIT y punto de venta sean editables desde ⚙️ Configuración, y de paso pidió sumar
  Razón Social y Domicilio Fiscal (sin uso todavía en el código de esta fase — quedan cargados para la
  fase que arme el comprobante imprimible).
- `Configuracion.jsx` (panel): sección nueva "ARCA / Facturación electrónica" con los 4 campos.

**Infraestructura**
- `docker-compose.yml`: `ARCA_ENTORNO` como env var del backend; bind mount de solo lectura
  `./arca_certs:/app/arca_certs:ro` (certificados que administra Florencia a mano vía WSASS, distinto
  del patrón de named volume que usa `fotos_productos`); named volume nuevo
  `fashbalance_arca_cache:/app/arca_cache` para el cache del ticket (separado de los certs porque
  necesita escritura).
- `.env`: agregado solo `ARCA_ENTORNO=testing`. El CUIT real que pasó el usuario en el chat
  (27360741104) se cargó directo en la base vía `PUT /configuracion`, nunca quedó en ningún archivo.
- `requirements.txt`: `zeep` + `cryptography`. Buildearon sin problema en `python:3.11-slim`, no hizo
  falta tocar el Dockerfile.

**Verificado**
- `docker compose build backend` — build limpio.
- `docker compose up -d backend` — arranca normal, certs montados, cache escribible.
- `curl PUT/GET /configuracion/` — los 4 campos nuevos persisten.
- `docker compose exec backend python -m app.arca.probar_conexion` corrido **contra homologación real
  de ARCA**, los 5 pasos pasaron:
  1. `FEDummy` → OK.
  2. Ticket WSAA obtenido (Token/Sign reales), reusado de cache en corridas posteriores (mismo
     vencimiento confirmado en dos corridas distintas).
  3. `FECompUltimoAutorizado` → número real devuelto por ARCA.
  4. `FECAESolicitar` → **CAE real emitido** (`86290596791490`, vencimiento `20260728`).
  5. Caso de rechazo a propósito (array `Iva` en Factura C) → rechazado con el error real de ARCA
     ("Para comprobantes tipo C el objeto IVA no debe informarse", código 10071), no una excepción sin
     manejar.
- `git status` confirmado: `.env` y `arca_certs/` siguen fuera del control de versiones.

**Falta probar a mano en el navegador** (no se puede confirmar desde acá):
1. Abrir ⚙️ Configuración, confirmar que aparece la sección "ARCA / Facturación electrónica" con los 4
   campos, guardarlos y refrescar para confirmar que persisten.

**No se tocó**: Compras, Movimientos, Caja, `Pedido`, `OrdenEcommerce`, ni ninguna otra pantalla del
panel o del storefront. Nada de CAEA. Ningún otro tipo de comprobante que Factura C (11).

CLAUDE.md actualizado con la sección nueva "Facturación electrónica (Fase A — integración ARCA)" y los
4 campos sumados a la tabla de "Configuración del negocio".
