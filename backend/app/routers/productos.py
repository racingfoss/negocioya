import itertools

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from .. import calculations, models, schemas
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


# --- Variantes: atributos que aplican al producto (y su orden) + generación de la grilla ---

@router.post("/{producto_id}/atributos", response_model=list[dict])
def set_atributos(producto_id: int, payload: schemas.ProductoAtributosRequest, db: Session = Depends(get_db)):
    producto = db.get(models.Producto, producto_id)
    if not producto:
        raise HTTPException(404, "Producto no encontrado.")
    if not producto.tiene_variantes:
        raise HTTPException(400, "El producto no tiene variantes habilitadas (tiene_variantes=False).")

    atributos_map = {}
    for item in payload.atributos:
        atributo = db.get(models.Atributo, item.atributo_id)
        if not atributo:
            raise HTTPException(400, f"El atributo {item.atributo_id} no existe.")
        atributos_map[item.atributo_id] = atributo

    db.query(models.ProductoAtributo).filter(models.ProductoAtributo.producto_id == producto_id).delete()
    for item in payload.atributos:
        db.add(models.ProductoAtributo(producto_id=producto_id, atributo_id=item.atributo_id, orden=item.orden))
    db.commit()

    filas = (
        db.query(models.ProductoAtributo)
        .filter(models.ProductoAtributo.producto_id == producto_id)
        .order_by(models.ProductoAtributo.orden)
        .all()
    )
    return [{"atributo_id": f.atributo_id, "atributo": atributos_map[f.atributo_id].nombre, "orden": f.orden} for f in filas]


@router.get("/{producto_id}/atributos", response_model=list[dict])
def listar_atributos(producto_id: int, db: Session = Depends(get_db)):
    if not db.get(models.Producto, producto_id):
        raise HTTPException(404, "Producto no encontrado.")
    filas = (
        db.query(models.ProductoAtributo)
        .options(joinedload(models.ProductoAtributo.atributo).joinedload(models.Atributo.valores))
        .filter(models.ProductoAtributo.producto_id == producto_id)
        .order_by(models.ProductoAtributo.orden)
        .all()
    )
    return [
        {
            "atributo_id": f.atributo_id,
            "atributo": f.atributo.nombre,
            "orden": f.orden,
            "valores": [{"id": v.id, "valor": v.valor} for v in f.atributo.valores],
        }
        for f in filas
    ]


@router.get("/{producto_id}/variantes", response_model=list[dict])
def listar_variantes(producto_id: int, db: Session = Depends(get_db)):
    if not db.get(models.Producto, producto_id):
        raise HTTPException(404, "Producto no encontrado.")
    variantes = db.query(models.Variante).filter(models.Variante.producto_id == producto_id).all()
    resultado = []
    for v in variantes:
        valores = (
            db.query(models.ValorAtributo, models.Atributo)
            .join(models.VarianteValor, models.VarianteValor.valor_atributo_id == models.ValorAtributo.id)
            .join(models.Atributo, models.ValorAtributo.atributo_id == models.Atributo.id)
            .filter(models.VarianteValor.variante_id == v.id)
            .all()
        )
        resultado.append({
            "id": v.id,
            "producto_id": v.producto_id,
            "activo": v.activo,
            "valores": [
                {"atributo_id": a.id, "atributo": a.nombre, "valor_atributo_id": va.id, "valor": va.valor}
                for va, a in valores
            ],
        })
    return resultado


@router.post("/{producto_id}/variantes/generar", response_model=list[dict])
def generar_variantes(producto_id: int, payload: schemas.GenerarVariantesRequest, db: Session = Depends(get_db)):
    producto = db.get(models.Producto, producto_id)
    if not producto:
        raise HTTPException(404, "Producto no encontrado.")
    if not producto.tiene_variantes:
        raise HTTPException(400, "El producto no tiene variantes habilitadas (tiene_variantes=False).")
    if not payload.selecciones:
        raise HTTPException(400, "Elegí al menos un atributo con sus valores para generar variantes.")

    atributos_producto = {
        pa.atributo_id
        for pa in db.query(models.ProductoAtributo).filter(models.ProductoAtributo.producto_id == producto_id).all()
    }
    for sel in payload.selecciones:
        if sel.atributo_id not in atributos_producto:
            raise HTTPException(400, f"El atributo {sel.atributo_id} no está configurado para este producto.")
        if not sel.valor_ids:
            raise HTTPException(400, "Cada atributo seleccionado necesita al menos un valor.")
        validos = {
            vid
            for (vid,) in db.query(models.ValorAtributo.id)
            .filter(models.ValorAtributo.atributo_id == sel.atributo_id, models.ValorAtributo.id.in_(sel.valor_ids))
            .all()
        }
        faltantes = set(sel.valor_ids) - validos
        if faltantes:
            raise HTTPException(400, f"Valores inválidos para el atributo {sel.atributo_id}: {sorted(faltantes)}")

    # una combinación por cada iteración del producto cartesiano; resolver_o_crear_variante
    # se encarga de no duplicar ni pisar combinaciones ya existentes (con stock o sin stock)
    listas_valores = [sel.valor_ids for sel in payload.selecciones]
    for combinacion in itertools.product(*listas_valores):
        calculations.resolver_o_crear_variante(db, producto_id, list(combinacion))
    db.commit()

    return listar_variantes(producto_id, db)
