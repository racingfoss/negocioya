from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from .. import calculations, models, schemas
from ..database import get_db

router = APIRouter(prefix="/movimientos", tags=["Movimientos"])

TIPOS_VALIDOS = ("Venta", "Ingreso", "Egreso")


def _validar(mov: schemas.MovimientoBase, db: Session, actual: "models.Movimiento | None" = None):
    if mov.tipo not in TIPOS_VALIDOS:
        raise HTTPException(400, "El tipo debe ser 'Venta', 'Ingreso' o 'Egreso'.")
    if mov.tipo == "Venta" and not mov.producto_id:
        raise HTTPException(400, "Una Venta debe tener un producto asociado.")
    if mov.producto_id is not None:
        producto = db.get(models.Producto, mov.producto_id)
        if not producto:
            raise HTTPException(400, "El producto indicado no existe.")
        if mov.tipo == "Venta" and producto.tiene_variantes and not mov.variante_id:
            raise HTTPException(400, "Este producto tiene variantes: especificá la variante de la venta.")
        if mov.variante_id is not None:
            variante = db.get(models.Variante, mov.variante_id)
            if not variante or variante.producto_id != mov.producto_id:
                raise HTTPException(400, "La variante indicada no corresponde a este producto.")
        if mov.tipo == "Venta":
            disponible = calculations.stock_disponible(db, mov.producto_id, mov.variante_id)
            # al editar una Venta ya registrada del mismo producto/variante, su cantidad vieja ya está
            # descontada del stock actual — se sube de vuelta antes de comparar contra la cantidad nueva
            if (
                actual is not None
                and actual.tipo == "Venta"
                and actual.producto_id == mov.producto_id
                and actual.variante_id == mov.variante_id
            ):
                disponible += actual.cantidad or 0
            if (mov.cantidad or 0) > disponible:
                referencia = "esta variante" if mov.variante_id else "este producto"
                raise HTTPException(
                    400,
                    f"No hay stock suficiente para {referencia}: disponible {disponible}, "
                    f"pediste {mov.cantidad}.",
                )


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
    _validar(mov, db)
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
    _validar(mov, db, actual=obj)
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
