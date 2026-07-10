import io
from datetime import date, datetime
from decimal import Decimal, InvalidOperation

import openpyxl
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from .. import calculations, models
from ..database import get_db

router = APIRouter(prefix="/importacion", tags=["Importación"])

# La búsqueda de productos existentes se hace por Nombre (case-insensitive, sin espacios
# al principio/final). No requiere "código de producto": con ~100 SKU y una sola persona
# armando la planilla, es más práctico. Si en el futuro hace falta desambiguar productos
# con nombres parecidos, el campo `codigo` del catálogo (opcional) puede usarse como
# columna extra "CodigoProducto" acá sin romper nada de lo que hay hoy.
COLUMNAS = ["Producto", "Categoria", "Costo", "Cantidad", "Descuento", "FechaCompra", "PrecioVenta"]
COLUMNAS_OBLIGATORIAS = ["Producto", "Costo", "Cantidad"]


def _norm(valor) -> str:
    return str(valor).strip() if valor is not None else ""


def _parse_fecha(valor):
    if valor in (None, ""):
        return date.today()
    if isinstance(valor, datetime):
        return valor.date()
    if isinstance(valor, date):
        return valor
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(str(valor).strip(), fmt).date()
        except ValueError:
            continue
    return date.today()


@router.get("/plantilla")
def descargar_plantilla():
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Importación"
    ws.append(COLUMNAS)
    ws.append(["Top Básico", "Remeras", 15000, 10, "", "2026-07-01", 32000])
    ws.append(["Vestido Fiesta", "Vestidos", 34000, 5, 10, "2026-07-01", ""])
    ws.append(["Top Básico", "Remeras", 16000, 5, "", "2026-07-15", ""])
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=plantilla_importacion_fashbalance.xlsx"},
    )


@router.post("/procesar")
async def procesar(file: UploadFile = File(...), db: Session = Depends(get_db)):
    if not file.filename.lower().endswith((".xlsx", ".xlsm")):
        raise HTTPException(400, "El archivo debe ser una planilla Excel (.xlsx).")

    contenido = await file.read()
    try:
        wb = openpyxl.load_workbook(io.BytesIO(contenido), data_only=True)
    except Exception:
        raise HTTPException(400, "No se pudo leer el archivo. Verificá que sea un .xlsx válido.")

    ws = wb.active
    filas = list(ws.iter_rows(values_only=True))
    if not filas:
        raise HTTPException(400, "La planilla está vacía.")

    encabezado = [_norm(c) for c in filas[0]]
    idx = {col: (encabezado.index(col) if col in encabezado else None) for col in COLUMNAS}

    faltantes = [c for c in COLUMNAS_OBLIGATORIAS if idx[c] is None]
    if faltantes:
        raise HTTPException(400, f"Faltan columnas obligatorias en la planilla: {', '.join(faltantes)}.")

    categorias_cache = {c.nombre.strip().lower(): c for c in db.query(models.Categoria).all()}
    productos_cache = {p.nombre.strip().lower(): p for p in db.query(models.Producto).all()}

    productos_creados = []
    compras_registradas = []
    cambios_costo = []
    errores = []
    productos_nuevos_ids = []

    def val(fila, col):
        i = idx.get(col)
        return fila[i] if i is not None and i < len(fila) else None

    for n, fila in enumerate(filas[1:], start=2):
        nombre = _norm(val(fila, "Producto"))
        if not nombre:
            continue  # fila vacía, se ignora sin marcar error

        try:
            costo_raw = val(fila, "Costo")
            cantidad_raw = val(fila, "Cantidad")
            if costo_raw in (None, "") or cantidad_raw in (None, ""):
                errores.append({"fila": n, "producto": nombre, "motivo": "Falta Costo o Cantidad."})
                continue

            costo = Decimal(str(costo_raw))
            cantidad = int(cantidad_raw)
            if cantidad <= 0:
                errores.append({"fila": n, "producto": nombre, "motivo": "La cantidad debe ser mayor a 0."})
                continue

            descuento_raw = val(fila, "Descuento")
            if descuento_raw not in (None, ""):
                descuento_pct = Decimal(str(descuento_raw))
                costo_final = costo * (Decimal("1") - descuento_pct / Decimal("100"))
            else:
                costo_final = costo
            costo_final = round(costo_final, 2)

            fecha = _parse_fecha(val(fila, "FechaCompra"))
            clave = nombre.lower()
            producto = productos_cache.get(clave)

            if producto is None:
                # Producto nuevo: hace falta categoría (se crea si no existe) y precio de venta.
                categoria_nombre = _norm(val(fila, "Categoria"))
                categoria = None
                if categoria_nombre:
                    categoria = categorias_cache.get(categoria_nombre.lower())
                    if categoria is None:
                        categoria = models.Categoria(nombre=categoria_nombre)
                        db.add(categoria)
                        db.flush()
                        categorias_cache[categoria_nombre.lower()] = categoria

                precio_raw = val(fila, "PrecioVenta")
                if precio_raw in (None, ""):
                    errores.append({
                        "fila": n, "producto": nombre,
                        "motivo": "Producto nuevo sin PrecioVenta (obligatorio para altas).",
                    })
                    continue
                precio_venta = Decimal(str(precio_raw))

                producto = models.Producto(
                    nombre=nombre,
                    categoria_id=categoria.id if categoria else None,
                    precio_venta=precio_venta,
                    costo=costo_final,
                    mix_pct=0,
                    activo=True,
                )
                db.add(producto)
                db.flush()
                productos_cache[clave] = producto
                productos_nuevos_ids.append(producto.id)

                db.add(models.Compra(
                    producto_id=producto.id, fecha=fecha, cantidad=cantidad,
                    costo_unitario=costo_final, proveedor="Importación Excel",
                ))
                db.flush()

                productos_creados.append({
                    "producto_id": producto.id, "producto": nombre,
                    "categoria": categoria.nombre if categoria else "Sin categoría",
                    "stock_inicial": cantidad, "costo": float(costo_final), "precio_venta": float(precio_venta),
                })
            else:
                # Reposición de un producto que ya existe en el catálogo.
                costo_promedio_antes = float(producto.costo)

                db.add(models.Compra(
                    producto_id=producto.id, fecha=fecha, cantidad=cantidad,
                    costo_unitario=costo_final, proveedor="Importación Excel",
                ))
                db.flush()
                calculations.recalcular_costo_promedio(db, producto.id)
                db.refresh(producto)
                costo_promedio_despues = float(producto.costo)

                compras_registradas.append({
                    "producto_id": producto.id, "producto": nombre, "cantidad": cantidad,
                    "costo_unitario": float(costo_final), "fecha": fecha.isoformat(),
                })

                diferencia_pct = (
                    round((costo_promedio_despues - costo_promedio_antes) / costo_promedio_antes * 100, 2)
                    if costo_promedio_antes else 0.0
                )
                if abs(diferencia_pct) > calculations.UMBRAL_CAMBIO_COSTO_PCT:
                    precio_actual = float(producto.precio_venta)
                    cambios_costo.append({
                        "producto_id": producto.id,
                        "producto": nombre,
                        "costo_anterior": costo_promedio_antes,
                        "costo_nuevo": costo_promedio_despues,
                        "diferencia_pct": diferencia_pct,
                        "precio_venta_actual": precio_actual,
                        "precio_venta_sugerido": round(precio_actual * (1 + diferencia_pct / 100), 2),
                    })

        except (InvalidOperation, ValueError) as e:
            errores.append({"fila": n, "producto": nombre, "motivo": f"Dato inválido ({e})."})
            continue

    db.commit()

    # por si el mismo producto nuevo aparece en más de una fila de la planilla
    for pid in productos_nuevos_ids:
        calculations.recalcular_costo_promedio(db, pid)

    return {
        "productos_creados": productos_creados,
        "compras_registradas": compras_registradas,
        "cambios_costo": cambios_costo,
        "errores": errores,
    }
