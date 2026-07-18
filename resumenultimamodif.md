# Resumen de la última modificación — Fase B: Pedido unificado, Caja como carrito, estados de logística

Implementación de `prompt1.md`: unifica `OrdenEcommerce`/`OrdenEcommerceItem` (canal e-commerce) y las
Ventas sueltas de Caja (canal mostrador) en un solo concepto `Pedido`/`PedidoItem` que sirve a los dos
canales, agrega `canal`/`facturar_arca` y una cadena real de estados de logística, y convierte Caja en un
flujo de carrito (agregar N ítems, después confirmar todo junto). Esta fase NO conecta con ARCA
(`backend/app/arca/` queda intacto) ni implementa reversión/cancelación real de stock — `Cancelado` es
solo un estado disponible en el selector. El storefront Next.js (`ecommerce/`) no se tocó, y su contrato
HTTP (`GET /ecommerce/catalogo`, `GET /ecommerce/catalogo/{id}`, `POST /ecommerce/ordenes`) sigue
funcionando exactamente igual (verificado corriendo el smoke test real del storefront).

**Decisión de diseño — renombrar/extender la tabla existente, no crear una tabla nueva** (explicada y
justificada en el chat antes de aplicarla): se transformó `ordenes_ecommerce`/`orden_ecommerce_items` en
lugar en vez de crear un `Pedido` paralelo, porque el propio pedido era "generalizar" el concepto
existente (no duplicarlo), porque renombrar + agregar columnas nullable/con default no mueve ni una fila
(las órdenes de e-commerce ya reales conservaron su `id` y su `movimiento_id` de trazabilidad sin ningún
script de copia), y porque la superficie de código que tocaba el modelo viejo era chica y estaba mapeada
de antemano.

**Backend**
- Migración SQL aplicada a mano contra la base viva (antes de tocar el código Python, para no romper el
  hot-reload): `ALTER TABLE ordenes_ecommerce RENAME TO pedidos`, `orden_ecommerce_items RENAME TO
  pedido_items` (+ columna `orden_id`→`pedido_id`), secuencias/índices/constraints renombrados por
  prolijidad, columnas nuevas `canal VARCHAR(20) NOT NULL DEFAULT 'ecommerce'` y `facturar_arca BOOLEAN
  NOT NULL DEFAULT TRUE`, `cliente_nombre`/`forma_entrega` pasados a nullable, y un `UPDATE` que
  reescribió el valor legado `estado='Confirmada'` (6 filas, todas datos de prueba, ninguna real) a
  `'Entregado'`.
- `models.py`: `OrdenEcommerce`→`Pedido`, `OrdenEcommerceItem`→`PedidoItem`, con los campos nuevos.
- `calculations.py`: nueva tupla `ESTADOS_PEDIDO_VALIDOS` (`Pendiente`, `Preparando`, `Listo para
  retirar`, `Enviado`, `Entregado`, `Cancelado`) — sin función nueva que lance `HTTPException`,
  `validar_movimiento` sigue siendo la única con esa excepción documentada.
- `schemas.py`: `OrdenEcommerceItemOut`→`PedidoItemOut`, `OrdenEcommerceOut`→`PedidoOut` (con `canal` y
  `facturar_arca` agregados, cambio aditivo). `OrdenEcommerceCreate` NO se tocó (contrato de entrada del
  storefront). Nuevos `PedidoLocalCreate` y `PedidoEstadoUpdate`.
- `routers/ecommerce.py`: `crear_orden` ahora fija `canal="ecommerce"`, `facturar_arca=True`,
  `estado="Pendiente"` explícito (antes el default de columna decidía). Se retiró `GET
  /ecommerce/ordenes` (solo lo consumía la pantalla vieja del panel, nunca el storefront).
- Nuevo `backend/app/routers/pedidos.py`: `GET /pedidos/` (ambos canales), `POST /pedidos/` (alta de
  pedido `canal="local"` desde Caja, mismo criterio de validación atómica por línea que
  `POST /ecommerce/ordenes`, reusando `stock_disponible`/`registrar_venta` tal cual, sin el chequeo de
  `visible_ecommerce` ni de `forma_entrega`), `PUT /pedidos/{id}/estado`.
- `main.py`: registrado el router nuevo.

**Frontend**
- `frontend/src/pages/OrdenesEcommerce.jsx` borrado, reemplazado por `Pedidos.jsx` (ruta `/pedidos`):
  lista pedidos de ambos canales con badge de canal, cliente, items, total, badge de `facturar_arca`, y
  estado editable con un `<select>` inline (`PUT /pedidos/{id}/estado`, revierte si falla). Sin botón de
  Facturar (Fase C).
- `frontend/src/pages/Movimientos.jsx`: tipo Venta pasa de guardar directo a un carrito de 2 fases.
  **Armar**: el selector de categoría→producto→atributos→variante (`opcionesParaAtributo`,
  `elegirValorAtributo`, `varianteResuelta`) se reusó tal cual sin reescribirlo; un botón "+ Agregar al
  pedido" empuja el ítem al carrito en memoria contra un tope de stock que descuenta lo ya agregado.
  **Confirmar**: checkbox "Facturar (ARCA)" (arranca destildado por default) + cliente opcional +
  `POST /pedidos/`. Ingreso/Egreso y la edición/borrado de un `Movimiento` ya existente no cambiaron.
  - **Bug encontrado y corregido tras el primer pase**: agregar dos veces el mismo producto+variante
    (ej. "Calza Dua M/Verde" x2 y después x1 más) dejaba dos líneas separadas en el carrito en vez de
    sumar la cantidad en una sola. Fix: `agregarAlCarrito` ahora busca si ya existe una línea con el
    mismo `producto_id`+`variante_id` antes de agregar, y si existe le suma la cantidad en vez de
    duplicar la línea. Confirmado por la usuaria en el navegador que ya funciona bien.
- `frontend/src/App.jsx`: ruta `/ordenes-ecommerce` reemplazada por `/pedidos`.

**Verificado**
- Migración SQL corrida en la base viva sin pérdida de datos (`\d pedidos`/`\d pedido_items` confirmados,
  6 filas legado migradas).
- `POST /pedidos/` con 3 líneas (2 con variante distinta, 1 sin variante): pedido creado con
  `canal="local"`, `estado="Entregado"`, `facturar_arca=false`, y confirmado que se generaron 3
  `Movimiento` tipo Venta con `movimiento_id` correcto y que el stock bajó bien en cada producto/variante.
- Rechazo atómico: una línea con cantidad muy superior al stock disponible devolvió 400 y no creó nada
  (ni Pedido, ni PedidoItem, ni Movimiento) — conteos de `movimientos`/`pedidos` iguales antes y después.
- `POST /ecommerce/ordenes` de prueba directa: `canal="ecommerce"`, `estado="Pendiente"`,
  `facturar_arca=true`.
- Smoke test real del storefront (`ecommerce/scripts/test-checkout.ts`, corrido con un contenedor
  descartable de Node en la red de Docker Compose del proyecto): creó una orden real de punta a punta y
  rechazó correctamente un pedido con cantidad mayor al stock — confirma que el contrato de
  `POST /ecommerce/ordenes` sigue intacto pese al cambio de tabla por debajo.
- `PUT /pedidos/{id}/estado` con valor válido (200) e inválido (400 con el detalle de los estados
  válidos).
- Confirmado que `GET /ecommerce/ordenes` ya no responde (405, solo queda el `POST` en esa ruta) y que
  `GET /pedidos/` devuelve unificados tanto los pedidos e-commerce viejos (ahora `Entregado`) como los
  nuevos de ambos canales.
- Frontend: confirmado que Vite transforma `App.jsx`/`Pedidos.jsx`/`Movimientos.jsx` sin errores de
  import ni de build.

**Probado a mano en el navegador por la usuaria**: armar un pedido en Caja con varios ítems, incluyendo
agregar dos veces el mismo producto+variante — confirmado que ahora suma bien la cantidad en una sola
línea tras el fix.

**No se tocó**: `backend/app/arca/`, `ecommerce/` (storefront Next.js), la interfaz pública de
`calculations.registrar_venta`/`validar_movimiento`/`stock_disponible`, `Compras.jsx`.

CLAUDE.md actualizado con la sección nueva "Fase B — Pedido unificado (canal e-commerce + local, Caja
como carrito)", incluyendo la decisión de renombrar vs. tabla nueva, los defaults de estado por canal, el
default destildado de `facturar_arca`, y el bug del merge de líneas repetidas en el carrito ya corregido.
