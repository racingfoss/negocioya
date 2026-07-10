from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .database import Base, engine
from .routers import categorias, compras, costos_fijos, dashboard, importacion, movimientos, productos, stock

Base.metadata.create_all(bind=engine)

app = FastAPI(title="FashBalance API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(categorias.router)
app.include_router(productos.router)
app.include_router(compras.router)
app.include_router(stock.router)
app.include_router(costos_fijos.router)
app.include_router(movimientos.router)
app.include_router(dashboard.router)
app.include_router(importacion.router)


@app.get("/")
def root():
    return {"status": "ok", "service": "FashBalance API", "version": "2.0.0"}


@app.get("/health")
def health():
    return {"status": "healthy"}
