from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from .. import calculations, models, schemas
from ..database import get_db

router = APIRouter(prefix="/compras", tags=["Compras"])


def _aplicar_precio_si_corresponde(db: Session, producto_id: int, nuevo_precio) -> None:
    if nuevo_precio is None:
        return
    producto = db.get(models.Producto, producto_id)
    if producto:
        producto.precio_venta = nuevo_precio
        db.commit()


def _validar_producto_y_variante(db: Session, producto_id: int, variante_id: int | None) -> models.Producto:
    producto = db.get(models.Producto, producto_id)
    if not producto:
        raise HTTPException(400, "El producto indicado no existe.")
    if producto.tiene_variantes and not variante_id:
        raise HTTPException(400, "Este producto tiene variantes: especificá la variante de la compra.")
    if variante_id is not None:
        variante = db.get(models.Variante, variante_id)
        if not variante or variante.producto_id != producto_id:
            raise HTTPException(400, "La variante indicada no corresponde a este producto.")
    return producto


@router.get("/", response_model=list[schemas.Compra])
def listar(db: Session = Depends(get_db), producto_id: int | None = None, limit: int = 300):
    q = db.query(models.Compra).options(joinedload(models.Compra.producto))
    if producto_id:
        q = q.filter(models.Compra.producto_id == producto_id)
    return q.order_by(models.Compra.fecha.desc(), models.Compra.id.desc()).limit(limit).all()


@router.post("/simular", response_model=dict)
def simular(payload: schemas.CompraSimularRequest, db: Session = Depends(get_db)):
    resultado = calculations.simular_compra(db, payload.producto_id, payload.cantidad, float(payload.costo_unitario))
    if resultado is None:
        raise HTTPException(404, "Producto no encontrado.")
    return resultado


@router.post("/", response_model=schemas.Compra)
def crear(compra: schemas.CompraCreate, db: Session = Depends(get_db)):
    _validar_producto_y_variante(db, compra.producto_id, compra.variante_id)
    data = compra.model_dump()
    nuevo_precio = data.pop("actualizar_precio_venta", None)
    if data.get("fecha") is None:
        data.pop("fecha", None)
    obj = models.Compra(**data)
    db.add(obj)
    db.commit()
    db.refresh(obj)
    calculations.recalcular_costo_promedio(db, obj.producto_id)
    _aplicar_precio_si_corresponde(db, obj.producto_id, nuevo_precio)
    db.refresh(obj)
    return obj


@router.put("/{compra_id}", response_model=schemas.Compra)
def actualizar(compra_id: int, compra: schemas.CompraCreate, db: Session = Depends(get_db)):
    obj = db.get(models.Compra, compra_id)
    if not obj:
        raise HTTPException(404, "Compra no encontrada.")
    _validar_producto_y_variante(db, compra.producto_id, compra.variante_id)
    data = compra.model_dump()
    nuevo_precio = data.pop("actualizar_precio_venta", None)
    if data.get("fecha") is None:
        data.pop("fecha", None)
    for k, v in data.items():
        setattr(obj, k, v)
    db.commit()
    db.refresh(obj)
    calculations.recalcular_costo_promedio(db, obj.producto_id)
    _aplicar_precio_si_corresponde(db, obj.producto_id, nuevo_precio)
    db.refresh(obj)
    return obj


@router.delete("/{compra_id}")
def borrar(compra_id: int, db: Session = Depends(get_db)):
    obj = db.get(models.Compra, compra_id)
    if not obj:
        raise HTTPException(404, "Compra no encontrada.")
    producto_id = obj.producto_id
    db.delete(obj)
    db.commit()
    calculations.recalcular_costo_promedio(db, producto_id)
    return {"ok": True}
