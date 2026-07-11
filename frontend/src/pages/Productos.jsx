import { useEffect, useState } from 'react'
import api, { getErrorMessage } from '../api'
import { aplanarArbol, etiquetaIndentada } from '../utils/categorias'

const empty = {
  nombre: '', codigo: '', categoria_id: '', precio_venta: '', costo: '', mix_pct: '', lead_time_dias: '',
  tiene_variantes: false,
}

const estadoColor = {
  'Sin stock': 'text-red-400 font-bold',
  Crítico: 'text-red-400 font-bold',
  'Próximo a agotarse': 'text-amber-400 font-bold',
  Atención: 'text-amber-400',
  'Sin ventas recientes': 'text-gray-500',
  OK: 'text-green-400',
}

export default function Productos() {
  const [productos, setProductos] = useState([])
  const [categorias, setCategorias] = useState([])
  const [stockPorProducto, setStockPorProducto] = useState({})
  const [form, setForm] = useState(empty)
  const [editId, setEditId] = useState(null)
  const [error, setError] = useState('')
  const [editandoMarkup, setEditandoMarkup] = useState(null) // producto_id en edición inline
  const [markupValor, setMarkupValor] = useState('')

  const [atributosDisponibles, setAtributosDisponibles] = useState([])
  const [variantesConfig, setVariantesConfig] = useState({}) // atributo_id -> {activo, orden, valor_ids: Set}
  const [variantesActuales, setVariantesActuales] = useState([])

  const cargar = () => {
    api.get('/productos').then((r) => setProductos(r.data))
    api.get('/categorias').then((r) => setCategorias(r.data))
    api.get('/atributos').then((r) => setAtributosDisponibles(r.data))
    api.get('/stock/productos').then((r) => {
      const mapa = {}
      r.data.forEach((s) => { mapa[s.producto_id] = s })
      setStockPorProducto(mapa)
    })
  }
  useEffect(() => {
    cargar()
  }, [])

  const categoriasArbol = aplanarArbol(categorias)
  const mixTotal = productos.filter((p) => p.activo).reduce((acc, p) => acc + Number(p.mix_pct || 0), 0)

  const guardar = async () => {
    setError('')
    const payload = {
      nombre: form.nombre,
      codigo: form.codigo || null,
      categoria_id: form.categoria_id ? Number(form.categoria_id) : null,
      precio_venta: Number(form.precio_venta),
      costo: Number(form.costo || 0),
      mix_pct: Number(form.mix_pct || 0),
      lead_time_dias: form.lead_time_dias ? Number(form.lead_time_dias) : null,
      tiene_variantes: form.tiene_variantes,
    }
    try {
      if (editId) await api.put(`/productos/${editId}`, payload)
      else await api.post('/productos', payload)
      setForm(empty)
      setEditId(null)
      setVariantesConfig({})
      setVariantesActuales([])
      cargar()
    } catch (e) {
      setError(getErrorMessage(e))
    }
  }

  const cargarConfigVariantes = async (productoId) => {
    const [{ data: atribs }, { data: variantes }] = await Promise.all([
      api.get(`/productos/${productoId}/atributos`),
      api.get(`/productos/${productoId}/variantes`),
    ])
    const config = {}
    atribs.forEach((a) => {
      config[a.atributo_id] = { activo: true, orden: a.orden, valor_ids: new Set() }
    })
    setVariantesConfig(config)
    setVariantesActuales(variantes)
  }

  const editar = (p) => {
    setEditId(p.id)
    setForm({
      nombre: p.nombre,
      codigo: p.codigo || '',
      categoria_id: p.categoria_id || '',
      precio_venta: p.precio_venta,
      costo: p.costo,
      mix_pct: p.mix_pct,
      lead_time_dias: p.lead_time_dias || '',
      tiene_variantes: p.tiene_variantes || false,
    })
    if (p.tiene_variantes) {
      cargarConfigVariantes(p.id).catch((e) => setError(getErrorMessage(e)))
    } else {
      setVariantesConfig({})
      setVariantesActuales([])
    }
  }

  const toggleAtributo = (atributoId, checked) => {
    setVariantesConfig((prev) => {
      const next = { ...prev }
      if (checked) {
        const ordenSiguiente = Object.values(prev).filter((c) => c.activo).length + 1
        next[atributoId] = { activo: true, orden: ordenSiguiente, valor_ids: new Set() }
      } else {
        delete next[atributoId]
      }
      return next
    })
  }

  const setOrdenAtributo = (atributoId, orden) => {
    setVariantesConfig((prev) => ({ ...prev, [atributoId]: { ...prev[atributoId], orden: Number(orden) } }))
  }

  const toggleValor = (atributoId, valorId) => {
    setVariantesConfig((prev) => {
      const actual = prev[atributoId]
      const nuevo = new Set(actual.valor_ids)
      if (nuevo.has(valorId)) nuevo.delete(valorId)
      else nuevo.add(valorId)
      return { ...prev, [atributoId]: { ...actual, valor_ids: nuevo } }
    })
  }

  const guardarAtributosYGenerar = async () => {
    setError('')
    const activos = Object.entries(variantesConfig).filter(([, c]) => c.activo)
    if (activos.length === 0) {
      setError('Elegí al menos un atributo para este producto.')
      return
    }
    if (activos.some(([, c]) => c.valor_ids.size === 0)) {
      setError('Elegí al menos un valor para cada atributo marcado.')
      return
    }
    try {
      await api.post(`/productos/${editId}/atributos`, {
        atributos: activos.map(([atributo_id, c]) => ({ atributo_id: Number(atributo_id), orden: c.orden })),
      })
      await api.post(`/productos/${editId}/variantes/generar`, {
        selecciones: activos.map(([atributo_id, c]) => ({
          atributo_id: Number(atributo_id),
          valor_ids: [...c.valor_ids],
        })),
      })
      await cargarConfigVariantes(editId)
      cargar()
    } catch (e) {
      setError(getErrorMessage(e))
    }
  }

  const borrar = async (id) => {
    if (!confirm('¿Borrar este producto? También se van a borrar sus compras y movimientos asociados.')) return
    try {
      await api.delete(`/productos/${id}`)
      cargar()
    } catch (e) {
      setError(getErrorMessage(e))
    }
  }

  const markupPct = (p) => (Number(p.costo) > 0 ? ((Number(p.precio_venta) - Number(p.costo)) / Number(p.costo)) * 100 : null)

  const empezarEdicionMarkup = (p) => {
    const m = markupPct(p)
    setEditandoMarkup(p.id)
    setMarkupValor(m !== null ? m.toFixed(1) : '')
  }

  const guardarMarkup = async (p) => {
    const pct = Number(markupValor)
    if (Number.isNaN(pct) || Number(p.costo) <= 0) {
      setEditandoMarkup(null)
      return
    }
    const nuevoPrecio = Math.round(Number(p.costo) * (1 + pct / 100) * 100) / 100
    try {
      await api.put(`/productos/${p.id}`, { precio_venta: nuevoPrecio })
      setEditandoMarkup(null)
      cargar()
    } catch (e) {
      setError(getErrorMessage(e))
      setEditandoMarkup(null)
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold flex items-center gap-2">👗 Catálogo de Productos</h1>
      <p className="text-gray-400 text-sm">
        Acá cargás cada prenda <b>una sola vez</b> (ficha maestra). El stock y el costo promedio se actualizan solos
        a partir de lo que registres en <b>Compras</b>.
      </p>

      <div
        className={`rounded-lg p-3 text-sm font-medium ${
          Math.round(mixTotal) === 100 ? 'bg-green-900/50 text-green-300' : 'bg-yellow-900/50 text-yellow-300'
        }`}
      >
        {Math.round(mixTotal) === 100
          ? `Mix balanceado correctamente (Suma: ${mixTotal.toFixed(1)}%)`
          : `⚠️ El mix de productos activos suma ${mixTotal.toFixed(1)}%, debería sumar 100%`}
      </div>

      <div className="bg-[#151b2b] rounded-xl p-5 space-y-3">
        <h2 className="font-bold">{editId ? 'Editar Prenda' : '+ Añadir Prenda'}</h2>
        {error && <p className="text-red-400 text-sm">{error}</p>}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <input
            className="bg-[#0b0f19] border border-gray-700 rounded-lg p-2"
            placeholder="Nombre (ej: Top)"
            value={form.nombre}
            onChange={(e) => setForm({ ...form, nombre: e.target.value })}
          />
          <input
            className="bg-[#0b0f19] border border-gray-700 rounded-lg p-2"
            placeholder="Código / SKU (opcional)"
            value={form.codigo}
            onChange={(e) => setForm({ ...form, codigo: e.target.value })}
          />
          <select
            className="bg-[#0b0f19] border border-gray-700 rounded-lg p-2"
            value={form.categoria_id}
            onChange={(e) => setForm({ ...form, categoria_id: e.target.value })}
          >
            <option value="">Sin categoría</option>
            {categoriasArbol.map((c) => (
              <option key={c.id} value={c.id}>
                {etiquetaIndentada(c)}
              </option>
            ))}
          </select>
          <input
            type="number"
            className="bg-[#0b0f19] border border-gray-700 rounded-lg p-2"
            placeholder="Precio de Venta ($)"
            value={form.precio_venta}
            onChange={(e) => setForm({ ...form, precio_venta: e.target.value })}
          />
          <input
            type="number"
            className="bg-[#0b0f19] border border-gray-700 rounded-lg p-2"
            placeholder="Costo inicial ($, opcional)"
            value={form.costo}
            onChange={(e) => setForm({ ...form, costo: e.target.value })}
          />
          <input
            type="number"
            className="bg-[#0b0f19] border border-gray-700 rounded-lg p-2"
            placeholder="Mix (%)"
            value={form.mix_pct}
            onChange={(e) => setForm({ ...form, mix_pct: e.target.value })}
          />
          <input
            type="number"
            className="bg-[#0b0f19] border border-gray-700 rounded-lg p-2"
            placeholder="Lead time proveedor (días, opcional)"
            value={form.lead_time_dias}
            onChange={(e) => setForm({ ...form, lead_time_dias: e.target.value })}
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.tiene_variantes}
            onChange={(e) => setForm({ ...form, tiene_variantes: e.target.checked })}
          />
          ¿Tiene variantes? (talle, color, etc.)
        </label>
        <p className="text-xs text-gray-500">
          El costo se puede dejar en 0 al principio — en cuanto cargues la primera Compra de este producto, se va a
          recalcular solo como promedio ponderado. El lead time se usa para la alerta de "próximo a agotarse" en
          Stock (si no lo cargás, se asume 7 días). Si activás variantes, guardá el producto y despues configurá sus
          atributos acá abajo.
        </p>
        <div className="flex gap-2">
          <button onClick={guardar} className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg font-medium">
            {editId ? 'Guardar cambios' : '+ Añadir Prenda'}
          </button>
          {editId && (
            <button
              onClick={() => {
                setEditId(null)
                setForm(empty)
                setVariantesConfig({})
                setVariantesActuales([])
              }}
              className="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg"
            >
              Cancelar
            </button>
          )}
        </div>
      </div>

      {editId && form.tiene_variantes && (
        <div className="bg-[#151b2b] rounded-xl p-5 space-y-4">
          <h2 className="font-bold">Variantes de "{form.nombre}"</h2>
          <p className="text-xs text-gray-500">
            Elegí qué atributos aplican a este producto y en qué orden (el primero agrupa el stock en subtotales,
            ej. Talle). Después elegí los valores de cada uno para generar la grilla de combinaciones — cada
            combinación nueva arranca con 0 de stock hasta que le cargues una Compra.
          </p>
          <div className="space-y-3">
            {atributosDisponibles.map((a) => {
              const config = variantesConfig[a.id]
              return (
                <div key={a.id} className="border border-gray-800 rounded-lg p-3">
                  <label className="flex items-center gap-2 font-medium">
                    <input
                      type="checkbox"
                      checked={!!config?.activo}
                      onChange={(e) => toggleAtributo(a.id, e.target.checked)}
                    />
                    {a.nombre}
                    {config?.activo && (
                      <input
                        type="number"
                        min="1"
                        className="w-16 bg-[#0b0f19] border border-gray-700 rounded p-1 text-sm ml-2"
                        value={config.orden}
                        onChange={(e) => setOrdenAtributo(a.id, e.target.value)}
                        title="Orden (1 = agrupa el stock en subtotales)"
                      />
                    )}
                  </label>
                  {config?.activo && (
                    <div className="flex flex-wrap gap-2 mt-2 ml-6">
                      {a.valores.map((v) => (
                        <label
                          key={v.id}
                          className="flex items-center gap-1 text-sm bg-[#0b0f19] border border-gray-700 rounded-full px-2 py-1"
                        >
                          <input
                            type="checkbox"
                            checked={config.valor_ids.has(v.id)}
                            onChange={() => toggleValor(a.id, v.id)}
                          />
                          {v.valor}
                        </label>
                      ))}
                      {a.valores.length === 0 && (
                        <span className="text-gray-500 text-xs">Sin valores cargados (andá a Atributos).</span>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
            {atributosDisponibles.length === 0 && (
              <p className="text-gray-500 text-sm">
                Todavía no cargaste atributos. Andá a la página "Atributos" para crear Talle, Color, etc.
              </p>
            )}
          </div>
          <button
            onClick={guardarAtributosYGenerar}
            className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg font-medium text-sm"
          >
            Guardar atributos y generar variantes
          </button>

          {variantesActuales.length > 0 && (
            <div className="mt-4">
              <h3 className="font-medium mb-2 text-sm text-gray-300">
                Variantes generadas ({variantesActuales.length})
              </h3>
              <p className="text-xs text-gray-500 mb-2">
                El costo es único para todo el producto (no varía por talle/color) — se muestra en la tabla de abajo.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-400 border-b border-gray-700">
                      <th className="py-1">Combinación</th>
                    </tr>
                  </thead>
                  <tbody>
                    {variantesActuales.map((v) => (
                      <tr key={v.id} className="border-b border-gray-800">
                        <td className="py-1">{v.valores.map((x) => x.valor).join(' / ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="bg-[#151b2b] rounded-xl p-5 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-400 border-b border-gray-700">
              <th className="py-2">Producto</th>
              <th>Categoría</th>
              <th>Venta</th>
              <th>Costo Prom.</th>
              <th>Markup s/Costo</th>
              <th>Mix (%)</th>
              <th>Stock</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {productos.map((p) => {
              const s = stockPorProducto[p.id]
              const markup = markupPct(p)
              return (
                <tr key={p.id} className="border-b border-gray-800">
                  <td className="py-2">
                    {p.nombre}
                    {p.codigo && <span className="text-gray-500"> ({p.codigo})</span>}
                    {p.tiene_variantes && (
                      <span className="ml-2 text-xs bg-blue-900/50 text-blue-300 px-2 py-0.5 rounded-full">
                        variantes
                      </span>
                    )}
                  </td>
                  <td>{p.categoria?.nombre || '—'}</td>
                  <td>${p.precio_venta}</td>
                  <td>${p.costo}</td>
                  <td>
                    {editandoMarkup === p.id ? (
                      <span className="inline-flex items-center gap-1">
                        <input
                          type="number"
                          autoFocus
                          className="w-20 bg-[#0b0f19] border border-gray-700 rounded p-1"
                          value={markupValor}
                          onChange={(e) => setMarkupValor(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && guardarMarkup(p)}
                        />
                        <span>%</span>
                        <button onClick={() => guardarMarkup(p)} className="text-green-400 hover:underline text-xs">
                          OK
                        </button>
                        <button onClick={() => setEditandoMarkup(null)} className="text-gray-500 hover:underline text-xs">
                          x
                        </button>
                      </span>
                    ) : (
                      <button
                        onClick={() => empezarEdicionMarkup(p)}
                        className="hover:underline"
                        title="Click para editar el % y recalcular el precio de venta"
                      >
                        {markup !== null ? `${markup.toFixed(1)}%` : '—'} ✎
                      </button>
                    )}
                  </td>
                  <td>{p.mix_pct}</td>
                  <td>{s ? `${s.stock_actual} u.` : '—'}</td>
                  <td className={estadoColor[s?.estado_stock] || ''}>{s?.estado_stock || '—'}</td>
                  <td className="text-right space-x-2">
                    <button onClick={() => editar(p)} className="text-blue-400 hover:underline">
                      Editar
                    </button>
                    <button onClick={() => borrar(p.id)} className="text-red-400 hover:underline">
                      Borrar
                    </button>
                  </td>
                </tr>
              )
            })}
            {productos.length === 0 && (
              <tr>
                <td colSpan={9} className="text-gray-500 py-4 text-center">
                  Todavía no cargaste productos.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
