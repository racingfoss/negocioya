Antes de aplicar el fix: confirmame algo aparte, no hace falta que cambies código para esto
todavía. El endpoint de /pedidos/{id}/facturar y el de nota-credito, ¿están definidos como
"def" o "async def"? Y la llamada real a ARCA (zeep, que es una librería sincrónica) ¿corre de
alguna forma que bloquee el resto del servidor mientras espera, o FastAPI ya la aísla en un
threadpool aparte automáticamente? Quiero saber si mientras se factura un pedido, el resto del
sistema (el storefront, por ejemplo) queda sin responder por esos mismos segundos o no.
