from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from .. import calculations, models, schemas
from ..database import get_db

router = APIRouter(prefix="/movimientos", tags=["Movimientos"])


@router.get("/", response_model=list[schemas.Movimiento])
def listar(db: Session = Depends(get_db), limit: int = 300):
    return (
        db.query(models.Movimiento)
        .options(joinedload(models.Movimiento.producto))
        .order_by(models.Movimiento.fecha.desc())
        .limit(limit)
        .all()
    )


@router.post("/", response_model=schemas.Movimiento)
def crear(mov: schemas.MovimientoCreate, db: Session = Depends(get_db)):
    if mov.tipo == "Venta":
        # único camino de alta de una Venta, compartido con POST /ecommerce/ordenes
        obj = calculations.registrar_venta(
            db, mov.producto_id, mov.variante_id, mov.cantidad or 1, mov.monto,
            concepto=mov.concepto, fecha=mov.fecha, costo_fijo_id=mov.costo_fijo_id,
        )
    else:
        calculations.validar_movimiento(db, mov.tipo, mov.producto_id, mov.variante_id, mov.cantidad)
        data = mov.model_dump()
        if data.get("fecha") is None:
            data.pop("fecha", None)  # deja que el default del modelo ponga "ahora"
        obj = models.Movimiento(**data)
        db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


@router.put("/{mov_id}", response_model=schemas.Movimiento)
def actualizar(mov_id: int, mov: schemas.MovimientoCreate, db: Session = Depends(get_db)):
    obj = db.get(models.Movimiento, mov_id)
    if not obj:
        raise HTTPException(404, "Movimiento no encontrado.")
    calculations.validar_movimiento(db, mov.tipo, mov.producto_id, mov.variante_id, mov.cantidad, actual=obj)
    data = mov.model_dump()
    if data.get("fecha") is None:
        data.pop("fecha", None)
    for k, v in data.items():
        setattr(obj, k, v)
    db.commit()
    db.refresh(obj)
    return obj


@router.delete("/{mov_id}")
def borrar(mov_id: int, db: Session = Depends(get_db)):
    obj = db.get(models.Movimiento, mov_id)
    if not obj:
        raise HTTPException(404, "Movimiento no encontrado.")
    db.delete(obj)
    db.commit()
    return {"ok": True}
