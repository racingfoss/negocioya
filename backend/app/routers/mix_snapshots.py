from typing import Optional

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import calculations, models, schemas
from ..database import get_db

router = APIRouter(prefix="/mix-snapshots", tags=["Mix Snapshots"])


@router.post("/tomar", response_model=list[schemas.MixSnapshot])
def tomar(db: Session = Depends(get_db)):
    """Fuerza un snapshot ahora mismo, sin importar si ya tocaba o no."""
    return calculations.tomar_snapshot_mix(db)


@router.get("/", response_model=list[schemas.MixSnapshot])
def listar(producto_id: Optional[int] = None, categoria: Optional[str] = None, db: Session = Depends(get_db)):
    q = db.query(models.MixSnapshot)
    if producto_id:
        q = q.filter(models.MixSnapshot.producto_id == producto_id)
    if categoria:
        q = q.filter(models.MixSnapshot.categoria_nombre == categoria)
    return q.order_by(models.MixSnapshot.fecha).all()
