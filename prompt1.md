Reorganización del CLAUDE.md — separar lo que hace falta leer SIEMPRE de la narrativa histórica de cómo
se llegó a cada decisión. No se pierde información, se mueve — nada de lo que hay hoy debe desaparecer.

## El criterio para separar

Para cada bloque del CLAUDE.md actual, preguntate: **"¿esto es una regla que hay que respetar de acá en
adelante, o es la historia de cómo se llegó a ella?"**

- **Regla que se queda en CLAUDE.md** (resumida, sin la narrativa): ejemplos reales del archivo actual —
  "`validar_movimiento` y `facturacion.py` son los únicos lugares que lanzan `HTTPException` directo",
  "el carrito del storefront usa `localStorage` a propósito, el panel interno no", "`stock_por_producto`/
  `stock_por_variante` sin el flag `considerar_reservas` siguen mostrando stock físico puro a propósito",
  "`Movimiento.tipo` es `String(10)`, cualquier tipo nuevo tiene que entrar en ese largo o migrar la
  columna". Son afirmaciones que alguien necesita conocer ANTES de tocar código relacionado, sin importar
  en qué fase se decidieron.
- **Narrativa que se muda a `docs/historial-tecnico.md`**: el paso a paso de cada fase, los bugs
  encontrados y cómo se corrigieron, el razonamiento completo de por qué se descartó una alternativa, las
  pruebas que se corrieron contra la API real. Sigue existiendo, solo que no se lee en cada sesión nueva
  — se consulta puntualmente si hace falta entender el contexto completo de algo.

## Cómo dejarlo

- `CLAUDE.md`: stack, cómo correr el proyecto, el modelo de datos resumido (tabla de `configuracion`
  puede quedar tal cual, es información operativa, no narrativa), y una lista de reglas/invariantes por
  área (backend, frontend, ARCA, reservas, etc.) — sin el "por qué" extendido de cada una, solo el "qué".
  Al final de cada sección, si corresponde, una línea tipo "Detalle completo de esta fase en
  `docs/historial-tecnico.md#nombre-de-la-sección`" — **como texto plano nomás, nunca con la sintaxis
  `@docs/historial-tecnico.md`**: esa sintaxis fuerza a Claude Code a cargar el archivo entero en cada
  sesión, anulando todo el ahorro que buscamos con esta reorganización. La referencia de texto simple no
  se carga sola — queda ahí para que vos (Javier) o yo se lo indiquemos explícito en un prompt puntual
  cuando haga falta ese contexto, o para que Claude Code la siga por su cuenta si en medio de una tarea
  decide que la necesita (no es automático, pero puede pasar).
- `docs/historial-tecnico.md` (nuevo): todo el contenido narrativo que se saca, organizado por fase con
  los mismos títulos que tenía en CLAUDE.md, para que sea fácil ubicar algo si hace falta.
- No hay un número mágico de líneas que cumplir a rajatabla, pero la idea es una reducción real y
  notoria del archivo que se lee siempre — no un recorte cosmético de 10%.

## Qué NO hacer

No borres nada — todo lo que no quede en CLAUDE.md tiene que estar en `docs/historial-tecnico.md`, texto
por texto o resumido pero sin perder el contenido real. No toques código de la aplicación, esto es
puramente reorganizar documentación.

## Antes de terminar

Mostrame un resumen de cuántas líneas quedó cada archivo antes/después, y confirmame explícitamente que
ninguna regla activa (las que si se pierden pueden hacer que rompas algo sin darte cuenta en una fase
futura) quedó fuera de CLAUDE.md por error — repasalas una por una contra el índice que armes.
