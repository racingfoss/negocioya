import { useEffect, useState } from 'react'
import api, { getErrorMessage } from '../api'

const hoy = () => new Date().toISOString().slice(0, 10)
const empty = { categoria_id: '', producto_id: '', fecha: hoy(), cantidad: '', costo_unitario: '', proveedor: '' }

export default function Compras() {
  const [compras, setCompras] = useState([])
  const [productos, setProductos] = useState([])
  const [categorias, setCategorias] = useState([])
  const [form, setForm] = useState(empty)
  const [editId, setEditId] = useState(null)
  const [error, setError] = useState('')

  // Confirmación de cambio de costo/precio antes de guardar la compra
  const [simulacion, setSimulacion] = useState(null) // resultado de /compras/simular
  const [pctAjuste, setPctAjuste] = useState(0)
  const [precioSugerido, setPrecioSugerido] = useState(0)
  const [actualizarPrecio, setActualizarPrecio] = useState(true)

  const cargar = () => {
    api.get('/compras').then((r) => setCompras(r.data))
    api.get('/productos').then((r) => setProductos(r.data))
    api.get('/categorias').then((r) => setCategorias(r.data))
  }
  useEffect(() => {
    cargar()
  }, [])

  const productosFiltrados = form.categoria_id
    ? productos.filter((p) => String(p.categoria_id) === String(form.categoria_id))
    : productos

  const resetForm = () => {
    setForm({ ...empty, fecha: hoy() })
    setEditId(null)
    setSimulacion(null)
  }

  // Paso 1: el usuario aprieta "Registrar Compra" -> simulamos el impacto en el costo promedio
  const iniciarGuardado = async () => {
    setError('')
    if (!form.producto_id) {
      setError('Elegí un producto.')
      return
    }
    if (editId) {
      // en edición no simulamos (es un ajuste puntual de un registro ya cargado), guardamos directo
      guardarCompra(null)
      return
    }
    try {
      const { data } = await api.post('/compras/simular', {
        producto_id: Number(form.producto_id),
        cantidad: Number(form.cantidad),
        costo_unitario: Number(form.costo_unitario),
      })
      if (data.supera_umbral) {
        setSimulacion(data)
        setPctAjuste(data.diferencia_pct)
        setPrecioSugerido(data.precio_venta_sugerido)
        setActualizarPrecio(true)
      } else {
        guardarCompra(null) // cambio menor al umbral (±2%), no hace falta preguntar
      }
    } catch (e) {
      setError(getErrorMessage(e))
    }
  }

  // Paso 2 (si corresponde): confirmar la compra, con o sin actualización de precio
  const guardarCompra = async (nuevoPrecioVenta) => {
    const payload = {
      producto_id: Number(form.producto_id),
      fecha: form.fecha || null,
      cantidad: Number(form.cantidad),
      costo_unitario: Number(form.costo_unitario),
      proveedor: form.proveedor || null,
      actualizar_precio_venta: nuevoPrecioVenta,
    }
    try {
      if (editId) await api.put(`/compras/${editId}`, payload)
      else await api.post('/compras', payload)
      resetForm()
      cargar()
    } catch (e) {
      setError(getErrorMessage(e))
    }
  }

  const confirmarConPrecio = () => guardarCompra(actualizarPrecio ? Number(precioSugerido) : null)

  // sincroniza % <-> precio en el panel de confirmación
  const cambiarPct = (valor) => {
    setPctAjuste(valor)
    if (simulacion) {
      setPrecioSugerido(Math.round(simulacion.precio_venta_actual * (1 + Number(valor) / 100) * 100) / 100)
    }
  }
  const cambiarPrecio = (valor) => {
    setPrecioSugerido(valor)
    if (simulacion && simulacion.precio_venta_actual) {
      setPctAjuste(Math.round(((Number(valor) - simulacion.precio_venta_actual) / simulacion.precio_venta_actual) * 1000) / 10)
    }
  }

  const editar = (c) => {
    setEditId(c.id)
    setSimulacion(null)
    setForm({
      categoria_id: c.producto?.categoria_id || '',
      producto_id: c.producto_id,
      fecha: c.fecha,
      cantidad: c.cantidad,
      costo_unitario: c.costo_unitario,
      proveedor: c.proveedor || '',
    })
  }

  const borrar = async (id) => {
    if (!confirm('¿Borrar esta compra? El stock y el costo promedio del producto se van a recalcular.')) return
    try {
      await api.delete(`/compras/${id}`)
      cargar()
    } catch (e) {
      setError(getErrorMessage(e))
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold flex items-center gap-2">📦 Compras / Reposición de Stock</h1>
      <p className="text-gray-400 text-sm">
        Cada vez que le comprás mercadería a un proveedor para un producto ya cargado en el Catálogo, registralo acá.
        Si la compra cambia el costo promedio en más de un 2%, te va a preguntar si querés ajustar el precio de
        venta en la misma proporción.
      </p>

      <div className="bg-[#151b2b] rounded-xl p-5 space-y-3">
        <h2 className="font-bold">{editId ? 'Editar Compra' : 'Registrar Compra'}</h2>
        {error && <p className="text-red-400 text-sm">{error}</p>}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <select
            className="bg-[#0b0f19] border border-gray-700 rounded-lg p-2"
            value={form.categoria_id}
            onChange={(e) => setForm({ ...form, categoria_id: e.target.value, producto_id: '' })}
          >
            <option value="">Todas las categorías</option>
            {categorias.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
          <select
            className="bg-[#0b0f19] border border-gray-700 rounded-lg p-2"
            value={form.producto_id}
            onChange={(e) => setForm({ ...form, producto_id: e.target.value })}
          >
            <option value="">Seleccionar producto...</option>
            {productosFiltrados.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </select>
          <input
            type="date"
            className="bg-[#0b0f19] border border-gray-700 rounded-lg p-2"
            value={form.fecha}
            onChange={(e) => setForm({ ...form, fecha: e.target.value })}
          />
          <input
            type="number"
            className="bg-[#0b0f19] border border-gray-700 rounded-lg p-2"
            placeholder="Cantidad (unidades)"
            value={form.cantidad}
            onChange={(e) => setForm({ ...form, cantidad: e.target.value })}
          />
          <input
            type="number"
            className="bg-[#0b0f19] border border-gray-700 rounded-lg p-2"
            placeholder="Costo Unitario ($)"
            value={form.costo_unitario}
            onChange={(e) => setForm({ ...form, costo_unitario: e.target.value })}
          />
          <input
            className="bg-[#0b0f19] border border-gray-700 rounded-lg p-2"
            placeholder="Proveedor (opcional)"
            value={form.proveedor}
            onChange={(e) => setForm({ ...form, proveedor: e.target.value })}
          />
        </div>

        {simulacion && (
          <div className="bg-amber-950/40 border border-amber-700 rounded-lg p-4 space-y-3">
            <p className="text-amber-300 font-medium">
              ⚠️ Esta compra cambia el costo promedio de <b>{simulacion.producto}</b> de $
              {simulacion.costo_promedio_actual.toLocaleString('es-AR')} a $
              {simulacion.costo_promedio_nuevo.toLocaleString('es-AR')} ({simulacion.diferencia_pct > 0 ? '+' : ''}
              {simulacion.diferencia_pct}%). ¿Querés ajustar el precio de venta en la misma proporción?
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 items-end">
              <label className="text-xs text-gray-400">
                % de ajuste
                <input
                  type="number"
                  className="w-full bg-[#0b0f19] border border-gray-700 rounded-lg p-2 mt-1"
                  value={pctAjuste}
                  onChange={(e) => cambiarPct(e.target.value)}
                />
              </label>
              <label className="text-xs text-gray-400">
                Precio de venta actual
                <input
                  disabled
                  className="w-full bg-[#0b0f19] border border-gray-800 rounded-lg p-2 mt-1 text-gray-500"
                  value={`$${simulacion.precio_venta_actual.toLocaleString('es-AR')}`}
                />
              </label>
              <label className="text-xs text-gray-400 col-span-2 md:col-span-1">
                Precio de venta nuevo
                <input
                  type="number"
                  className="w-full bg-[#0b0f19] border border-gray-700 rounded-lg p-2 mt-1"
                  value={precioSugerido}
                  onChange={(e) => cambiarPrecio(e.target.value)}
                />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={actualizarPrecio} onChange={(e) => setActualizarPrecio(e.target.checked)} />
                Actualizar precio
              </label>
            </div>
            <div className="flex gap-2">
              <button onClick={confirmarConPrecio} className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg font-medium">
                Confirmar compra
              </button>
              <button
                onClick={() => setSimulacion(null)}
                className="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg"
              >
                Volver
              </button>
            </div>
          </div>
        )}

        {!simulacion && (
          <div className="flex gap-2">
            <button onClick={iniciarGuardado} className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg font-medium">
              {editId ? 'Guardar cambios' : '+ Registrar Compra'}
            </button>
            {editId && (
              <button onClick={resetForm} className="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg">
                Cancelar
              </button>
            )}
          </div>
        )}
      </div>

      <div className="bg-[#151b2b] rounded-xl p-5 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-400 border-b border-gray-700">
              <th className="py-2">Fecha</th>
              <th>Producto</th>
              <th>Cantidad</th>
              <th>Costo Unit.</th>
              <th>Total</th>
              <th>Proveedor</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {compras.map((c) => (
              <tr key={c.id} className="border-b border-gray-800">
                <td className="py-2">{c.fecha}</td>
                <td>{c.producto?.nombre || '—'}</td>
                <td>{c.cantidad}</td>
                <td>${Number(c.costo_unitario).toLocaleString('es-AR')}</td>
                <td>${(c.cantidad * Number(c.costo_unitario)).toLocaleString('es-AR')}</td>
                <td className="text-gray-400">{c.proveedor}</td>
                <td className="text-right space-x-2">
                  <button onClick={() => editar(c)} className="text-blue-400 hover:underline">
                    Editar
                  </button>
                  <button onClick={() => borrar(c.id)} className="text-red-400 hover:underline">
                    Borrar
                  </button>
                </td>
              </tr>
            ))}
            {compras.length === 0 && (
              <tr>
                <td colSpan={7} className="text-gray-500 py-4 text-center">
                  Todavía no registraste compras.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
