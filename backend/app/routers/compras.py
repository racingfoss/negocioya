from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from .. import calculations, models, schemas
from ..database import get_db

router = APIRouter(prefix="/compras", tags=["Compras"])


@router.get("/", response_model=list[schemas.Compra])
def listar(db: Session = Depends(get_db), producto_id: int | None = None, limit: int = 300):
    q = db.query(models.Compra).options(joinedload(models.Compra.producto))
    if producto_id:
        q = q.filter(models.Compra.producto_id == producto_id)
    return q.order_by(models.Compra.fecha.desc(), models.Compra.id.desc()).limit(limit).all()


@router.post("/", response_model=schemas.Compra)
def crear(compra: schemas.CompraCreate, db: Session = Depends(get_db)):
    if not db.get(models.Producto, compra.producto_id):
        raise HTTPException(400, "El producto indicado no existe.")
    data = compra.model_dump()
    if data.get("fecha") is None:
        data.pop("fecha", None)
    obj = models.Compra(**data)
    db.add(obj)
    db.commit()
    db.refresh(obj)
    calculations.recalcular_costo_promedio(db, obj.producto_id)
    return obj


@router.put("/{compra_id}", response_model=schemas.Compra)
def actualizar(compra_id: int, compra: schemas.CompraCreate, db: Session = Depends(get_db)):
    obj = db.get(models.Compra, compra_id)
    if not obj:
        raise HTTPException(404, "Compra no encontrada.")
    data = compra.model_dump()
    if data.get("fecha") is None:
        data.pop("fecha", None)
    for k, v in data.items():
        setattr(obj, k, v)
    db.commit()
    db.refresh(obj)
    calculations.recalcular_costo_promedio(db, obj.producto_id)
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
