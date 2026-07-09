from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import calculations
from ..database import get_db

router = APIRouter(prefix="/stock", tags=["Stock"])


@router.get("/productos", response_model=list[dict])
def stock_productos(db: Session = Depends(get_db)):
    return calculations.stock_por_producto(db)


@router.get("/categorias", response_model=list[dict])
def stock_categorias(db: Session = Depends(get_db)):
    return calculations.stock_por_categoria(db)
