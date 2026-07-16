import { useEffect, useState } from 'react'
import api, { getErrorMessage } from '../api'

export default function OrdenesEcommerce() {
  const [ordenes, setOrdenes] = useState([])
  const [error, setError] = useState('')

  useEffect(() => {
    api.get('/ecommerce/ordenes').then((r) => setOrdenes(r.data)).catch((e) => setError(getErrorMessage(e)))
  }, [])

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold flex items-center gap-2">🛒 Órdenes E-commerce</h1>
      <p className="text-gray-400 text-sm">
        Órdenes creadas desde el e-commerce. Cada línea generó automáticamente una Venta en Caja.
      </p>
      {error && <p className="text-red-400 text-sm">{error}</p>}

      <div className="bg-[#151b2b] rounded-xl p-5 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-400 border-b border-gray-700">
              <th className="py-2">Fecha</th>
              <th>Cliente</th>
              <th>Entrega</th>
              <th>Pago</th>
              <th>Items</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {ordenes.map((o) => (
              <tr key={o.id} className="border-b border-gray-800 align-top">
                <td className="py-2">{new Date(o.fecha).toLocaleString()}</td>
                <td>
                  {o.cliente_nombre}
                  {o.cliente_email && <div className="text-gray-500 text-xs">{o.cliente_email}</div>}
                  {o.cliente_telefono && <div className="text-gray-500 text-xs">{o.cliente_telefono}</div>}
                </td>
                <td>
                  {o.forma_entrega}
                  {o.direccion_envio && <div className="text-gray-500 text-xs">{o.direccion_envio}</div>}
                </td>
                <td>{o.metodo_pago_preferido || '—'}</td>
                <td>
                  {o.items.map((it) => (
                    <div key={it.id}>
                      {it.producto?.nombre || `Producto #${it.producto_id}`} x{it.cantidad}
                    </div>
                  ))}
                </td>
                <td>${o.total}</td>
              </tr>
            ))}
            {ordenes.length === 0 && (
              <tr>
                <td colSpan={6} className="text-gray-500 py-4 text-center">
                  Todavía no hay órdenes.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
