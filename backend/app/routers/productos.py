import itertools
import os
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from .. import calculations, models, schemas
from ..database import get_db

router = APIRouter(prefix="/productos", tags=["Productos"])

# Fotos de producto para el catálogo de e-commerce (ver sección "E-commerce" en CLAUDE.md).
FOTOS_DIR = os.getenv("FOTOS_PRODUCTOS_DIR", "/app/fotos_productos")
EXTENSIONES_FOTO_VALIDAS = {"jpg", "jpeg", "png", "webp"}
FOTO_TAMANO_MAXIMO_BYTES = 5 * 1024 * 1024


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

    # Desactivar variantes en un producto que ya tiene trazabilidad de compras/ventas por variante
    # perdería esa trazabilidad sin forma de recuperarla — se bloquea directamente en vez de permitirlo
    # con confirmación, para que no se pueda perder sin querer con un solo click.
    if data.get("tiene_variantes") is False and obj.tiene_variantes:
        tiene_compras = db.query(models.Compra).filter(models.Compra.producto_id == producto_id).first() is not None
        tiene_ventas = (
            db.query(models.Movimiento)
            .filter(models.Movimiento.producto_id == producto_id, models.Movimiento.tipo == "Venta")
            .first()
            is not None
        )
        if tiene_compras or tiene_ventas:
            raise HTTPException(
                400,
                "Este producto tiene compras o ventas registradas por variante. No se puede desactivar "
                "variantes sin perder esa trazabilidad de stock/costo. Borrá esos registros primero si "
                "estás segura de que querés sacarle las variantes.",
            )
        # sin compras ni ventas de por medio, la configuración de atributos/variantes queda huérfana:
        # se limpia para no dejar variantes fantasma si más adelante se vuelve a activar
        db.query(models.Variante).filter(models.Variante.producto_id == producto_id).delete()
        db.query(models.ProductoAtributo).filter(models.ProductoAtributo.producto_id == producto_id).delete()

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
#
# `_set_atributos` y `_generar_variantes` no hacen commit — así se pueden reusar tanto desde los
# endpoints de dos pasos (usados por la edición de un producto existente) como desde el alta atómica
# de un producto nuevo con variantes (`POST /productos/con-variantes`), donde todo tiene que quedar
# adentro de una única transacción.

def _set_atributos(db: Session, producto_id: int, atributos: list[schemas.ProductoAtributoIn]) -> dict:
    atributos_map = {}
    for item in atributos:
        atributo = db.get(models.Atributo, item.atributo_id)
        if not atributo:
            raise HTTPException(400, f"El atributo {item.atributo_id} no existe.")
        atributos_map[item.atributo_id] = atributo

    db.query(models.ProductoAtributo).filter(models.ProductoAtributo.producto_id == producto_id).delete()
    for item in atributos:
        db.add(models.ProductoAtributo(producto_id=producto_id, atributo_id=item.atributo_id, orden=item.orden))
    db.flush()
    return atributos_map


def _generar_variantes(db: Session, producto_id: int, selecciones: list[schemas.SeleccionAtributo]) -> None:
    if not selecciones:
        raise HTTPException(400, "Elegí al menos un atributo con sus valores para generar variantes.")

    atributos_producto = {
        pa.atributo_id
        for pa in db.query(models.ProductoAtributo).filter(models.ProductoAtributo.producto_id == producto_id).all()
    }
    for sel in selecciones:
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
    listas_valores = [sel.valor_ids for sel in selecciones]
    for combinacion in itertools.product(*listas_valores):
        calculations.resolver_o_crear_variante(db, producto_id, list(combinacion))


@router.post("/con-variantes", response_model=schemas.Producto)
def crear_con_variantes(payload: schemas.ProductoConVariantesCreate, db: Session = Depends(get_db)):
    """Alta atómica de un producto nuevo CON variantes: producto + producto_atributos + variantes
    quedan todos en la misma transacción — si algo falla a mitad de camino no queda un producto a
    medio configurar. Reusa la misma lógica que los endpoints de dos pasos usados por la edición."""
    if not payload.producto.tiene_variantes:
        raise HTTPException(400, "tiene_variantes debe ser true para usar este endpoint.")
    if payload.producto.categoria_id is not None and not db.get(models.Categoria, payload.producto.categoria_id):
        raise HTTPException(400, "La categoría indicada no existe.")
    if not payload.atributos:
        raise HTTPException(400, "Elegí al menos un atributo para este producto.")

    obj = models.Producto(**payload.producto.model_dump())
    db.add(obj)
    db.flush()  # obj.id disponible sin comprometer la transacción todavía

    _set_atributos(db, obj.id, payload.atributos)
    _generar_variantes(db, obj.id, payload.selecciones)

    db.commit()
    db.refresh(obj)
    return obj


@router.post("/{producto_id}/atributos", response_model=list[dict])
def set_atributos(producto_id: int, payload: schemas.ProductoAtributosRequest, db: Session = Depends(get_db)):
    producto = db.get(models.Producto, producto_id)
    if not producto:
        raise HTTPException(404, "Producto no encontrado.")
    if not producto.tiene_variantes:
        raise HTTPException(400, "El producto no tiene variantes habilitadas (tiene_variantes=False).")

    atributos_map = _set_atributos(db, producto_id, payload.atributos)
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


def _formatear_variantes(db: Session, producto_id: int, stock_por_id: dict) -> list[dict]:
    """Arma la lista de variantes de un producto con su stock, a partir de un mapa de stock ya
    calculado (stock_por_variante(db)) — separado de listar_variantes para que GET /ecommerce/catalogo
    pueda calcular ese mapa UNA sola vez para todo el catálogo en vez de por cada producto."""
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
            "stock_actual": stock_por_id.get(v.id, 0),
            "valores": [
                {"atributo_id": a.id, "atributo": a.nombre, "valor_atributo_id": va.id, "valor": va.valor}
                for va, a in valores
            ],
        })
    return resultado


@router.get("/{producto_id}/variantes", response_model=list[dict])
def listar_variantes(producto_id: int, db: Session = Depends(get_db)):
    if not db.get(models.Producto, producto_id):
        raise HTTPException(404, "Producto no encontrado.")
    # stock_actual por variante: mismo cálculo que usa la pantalla de Stock (stock_por_variante),
    # reusado acá para que Ventas pueda deshabilitar combinaciones sin stock sin duplicar la fórmula.
    stock_por_id = {s["variante_id"]: s["stock_actual"] for s in calculations.stock_por_variante(db)}
    return _formatear_variantes(db, producto_id, stock_por_id)


@router.post("/{producto_id}/variantes/generar", response_model=list[dict])
def generar_variantes(producto_id: int, payload: schemas.GenerarVariantesRequest, db: Session = Depends(get_db)):
    producto = db.get(models.Producto, producto_id)
    if not producto:
        raise HTTPException(404, "Producto no encontrado.")
    if not producto.tiene_variantes:
        raise HTTPException(400, "El producto no tiene variantes habilitadas (tiene_variantes=False).")

    _generar_variantes(db, producto_id, payload.selecciones)
    db.commit()

    return listar_variantes(producto_id, db)


# --- Fotos de producto (catálogo de e-commerce) ---

@router.post("/{producto_id}/fotos", response_model=schemas.FotoProducto)
async def subir_foto(producto_id: int, archivo: UploadFile = File(...), db: Session = Depends(get_db)):
    if not db.get(models.Producto, producto_id):
        raise HTTPException(404, "Producto no encontrado.")

    ext = (archivo.filename or "").rsplit(".", 1)[-1].lower()
    if ext not in EXTENSIONES_FOTO_VALIDAS:
        raise HTTPException(400, "Formato inválido: solo se aceptan JPG, PNG o WEBP.")

    contenido = await archivo.read()
    if len(contenido) > FOTO_TAMANO_MAXIMO_BYTES:
        raise HTTPException(400, "La foto no puede superar los 5MB.")

    carpeta = os.path.join(FOTOS_DIR, str(producto_id))
    os.makedirs(carpeta, exist_ok=True)
    nombre_archivo = f"{uuid.uuid4().hex}.{ext}"
    with open(os.path.join(carpeta, nombre_archivo), "wb") as f:
        f.write(contenido)

    siguiente_orden = (
        db.query(func.coalesce(func.max(models.ProductoFoto.orden), 0))
        .filter(models.ProductoFoto.producto_id == producto_id)
        .scalar()
    ) + 1
    foto = models.ProductoFoto(
        producto_id=producto_id, ruta_archivo=f"{producto_id}/{nombre_archivo}", orden=siguiente_orden
    )
    db.add(foto)
    db.commit()
    db.refresh(foto)
    return foto


@router.delete("/{producto_id}/fotos/{foto_id}")
def borrar_foto(producto_id: int, foto_id: int, db: Session = Depends(get_db)):
    foto = db.get(models.ProductoFoto, foto_id)
    if not foto or foto.producto_id != producto_id:
        raise HTTPException(404, "Foto no encontrada.")
    ruta_completa = os.path.join(FOTOS_DIR, foto.ruta_archivo)
    db.delete(foto)
    db.commit()
    if os.path.exists(ruta_completa):
        os.remove(ruta_completa)  # se borra el archivo DESPUÉS del commit: si el remove falla, la BD ya quedó consistente
    return {"ok": True}


@router.put("/{producto_id}/fotos/orden", response_model=list[schemas.FotoProducto])
def reordenar_fotos(producto_id: int, payload: schemas.ReordenarFotosRequest, db: Session = Depends(get_db)):
    fotos = {
        f.id: f
        for f in db.query(models.ProductoFoto).filter(models.ProductoFoto.producto_id == producto_id).all()
    }
    if not fotos:
        raise HTTPException(404, "Este producto no tiene fotos cargadas.")
    if set(payload.orden_ids) != set(fotos.keys()):
        raise HTTPException(400, "La lista de IDs no coincide con las fotos actuales del producto.")
    for pos, foto_id in enumerate(payload.orden_ids, start=1):
        fotos[foto_id].orden = pos
    db.commit()
    return sorted(fotos.values(), key=lambda f: f.orden)
