from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import calculations, schemas
from ..database import get_db

router = APIRouter(prefix="/configuracion", tags=["Configuración"])


@router.get("/", response_model=schemas.Configuracion)
def obtener(db: Session = Depends(get_db)):
    return calculations.get_configuracion(db)


@router.put("/", response_model=schemas.Configuracion)
def actualizar(payload: schemas.ConfiguracionUpdate, db: Session = Depends(get_db)):
    config = calculations.get_configuracion(db)
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(config, k, v)
    db.commit()
    db.refresh(config)
    return config
