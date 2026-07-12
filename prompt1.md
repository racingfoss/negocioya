En Caja > Ventas: al elegir un producto con variantes, los combos de atributo tienen que reflejar stock
disponible, no solo qué combinaciones existen.

Antes de tocar nada, revisá el estado actual de `Movimientos.jsx` — no doy por sentado que ya tenga el
mismo filtro por existencia que `Compras.jsx` (con su función `opcionesParaAtributo` y los datos de
`variantesProducto`). Puede que Movimientos todavía muestre TODOS los atributos/valores del sistema sin
filtrar nada, o puede que ya tenga el filtro por existencia pero le falte el de stock. Confirmalo primero.

## Comportamiento esperado (destino final, sin importar de qué estado parta)

- Igual que ya hace `Compras.jsx`: el combo del primer atributo (ej. Talle) solo lista valores que forman
  parte de alguna `Variante` real de ESE producto — no todos los `valores_atributo` del sistema. El
  siguiente combo (ej. Color) se filtra además a lo que, combinado con el valor ya elegido, corresponda a
  una variante real.
- Encima de eso (esto es lo nuevo, específico de Ventas, no aplica a Compras): de esas opciones que sí
  existen, hay que distinguir cuáles tienen stock:
  - Si al menos una variante con ese valor tiene `stock_actual > 0`: opción habilitada, normal.
  - Si NINGUNA variante con ese valor tiene stock: la opción se sigue mostrando (no se oculta — tiene
    sentido que la vendedora vea que el producto "existe" en ese talle aunque no haya ahora), pero con
    `disabled` en el `<option>` y agregale " (sin stock)" al texto.
  - Mismo criterio en cascada para el segundo combo, evaluando el `stock_actual` de la combinación
    puntual (ej. Talle+Color), no solo del primer atributo.
- Si se cambia la selección del primer atributo, resetear la del segundo.
- Si TODAS las opciones del primer combo quedan deshabilitadas (sin stock en ninguna variante), mostrar
  un mensaje explícito arriba del formulario ("Este producto no tiene stock disponible en ninguna
  variante") en vez de un combo lleno de opciones grises sin contexto.
- Si el producto tiene `tiene_variantes=True` pero cero `Variante` cargadas todavía, replicá el mismo
  aviso que ya usa Compras para ese caso ("Este producto no tiene variantes cargadas todavía...").

## Backend: extender, no duplicar

`stock_por_variante()` ya existe en `calculations.py` (mismo cálculo que `stock_por_producto`, agrupado
por `variante_id`). Identificá qué endpoint alimenta hoy a `variantesProducto` en `Compras.jsx` y
extendé ESA respuesta para que cada variante incluya su `stock_actual` (usando `stock_por_variante`) —
no crees un endpoint paralelo. Ventas y Compras terminan consumiendo la misma fuente de datos; la
diferencia de comportamiento (Compras ignora `stock_actual` al habilitar/deshabilitar, Ventas no) queda
del lado del frontend de cada pantalla, no del backend. NO toques el comportamiento de `Compras.jsx`
— sigue mostrando todas las variantes existentes como seleccionables, tengan o no stock.

## Dos agregados que no pediste explícitamente pero salen del mismo bug — decidí antes de tirar el prompt si los querés en esta pasada o los dejamos para después

1. **Tope de cantidad en el frontend**: aunque el combo ya no deje elegir una variante sin stock, nada
   impide cargar una Cantidad mayor al `stock_actual` de la variante elegida (ej. hay 3, cargás 10).
2. **Validación real en el backend**: confirmado en el CLAUDE.md que `POST /movimientos` (tipo Venta) hoy
   solo valida que venga `variante_id` y que pertenezca al producto — no valida que la `cantidad` no
   supere el `stock_actual` de esa variante (ni, para productos sin variantes, el `stock_actual` del
   producto). El punto 1 es solo cosmético del lado del frontend, se puede saltear llamando a la API
   directo — si querés blindarlo de verdad, el backend tiene que rechazar la Venta en ese caso.

Si los querés a los dos, agregalo explícito en el prompt antes de pegárselo a Claude Code. Si no, decile
que se enfoque solo en los combos de Ventas y te muestre plan para estos dos antes de tocar nada.

## Qué NO cambiar

`Compras.jsx` y su filtro por existencia (sin tocar). Stock, Análisis, Catálogo, Importación.

## Antes de terminar

Probá con un producto con Talle S sin stock en ningún color, Talle M con stock solo en un color, Talle L
con stock en todos — confirmá que el combo de Talle muestra S deshabilitado y que, al elegir M, el combo
de Color deja seleccionable solo el color con stock. Actualizá el CLAUDE.md (sección "Variantes de
producto", junto al punto de Compras ya documentado) con este comportamiento de Ventas.
