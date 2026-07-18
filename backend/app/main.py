import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .database import Base, engine
from .routers import (
    atributos, categorias, compras, configuracion, costos_fijos, dashboard, ecommerce, importacion,
    mix_snapshots, movimientos, pedidos, productos, stock,
)

Base.metadata.create_all(bind=engine)

app = FastAPI(title="FashBalance API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Fotos de producto, servidas como archivos estáticos para el catálogo de e-commerce.
# os.makedirs es necesario porque StaticFiles valida existencia del directorio al construirse,
# y el volumen nombrado (fashbalance_fotos_data) arranca vacío en el primer `docker compose up`.
FOTOS_DIR = os.getenv("FOTOS_PRODUCTOS_DIR", "/app/fotos_productos")
os.makedirs(FOTOS_DIR, exist_ok=True)
app.mount("/fotos", StaticFiles(directory=FOTOS_DIR), name="fotos")

app.include_router(categorias.router)
app.include_router(productos.router)
app.include_router(atributos.router)
app.include_router(compras.router)
app.include_router(stock.router)
app.include_router(costos_fijos.router)
app.include_router(movimientos.router)
app.include_router(dashboard.router)
app.include_router(importacion.router)
app.include_router(configuracion.router)
app.include_router(mix_snapshots.router)
app.include_router(ecommerce.router)
app.include_router(pedidos.router)


@app.get("/")
def root():
    return {"status": "ok", "service": "FashBalance API", "version": "2.0.0"}


@app.get("/health")
def health():
    return {"status": "healthy"}
