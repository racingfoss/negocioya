Dos cosas para confirmar/ajustar antes de dar el plan por cerrado:

1. Confirmame explícitamente: ¿"FECompUltimoAutorizado" se sigue llamando en algún lado ANTES de
armar el request de "FECAESolicitar", para saber cuál es el próximo número de comprobante habilitado
que hay que pedir en "CbteDesde"? El punto 2 del plan evita el llamado SEPARADO después de conseguir
el CAE (para no consultarlo dos veces) — pero confirmame que la consulta previa (antes de pedir el
CAE) sigue estando, en "wsfe.fe_cae_solicitar()" o donde corresponda. Si en el cambio se perdió esa
consulta previa sin querer, agregala de vuelta.

2. En el llamado a "wsfe.fe_cae_solicitar(...)" del punto 7 no estás pasando "doc_tipo"/"doc_nro"
explícitos — quedan solo como default de columna en el modelo "Factura" (99/0). Son dos lugares
distintos: pasalos explícitos como parámetro al armar el request real que se manda a ARCA, y usá esos
mismos valores (no el default de la columna) al guardar la fila de "Factura". Así lo que queda
grabado en la base siempre coincide con lo que realmente se le mandó a ARCA, no con un default que
podría desalinearse si algún día cambia uno de los dos lugares sin el otro.

Contestame los dos puntos antes de que aprobemos el plan.
