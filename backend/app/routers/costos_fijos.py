from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db

router = APIRouter(prefix="/costos-fijos", tags=["Costos Fijos"])


@router.get("/", response_model=list[schemas.CostoFijo])
def listar(db: Session = Depends(get_db)):
    return db.query(models.CostoFijo).order_by(models.CostoFijo.id).all()


@router.post("/", response_model=schemas.CostoFijo)
def crear(costo: schemas.CostoFijoCreate, db: Session = Depends(get_db)):
    obj = models.CostoFijo(**costo.model_dump())
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


@router.put("/{costo_id}", response_model=schemas.CostoFijo)
def actualizar(costo_id: int, costo: schemas.CostoFijoCreate, db: Session = Depends(get_db)):
    obj = db.get(models.CostoFijo, costo_id)
    if not obj:
        raise HTTPException(404, "Costo fijo no encontrado.")
    for k, v in costo.model_dump().items():
        setattr(obj, k, v)
    db.commit()
    db.refresh(obj)
    return obj


@router.delete("/{costo_id}")
def borrar(costo_id: int, db: Session = Depends(get_db)):
    obj = db.get(models.CostoFijo, costo_id)
    if not obj:
        raise HTTPException(404, "Costo fijo no encontrado.")
    db.delete(obj)
    db.commit()
    return {"ok": True}
