from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import calculations, schemas
from ..database import get_db

router = APIRouter(prefix="/reservas", tags=["Reservas"])


@router.get("/", response_model=list[schemas.ReservaStockOut])
def listar(sesion_id: Optional[str] = None, db: Session = Depends(get_db)):
    """Reservas activas (sin filtrar por defecto) — usado por Movimientos.jsx al montar para
    reconstruir un pedido en armado que sobrevivió a un refresh de página (el sesion_id solo
    vivía en memoria de React; la reserva en Postgres, no)."""
    return calculations.listar_reservas_activas(db, sesion_id)


@router.post("/", response_model=schemas.ReservaStockOut)
def crear(payload: schemas.ReservaStockCreate, db: Session = Depends(get_db)):
    try:
        reserva = calculations.reservar_stock(
            db, payload.sesion_id, payload.producto_id, payload.variante_id, payload.cantidad
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    db.commit()
    db.refresh(reserva)
    return reserva


@router.delete("/", status_code=204)
def eliminar(
    sesion_id: str,
    producto_id: Optional[int] = None,
    variante_id: Optional[int] = None,
    db: Session = Depends(get_db),
):
    calculations.liberar_reserva(db, sesion_id, producto_id, variante_id)
    db.commit()
