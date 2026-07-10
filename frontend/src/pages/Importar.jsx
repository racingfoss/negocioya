import { useRef, useState } from 'react'
import api, { getErrorMessage } from '../api'

export default function Importar() {
  const [archivo, setArchivo] = useState(null)
  const [cargando, setCargando] = useState(false)
  const [resultado, setResultado] = useState(null)
  const [error, setError] = useState('')
  const [cambiosResueltos, setCambiosResueltos] = useState({}) // producto_id -> "aceptado" | "rechazado"
  const inputRef = useRef(null)

  const descargarPlantilla = () => {
    window.open(`${api.defaults.baseURL}/importacion/plantilla`, '_blank')
  }

  const subir = async () => {
    if (!archivo) {
      setError('Elegí un archivo .xlsx primero.')
      return
    }
    setError('')
    setCargando(true)
    setResultado(null)
    setCambiosResueltos({})
    const formData = new FormData()
    formData.append('file', archivo)
    try {
      const { data } = await api.post('/importacion/procesar', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 60000,
      })
      setResultado(data)
    } catch (e) {
      setError(getErrorMessage(e))
    } finally {
      setCargando(false)
      if (inputRef.current) inputRef.current.value = ''
      setArchivo(null)
    }
  }

  const aplicarCambioPrecio = async (item, aceptar) => {
    if (aceptar) {
      try {
        await api.put(`/productos/${item.producto_id}`, { precio_venta: item.precio_venta_sugerido })
        setCambiosResueltos((r) => ({ ...r, [item.producto_id]: 'aceptado' }))
      } catch (e) {
        setError(getErrorMessage(e))
      }
    } else {
      setCambiosResueltos((r) => ({ ...r, [item.producto_id]: 'rechazado' }))
    }
  }

  const aceptarTodos = () => {
    resultado.cambios_costo.forEach((item) => {
      if (!cambiosResueltos[item.producto_id]) aplicarCambioPrecio(item, true)
    })
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold flex items-center gap-2">📥 Importar Catálogo / Stock desde Excel</h1>
      <p className="text-gray-400 text-sm">
        Subí una planilla con productos nuevos y/o reposición de stock de productos existentes. El software busca
        cada producto por <b>nombre</b> (no hace falta código): si existe, repone stock; si no existe, lo crea.
      </p>

      <div className="bg-[#151b2b] rounded-xl p-5 space-y-4">
        <div>
          <h2 className="font-bold mb-1">Columnas esperadas</h2>
          <p className="text-sm text-gray-400">
            <b>Producto</b> (obligatoria), <b>Costo</b> (obligatoria), <b>Cantidad</b> (obligatoria), Categoria
            (para productos nuevos), Descuento (%, opcional, se aplica sobre Costo), FechaCompra (si falta, usa hoy),
            PrecioVenta (obligatoria solo para productos nuevos).
          </p>
          <button onClick={descargarPlantilla} className="text-blue-400 hover:underline text-sm mt-2">
            ⬇️ Descargar plantilla de ejemplo (.xlsx)
          </button>
        </div>

        {error && <p className="text-red-400 text-sm">{error}</p>}

        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xlsm"
            onChange={(e) => setArchivo(e.target.files[0] || null)}
            className="text-sm"
          />
          <button
            onClick={subir}
            disabled={cargando}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 px-4 py-2 rounded-lg font-medium"
          >
            {cargando ? 'Procesando...' : 'Importar'}
          </button>
        </div>
      </div>

      {resultado && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-[#151b2b] rounded-xl border-l-4 border-green-500 p-4">
              <p className="text-xs uppercase tracking-wide text-gray-400">Productos Nuevos</p>
              <p className="text-2xl font-bold mt-1">{resultado.productos_creados.length}</p>
            </div>
            <div className="bg-[#151b2b] rounded-xl border-l-4 border-blue-500 p-4">
              <p className="text-xs uppercase tracking-wide text-gray-400">Reposiciones</p>
              <p className="text-2xl font-bold mt-1">{resultado.compras_registradas.length}</p>
            </div>
            <div className="bg-[#151b2b] rounded-xl border-l-4 border-amber-500 p-4">
              <p className="text-xs uppercase tracking-wide text-gray-400">Cambios de Costo</p>
              <p className="text-2xl font-bold mt-1">{resultado.cambios_costo.length}</p>
            </div>
            <div className="bg-[#151b2b] rounded-xl border-l-4 border-red-500 p-4">
              <p className="text-xs uppercase tracking-wide text-gray-400">Filas con Error</p>
              <p className="text-2xl font-bold mt-1">{resultado.errores.length}</p>
            </div>
          </div>

          {resultado.cambios_costo.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-xl font-bold">💰 Productos con cambio de costo promedio</h2>
                <button onClick={aceptarTodos} className="bg-green-700 hover:bg-green-600 px-3 py-1.5 rounded-lg text-sm">
                  Aceptar todos
                </button>
              </div>
              <div className="bg-[#151b2b] rounded-xl p-5 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-400 border-b border-gray-700">
                      <th className="py-2">Producto</th>
                      <th>Costo Anterior</th>
                      <th>Costo Nuevo</th>
                      <th>Diferencia</th>
                      <th>Precio Actual</th>
                      <th>Precio Sugerido</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {resultado.cambios_costo.map((item) => {
                      const estado = cambiosResueltos[item.producto_id]
                      return (
                        <tr key={item.producto_id} className="border-b border-gray-800">
                          <td className="py-2">{item.producto}</td>
                          <td>${item.costo_anterior.toLocaleString('es-AR')}</td>
                          <td>${item.costo_nuevo.toLocaleString('es-AR')}</td>
                          <td className={item.diferencia_pct > 0 ? 'text-red-400' : 'text-green-400'}>
                            {item.diferencia_pct > 0 ? '+' : ''}
                            {item.diferencia_pct}%
                          </td>
                          <td>${item.precio_venta_actual.toLocaleString('es-AR')}</td>
                          <td>${item.precio_venta_sugerido.toLocaleString('es-AR')}</td>
                          <td className="text-right">
                            {estado === 'aceptado' && <span className="text-green-400 text-xs">✓ Precio actualizado</span>}
                            {estado === 'rechazado' && <span className="text-gray-500 text-xs">Sin cambios</span>}
                            {!estado && (
                              <span className="space-x-2">
                                <button
                                  onClick={() => aplicarCambioPrecio(item, true)}
                                  className="text-green-400 hover:underline text-xs"
                                >
                                  Aceptar
                                </button>
                                <button
                                  onClick={() => aplicarCambioPrecio(item, false)}
                                  className="text-gray-400 hover:underline text-xs"
                                >
                                  Rechazar
                                </button>
                              </span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {resultado.productos_creados.length > 0 && (
            <div>
              <h2 className="text-xl font-bold mb-2">✨ Productos dados de alta</h2>
              <div className="bg-[#151b2b] rounded-xl p-5 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-400 border-b border-gray-700">
                      <th className="py-2">Producto</th>
                      <th>Categoría</th>
                      <th>Stock Inicial</th>
                      <th>Costo</th>
                      <th>Precio Venta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resultado.productos_creados.map((p) => (
                      <tr key={p.producto_id} className="border-b border-gray-800">
                        <td className="py-2">{p.producto}</td>
                        <td>{p.categoria}</td>
                        <td>{p.stock_inicial}</td>
                        <td>${p.costo.toLocaleString('es-AR')}</td>
                        <td>${p.precio_venta.toLocaleString('es-AR')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {resultado.compras_registradas.length > 0 && (
            <div>
              <h2 className="text-xl font-bold mb-2">📦 Reposiciones registradas</h2>
              <div className="bg-[#151b2b] rounded-xl p-5 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-400 border-b border-gray-700">
                      <th className="py-2">Producto</th>
                      <th>Fecha</th>
                      <th>Cantidad</th>
                      <th>Costo Unit.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resultado.compras_registradas.map((c, idx) => (
                      <tr key={idx} className="border-b border-gray-800">
                        <td className="py-2">{c.producto}</td>
                        <td>{c.fecha}</td>
                        <td>{c.cantidad}</td>
                        <td>${c.costo_unitario.toLocaleString('es-AR')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {resultado.errores.length > 0 && (
            <div>
              <h2 className="text-xl font-bold mb-2">⚠️ Filas ignoradas</h2>
              <div className="bg-[#151b2b] rounded-xl p-5 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-400 border-b border-gray-700">
                      <th className="py-2">Fila</th>
                      <th>Producto</th>
                      <th>Motivo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resultado.errores.map((e, idx) => (
                      <tr key={idx} className="border-b border-gray-800">
                        <td className="py-2">{e.fila}</td>
                        <td>{e.producto}</td>
                        <td className="text-red-400">{e.motivo}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
