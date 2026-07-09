# FashBalance 2.0

Software de punto de equilibrio ponderado + gestión profesional de inventario para venta de indumentaria (un solo local, un solo usuario), pensado para escalar de "cargar cada prenda" a **categorías**, con Matriz BCG, Sell-through y alerta de rotación de 90 días.

## Stack

- **PostgreSQL 16** – base de datos relacional.
- **FastAPI + SQLAlchemy** (Python) – API REST, hace todos los cálculos pesados.
- **React 18 + Vite + Tailwind + Recharts** – frontend, dashboards interactivos.
- **Docker Compose** – orquesta los 3 servicios.

## Cómo correrlo

Requisito: Docker y Docker Compose instalados.

```bash
cd fashbalance
docker compose up --build
```

- Frontend: http://localhost:5173
- API (docs interactivos Swagger): http://localhost:8000/docs
- Postgres queda expuesto en el puerto 5432 (usuario/pass/db: `fashbalance`) por si querés conectarte con un cliente externo (DBeaver, pgAdmin, etc).

Los datos quedan en un volumen Docker (`fashbalance_db_data`), así que sobreviven a reinicios de los contenedores. Para borrar todo y arrancar de cero:

```bash
docker compose down -v
```

## Orden recomendado de carga inicial

1. **Categorías** — creá tus familias de productos (Remeras, Jeans, Abrigos, etc). No vienen predefinidas, las cargás vos.
2. **Catálogo** — cargá cada prenda **una sola vez** (ficha maestra): nombre, categoría, precio de venta y % de mix. El costo se puede dejar en 0, se recalcula solo.
3. **Compras** — cada vez que reponés stock de un producto, registrá acá cantidad, costo unitario, fecha y proveedor (opcional). El costo del producto se recalcula automáticamente como **promedio ponderado** entre todas sus compras, y el stock actual = compras − ventas (no se carga a mano).
4. **Estructura Fija** — cargá tus costos fijos mensuales (alquiler, servicios, etc).
5. **Caja** — registrá cada venta con tipo **"Venta"**: elegís categoría → producto (cascada), el precio y el monto (cantidad × precio) se precargan solos, la fecha viene con la de hoy pero es editable, y el concepto es opcional. Esto alimenta automáticamente Stock, Matriz BCG y Sell-through.

## Qué calcula cada módulo

- **Panel de Control**: caja actual, punto de equilibrio ponderado por mix de productos (en $ de facturación), y contribución de margen por categoría (qué familia es el "motor" del negocio).
- **Matriz BCG**: clasifica cada prenda en Estrella / Vaca / Incógnita / Perro según margen (%) y volumen vendido en la ventana de días elegida (7/30/90), usando la mediana como umbral.
- **Stock**: stock actual por producto y agregado por categoría, con antigüedad calculada por **FIFO** (se asume que se vende primero lo más viejo) y alerta automática cuando el lote más antiguo sin vender supera los 90 días.
- **Sell-through**: % del total histórico comprado que ya se vendió, por producto.

## Modelo de datos: Producto vs Compras vs Movimientos

Son tres cosas separadas a propósito:

- **`productos`**: ficha maestra, se carga una vez. Guarda nombre, categoría, precio de venta, % de mix y el **costo promedio** (calculado, no se edita a mano salvo carga inicial).
- **`compras`**: cada reposición de stock. Un producto puede tener muchas. De acá sale el costo promedio ponderado y el stock disponible.
- **`movimientos`**: caja. `tipo` puede ser `"Venta"` (siempre atada a un producto y a una cantidad — resta stock, suma caja), `"Ingreso"` (otro ingreso sin producto) o `"Egreso"` (gasto).

## Estructura del proyecto

```
fashbalance/
├── backend/
│   ├── app/
│   │   ├── main.py            # arranque de FastAPI + CORS + creación de tablas
│   │   ├── database.py        # conexión a Postgres
│   │   ├── models.py          # tablas: categorias, productos, costos_fijos, movimientos
│   │   ├── schemas.py         # validación Pydantic
│   │   ├── calculations.py    # punto de equilibrio, BCG, sell-through, contribución
│   │   └── routers/           # endpoints REST por entidad
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── pages/              # Dashboard, Categorias, Productos, CostosFijos, Movimientos, BCG, SellThrough
│   │   ├── components/
│   │   ├── api.js
│   │   └── App.jsx
│   ├── package.json
│   └── Dockerfile
└── docker-compose.yml
```

## Notas técnicas

- Las categorías **no están hardcodeadas**: es una tabla más, con CRUD propio (`/categorias`), y cada producto se asocia vía `categoria_id` (opcional).
- Los contenedores de backend y frontend montan el código como volumen, así que podés editar archivos localmente y ver los cambios sin reconstruir la imagen (hot-reload tanto en FastAPI `--reload` como en Vite dev server).
- Para producción real conviene: (1) cambiar las credenciales de Postgres, (2) servir el frontend con un build estático + Nginx en vez del dev server de Vite, y (3) sacar el `allow_origins=["*"]` del CORS y restringirlo a tu dominio.

## Próximos pasos posibles (no incluidos en esta versión)

- Módulo de "Sugerencias de Compra" (proyección de agotamiento de stock según velocidad de venta).
- Reportes Best/Worst Sellers semanales automáticos.
- Proyección de flujo de caja estacional.
