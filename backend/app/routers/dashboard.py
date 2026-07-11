from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends
from sqlalchemy.orm import Session

from .. import calculations
from ..database import SessionLocal, get_db

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])


def _verificar_snapshot_en_segundo_plano() -> None:
    # Sesión propia: la del request ya se cerró para cuando corre el BackgroundTask.
    db = SessionLocal()
    try:
        calculations.verificar_y_tomar_snapshot_si_corresponde(db)
    finally:
        db.close()


@router.get("/resumen")
def resumen(background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    background_tasks.add_task(_verificar_snapshot_en_segundo_plano)
    return calculations.get_caja_actual(db)


@router.get("/punto-equilibrio")
def punto_equilibrio(background_tasks: BackgroundTasks, modo: str = "real", dias: int = 30, db: Session = Depends(get_db)):
    background_tasks.add_task(_verificar_snapshot_en_segundo_plano)
    return calculations.punto_equilibrio_ponderado(db, modo=modo, dias=dias)


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
