# Cambio de producto (devolución + reposición con pedido nuevo)

## Contexto

Ya existen, funcionando y probados contra la API real: reversión de ventas (`Devolucion`/
`DevolucionItem`, `calculations.procesar_devolucion`) y Nota de Crédito C (`facturacion.emitir_nota_credito`).
Lo que falta es el caso en que la clienta no quiere el reembolso sino cambiar la prenda por otra.

**No es una fase nueva ni algo del tamaño de Pedido/Facturación — es un agregado chico que orquesta lo
que ya existe.** No se toca `arca/`, `facturacion.py`, `reservas_stock` ni `ecommerce/`.

**Idea central**: un cambio = una `Devolucion` sobre el ítem original (ya existe, se reusa tal cual) +
un `Pedido` nuevo con el ítem de cambio (misma alta de pedido que ya existe, se reusa tal cual) + una
entidad liviana `Cambio` que vincula ambos para trazabilidad. **No se edita el `Pedido` original en
ningún momento** — sigue siendo inmutable salvo devolución/cancelación, como ya es hoy.

**La diferencia de precio NO necesita un movimiento de caja nuevo.** La `Devolucion` ya resta de caja el
monto del ítem devuelto, y el `Pedido` nuevo (una Venta normal) ya suma el monto del ítem nuevo — la
combinación de los dos ya netea la diferencia sola en `get_caja_actual`. `Cambio.diferencia_monto` es
un campo informativo (cuánto pagó de más o de menos la clienta), no dispara ningún `Movimiento` propio.

**Lo que ya cubre esto sin tocar nada nuevo**: si el pedido original ya tenía Factura C emitida, el botón
"Emitir Nota de Crédito" que ya existe en el historial de devoluciones de `Pedidos.jsx` va a aparecer
solo sobre la `Devolucion` que este flujo crea (usa `devolucion_requiere_nota_credito`, que no cambia). Y
el pedido nuevo es un `Pedido` como cualquier otro, así que el botón "Facturar" que ya existe lo cubre
directo. **El wizard de Cambio no necesita UI de facturación propia.**

## Paso 0

Antes de tocar nada, confirmar contra el código:

1. Dónde vive hoy la lógica de alta de un `Pedido` local con sus líneas (`POST /pedidos`, `crear_local`
   en `routers/pedidos.py`) — si el loop de validación por línea está inline en el router o ya delegado a
   una función de `calculations.py`. Esto decide el approach del punto 2.
2. Si `procesar_devolucion` es la única función de esta parte del sistema que commitea internamente
   (documentado que sí lo hace), o si la creación de pedido también commitea sola. Necesito saberlo para
   diseñar la atomicidad de `procesar_cambio` (ver más abajo).
3. El schema Pydantic real usado hoy para las líneas de `POST /pedidos` (nombres exactos de campos:
   `producto_id`, `variante_id`, `cantidad`, y si `precio_unitario` se manda desde el cliente o se toma
   de `producto.precio_venta` en el momento de la venta). Usar esos mismos nombres en los schemas nuevos,
   no inventar otros.
4. Cómo está armada hoy la pantalla de Análisis (`analisis_combinado`, BCG + contribución de margen):
   nombre real del componente frontend, si ya tiene un selector de ventana de días (7/30/90, mismo patrón
   que la Matriz BCG) reusable, y el estilo visual de sus tarjetas/paneles — para que el reporte nuevo de
   más abajo entre con el mismo criterio en vez de inventar un estilo aparte.

Si algo de lo que sigue no calza con lo que encontrás, avisame antes de implementar — no fuerces el
diseño de acá contra un código real distinto.

## Modelo de datos nuevo

Una sola tabla nueva, autocreada por `Base.metadata.create_all()` (sin `ALTER TABLE`, es tabla nueva):

```python
class Cambio(Base):
    __tablename__ = "cambios"
    id = Column(Integer, primary_key=True, index=True)
    pedido_original_id = Column(Integer, ForeignKey("pedidos.id"), nullable=False)
    devolucion_id = Column(Integer, ForeignKey("devoluciones.id"), nullable=False)
    pedido_nuevo_id = Column(Integer, ForeignKey("pedidos.id"), nullable=False)
    diferencia_monto = Column(Numeric, nullable=False, default=0)  # positivo: pagó de más, negativo: se le devolvió
    fecha = Column(DateTime, server_default=func.now())
    motivo = Column(Text, nullable=True)
```

Sin `relationship` — mismo criterio minimalista que `ReservaStock`/`MixSnapshot`. `diferencia_monto` es
un valor monetario transaccional real (como `Factura.importe_total`), no un dato de reporte: se persiste
en `Decimal`, sin la conversión a `float` que sí aplica en los endpoints `/dashboard/*` y `/stock/*`.

## Backend — orquestación

### 1. Extender `procesar_devolucion`, no duplicarla

Agregar un parámetro `commit: bool = True` (default preserva el comportamiento actual, cero cambios para
el único call site que ya existe hoy). Con `commit=False`, hace exactamente los mismos pasos (crea
`Devolucion`, `Movimiento` tipo `"Devolucion"` por línea, `DevolucionItem`, actualiza `Pedido.estado` si
corresponde) pero no llama a `db.commit()` — deja el control al caller. Mismo criterio que ya usa
`stock_disponible(excluir_sesion=None)`: extensión retrocompatible, no una función nueva en paralelo.

### 2. Igual tratamiento para la creación del pedido nuevo (si hace falta, según el Paso 0)

Si la lógica de alta de pedido con líneas hoy vive inline en el router: extraerla a una función de
`calculations.py` — por ejemplo `crear_pedido_con_items(db, *, canal, items, facturar_arca,
cliente_nombre=None, forma_entrega=None, sesion_id=None, commit=True) -> models.Pedido` — y que
`crear_local` (`routers/pedidos.py`) quede como un wrapper delgado que la llama con `commit=True` (mismo
comportamiento exacto de hoy, incluido el gotcha de `liberar_reserva` como primer paso). Esto además
alinea esa parte del código con la convención ya establecida del proyecto ("la lógica de negocio vive en
`calculations.py`, los routers son delgados").

Si esto resulta más invasivo de lo que parece por el Paso 0, no lo fuerces — avisame y lo resolvemos
distinto (por ejemplo, aceptando una ventana chica de no-atomicidad y documentándola, ver "Casos de
borde" más abajo) antes de tocar código que no hace falta tocar para un agregado de este tamaño.

### 3. `calculations.procesar_cambio`

```python
def procesar_cambio(db, pedido_original: models.Pedido, items_devolver, items_nuevos, motivo=None,
                     canal_nuevo="local", facturar_arca_nuevo=False, cliente_nombre_nuevo=None) -> models.Cambio:
```

Recibe el `Pedido` original ya cargado (no un id — mismo criterio que `monto_neto_pedido`, evita
reconsultarlo; el router hace el `get()` y el 404 si no existe, igual que en
`POST /pedidos/{id}/devoluciones`).

Pasos:
1. `devolucion = procesar_devolucion(db, pedido_original.id, items_devolver, motivo=motivo, tipo="Devolucion", commit=False)`
2. `facturar_arca_final = facturar_arca_nuevo` (default `False` — la facturación del pedido nuevo sigue
   siendo 100% manual después, vía el checkbox/botón que ya existen, igual que cualquier pedido nuevo de
   Caja; no tiene sentido heredar el `facturar_arca` del original, ver más arriba por qué)
   `cliente_nombre_final = cliente_nombre_nuevo if cliente_nombre_nuevo is not None else pedido_original.cliente_nombre`
3. Crear el pedido nuevo con `items_nuevos`, `canal=canal_nuevo`, `facturar_arca=facturar_arca_final`,
   `cliente_nombre=cliente_nombre_final`, sin `sesion_id` (un cambio es una acción atómica de un solo
   paso, no necesita el mecanismo de reserva pensado para un carrito que se arma en el tiempo),
   `commit=False`.
4. `diferencia = monto_neto_pedido(db, pedido_nuevo) - monto_devolucion(db, devolucion)`
5. Crear `Cambio(pedido_original_id=pedido_original.id, devolucion_id=devolucion.id,
   pedido_nuevo_id=pedido_nuevo.id, diferencia_monto=diferencia, motivo=motivo)`, `db.add`, **un solo
   `db.commit()` acá, al final** — esto es lo que hace atómica toda la operación.
6. Si algo de esto lanza `ValueError` (viene de `procesar_devolucion` o de la validación de stock del
   pedido nuevo), no debe quedar nada escrito — mismo invariante que ya cumple `procesar_devolucion`
   sola. `procesar_cambio` no captura esos errores, los deja subir: el router los traduce a 400, igual
   que ya hace con `procesar_devolucion`.

### 4. Endpoints nuevos (`routers/pedidos.py`)

- `POST /pedidos/{pedido_id}/cambios` — 404 si el pedido no existe, 400 con el detalle si
  `procesar_cambio` rechaza algo (`ValueError`). `response_model=schemas.CambioOut`.
- `GET /pedidos/{pedido_id}/cambios` — historial, más reciente primero. Mismo criterio que
  `GET /pedidos/{id}/devoluciones`.

### 5. Schemas nuevos

```python
class CambioItemDevolver(BaseModel):
    pedido_item_id: int
    cantidad: int

class CambioItemNuevo(BaseModel):
    producto_id: int
    variante_id: Optional[int] = None
    cantidad: int
    # sumar precio_unitario acá SOLO si el Paso 0 confirma que POST /pedidos ya lo recibe del cliente
    # hoy — si el precio sale de producto.precio_venta en el momento de la venta, no agregarlo.

class CambioCreate(BaseModel):
    items_devolver: List[CambioItemDevolver]
    items_nuevos: List[CambioItemNuevo]
    motivo: Optional[str] = None
    canal_nuevo: str = "local"
    facturar_arca_nuevo: bool = False                # decisión manual, igual que cualquier pedido nuevo en Caja
    cliente_nombre_nuevo: Optional[str] = None       # None = hereda del pedido original

class CambioOut(BaseModel):
    id: int
    pedido_original_id: int
    devolucion: DevolucionOut
    pedido_nuevo: PedidoOut
    diferencia_monto: Decimal
    fecha: datetime
    motivo: Optional[str]
```

Armar `CambioOut` reusando los helpers que ya existen (`_pedido_out`, `_devolucion_out`) para
`pedido_nuevo` y `devolucion` — no reinventar el `monto_neto` ni el `requiere_nota_credito`.

### 6. Que una `Devolucion` "sepa" si es parte de un cambio (no solo el panel nuevo)

El panel de historial de cambios (frontend, más abajo) resuelve la vista "cambio-céntrica", pero el
panel de devoluciones que **ya existe hoy** (sin tocar) sigue mostrando esa misma `Devolucion` como una
devolución suelta, sin ninguna pista de que en realidad fue parte de un cambio — ahí es donde se ve como
"dos operaciones sueltas" si alguien mira solo esa pantalla. Agregar un campo opcional a `DevolucionOut`:

```python
class CambioResumenOut(BaseModel):
    id: int
    pedido_nuevo_id: int
    diferencia_monto: Decimal
    fecha: datetime

# en DevolucionOut, un campo más:
    cambio: Optional[CambioResumenOut] = None
```

`_devolucion_out` (el helper que ya existe) lo completa con una query chica: `Cambio` filtrado por
`devolucion_id == devolucion.id` (0 o 1 fila, `devolucion_id` no es único a nivel de constraint pero la
lógica de `procesar_cambio` nunca genera más de un `Cambio` por `Devolucion`). Este mismo campo es
también la forma más simple de armar la métrica de negocio de "tasa de cambios vs. devoluciones-reembolso"
más adelante: alcanza con contar devoluciones con `cambio IS NOT NULL` vs. `cambio IS NULL` en un rango de
fechas — no hace falta nada en el modelo de datos para eso, ya está — **si en algún momento se quiere
esa métrica en una pantalla, es un endpoint/gráfico aparte, no hace falta resolverlo en este agregado**.

## Frontend (`Pedidos.jsx`)

- **Panel de devoluciones existente, una línea nueva**: cuando `devolucion.cambio` no es `null`, mostrar
  ahí mismo algo tipo "🔄 Parte de un cambio → pedido #{pedido_nuevo_id}" en vez de (o junto a) la fila
  normal de devolución — así se ve el vínculo aunque se entre por el panel de devoluciones y no por el de
  cambios.
- Botón nuevo "Cambiar producto" junto al de devolución — misma convención del proyecto (sin modal,
  sección condicional debajo de la tabla, igual que el panel de devolución que ya existe).
- **Paso 1 (qué se devuelve)**: reusar el mismo selector de línea + cantidad máxima disponible que ya
  tiene el panel de devolución actual — no reimplementarlo.
- **Paso 2 (qué prenda entra)**: reusar la lógica de selector categoría→producto→atributos→variante con
  filtro por stock que ya existe en `Movimientos.jsx` (`opcionesParaAtributo` y compañía). **El proyecto
  ya tiene precedente de NO compartir ese selector entre pantallas** (`Compras.jsx` y `Movimientos.jsx`
  tienen cada una su propia copia, a propósito) — seguir el mismo criterio acá: copiar la lógica a
  `Pedidos.jsx` en vez de extraer un hook compartido, salvo que prefieras romper esa convención a
  propósito (avisame si es así).
- **Diferencia**: mostrar un preview informativo en el cliente (cantidad × precio de lo nuevo, menos lo
  que se está devolviendo) — el backend la recalcula de forma autoritativa al confirmar, esto es solo
  para que la usuaria vea el número antes de confirmar.
- Confirmar → `POST /pedidos/{pedido_id}/cambios`. Mismo patrón de protección de doble click que ya usan
  `facturando`/`devolviendo`/`emitiendoNC` (Set de ids en vuelo).
- Al confirmar con éxito: refrescar `GET /pedidos` completo (así se ve tanto el pedido original
  actualizado como la fila nueva) y cerrar el panel. No hace falta ninguna UI de facturación nueva — el
  botón "Facturar" de la fila nueva y el botón "Emitir Nota de Crédito" del historial de devoluciones del
  pedido original ya cubren el resto, sin cambios.
- **Mensaje de confirmación con el monto real, no genérico**: la cajera tiene que cobrar o devolver esa
  plata en el momento, no es solo un dato informativo. Si `diferencia_monto > 0`: algo tipo "La clienta
  te debe ${monto} más." Si `< 0`: "Hay que devolverle ${abs(monto)}." Si `= 0`: "Cambio a precio igual —
  no hace falta tocar la facturación, la Factura original sigue siendo válida." En los dos primeros
  casos, agregar además la sugerencia de facturar/emitir NC si corresponde, señalando los botones que ya
  existen, sin auto-dispararlos.
- **Historial de cambios, visible después de cerrar el panel**: el endpoint `GET /pedidos/{pedido_id}/cambios`
  (ya definido en el backend más abajo) no sirve de nada si no lo consume nadie — agregar un panel de
  historial en `Pedidos.jsx`, mismo criterio que el de devoluciones (sección condicional, sin modal): por
  cada `Cambio`, fecha, resumen de qué se devolvió / qué entró (`ítem X → ítem Y`), y `diferencia_monto`
  con la misma dirección explícita de arriba ("cobrado de más" / "devuelto"). Así Florencia puede volver
  a consultarlo más tarde sin depender de haber visto el aviso en el momento.

## Reporte — tasa de cambios vs. devoluciones-reembolso (pantalla Análisis)

Métrica de negocio: de todas las `Devolucion` en una ventana de días, cuántas fueron en realidad un
cambio (tienen `Cambio.devolucion_id` apuntándolas) vs. cuántas fueron reembolso puro. El dato ya está
100% disponible con el modelo de arriba — esto es solo exponerlo.

### Backend

```python
def tasa_cambios_vs_devoluciones(db, dias: int = 30) -> dict:
    desde = datetime.now() - timedelta(days=dias)
    devoluciones = db.query(models.Devolucion).filter(models.Devolucion.fecha >= desde).all()
    total = len(devoluciones)
    ids_cambio = {
        row[0] for row in db.query(models.Cambio.devolucion_id)
        .filter(models.Cambio.devolucion_id.in_([d.id for d in devoluciones]))
    }
    cantidad_cambios = len(ids_cambio)
    cantidad_reembolsos = total - cantidad_cambios
    tasa_cambio_pct = (cantidad_cambios / total * 100) if total else 0  # 0, no error — mismo criterio que el mix real sin ventas
    monto_cambiado = sum(monto_devolucion(db, d) for d in devoluciones if d.id in ids_cambio)
    monto_reembolsado = sum(monto_devolucion(db, d) for d in devoluciones if d.id not in ids_cambio)
    return {
        "dias": dias, "total_devoluciones": total,
        "cantidad_cambios": cantidad_cambios, "cantidad_reembolsos": cantidad_reembolsos,
        "tasa_cambio_pct": tasa_cambio_pct,
        "monto_cambiado": monto_cambiado, "monto_reembolsado": monto_reembolsado,
    }
```

Reusa `monto_devolucion` (ya existe) por cada `Devolucion` — un loop en Python, no una query agregada;
para el volumen de un negocio unipersonal no hace falta más, mismo criterio que ya aplica el proyecto en
otros lados. Es un endpoint de **reporte**, no una operación contable: los montos van en `float` en el
schema de salida, no `Decimal` (mismo criterio que `/dashboard/*` y `/stock/*`, a diferencia de
`Cambio.diferencia_monto` que sí es un valor transaccional real).

```python
class TasaCambiosDevolucionesOut(BaseModel):
    dias: int
    total_devoluciones: int
    cantidad_cambios: int
    cantidad_reembolsos: int
    tasa_cambio_pct: float
    monto_cambiado: float
    monto_reembolsado: float
```

Endpoint: `GET /analisis/cambios-devoluciones?dias=30` — confirmar el prefijo real del router de Análisis
en el Paso 0 (asumo `routers/analisis.py` con algo como `GET /analisis/combinado` ya existente, pero
verificalo antes de asumirlo).

### Frontend (pantalla Análisis)

Agregar una tarjeta/sección chica con estos números (total de devoluciones, cambios, reembolsos, tasa %,
monto cambiado, monto reembolsado), con el mismo estilo visual que ya usan las tarjetas de esa pantalla
(BCG / Motor-Decoración) — no inventar un estilo nuevo. **Si la pantalla ya tiene un selector de ventana
de días (7/30/90) para el resto de las métricas, reusar exactamente ese mismo estado** para pedir este
reporte también, en vez de agregar un selector de ventana independiente.

### Casos de borde de este reporte

- Ventana sin ninguna devolución → `total_devoluciones = 0`, `tasa_cambio_pct = 0`, sin error (mismo
  criterio que el resto del proyecto: "0%, no excepción").
- Ventana con cambios pero cero reembolsos puros (o viceversa) → los porcentajes tienen que dar 100%/0%
  sin dividir por cero en ningún punto intermedio.

## Qué NO se toca

`backend/app/arca/`, `facturacion.py`, `reservas_stock`/`reservar_stock`/`liberar_reserva` (un cambio no
usa el mecanismo de carrito), `ecommerce/` (storefront), `Compras.jsx`.

Cambios que podes hacer por api o perdimelo a mi para que lo haga por el navegador

1. Pedido original sin facturar todavía → el cambio no debe generar NC (`devolucion_requiere_nota_credito`
   da `False` como ya hace hoy), y `facturar_arca_nuevo` por default hereda del original.
2. Pedido original ya facturado con CAE real → después del cambio, el botón "Emitir Nota de Crédito"
   debe aparecer sobre la `Devolucion` nueva en el historial del pedido original.
3. Cambio parcial (pedido con 2+ líneas, se devuelve solo 1) → `Pedido.estado` del original NO debe pasar
   a `"Cancelado"` (la regla existente solo dispara eso si se devolvió el 100% de todas las líneas).
4. Diferencia = 0 → `diferencia_monto` se guarda en 0, sin comportamiento especial.
5. La prenda de cambio no tiene stock suficiente → todo el `Cambio` debe abortar sin dejar la
   `Devolucion` escrita sola (esto es lo que valida que la atomicidad del punto 3 de
   `procesar_cambio` funciona de verdad — probarlo a propósito).
6. Si por algún motivo no se llegó a una atomicidad completa (Paso 0 lo determina): documentar en el
   `CLAUDE.md` correspondiente cómo se detecta a mano una `Devolucion` sin `Cambio` asociado (queda
   visible igual en el historial normal de devoluciones del pedido) y cómo completarla manualmente desde
   Caja.
7. Cambio a precio igual (`diferencia_monto = 0`) → confirmar que el flujo no fuerza ni dispara ninguna
   acción fiscal automática (ni NC ni Factura nueva) — la Factura original, si existía, queda intacta y
   sigue siendo válida tal cual, solo cambia el aviso informativo del punto anterior.
8. Después de confirmar un cambio con diferencia, cerrar el panel y volver a abrir el historial (o
   recargar la página) → el monto y la dirección de la diferencia tienen que seguir viéndose igual que en
   el aviso inicial, sin depender de haber estado mirando la pantalla en el momento de confirmar.

## Al terminar

Actualizar los `CLAUDE.md` de raíz/backend/frontend con un resumen de esta funcionalidad, mismo estilo
que las secciones existentes (qué se agregó, qué se reusó, qué NO se tocó, y cualquier decisión de
diseño — en particular qué se resolvió en el Paso 0 sobre atomicidad).
Pisar el contenido de resumenutimamodif con el resumen de lo que se haya realizado.
