from datetime import date, datetime, timezone

from sqlalchemy import (
    Boolean, Column, Date, DateTime, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from .database import Base


def _now_utc():
    return datetime.now(timezone.utc)


class Categoria(Base):
    """Familia de productos, definida libremente por el usuario (no hardcodeada).
    Se anida vía `parent_id` (adjacency list) para soportar subcategorías sin límite
    de profundidad, ej. "Ropa de fiesta" > "Vestido" > "Corto"."""
    __tablename__ = "categorias"

    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String(100), unique=True, nullable=False)
    descripcion = Column(String(255), nullable=True)
    parent_id = Column(Integer, ForeignKey("categorias.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    productos = relationship("Producto", back_populates="categoria")
    parent = relationship("Categoria", remote_side=[id], back_populates="hijos")
    hijos = relationship("Categoria", back_populates="parent")


class Producto(Base):
    """Ficha maestra de la prenda. Se carga UNA vez.
    El stock y el costo promedio se derivan de la tabla `compras`, no se cargan acá."""
    __tablename__ = "productos"

    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String(150), nullable=False)
    codigo = Column(String(50), unique=True, nullable=True)  # SKU/código de barras, opcional, no se usa para importar
    categoria_id = Column(Integer, ForeignKey("categorias.id", ondelete="SET NULL"), nullable=True)
    precio_venta = Column(Numeric(12, 2), nullable=False)
    costo = Column(Numeric(12, 2), nullable=False, default=0)  # costo promedio ponderado, se recalcula solo
    mix_pct = Column(Numeric(5, 2), nullable=False, default=0)
    lead_time_dias = Column(Integer, nullable=True)  # plazo medio de reposición del proveedor, opcional
    activo = Column(Boolean, default=True, nullable=False)
    tiene_variantes = Column(Boolean, default=False, nullable=False)
    visible_ecommerce = Column(Boolean, default=False, nullable=False)  # opt-in explícito, nada se publica solo
    descripcion_ecommerce = Column(Text, nullable=True)  # texto para el público, distinto de cualquier dato interno
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    categoria = relationship("Categoria", back_populates="productos")
    movimientos = relationship("Movimiento", back_populates="producto")
    compras = relationship("Compra", back_populates="producto", cascade="all, delete-orphan")
    atributos = relationship("ProductoAtributo", back_populates="producto", cascade="all, delete-orphan", order_by="ProductoAtributo.orden")
    variantes = relationship("Variante", back_populates="producto", cascade="all, delete-orphan")
    fotos = relationship("ProductoFoto", back_populates="producto", cascade="all, delete-orphan", order_by="ProductoFoto.orden")


class Compra(Base):
    """Cada reposición de stock de un producto: cantidad, costo y fecha propios.
    Un producto puede tener muchas compras a lo largo del tiempo."""
    __tablename__ = "compras"

    id = Column(Integer, primary_key=True, index=True)
    producto_id = Column(Integer, ForeignKey("productos.id", ondelete="CASCADE"), nullable=False)
    variante_id = Column(Integer, ForeignKey("variantes.id", ondelete="SET NULL"), nullable=True)
    fecha = Column(Date, nullable=False, default=date.today)
    cantidad = Column(Integer, nullable=False)
    costo_unitario = Column(Numeric(12, 2), nullable=False)
    proveedor = Column(String(150), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    producto = relationship("Producto", back_populates="compras")
    variante = relationship("Variante", back_populates="compras")


class CostoFijo(Base):
    __tablename__ = "costos_fijos"

    id = Column(Integer, primary_key=True, index=True)
    concepto = Column(String(150), nullable=False)
    monto = Column(Numeric(12, 2), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    movimientos = relationship("Movimiento", back_populates="costo_fijo")


class Movimiento(Base):
    """Movimiento de caja. tipo: 'Venta' (siempre atada a producto, alimenta BCG/stock/sell-through),
    'Ingreso' (otros ingresos sin producto), 'Egreso' (gastos)."""
    __tablename__ = "movimientos"

    id = Column(Integer, primary_key=True, index=True)
    fecha = Column(DateTime(timezone=True), nullable=False, default=_now_utc)
    tipo = Column(String(10), nullable=False)  # "Venta" | "Ingreso" | "Egreso"
    concepto = Column(Text, nullable=True)
    cantidad = Column(Integer, nullable=True, default=1)
    monto = Column(Numeric(12, 2), nullable=False)
    producto_id = Column(Integer, ForeignKey("productos.id", ondelete="SET NULL"), nullable=True)
    variante_id = Column(Integer, ForeignKey("variantes.id", ondelete="SET NULL"), nullable=True)
    costo_fijo_id = Column(Integer, ForeignKey("costos_fijos.id", ondelete="SET NULL"), nullable=True)

    producto = relationship("Producto", back_populates="movimientos")
    variante = relationship("Variante", back_populates="movimientos")
    costo_fijo = relationship("CostoFijo", back_populates="movimientos")


# ---------------------------------------------------------------------------
# Variantes de producto: patrón Atributo + Valor + Variante (estilo Shopify/VTEX),
# definidos libremente por la usuaria (nada hardcodeado tipo "talle"/"color").
# ---------------------------------------------------------------------------
class Atributo(Base):
    """Ej: "Talle", "Color". Reutilizable entre productos."""
    __tablename__ = "atributos"

    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String(100), unique=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    valores = relationship("ValorAtributo", back_populates="atributo", cascade="all, delete-orphan")


class ValorAtributo(Base):
    """Ej: "S"/"M"/"L" para Talle, "Verde"/"Azul" para Color."""
    __tablename__ = "valores_atributo"

    id = Column(Integer, primary_key=True, index=True)
    atributo_id = Column(Integer, ForeignKey("atributos.id", ondelete="CASCADE"), nullable=False)
    valor = Column(String(100), nullable=False)

    atributo = relationship("Atributo", back_populates="valores")


class ProductoAtributo(Base):
    """Qué atributos aplican a un producto puntual, y en qué orden.
    El orden no es cosmético: orden=1 agrupa el stock en subtotales (ver stock_por_producto_arbol
    en calculations.py), el resto queda como detalle de cada hoja."""
    __tablename__ = "producto_atributos"
    __table_args__ = (UniqueConstraint("producto_id", "atributo_id", name="uq_producto_atributo"),)

    id = Column(Integer, primary_key=True, index=True)
    producto_id = Column(Integer, ForeignKey("productos.id", ondelete="CASCADE"), nullable=False)
    atributo_id = Column(Integer, ForeignKey("atributos.id", ondelete="CASCADE"), nullable=False)
    orden = Column(Integer, nullable=False, default=1)

    producto = relationship("Producto", back_populates="atributos")
    atributo = relationship("Atributo")


class Variante(Base):
    """La unidad real que tiene stock: una combinación puntual de valores de atributo
    (ej. Talle M + Color Verde). El costo NO se trackea por variante: todas las
    variantes de un producto comparten el mismo costo promedio ponderado
    (`producto.costo`), calculado sobre TODAS las compras del producto sin importar
    la variante (ver recalcular_costo_promedio en calculations.py) — se descartó el
    costo por variante porque en la práctica el costo no varía entre talle/color."""
    __tablename__ = "variantes"

    id = Column(Integer, primary_key=True, index=True)
    producto_id = Column(Integer, ForeignKey("productos.id", ondelete="CASCADE"), nullable=False)
    activo = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    producto = relationship("Producto", back_populates="variantes")
    valores = relationship("VarianteValor", back_populates="variante", cascade="all, delete-orphan")
    compras = relationship("Compra", back_populates="variante")
    movimientos = relationship("Movimiento", back_populates="variante")


class VarianteValor(Base):
    """Tabla puente: permite que una variante combine N atributos (no limitado a 2)."""
    __tablename__ = "variante_valores"
    __table_args__ = (UniqueConstraint("variante_id", "valor_atributo_id", name="uq_variante_valor"),)

    id = Column(Integer, primary_key=True, index=True)
    variante_id = Column(Integer, ForeignKey("variantes.id", ondelete="CASCADE"), nullable=False)
    valor_atributo_id = Column(Integer, ForeignKey("valores_atributo.id", ondelete="CASCADE"), nullable=False)

    variante = relationship("Variante", back_populates="valores")
    valor_atributo = relationship("ValorAtributo")


# ---------------------------------------------------------------------------
# Configuración del negocio: fila única (singleton, id fijo = 1) con los
# "números mágicos" que antes eran constantes de módulo hardcodeadas en
# calculations.py. Ver get_configuracion() ahí, y la sección correspondiente
# en CLAUDE.md para el detalle de qué controla cada campo y sus defaults.
# ---------------------------------------------------------------------------
class Configuracion(Base):
    __tablename__ = "configuracion"

    id = Column(Integer, primary_key=True, default=1)
    demanda_ventana_dias = Column(Integer, nullable=False, default=90)
    lead_time_default_dias = Column(Integer, nullable=False, default=7)
    safety_days = Column(Integer, nullable=False, default=3)
    stock_dias_verde = Column(Integer, nullable=False, default=30)
    stock_dias_rojo = Column(Integer, nullable=False, default=7)
    rotacion_alerta_dias = Column(Integer, nullable=False, default=90)
    umbral_cambio_costo_pct = Column(Numeric(5, 2), nullable=False, default=2.0)
    renegociacion_margen_umbral_pct = Column(Numeric(5, 2), nullable=False, default=15.0)
    renegociacion_percentil_volumen = Column(Numeric(4, 3), nullable=False, default=0.7)
    motor_decoracion_pareto_pct = Column(Numeric(5, 2), nullable=False, default=80.0)
    mix_real_ventana_dias_default = Column(Integer, nullable=False, default=30)
    snapshot_periodo_dias = Column(Integer, nullable=False, default=30)
    # Minutos de vida de una reserva de stock para un pedido en armado en Caja — ver
    # ReservaStock más abajo y la sección "Reserva de stock" en CLAUDE.md.
    reserva_stock_minutos = Column(Integer, nullable=False, default=20)
    # Identidad de la tienda para el storefront (ecommerce/) — reemplaza a las env vars fijas
    # WHATSAPP_NUMERO/INSTAGRAM_URL/FACEBOOK_URL de la Fase 1, editable sin rebuild.
    # Expuesto al storefront vía GET /ecommerce/configuracion-tienda (schema dedicado, con
    # X-API-Key), nunca por GET /configuracion (Admin API interna, sin auth).
    nombre_ecommerce = Column(String(100), nullable=False, default="Adorante")
    whatsapp_numero = Column(String(30), nullable=True)
    instagram_url = Column(String(255), nullable=True)
    facebook_url = Column(String(255), nullable=True)
    # Destino del mailto: armado por el formulario de Contacto del storefront (Fase 2). Sin
    # default, igual que whatsapp_numero/instagram_url/facebook_url — si queda vacío, el storefront
    # oculta el formulario y muestra solo el botón de WhatsApp.
    email_contacto = Column(String(150), nullable=True)
    # Facturación electrónica (Fase A — integración ARCA). Datos de negocio editables desde
    # ⚙️ Configuración, no variables de entorno (esas son solo para lo que depende del filesystem/
    # red del contenedor: rutas de certificado, URLs de ARCA — ver backend/app/arca/config.py).
    # arca_razon_social/arca_domicilio_fiscal no los usa todavía ningún código de esta fase (WSFEv1
    # no lleva esos datos en el request de CAE) — se cargan ya para no rehacer esta pantalla cuando
    # llegue la fase que arme el comprobante imprimible.
    arca_cuit = Column(String(20), nullable=True)
    arca_punto_venta_defecto = Column(Integer, nullable=False, default=1)
    arca_razon_social = Column(String(150), nullable=True)
    arca_domicilio_fiscal = Column(String(255), nullable=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


# ---------------------------------------------------------------------------
# Snapshot periódico del mix real (% de facturación) de cada producto activo,
# para poder graficar su evolución en el tiempo. `producto_id` es nullable y
# `producto_nombre`/`categoria_nombre` se guardan como texto plano (no FK de
# lectura) a propósito: el histórico tiene que seguir siendo legible aunque el
# producto se borre, se renombre o cambie de categoría más adelante.
# ---------------------------------------------------------------------------
class MixSnapshot(Base):
    __tablename__ = "mix_snapshots"

    id = Column(Integer, primary_key=True, index=True)
    fecha = Column(DateTime(timezone=True), nullable=False, default=_now_utc)
    ventana_dias = Column(Integer, nullable=False)
    producto_id = Column(Integer, ForeignKey("productos.id", ondelete="SET NULL"), nullable=True)
    producto_nombre = Column(String(150), nullable=False)
    categoria_nombre = Column(String(100), nullable=True)
    mix_pct = Column(Numeric(6, 3), nullable=False)
    facturacion = Column(Numeric(12, 2), nullable=False)


# ---------------------------------------------------------------------------
# E-commerce (Fase 0): base para que un servicio de e-commerce separado consuma
# el catálogo y registre órdenes. Pedido/PedidoItem (Fase B) generalizan lo que
# empezó acá como OrdenEcommerce/OrdenEcommerceItem a un concepto que sirve para
# los dos canales de venta (ecommerce y local/mostrador). Ver sección
# "E-commerce" y "Fase B — Pedido unificado" en CLAUDE.md para el detalle completo.
# ---------------------------------------------------------------------------
class ProductoFoto(Base):
    """Fotos de un producto para el catálogo público. `orden` define el orden de
    visualización — orden=1 es la portada. `ondelete="CASCADE"` a propósito
    (a diferencia de Compra/Movimiento con SET NULL): una foto sin producto no
    tiene ningún valor histórico que conservar."""
    __tablename__ = "producto_fotos"

    id = Column(Integer, primary_key=True, index=True)
    producto_id = Column(Integer, ForeignKey("productos.id", ondelete="CASCADE"), nullable=False)
    ruta_archivo = Column(String(255), nullable=False)  # relativo a FOTOS_DIR, ej. "12/3f9a2b1c.jpg"
    orden = Column(Integer, nullable=False, default=1)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    producto = relationship("Producto", back_populates="fotos")


class Pedido(Base):
    """Pedido unificado de los dos canales de venta (Fase B). `canal`: "ecommerce" | "local".
    `facturar_arca`: siempre True para "ecommerce" (toda venta online se factura), lo decide
    un checkbox en Caja para "local". `estado`: cadena de logística
    Pendiente -> Preparando -> Listo para retirar/Enviado (según forma_entrega) -> Entregado,
    con Cancelado disponible como alternativa en cualquier punto antes de Entregado (sin
    ningún efecto de reversión de stock todavía, eso es una fase futura). Default de estado
    por canal: "ecommerce" arranca en Pendiente (falta prepararlo/enviarlo), "local" arranca
    directo en Entregado (la clienta se lo lleva en el momento). `cliente_nombre` y
    `forma_entrega` son nullable porque no aplican igual a un pedido de mostrador."""
    __tablename__ = "pedidos"

    id = Column(Integer, primary_key=True, index=True)
    fecha = Column(DateTime(timezone=True), nullable=False, default=_now_utc)
    canal = Column(String(20), nullable=False)  # "ecommerce" | "local"
    facturar_arca = Column(Boolean, nullable=False, default=True)
    estado = Column(String(20), nullable=False)
    cliente_nombre = Column(String(150), nullable=True)
    cliente_email = Column(String(150), nullable=True)
    cliente_telefono = Column(String(50), nullable=True)
    forma_entrega = Column(String(20), nullable=True)  # "Retiro en persona" | "Envío", solo canal ecommerce
    direccion_envio = Column(Text, nullable=True)
    notas = Column(Text, nullable=True)
    # Qué opción visual tildó el cliente en el checkout (ej. "Efectivo al retirar",
    # "Transferencia bancaria") — puramente informativo, no dispara ninguna lógica de pago real.
    metodo_pago_preferido = Column(String(50), nullable=True)
    total = Column(Numeric(12, 2), nullable=False)

    items = relationship("PedidoItem", back_populates="pedido", cascade="all, delete-orphan")
    facturas = relationship("Factura", back_populates="pedido", cascade="all, delete-orphan")
    devoluciones = relationship("Devolucion", back_populates="pedido", cascade="all, delete-orphan")


class PedidoItem(Base):
    """Línea de un Pedido (cualquier canal). `precio_unitario` se guarda como valor propio
    (no se lee del producto por join) — mismo criterio de denormalización deliberada
    que MixSnapshot, para que el histórico no dependa de que el precio no haya
    cambiado después. `movimiento_id` referencia el Movimiento tipo Venta que esta
    línea generó, para trazabilidad."""
    __tablename__ = "pedido_items"

    id = Column(Integer, primary_key=True, index=True)
    pedido_id = Column(Integer, ForeignKey("pedidos.id", ondelete="CASCADE"), nullable=False)
    producto_id = Column(Integer, ForeignKey("productos.id", ondelete="SET NULL"), nullable=True)
    variante_id = Column(Integer, ForeignKey("variantes.id", ondelete="SET NULL"), nullable=True)
    cantidad = Column(Integer, nullable=False)
    precio_unitario = Column(Numeric(12, 2), nullable=False)
    movimiento_id = Column(Integer, ForeignKey("movimientos.id", ondelete="SET NULL"), nullable=True)

    pedido = relationship("Pedido", back_populates="items")
    producto = relationship("Producto")
    variante = relationship("Variante")
    movimiento = relationship("Movimiento")


class Factura(Base):
    """Intento de facturación ARCA (WSFEv1) de un Pedido — Fase C. Un pedido puede tener más de
    una fila con el tiempo (intentos fallidos, y a futuro una Nota de Crédito), por eso no es
    una relación 1:1 forzada. `tipo_comprobante` es un campo propio (no hardcodeado en la
    query) porque una futura Nota de Crédito C usaría 13 en esta misma tabla, aunque esta fase
    solo emite 11 (Factura C). `punto_venta` es un snapshot del valor de `configuracion` al
    momento de facturar, no una referencia viva. `doc_tipo`/`doc_nro` default a Consumidor
    Final (99/0) pero `facturacion.py` siempre los pasa explícitos al crear la fila — el
    default de columna es solo una red de seguridad, no la fuente de verdad."""
    __tablename__ = "facturas"

    id = Column(Integer, primary_key=True, index=True)
    pedido_id = Column(Integer, ForeignKey("pedidos.id", ondelete="CASCADE"), nullable=False)
    tipo_comprobante = Column(Integer, nullable=False, default=11)  # 11 = Factura C
    punto_venta = Column(Integer, nullable=False)
    numero_comprobante = Column(Integer, nullable=True)
    cae = Column(String(20), nullable=True)
    cae_vencimiento = Column(Date, nullable=True)
    fecha_emision = Column(DateTime(timezone=True), nullable=True)
    importe_total = Column(Numeric(12, 2), nullable=False)
    doc_tipo = Column(Integer, nullable=False, default=99)  # 99 = Consumidor Final
    doc_nro = Column(Integer, nullable=False, default=0)
    estado = Column(String(20), nullable=False)  # "Emitida" | "Error"
    mensaje_error = Column(Text, nullable=True)  # también guarda observaciones de ARCA en éxito
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    pedido = relationship("Pedido", back_populates="facturas")


class Devolucion(Base):
    """Reversión de una Venta ya confirmada de un Pedido (Fase D parte 1) — cancelación (antes de
    entregar) o devolución (después), misma mecánica para las dos. `tipo` es solo para mostrar en
    la UI. Es un evento nuevo, nunca una edición retroactiva del Movimiento de Venta original —
    mismo criterio ya aplicado en todo el proyecto."""
    __tablename__ = "devoluciones"

    id = Column(Integer, primary_key=True, index=True)
    pedido_id = Column(Integer, ForeignKey("pedidos.id", ondelete="CASCADE"), nullable=False)
    fecha = Column(DateTime(timezone=True), nullable=False, default=_now_utc)
    motivo = Column(Text, nullable=True)
    tipo = Column(String(20), nullable=False)  # "Cancelacion" | "Devolucion"

    pedido = relationship("Pedido", back_populates="devoluciones")
    items = relationship("DevolucionItem", back_populates="devolucion", cascade="all, delete-orphan")


class DevolucionItem(Base):
    """Línea de una Devolución — cuánto se devuelve de un PedidoItem puntual (puede ser menor a
    su cantidad original). `movimiento_id` referencia el Movimiento tipo "Devolucion" que esta
    línea generó, mismo patrón de trazabilidad que PedidoItem.movimiento_id."""
    __tablename__ = "devolucion_items"

    id = Column(Integer, primary_key=True, index=True)
    devolucion_id = Column(Integer, ForeignKey("devoluciones.id", ondelete="CASCADE"), nullable=False)
    pedido_item_id = Column(Integer, ForeignKey("pedido_items.id", ondelete="CASCADE"), nullable=False)
    cantidad = Column(Integer, nullable=False)
    movimiento_id = Column(Integer, ForeignKey("movimientos.id", ondelete="SET NULL"), nullable=True)

    devolucion = relationship("Devolucion", back_populates="items")
    pedido_item = relationship("PedidoItem")
    movimiento = relationship("Movimiento")


class ReservaStock(Base):
    """Reserva efímera de stock para un pedido en armado en Caja (Fase B+). Vence sola por
    tiempo — cualquier cálculo de disponibilidad (calculations.stock_disponible) ignora las
    filas con expira_en <= now(), sin que nadie tenga que borrarlas para que dejen de bloquear.
    Limpieza física oportunista dentro de calculations.reservar_stock(), no hay cron ni
    BackgroundTask. `expira_en` no lleva default de columna porque depende de
    configuracion.reserva_stock_minutos (dinámico) — se calcula explícito en Python. Sin
    relationships hacia Producto/Variante: no hace falta navegar desde ahí, mismo criterio
    minimalista que MixSnapshot.

    `nombre_producto`/`descripcion_variante`/`precio_unitario` son denormalizados a propósito
    (mismo criterio ya documentado para PedidoItem/MixSnapshot): se completan en
    calculations.reservar_stock() a partir del Producto/Variante en el momento de reservar, para
    que GET /reservas alcance para reconstruir el carrito visual de Movimientos.jsx tras un
    refresh de página, sin round-trips extra a /productos ni /productos/{id}/variantes."""
    __tablename__ = "reservas_stock"

    id = Column(Integer, primary_key=True, index=True)
    sesion_id = Column(String(64), nullable=False, index=True)
    producto_id = Column(Integer, ForeignKey("productos.id", ondelete="CASCADE"), nullable=False)
    variante_id = Column(Integer, ForeignKey("variantes.id", ondelete="CASCADE"), nullable=True)
    cantidad = Column(Integer, nullable=False)
    creado_en = Column(DateTime(timezone=True), server_default=func.now())
    expira_en = Column(DateTime(timezone=True), nullable=False)
    nombre_producto = Column(String(200), nullable=True)
    descripcion_variante = Column(String(255), nullable=True)
    precio_unitario = Column(Numeric(12, 2), nullable=True)
