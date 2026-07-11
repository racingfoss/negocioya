from typing import Optional

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import calculations
from ..database import get_db

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])


@router.get("/resumen")
def resumen(db: Session = Depends(get_db)):
    return calculations.get_caja_actual(db)


@router.get("/punto-equilibrio")
def punto_equilibrio(db: Session = Depends(get_db)):
    return calculations.punto_equilibrio_ponderado(db)


@router.get("/bcg")
def bcg(dias: int = 30, db: Session = Depends(get_db)):
    return calculations.matriz_bcg(db, dias=dias)


@router.get("/analisis")
def analisis(dias: int = 30, rollup: bool = False, db: Session = Depends(get_db)):
    return calculations.analisis_combinado(db, dias=dias, rollup=rollup)


@router.get("/sell-through", response_model=list[dict])
def sellthrough(db: Session = Depends(get_db)):
    return calculations.sell_through(db)


@router.get("/contribucion-categorias")
def contribucion(dias: Optional[int] = None, rollup: bool = False, db: Session = Depends(get_db)):
    return calculations.contribucion_por_categoria(db, dias=dias, rollup=rollup)
