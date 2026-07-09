from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from .. import models, schemas
from ..database import get_db

router = APIRouter(prefix="/productos", tags=["Productos"])


@router.get("/", response_model=list[schemas.Producto])
def listar(db: Session = Depends(get_db), solo_activos: bool = False):
    q = db.query(models.Producto).options(joinedload(models.Producto.categoria))
    if solo_activos:
        q = q.filter(models.Producto.activo.is_(True))
    return q.order_by(models.Producto.nombre).all()


@router.post("/", response_model=schemas.Producto)
def crear(producto: schemas.ProductoCreate, db: Session = Depends(get_db)):
    if producto.categoria_id is not None and not db.get(models.Categoria, producto.categoria_id):
        raise HTTPException(400, "La categoría indicada no existe.")
    obj = models.Producto(**producto.model_dump())
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


@router.put("/{producto_id}", response_model=schemas.Producto)
def actualizar(producto_id: int, producto: schemas.ProductoUpdate, db: Session = Depends(get_db)):
    obj = db.get(models.Producto, producto_id)
    if not obj:
        raise HTTPException(404, "Producto no encontrado.")
    data = producto.model_dump(exclude_unset=True)
    if data.get("categoria_id") is not None and not db.get(models.Categoria, data["categoria_id"]):
        raise HTTPException(400, "La categoría indicada no existe.")
    for k, v in data.items():
        setattr(obj, k, v)
    db.commit()
    db.refresh(obj)
    return obj


@router.delete("/{producto_id}")
def borrar(producto_id: int, db: Session = Depends(get_db)):
    obj = db.get(models.Producto, producto_id)
    if not obj:
        raise HTTPException(404, "Producto no encontrado.")
    db.delete(obj)
    db.commit()
    return {"ok": True}
