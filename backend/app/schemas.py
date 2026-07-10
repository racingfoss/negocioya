from datetime import date, datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, ConfigDict


class CategoriaBase(BaseModel):
    nombre: str
    descripcion: Optional[str] = None


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


class Producto(ProductoBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    categoria: Optional[Categoria] = None


class CompraBase(BaseModel):
    producto_id: int
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
    cantidad: int
    costo_unitario: Decimal


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
    costo_fijo_id: Optional[int] = None
    fecha: Optional[datetime] = None  # si no se manda, se usa el momento actual


class MovimientoCreate(MovimientoBase):
    pass


class Movimiento(MovimientoBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    fecha: datetime
    producto: Optional[Producto] = None


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
