from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import calculations, models, schemas
from ..database import get_db

router = APIRouter(prefix="/categorias", tags=["Categorias"])


@router.get("/", response_model=list[schemas.Categoria])
def listar(db: Session = Depends(get_db)):
    return db.query(models.Categoria).order_by(models.Categoria.nombre).all()


@router.get("/arbol", response_model=list[dict])
def arbol(db: Session = Depends(get_db)):
    return calculations.categorias_arbol(db)


@router.post("/", response_model=schemas.Categoria)
def crear(categoria: schemas.CategoriaCreate, db: Session = Depends(get_db)):
    if categoria.parent_id is not None and not db.get(models.Categoria, categoria.parent_id):
        raise HTTPException(400, "La categoría padre indicada no existe.")
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
    if categoria.parent_id is not None and not db.get(models.Categoria, categoria.parent_id):
        raise HTTPException(400, "La categoría padre indicada no existe.")
    if not calculations.validar_no_ciclo(db, categoria_id, categoria.parent_id):
        raise HTTPException(400, "Esa asignación crearía un ciclo: una categoría no puede ser ancestro de sí misma.")
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
