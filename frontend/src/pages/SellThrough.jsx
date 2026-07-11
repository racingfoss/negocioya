import { useEffect, useState } from 'react'
import api from '../api'

const badgeEstado = {
  'Sin stock': 'bg-red-900/60 text-red-300',
  Crítico: 'bg-red-900/60 text-red-300',
  'Próximo a agotarse': 'bg-amber-900/60 text-amber-300',
  Atención: 'bg-amber-900/40 text-amber-300',
  'Sin ventas recientes': 'bg-gray-800 text-gray-400',
  OK: 'bg-green-900/60 text-green-300',
}

function Badge({ estado }) {
  return (
    <span className={`px-2 py-1 rounded-full text-xs font-medium ${badgeEstado[estado] || 'bg-gray-800 text-gray-400'}`}>
      {estado}
    </span>
  )
}

const sellThroughPct = (vendido, comprado) => (comprado ? Math.round((vendido / comprado) * 1000) / 10 : null)

export default function Stock() {
  const [data, setData] = useState([])
  const [arbol, setArbol] = useState([])
  const [porCategoria, setPorCategoria] = useState([])

  useEffect(() => {
    api.get('/dashboard/sell-through').then((r) => setData(r.data))
    api.get('/stock/productos/arbol').then((r) => setArbol(r.data))
    api.get('/stock/categorias').then((r) => setPorCategoria(r.data))
  }, [])

  const criticos = [...data]
    .filter((p) => p.stock_actual > 0 && p.dias_cobertura !== null)
    .sort((a, b) => a.dias_cobertura - b.dias_cobertura)
    .slice(0, 5)

  // aplana el árbol de 3 niveles (producto > subtotal de atributo primario > variante) en filas con indentación,
  // para no forzar niveles vacíos en productos sin variantes o con un solo atributo configurado
  const filas = []
  for (const p of arbol) {
    filas.push({ ...p, nivel: 0, key: `p-${p.producto_id}` })
    for (const g of p.grupos || []) {
      filas.push({ ...g, nivel: 1, key: `p-${p.producto_id}-g-${g.nombre}` })
      for (const v of g.variantes || []) {
        filas.push({ ...v, nivel: 2, key: `v-${v.variante_id}` })
      }
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold flex items-center gap-2">📈 Stock y Reposición</h1>
      <p className="text-gray-400 text-sm">
        "Días de cobertura" = stock actual / demanda media diaria (ventas de los últimos 90 días). Verde = más de 30
        días, ámbar = entre 7 y 30, rojo = menos de 7. También se marca "reponer" cuando la cobertura cae por debajo
        del lead time del proveedor (configurable por producto en el Catálogo).
      </p>

      {criticos.length > 0 && (
        <div>
          <h2 className="text-xl font-bold mb-2">🚨 SKU más críticos</h2>
          <div className="bg-[#151b2b] rounded-xl p-5 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-400 border-b border-gray-700">
                  <th className="py-2">Producto</th>
                  <th>Categoría</th>
                  <th>Stock</th>
                  <th>Días de Cobertura</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {criticos.map((p) => (
                  <tr key={p.producto_id} className="border-b border-gray-800">
                    <td className="py-2">{p.producto}</td>
                    <td>{p.categoria}</td>
                    <td>{p.stock_actual}</td>
                    <td>{p.dias_cobertura} días</td>
                    <td>
                      <Badge estado={p.estado_stock} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {porCategoria.length > 0 && (
        <div>
          <h2 className="text-xl font-bold mb-2">📦 Stock y Cobertura por Categoría</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {porCategoria.map((c) => (
              <div key={c.categoria} className="bg-[#151b2b] rounded-xl border-l-4 border-blue-500 p-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs uppercase tracking-wide text-gray-400">{c.categoria}</p>
                  <Badge estado={c.estado_stock} />
                </div>
                <p className="text-2xl font-bold mt-1">{c.stock_actual} u.</p>
                <p className="text-xs text-gray-500">
                  {c.cantidad_productos} producto(s) · {c.dias_cobertura !== null ? `${c.dias_cobertura} días de cobertura` : 'sin ventas recientes'}
                </p>
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
              <th>Demanda Diaria</th>
              <th>Días de Cobertura</th>
              <th>Sell-through</th>
              <th>Días en Stock (rotación)</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => {
              const esDetalle = f.nivel > 0
              const sellThrough = sellThroughPct(f.total_vendido, f.total_comprado)
              return (
                <tr
                  key={f.key}
                  className={`border-b border-gray-800 ${f.nivel === 0 && f.necesita_reponer ? 'bg-red-950/30' : ''} ${
                    esDetalle ? 'text-gray-400' : ''
                  }`}
                >
                  <td className="py-2" style={{ paddingLeft: `${f.nivel * 1.5}rem` }}>
                    {f.nivel > 0 ? `${'—'.repeat(f.nivel)} ${f.nombre}` : f.producto}
                  </td>
                  <td>{f.nivel === 0 ? f.categoria : ''}</td>
                  <td>{f.stock_actual} u.</td>
                  <td>{f.nivel < 2 ? '—' : `${f.demanda_media_diaria} u./día`}</td>
                  <td>{f.nivel < 2 ? '—' : f.dias_cobertura !== null ? `${f.dias_cobertura} días` : '—'}</td>
                  <td>{sellThrough !== null ? `${sellThrough}%` : '—'}</td>
                  <td className={f.alerta_rotacion_90_dias ? 'text-red-400 font-bold' : ''}>
                    {f.nivel < 2 ? '—' : f.dias_en_stock !== null ? `${f.dias_en_stock} días` : '—'}
                  </td>
                  <td>{f.nivel < 2 ? (f.nivel === 0 ? <Badge estado={f.estado_stock} /> : '—') : <Badge estado={f.estado_stock} />}</td>
                </tr>
              )
            })}
            {filas.length === 0 && (
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
