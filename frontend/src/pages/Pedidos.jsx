import { useEffect, useState } from 'react'
import api, { getErrorMessage } from '../api'

const ESTADOS_BASE = ['Pendiente', 'Preparando', 'Entregado', 'Cancelado']

const opcionesEstado = (pedido) =>
  pedido.forma_entrega === 'Envío' ? [...ESTADOS_BASE.slice(0, 2), 'Enviado', ...ESTADOS_BASE.slice(2)] : [...ESTADOS_BASE.slice(0, 2), 'Listo para retirar', ...ESTADOS_BASE.slice(2)]

export default function Pedidos() {
  const [pedidos, setPedidos] = useState([])
  const [error, setError] = useState('')

  useEffect(() => {
    api.get('/pedidos').then((r) => setPedidos(r.data)).catch((e) => setError(getErrorMessage(e)))
  }, [])

  const cambiarEstado = async (pedido, nuevoEstado) => {
    const anterior = pedido.estado
    setPedidos((prev) => prev.map((p) => (p.id === pedido.id ? { ...p, estado: nuevoEstado } : p)))
    try {
      await api.put(`/pedidos/${pedido.id}/estado`, { estado: nuevoEstado })
    } catch (e) {
      setError(getErrorMessage(e))
      setPedidos((prev) => prev.map((p) => (p.id === pedido.id ? { ...p, estado: anterior } : p)))
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold flex items-center gap-2">📦 Pedidos</h1>
      <p className="text-gray-400 text-sm">
        Pedidos de los dos canales de venta: e-commerce y mostrador (Caja). Cada línea generó
        automáticamente una Venta en Caja.
      </p>
      {error && <p className="text-red-400 text-sm">{error}</p>}

      <div className="bg-[#151b2b] rounded-xl p-5 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-400 border-b border-gray-700">
              <th className="py-2">Canal</th>
              <th>Fecha</th>
              <th>Cliente</th>
              <th>Items</th>
              <th>Total</th>
              <th>Facturar</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {pedidos.map((p) => (
              <tr key={p.id} className="border-b border-gray-800 align-top">
                <td className="py-2">
                  <span
                    className={`px-2 py-1 rounded text-xs font-medium ${
                      p.canal === 'ecommerce' ? 'bg-blue-950/50 text-blue-300' : 'bg-purple-950/50 text-purple-300'
                    }`}
                  >
                    {p.canal === 'ecommerce' ? '🛒 E-commerce' : '🏬 Mostrador'}
                  </span>
                </td>
                <td>{new Date(p.fecha).toLocaleString('es-AR')}</td>
                <td>
                  {p.cliente_nombre || (p.canal === 'local' ? 'Mostrador' : '—')}
                  {p.cliente_email && <div className="text-gray-500 text-xs">{p.cliente_email}</div>}
                  {p.cliente_telefono && <div className="text-gray-500 text-xs">{p.cliente_telefono}</div>}
                </td>
                <td>
                  {p.items.map((it) => (
                    <div key={it.id}>
                      {it.producto?.nombre || `Producto #${it.producto_id}`} x{it.cantidad}
                    </div>
                  ))}
                </td>
                <td>${Number(p.total).toLocaleString('es-AR')}</td>
                <td>
                  <span
                    className={`px-2 py-1 rounded text-xs font-medium ${
                      p.facturar_arca ? 'bg-green-950/50 text-green-300' : 'bg-gray-800 text-gray-400'
                    }`}
                  >
                    {p.facturar_arca ? 'Sí' : 'No'}
                  </span>
                </td>
                <td>
                  <select
                    className="bg-[#0b0f19] border border-gray-700 rounded-lg p-1 text-xs"
                    value={p.estado}
                    onChange={(e) => cambiarEstado(p, e.target.value)}
                  >
                    {!opcionesEstado(p).includes(p.estado) && <option value={p.estado}>{p.estado}</option>}
                    {opcionesEstado(p).map((estado) => (
                      <option key={estado} value={estado}>
                        {estado}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
            {pedidos.length === 0 && (
              <tr>
                <td colSpan={7} className="text-gray-500 py-4 text-center">
                  Todavía no hay pedidos.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
