import { useEffect, useState } from 'react'
import api, { getErrorMessage } from '../api'
import { aplanarArbol, etiquetaIndentada } from '../utils/categorias'

const nowLocal = () => {
  const d = new Date()
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 16) // formato datetime-local: YYYY-MM-DDTHH:mm
}

const empty = {
  tipo: 'Venta',
  categoria_id: '',
  producto_id: '',
  cantidad: 1,
  monto: '',
  concepto: '',
  fecha: nowLocal(),
}

export default function Movimientos() {
  const [movimientos, setMovimientos] = useState([])
  const [productos, setProductos] = useState([])
  const [categorias, setCategorias] = useState([])
  const [form, setForm] = useState(empty)
  const [editId, setEditId] = useState(null)
  const [montoEditadoManualmente, setMontoEditadoManualmente] = useState(false)
  const [error, setError] = useState('')

  // Selectores en cascada para resolver la variante (si el producto elegido tiene variantes)
  const [atributosProducto, setAtributosProducto] = useState([])
  const [variantesProducto, setVariantesProducto] = useState([])
  const [valoresElegidos, setValoresElegidos] = useState({}) // atributo_id -> valor_id
  const [edicionVarianteId, setEdicionVarianteId] = useState(null)
  const [varianteIdOriginal, setVarianteIdOriginal] = useState(null)

  const cargar = () => {
    api.get('/movimientos').then((r) => setMovimientos(r.data))
    api.get('/productos', { params: { solo_activos: true } }).then((r) => setProductos(r.data))
    api.get('/categorias').then((r) => setCategorias(r.data))
  }
  useEffect(() => {
    cargar()
  }, [])

  const categoriasArbol = aplanarArbol(categorias)
  const productoSeleccionado = productos.find((p) => String(p.id) === String(form.producto_id))
  const productosFiltrados = form.categoria_id
    ? productos.filter((p) => String(p.categoria_id) === String(form.categoria_id))
    : productos

  useEffect(() => {
    setValoresElegidos({})
    if (form.tipo === 'Venta' && productoSeleccionado?.tiene_variantes) {
      Promise.all([
        api.get(`/productos/${productoSeleccionado.id}/atributos`),
        api.get(`/productos/${productoSeleccionado.id}/variantes`),
      ]).then(([{ data: atribs }, { data: variantes }]) => {
        setAtributosProducto(atribs)
        setVariantesProducto(variantes)
      })
    } else {
      setAtributosProducto([])
      setVariantesProducto([])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.producto_id, form.tipo])

  const varianteResuelta =
    atributosProducto.length > 0 && atributosProducto.every((a) => valoresElegidos[a.atributo_id])
      ? variantesProducto.find((v) =>
          atributosProducto.every((a) =>
            v.valores.some(
              (x) => x.atributo_id === a.atributo_id && x.valor_atributo_id === Number(valoresElegidos[a.atributo_id])
            )
          )
        )
      : null

  // al editar un movimiento ya cargado, prellenar los selectores con la variante que tenía
  useEffect(() => {
    if (edicionVarianteId && variantesProducto.length > 0) {
      const v = variantesProducto.find((x) => x.id === edicionVarianteId)
      if (v) {
        const elegidos = {}
        v.valores.forEach((x) => { elegidos[x.atributo_id] = x.valor_atributo_id })
        setValoresElegidos(elegidos)
      }
      setEdicionVarianteId(null)
    }
  }, [variantesProducto, edicionVarianteId])

  // Auto-calcula el monto = cantidad x precio de venta del producto, mientras el usuario no lo haya tocado a mano.
  useEffect(() => {
    if (form.tipo === 'Venta' && productoSeleccionado && !montoEditadoManualmente) {
      const total = Number(form.cantidad || 0) * Number(productoSeleccionado.precio_venta)
      setForm((f) => ({ ...f, monto: total ? String(total) : '' }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.producto_id, form.cantidad, form.tipo])

  const cambiarTipo = (tipo) => {
    setMontoEditadoManualmente(false)
    setValoresElegidos({})
    setForm({ ...empty, tipo, fecha: form.fecha })
  }

  const guardar = async () => {
    setError('')
    if (form.tipo === 'Venta' && atributosProducto.length > 0 && !varianteResuelta && !editId) {
      setError('Elegí un valor para cada atributo, así se puede resolver la variante de la venta.')
      return
    }
    const payload = {
      tipo: form.tipo,
      concepto: form.concepto || null,
      cantidad: form.tipo === 'Venta' ? Number(form.cantidad || 1) : null,
      monto: Number(form.monto),
      producto_id: form.tipo === 'Venta' ? Number(form.producto_id) : null,
      variante_id: form.tipo === 'Venta' ? varianteResuelta?.id || (editId ? varianteIdOriginal : null) : null,
      fecha: form.fecha ? new Date(form.fecha).toISOString() : null,
    }
    try {
      if (editId) await api.put(`/movimientos/${editId}`, payload)
      else await api.post('/movimientos', payload)
      setForm({ ...empty, fecha: nowLocal() })
      setMontoEditadoManualmente(false)
      setEditId(null)
      setVarianteIdOriginal(null)
      cargar()
    } catch (e) {
      setError(getErrorMessage(e))
    }
  }

  const editar = (m) => {
    setEditId(m.id)
    setMontoEditadoManualmente(true) // no pisar el monto ya guardado al editar
    setEdicionVarianteId(m.variante_id || null)
    setVarianteIdOriginal(m.variante_id || null)
    const fechaLocal = new Date(m.fecha)
    fechaLocal.setMinutes(fechaLocal.getMinutes() - fechaLocal.getTimezoneOffset())
    setForm({
      tipo: m.tipo,
      categoria_id: m.producto?.categoria_id || '',
      producto_id: m.producto_id || '',
      cantidad: m.cantidad || 1,
      monto: m.monto,
      concepto: m.concepto || '',
      fecha: fechaLocal.toISOString().slice(0, 16),
    })
  }

  const borrar = async (id) => {
    if (!confirm('¿Borrar este movimiento?')) return
    try {
      await api.delete(`/movimientos/${id}`)
      cargar()
    } catch (e) {
      setError(getErrorMessage(e))
    }
  }

  const tipoColor = { Venta: 'text-green-400', Ingreso: 'text-blue-400', Egreso: 'text-red-400' }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold flex items-center gap-2">💰 Gestión de Caja Reales</h1>

      <div className="bg-[#151b2b] rounded-xl p-5 space-y-3">
        <h2 className="font-bold">{editId ? 'Editar Movimiento' : 'Registrar Movimiento'}</h2>
        {error && <p className="text-red-400 text-sm">{error}</p>}

        <div className="flex gap-2">
          {['Venta', 'Ingreso', 'Egreso'].map((t) => (
            <button
              key={t}
              onClick={() => cambiarTipo(t)}
              className={`px-4 py-2 rounded-lg text-sm font-medium ${
                form.tipo === t ? 'bg-blue-600 text-white' : 'bg-[#0b0f19] border border-gray-700 text-gray-300'
              }`}
            >
              {t === 'Venta' ? '🛍️ Venta' : t === 'Ingreso' ? '➕ Otro Ingreso' : '➖ Egreso'}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {form.tipo === 'Venta' && (
            <>
              <select
                className="bg-[#0b0f19] border border-gray-700 rounded-lg p-2"
                value={form.categoria_id}
                onChange={(e) => setForm({ ...form, categoria_id: e.target.value, producto_id: '' })}
              >
                <option value="">Todas las categorías</option>
                {categoriasArbol.map((c) => (
                  <option key={c.id} value={c.id}>
                    {etiquetaIndentada(c)}
                  </option>
                ))}
              </select>
              <select
                className="bg-[#0b0f19] border border-gray-700 rounded-lg p-2"
                value={form.producto_id}
                onChange={(e) => {
                  setMontoEditadoManualmente(false)
                  setForm({ ...form, producto_id: e.target.value })
                }}
              >
                <option value="">Seleccionar producto...</option>
                {productosFiltrados.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre} (${p.precio_venta})
                  </option>
                ))}
              </select>
              {atributosProducto.map((a) => (
                <select
                  key={a.atributo_id}
                  className="bg-[#0b0f19] border border-gray-700 rounded-lg p-2"
                  value={valoresElegidos[a.atributo_id] || ''}
                  onChange={(e) => setValoresElegidos({ ...valoresElegidos, [a.atributo_id]: e.target.value })}
                >
                  <option value="">{a.atributo}...</option>
                  {a.valores.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.valor}
                    </option>
                  ))}
                </select>
              ))}
              <input
                type="number"
                min="1"
                className="bg-[#0b0f19] border border-gray-700 rounded-lg p-2"
                placeholder="Cantidad vendida"
                value={form.cantidad}
                onChange={(e) => {
                  setMontoEditadoManualmente(false)
                  setForm({ ...form, cantidad: e.target.value })
                }}
              />
            </>
          )}

          <input
            type="number"
            className="bg-[#0b0f19] border border-gray-700 rounded-lg p-2"
            placeholder="Monto ($)"
            value={form.monto}
            onChange={(e) => {
              setMontoEditadoManualmente(true)
              setForm({ ...form, monto: e.target.value })
            }}
          />
          <input
            type="datetime-local"
            className="bg-[#0b0f19] border border-gray-700 rounded-lg p-2"
            value={form.fecha}
            onChange={(e) => setForm({ ...form, fecha: e.target.value })}
          />
          <input
            className="bg-[#0b0f19] border border-gray-700 rounded-lg p-2 md:col-span-2"
            placeholder="Detalle / concepto (opcional)"
            value={form.concepto}
            onChange={(e) => setForm({ ...form, concepto: e.target.value })}
          />
        </div>

        {form.tipo === 'Venta' && productoSeleccionado && (
          <p className="text-xs text-gray-500">
            Precio de venta del producto: ${productoSeleccionado.precio_venta} · el monto se calcula solo
            (cantidad × precio), pero lo podés pisar a mano si vendiste con descuento.
          </p>
        )}
        {form.tipo === 'Venta' && atributosProducto.length > 0 && !varianteResuelta && !editId && (
          <p className="text-xs text-amber-400">
            Elegí un valor para cada atributo para resolver la variante puntual de esta venta.
          </p>
        )}

        <div className="flex gap-2">
          <button onClick={guardar} className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg font-medium">
            {editId ? 'Guardar cambios' : '+ Registrar Movimiento'}
          </button>
          {editId && (
            <button
              onClick={() => {
                setEditId(null)
                setMontoEditadoManualmente(false)
                setForm({ ...empty, fecha: nowLocal() })
              }}
              className="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg"
            >
              Cancelar
            </button>
          )}
        </div>
      </div>

      <div className="bg-[#151b2b] rounded-xl p-5 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-400 border-b border-gray-700">
              <th className="py-2">Fecha</th>
              <th>Tipo</th>
              <th>Producto</th>
              <th>Cantidad</th>
              <th>Monto</th>
              <th>Concepto</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {movimientos.map((m) => (
              <tr key={m.id} className="border-b border-gray-800">
                <td className="py-2">{new Date(m.fecha).toLocaleString('es-AR')}</td>
                <td className={tipoColor[m.tipo] || ''}>{m.tipo}</td>
                <td>{m.producto?.nombre || '—'}</td>
                <td>{m.cantidad || '—'}</td>
                <td>${Number(m.monto).toLocaleString('es-AR')}</td>
                <td className="text-gray-400">{m.concepto}</td>
                <td className="text-right space-x-2">
                  <button onClick={() => editar(m)} className="text-blue-400 hover:underline">
                    Editar
                  </button>
                  <button onClick={() => borrar(m.id)} className="text-red-400 hover:underline">
                    Borrar
                  </button>
                </td>
              </tr>
            ))}
            {movimientos.length === 0 && (
              <tr>
                <td colSpan={7} className="text-gray-500 py-4 text-center">
                  Todavía no hay movimientos registrados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
