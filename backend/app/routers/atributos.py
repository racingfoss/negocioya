from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from .. import models, schemas
from ..database import get_db

router = APIRouter(prefix="/atributos", tags=["Atributos"])


@router.get("/", response_model=list[schemas.Atributo])
def listar(db: Session = Depends(get_db)):
    return (
        db.query(models.Atributo)
        .options(joinedload(models.Atributo.valores))
        .order_by(models.Atributo.nombre)
        .all()
    )


@router.post("/", response_model=schemas.Atributo)
def crear(atributo: schemas.AtributoCreate, db: Session = Depends(get_db)):
    obj = models.Atributo(**atributo.model_dump())
    db.add(obj)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(400, "Ya existe un atributo con ese nombre.")
    db.refresh(obj)
    return obj


@router.delete("/{atributo_id}")
def borrar(atributo_id: int, db: Session = Depends(get_db)):
    obj = db.get(models.Atributo, atributo_id)
    if not obj:
        raise HTTPException(404, "Atributo no encontrado.")
    db.delete(obj)
    db.commit()
    return {"ok": True}


@router.post("/{atributo_id}/valores", response_model=schemas.ValorAtributo)
def agregar_valor(atributo_id: int, valor: schemas.ValorAtributoCreate, db: Session = Depends(get_db)):
    if not db.get(models.Atributo, atributo_id):
        raise HTTPException(404, "Atributo no encontrado.")
    obj = models.ValorAtributo(atributo_id=atributo_id, **valor.model_dump())
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


@router.delete("/valores/{valor_id}")
def borrar_valor(valor_id: int, db: Session = Depends(get_db)):
    obj = db.get(models.ValorAtributo, valor_id)
    if not obj:
        raise HTTPException(404, "Valor no encontrado.")
    db.delete(obj)
    db.commit()
    return {"ok": True}
