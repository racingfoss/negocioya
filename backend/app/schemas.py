from datetime import date, datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, ConfigDict


class CategoriaBase(BaseModel):
    nombre: str
    descripcion: Optional[str] = None
    parent_id: Optional[int] = None


class CategoriaCreate(CategoriaBase):
    pass


class Categoria(CategoriaBase):
    model_config = ConfigDict(from_attributes=True)
    id: int


class ProductoBase(BaseModel):
    nombre: str
    codigo: Optional[str] = None
    categoria_id: Optional[int] = None
    precio_venta: Decimal
    costo: Decimal = Decimal("0")
    mix_pct: Decimal = Decimal("0")
    lead_time_dias: Optional[int] = None
    activo: bool = True
    tiene_variantes: bool = False
    visible_ecommerce: bool = False
    descripcion_ecommerce: Optional[str] = None


class ProductoCreate(ProductoBase):
    pass


class ProductoUpdate(BaseModel):
    nombre: Optional[str] = None
    codigo: Optional[str] = None
    categoria_id: Optional[int] = None
    precio_venta: Optional[Decimal] = None
    costo: Optional[Decimal] = None
    mix_pct: Optional[Decimal] = None
    lead_time_dias: Optional[int] = None
    activo: Optional[bool] = None
    tiene_variantes: Optional[bool] = None
    visible_ecommerce: Optional[bool] = None
    descripcion_ecommerce: Optional[str] = None


class FotoProducto(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    producto_id: int
    ruta_archivo: str
    orden: int


class ReordenarFotosRequest(BaseModel):
    orden_ids: list[int]


class Producto(ProductoBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    categoria: Optional[Categoria] = None
    fotos: list[FotoProducto] = []


class CompraBase(BaseModel):
    producto_id: int
    variante_id: Optional[int] = None
    fecha: Optional[date] = None
    cantidad: int
    costo_unitario: Decimal
    proveedor: Optional[str] = None


class CompraCreate(CompraBase):
    actualizar_precio_venta: Optional[Decimal] = None  # si viene, se aplica al producto tras registrar la compra


class Compra(CompraBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    fecha: date
    producto: Optional[Producto] = None


class CompraSimularRequest(BaseModel):
    producto_id: int
    variante_id: Optional[int] = None
    cantidad: int
    costo_unitario: Decimal


# --- Atributos y variantes (talle, color, etc. definidos por la usuaria) ---

class ValorAtributoBase(BaseModel):
    valor: str


class ValorAtributoCreate(ValorAtributoBase):
    pass


class ValorAtributo(ValorAtributoBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    atributo_id: int


class AtributoBase(BaseModel):
    nombre: str


class AtributoCreate(AtributoBase):
    pass


class Atributo(AtributoBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    valores: list[ValorAtributo] = []


class ProductoAtributoIn(BaseModel):
    atributo_id: int
    orden: int


class ProductoAtributosRequest(BaseModel):
    atributos: list[ProductoAtributoIn]


class SeleccionAtributo(BaseModel):
    atributo_id: int
    valor_ids: list[int]


class GenerarVariantesRequest(BaseModel):
    selecciones: list[SeleccionAtributo]


class ProductoConVariantesCreate(BaseModel):
    """Alta atómica de un producto nuevo con variantes: producto + configuración de atributos +
    grilla de variantes a generar, todo en una sola operación de backend (ver POST /productos/con-variantes)."""

    producto: ProductoCreate
    atributos: list[ProductoAtributoIn]
    selecciones: list[SeleccionAtributo]


class CostoFijoBase(BaseModel):
    concepto: str
    monto: Decimal


class CostoFijoCreate(CostoFijoBase):
    pass


class CostoFijo(CostoFijoBase):
    model_config = ConfigDict(from_attributes=True)
    id: int


class MovimientoBase(BaseModel):
    tipo: str  # "Venta" | "Ingreso" | "Egreso"
    concepto: Optional[str] = None
    cantidad: Optional[int] = 1
    monto: Decimal
    producto_id: Optional[int] = None
    variante_id: Optional[int] = None
    costo_fijo_id: Optional[int] = None
    fecha: Optional[datetime] = None  # si no se manda, se usa el momento actual


class MovimientoCreate(MovimientoBase):
    pass


class Movimiento(MovimientoBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    fecha: datetime
    producto: Optional[Producto] = None


# --- E-commerce (Fase 0): catálogo público y órdenes ---
# ProductoCatalogoOut es un schema dedicado (no reusa Producto) para garantizar por diseño que
# costo/mix_pct/lead_time_dias nunca se exponen en el endpoint público, sin depender de que nadie
# los agregue por error a Producto más adelante.

class ProductoCatalogoOut(BaseModel):
    id: int
    nombre: str
    descripcion_ecommerce: Optional[str] = None
    precio_venta: Decimal
    categoria: Optional[str] = None
    fotos: list[FotoProducto] = []
    tiene_variantes: bool
    stock_actual: Optional[int] = None        # solo si NO tiene variantes
    variantes: Optional[list[dict]] = None     # solo si tiene variantes, mismo shape que GET /productos/{id}/variantes


class LineaOrdenIn(BaseModel):
    producto_id: int
    variante_id: Optional[int] = None
    cantidad: int


class OrdenEcommerceCreate(BaseModel):
    cliente_nombre: str
    cliente_email: Optional[str] = None
    cliente_telefono: Optional[str] = None
    forma_entrega: str  # "Retiro en persona" | "Envío"
    direccion_envio: Optional[str] = None
    notas: Optional[str] = None
    metodo_pago_preferido: Optional[str] = None
    lineas: list[LineaOrdenIn]


class PedidoItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    producto_id: Optional[int]
    variante_id: Optional[int]
    cantidad: int
    precio_unitario: Decimal
    movimiento_id: Optional[int]
    producto: Optional[Producto] = None
    # No es un atributo del ORM (Fase D parte 1) — lo completa a mano el router (_pedido_out) con
    # calculations.descripcion_variante, mismo criterio que monto_neto en PedidoOut. Sirve para
    # mostrar "M / Verde" en el panel de devolución sin que el frontend arme la query.
    variante_descripcion: Optional[str] = None


class FacturaOut(BaseModel):
    """Intento de facturación ARCA de un Pedido (Fase C) — ver models.Factura."""
    model_config = ConfigDict(from_attributes=True)
    id: int
    pedido_id: int
    tipo_comprobante: int
    punto_venta: int
    numero_comprobante: Optional[int]
    cae: Optional[str]
    cae_vencimiento: Optional[date]
    fecha_emision: Optional[datetime]
    importe_total: Decimal
    doc_tipo: int
    doc_nro: int
    estado: str
    mensaje_error: Optional[str]
    created_at: datetime
    # Solo poblados en Notas de Crédito (tipo_comprobante=13, Fase D parte 2) — ver models.Factura.
    devolucion_id: Optional[int] = None
    factura_original_id: Optional[int] = None


class PedidoOut(BaseModel):
    """Pedido unificado (Fase B), cualquier canal. `canal`/`facturar_arca` son campos
    aditivos sobre lo que antes era OrdenEcommerceOut — el storefront (POST /ecommerce/ordenes)
    solo lee `id` de la respuesta, así que agregarlos no rompe su contrato. `monto_neto` (Fase
    C) no es un atributo del ORM — lo completa a mano el router (`_pedido_out`) llamando a
    calculations.monto_neto_pedido; el default acá es solo para que model_validate no falle si
    algún caller se olvida de setearlo, nunca el valor real."""
    model_config = ConfigDict(from_attributes=True)
    id: int
    fecha: datetime
    canal: str
    facturar_arca: bool
    estado: str
    cliente_nombre: Optional[str]
    cliente_email: Optional[str]
    cliente_telefono: Optional[str]
    forma_entrega: Optional[str]
    direccion_envio: Optional[str]
    notas: Optional[str]
    metodo_pago_preferido: Optional[str]
    total: Decimal
    monto_neto: Decimal = Decimal("0")
    items: list[PedidoItemOut] = []
    facturas: list[FacturaOut] = []


class PedidoLocalCreate(BaseModel):
    """Alta de un Pedido canal="local" desde Caja (Fase B) — el carrito armado en Movimientos.jsx."""
    cliente_nombre: Optional[str] = None
    facturar_arca: bool = False
    notas: Optional[str] = None
    sesion_id: Optional[str] = None
    lineas: list[LineaOrdenIn]


class PedidoEstadoUpdate(BaseModel):
    estado: str


# --- Devoluciones/cancelaciones de un Pedido (Fase D parte 1) ---

class DevolucionItemIn(BaseModel):
    pedido_item_id: int
    cantidad: int


class DevolucionCreate(BaseModel):
    motivo: Optional[str] = None
    tipo: str = "Devolucion"  # "Cancelacion" | "Devolucion" — validado en calculations.procesar_devolucion
    items: list[DevolucionItemIn]


class DevolucionItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    pedido_item_id: int
    cantidad: int
    movimiento_id: Optional[int]


class DevolucionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    pedido_id: int
    fecha: datetime
    motivo: Optional[str]
    tipo: str
    items: list[DevolucionItemOut] = []
    # Fase D parte 2 — ninguno de los dos es atributo del ORM, los completa el router
    # (_devolucion_out) llamando a calculations.devolucion_requiere_nota_credito y buscando la
    # Factura tipo 13 ya emitida para esta devolución, si existe.
    requiere_nota_credito: bool = False
    nota_credito: Optional[FacturaOut] = None


# --- Reserva de stock efímera (pedido en armado en Caja) ---

class ReservaStockCreate(BaseModel):
    sesion_id: str
    producto_id: int
    variante_id: Optional[int] = None
    cantidad: int


class ReservaStockOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    sesion_id: str
    producto_id: int
    variante_id: Optional[int] = None
    cantidad: int
    expira_en: datetime
    nombre_producto: Optional[str] = None
    descripcion_variante: Optional[str] = None
    precio_unitario: Optional[Decimal] = None


# --- Stock (calculado, no se carga a mano) ---

class StockProducto(BaseModel):
    producto_id: int
    producto: str
    categoria: str
    stock_actual: int
    total_comprado: int
    total_vendido: int
    costo_promedio: float
    dias_en_stock: Optional[int] = None
    alerta_rotacion_90_dias: bool = False
    demanda_media_diaria: float = 0.0
    dias_cobertura: Optional[float] = None
    estado_stock: str = "OK"
    necesita_reponer: bool = False


class StockCategoria(BaseModel):
    categoria: str
    stock_actual: int
    cantidad_productos: int
    demanda_media_diaria: float = 0.0
    dias_cobertura: Optional[float] = None
    estado_stock: str = "OK"


# --- Configuración del negocio (singleton) ---

class ConfiguracionBase(BaseModel):
    demanda_ventana_dias: int
    lead_time_default_dias: int
    safety_days: int
    stock_dias_verde: int
    stock_dias_rojo: int
    rotacion_alerta_dias: int
    umbral_cambio_costo_pct: Decimal
    renegociacion_margen_umbral_pct: Decimal
    renegociacion_percentil_volumen: Decimal
    motor_decoracion_pareto_pct: Decimal
    mix_real_ventana_dias_default: int
    snapshot_periodo_dias: int
    reserva_stock_minutos: int
    nombre_ecommerce: str = "Adorante"
    whatsapp_numero: Optional[str] = None
    instagram_url: Optional[str] = None
    facebook_url: Optional[str] = None
    email_contacto: Optional[str] = None
    arca_cuit: Optional[str] = None
    arca_punto_venta_defecto: int = 1
    arca_razon_social: Optional[str] = None
    arca_domicilio_fiscal: Optional[str] = None
    arca_condicion_iva: str = "RESPONSABLE MONOTRIBUTO"
    arca_inicio_actividades: Optional[date] = None


class Configuracion(ConfiguracionBase):
    model_config = ConfigDict(from_attributes=True)
    id: int


class ConfiguracionUpdate(BaseModel):
    demanda_ventana_dias: Optional[int] = None
    lead_time_default_dias: Optional[int] = None
    safety_days: Optional[int] = None
    stock_dias_verde: Optional[int] = None
    stock_dias_rojo: Optional[int] = None
    rotacion_alerta_dias: Optional[int] = None
    umbral_cambio_costo_pct: Optional[Decimal] = None
    renegociacion_margen_umbral_pct: Optional[Decimal] = None
    renegociacion_percentil_volumen: Optional[Decimal] = None
    motor_decoracion_pareto_pct: Optional[Decimal] = None
    mix_real_ventana_dias_default: Optional[int] = None
    snapshot_periodo_dias: Optional[int] = None
    reserva_stock_minutos: Optional[int] = None
    nombre_ecommerce: Optional[str] = None
    whatsapp_numero: Optional[str] = None
    instagram_url: Optional[str] = None
    facebook_url: Optional[str] = None
    email_contacto: Optional[str] = None
    arca_cuit: Optional[str] = None
    arca_punto_venta_defecto: Optional[int] = None
    arca_razon_social: Optional[str] = None
    arca_domicilio_fiscal: Optional[str] = None
    arca_condicion_iva: Optional[str] = None
    arca_inicio_actividades: Optional[date] = None


# --- Configuración de la tienda (subset público, para el storefront) ---
# Schema dedicado (mismo criterio que ProductoCatalogoOut): garantiza por diseño que
# GET /ecommerce/configuracion-tienda nunca devuelva ningún otro campo de `configuracion`
# (umbrales internos de negocio), aunque el modelo ORM tenga muchos más.

class ConfiguracionTiendaOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    nombre_ecommerce: str
    whatsapp_numero: Optional[str] = None
    instagram_url: Optional[str] = None
    facebook_url: Optional[str] = None
    email_contacto: Optional[str] = None


# --- Snapshots del mix real (para graficar evolución en el tiempo) ---

class MixSnapshot(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    fecha: datetime
    ventana_dias: int
    producto_id: Optional[int] = None
    producto_nombre: str
    categoria_nombre: Optional[str] = None
    mix_pct: float
    facturacion: float
