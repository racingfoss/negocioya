from datetime import date, datetime, timezone

from sqlalchemy import (
    Boolean, Column, Date, DateTime, ForeignKey, Integer, Numeric, String, Text
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from .database import Base


def _now_utc():
    return datetime.now(timezone.utc)


class Categoria(Base):
    """Familia de productos, definida libremente por el usuario (no hardcodeada)."""
    __tablename__ = "categorias"

    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String(100), unique=True, nullable=False)
    descripcion = Column(String(255), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    productos = relationship("Producto", back_populates="categoria")


class Producto(Base):
    """Ficha maestra de la prenda. Se carga UNA vez.
    El stock y el costo promedio se derivan de la tabla `compras`, no se cargan acá."""
    __tablename__ = "productos"

    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String(150), nullable=False)
    categoria_id = Column(Integer, ForeignKey("categorias.id", ondelete="SET NULL"), nullable=True)
    precio_venta = Column(Numeric(12, 2), nullable=False)
    costo = Column(Numeric(12, 2), nullable=False, default=0)  # costo promedio ponderado, se recalcula solo
    mix_pct = Column(Numeric(5, 2), nullable=False, default=0)
    activo = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    categoria = relationship("Categoria", back_populates="productos")
    movimientos = relationship("Movimiento", back_populates="producto")
    compras = relationship("Compra", back_populates="producto", cascade="all, delete-orphan")


class Compra(Base):
    """Cada reposición de stock de un producto: cantidad, costo y fecha propios.
    Un producto puede tener muchas compras a lo largo del tiempo."""
    __tablename__ = "compras"

    id = Column(Integer, primary_key=True, index=True)
    producto_id = Column(Integer, ForeignKey("productos.id", ondelete="CASCADE"), nullable=False)
    fecha = Column(Date, nullable=False, default=date.today)
    cantidad = Column(Integer, nullable=False)
    costo_unitario = Column(Numeric(12, 2), nullable=False)
    proveedor = Column(String(150), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    producto = relationship("Producto", back_populates="compras")


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
    costo_fijo_id = Column(Integer, ForeignKey("costos_fijos.id", ondelete="SET NULL"), nullable=True)

    producto = relationship("Producto", back_populates="movimientos")
    costo_fijo = relationship("CostoFijo", back_populates="movimientos")
