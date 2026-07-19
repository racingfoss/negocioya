Mejora chica al storefront: cuando se abre `/carrito`, revalidar el stock real de cada línea contra
FashBalance — no confiar solo en el `stock_actual` que quedó guardado en `localStorage` al momento de
agregar el producto (puede estar viejo si el carrito quedó abierto un rato).

## Qué hacer

En `app/carrito/page.tsx` (o el componente que corresponda), al montar: por cada `producto_id` distinto
presente en el carrito, pedir el stock actual (`GET /ecommerce/catalogo/{id}`, ya existe, reusalo tal
cual — no crees un endpoint nuevo para esto). Comparar el `stock_actual` fresco (del producto entero o de
la variante puntual, según corresponda) contra la `cantidad` que tiene esa línea en el carrito:

- Si el stock fresco alcanza: no mostrar nada, todo normal.
- Si el stock fresco es menor a la cantidad en el carrito (pero mayor a 0): mostrar un aviso inline en esa
  línea ("Solo quedan N disponibles") sin bloquear nada todavía — el comprador puede seguir, el checkout
  ya rechaza atómicamente si intenta confirmar de más (eso ya existe, no lo toques).
- Si el stock fresco es 0: mismo aviso pero más explícito ("Ya no hay stock de este producto/variante"),
  y deshabilitar el botón de continuar a `/checkout` hasta que se ajuste o saque esa línea — no tiene
  sentido dejar avanzar a un checkout que se sabe de antemano que va a fallar.

No hace falta bloquear con un spinner de carga agresivo — la revalidación puede aparecer un instante
después de que la página ya se vio, es aceptable.

## Qué NO hacer

No implementes ningún tipo de reserva de stock acá — eso es un pedido aparte, para el lado de FashBalance
(Caja), no para el storefront. Esto es solo refrescar un dato para avisar mejor, nada más.

## Antes de terminar

Probá con un producto de stock bajo: armá el carrito con más cantidad de la disponible (simulando que
alguien más compró mientras tanto — podés bajar el stock real desde FashBalance entre que armás el
carrito y volvés a `/carrito`) y confirmá que aparece el aviso correcto. Avisame qué revisar a mano en el
navegador. Actualizá el CLAUDE.md con esta mejora chica dentro de la sección del storefront.
