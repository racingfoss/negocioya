// Aplana el árbol de categorías (parent_id) en una lista ordenada con profundidad,
// para mostrar indentación consistente tanto en la vista de árbol de Categorías
// como en los <select> de Productos/Compras/Movimientos.
export function aplanarArbol(categorias) {
  const porId = new Map(categorias.map((c) => [c.id, c]))
  const hijosPorPadre = new Map()
  for (const c of categorias) {
    const clave = c.parent_id && porId.has(c.parent_id) ? c.parent_id : null
    if (!hijosPorPadre.has(clave)) hijosPorPadre.set(clave, [])
    hijosPorPadre.get(clave).push(c)
  }
  for (const lista of hijosPorPadre.values()) {
    lista.sort((a, b) => a.nombre.localeCompare(b.nombre))
  }

  const resultado = []
  const recorrer = (padreId, profundidad) => {
    for (const c of hijosPorPadre.get(padreId) || []) {
      resultado.push({ ...c, profundidad })
      recorrer(c.id, profundidad + 1)
    }
  }
  recorrer(null, 0)
  return resultado
}

export function etiquetaIndentada(categoria) {
  return `${'—'.repeat(categoria.profundidad)}${categoria.profundidad > 0 ? ' ' : ''}${categoria.nombre}`
}
