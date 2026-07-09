import { useEffect, useState } from 'react'
import api from '../api'

export default function SellThrough() {
  const [data, setData] = useState([])
  const [porCategoria, setPorCategoria] = useState([])

  useEffect(() => {
    api.get('/dashboard/sell-through').then((r) => setData(r.data))
    api.get('/stock/categorias').then((r) => setPorCategoria(r.data))
  }, [])

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold flex items-center gap-2">📈 Stock, Sell-through y Rotación</h1>
      <p className="text-gray-400 text-sm">
        El stock se calcula solo (compras − ventas), no se carga a mano. Se resalta en rojo lo que supera los 90 días
        sin venderse (regla de rotación).
      </p>

      {porCategoria.length > 0 && (
        <div>
          <h2 className="text-xl font-bold mb-2">📦 Stock por Categoría</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {porCategoria.map((c) => (
              <div key={c.categoria} className="bg-[#151b2b] rounded-xl border-l-4 border-blue-500 p-4">
                <p className="text-xs uppercase tracking-wide text-gray-400">{c.categoria}</p>
                <p className="text-2xl font-bold mt-1">{c.stock_actual} u.</p>
                <p className="text-xs text-gray-500">{c.cantidad_productos} producto(s)</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-[#151b2b] rounded-xl p-5 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-400 border-b border-gray-700">
              <th className="py-2">Producto</th>
              <th>Categoría</th>
              <th>Stock Actual</th>
              <th>Total Comprado</th>
              <th>Total Vendido</th>
              <th>Sell-through</th>
              <th>Días en Stock</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {data.map((p) => (
              <tr
                key={p.producto_id}
                className={`border-b border-gray-800 ${p.alerta_rotacion_90_dias ? 'bg-red-950/40' : ''}`}
              >
                <td className="py-2">{p.producto}</td>
                <td>{p.categoria}</td>
                <td>{p.stock_actual}</td>
                <td>{p.total_comprado}</td>
                <td>{p.total_vendido}</td>
                <td>{p.sell_through_pct !== null ? `${p.sell_through_pct}%` : '—'}</td>
                <td className={p.dias_en_stock > 90 ? 'text-red-400 font-bold' : ''}>
                  {p.dias_en_stock !== null ? `${p.dias_en_stock} días` : '—'}
                </td>
                <td>
                  {p.alerta_rotacion_90_dias
                    ? '🔴 Liquidar / ofertar'
                    : p.stock_actual === 0
                      ? '⚪ Sin stock'
                      : p.sell_through_pct !== null && p.sell_through_pct < 20
                        ? '🟡 Bajo movimiento'
                        : '🟢 OK'}
                </td>
              </tr>
            ))}
            {data.length === 0 && (
              <tr>
                <td colSpan={8} className="text-gray-500 py-4 text-center">
                  No hay productos activos cargados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
