from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db

router = APIRouter(prefix="/categorias", tags=["Categorias"])


@router.get("/", response_model=list[schemas.Categoria])
def listar(db: Session = Depends(get_db)):
    return db.query(models.Categoria).order_by(models.Categoria.nombre).all()


@router.post("/", response_model=schemas.Categoria)
def crear(categoria: schemas.CategoriaCreate, db: Session = Depends(get_db)):
    obj = models.Categoria(**categoria.model_dump())
    db.add(obj)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(400, "Ya existe una categoría con ese nombre.")
    db.refresh(obj)
    return obj


@router.put("/{categoria_id}", response_model=schemas.Categoria)
def actualizar(categoria_id: int, categoria: schemas.CategoriaCreate, db: Session = Depends(get_db)):
    obj = db.get(models.Categoria, categoria_id)
    if not obj:
        raise HTTPException(404, "Categoría no encontrada.")
    for k, v in categoria.model_dump().items():
        setattr(obj, k, v)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(400, "Ya existe una categoría con ese nombre.")
    db.refresh(obj)
    return obj


@router.delete("/{categoria_id}")
def borrar(categoria_id: int, db: Session = Depends(get_db)):
    obj = db.get(models.Categoria, categoria_id)
    if not obj:
        raise HTTPException(404, "Categoría no encontrada.")
    db.delete(obj)
    db.commit()
    return {"ok": True}
