import { useEffect, useState } from 'react'
import {
  CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis,
} from 'recharts'
import api from '../api'

const colores = { Estrella: '#facc15', Vaca: '#38bdf8', Incognita: '#a78bfa', Perro: '#f87171' }
const descripciones = {
  Estrella: 'Alto margen, alto volumen. Nunca deben faltar en stock.',
  Vaca: 'Bajo margen, alto volumen. Traen tráfico y mueven el efectivo.',
  Incognita: 'Alto margen, bajo volumen. Apuestas / tendencias.',
  Perro: 'Bajo margen, bajo volumen. Liquidar para recuperar capital y espacio.',
}
const fmt = (n) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n || 0)

export default function Analisis() {
  const [data, setData] = useState(null)
  const [dias, setDias] = useState(30)
  const [cambiosDevoluciones, setCambiosDevoluciones] = useState(null)

  useEffect(() => {
    api.get('/dashboard/analisis', { params: { dias } }).then((r) => setData(r.data))
    api.get('/dashboard/cambios-devoluciones', { params: { dias } }).then((r) => setCambiosDevoluciones(r.data))
  }, [dias])

  if (!data) return <p>Cargando...</p>
  if (data.error) return <p className="text-yellow-400">{data.error}</p>

  const grupos = { Estrella: [], Vaca: [], Incognita: [], Perro: [] }
  data.productos.forEach((i) => grupos[i.cuadrante].push(i))
  const candidatos = data.productos.filter((p) => p.candidato_renegociacion)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-3xl font-bold flex items-center gap-2">🎯 Análisis: BCG + Margen</h1>
        <select
          className="bg-[#0b0f19] border border-gray-700 rounded-lg p-2"
          value={dias}
          onChange={(e) => setDias(Number(e.target.value))}
        >
          <option value={7}>Últimos 7 días</option>
          <option value={30}>Últimos 30 días</option>
          <option value={90}>Últimos 90 días</option>
        </select>
      </div>
      <p className="text-gray-400 text-sm">
        Eje X: volumen vendido · Eje Y: margen (%) · tamaño de la burbuja: margen generado en $. Así se ve en una sola
        vista qué producto vende mucho, qué margen deja, y cuánta plata aporta realmente — sin cruzar dos pantallas.
      </p>

      <div className="bg-[#151b2b] rounded-xl p-5" style={{ height: 420 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 0 }}>
            <CartesianGrid stroke="#1f2937" />
            <XAxis type="number" dataKey="volumen" name="Volumen" stroke="#9ca3af" />
            <YAxis type="number" dataKey="margen_pct" name="Margen %" stroke="#9ca3af" />
            <ZAxis type="number" dataKey="margen_generado" range={[80, 900]} name="Margen generado" />
            <ReferenceLine x={data.volumen_mediano} stroke="#4b5563" />
            <ReferenceLine y={data.margen_mediano_pct} stroke="#4b5563" />
            <Tooltip
              contentStyle={{ background: '#151b2b', border: '1px solid #374151' }}
              formatter={(value, name) => (name === 'Margen generado' ? [fmt(value), name] : [value, name])}
              labelFormatter={() => ''}
            />
            <Scatter data={data.productos}>
              {data.productos.map((it, idx) => (
                <Cell key={idx} fill={colores[it.cuadrante]} fillOpacity={0.75} />
              ))}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </div>

      <div>
        <h2 className="text-xl font-bold mb-2">🏆 Motor vs Decoración (por categoría)</h2>
        <p className="text-gray-400 text-sm mb-2">
          "Motor" = categorías que, ordenadas de mayor a menor margen generado, alcanzan a cubrir los costos fijos del
          negocio. El resto suma margen extra pero no es imprescindible para el punto de equilibrio.
        </p>
        <div className="bg-[#151b2b] rounded-xl p-5 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-400 border-b border-gray-700">
                <th className="py-2">Categoría</th>
                <th></th>
                <th>Margen Generado</th>
                <th>% del Total</th>
                <th>⭐</th>
                <th>🐄</th>
                <th>❓</th>
                <th>🐶</th>
              </tr>
            </thead>
            <tbody>
              {data.categorias.map((c) => (
                <tr key={c.categoria} className="border-b border-gray-800">
                  <td className="py-2">{c.categoria}</td>
                  <td>
                    {c.clasificacion === 'Motor' ? (
                      <span className="px-2 py-1 rounded-full text-xs font-medium bg-yellow-900/60 text-yellow-300">
                        🏆 Motor
                      </span>
                    ) : (
                      <span className="px-2 py-1 rounded-full text-xs font-medium bg-gray-800 text-gray-400">
                        Decoración
                      </span>
                    )}
                  </td>
                  <td>{fmt(c.margen_generado)}</td>
                  <td>{c.pct_del_margen_total}%</td>
                  <td>{c.cantidad_estrella}</td>
                  <td>{c.cantidad_vaca}</td>
                  <td>{c.cantidad_incognita}</td>
                  <td>{c.cantidad_perro}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {candidatos.length > 0 && (
        <div>
          <h2 className="text-xl font-bold mb-2">💸 Candidatos a renegociar (poco margen, mucha venta)</h2>
          <p className="text-gray-400 text-sm mb-2">
            Margen menor al 15% y entre lo más vendido (top 30% en unidades). Vale la pena renegociar el costo con el
            proveedor, buscar otro proveedor, o evaluar si conviene mantenerlos solo como "imán" de tráfico.
          </p>
          <div className="bg-[#151b2b] rounded-xl p-5 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-400 border-b border-gray-700">
                  <th className="py-2">Producto</th>
                  <th>Categoría</th>
                  <th>Margen %</th>
                  <th>Volumen</th>
                  <th>Margen Generado</th>
                </tr>
              </thead>
              <tbody>
                {candidatos.map((p) => (
                  <tr key={p.producto_id} className="border-b border-gray-800">
                    <td className="py-2">{p.producto}</td>
                    <td>{p.categoria}</td>
                    <td className="text-amber-400">{p.margen_pct}%</td>
                    <td>{p.volumen}</td>
                    <td>{fmt(p.margen_generado)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {Object.entries(grupos).map(([cuadrante, items]) => (
          <div
            key={cuadrante}
            className="bg-[#151b2b] rounded-xl p-4"
            style={{ borderLeft: `4px solid ${colores[cuadrante]}` }}
          >
            <h3 className="font-bold text-lg" style={{ color: colores[cuadrante] }}>
              {cuadrante} ({items.length})
            </h3>
            <p className="text-gray-400 text-sm mb-2">{descripciones[cuadrante]}</p>
            <ul className="text-sm space-y-1">
              {items.map((i) => (
                <li key={i.producto_id} className="flex justify-between border-b border-gray-800 py-1">
                  <span>
                    {i.producto} <span className="text-gray-500">({i.categoria})</span>
                  </span>
                  <span className="text-gray-400">
                    {i.margen_pct}% · {i.volumen} u. · {fmt(i.margen_generado)}
                  </span>
                </li>
              ))}
              {items.length === 0 && <li className="text-gray-600">Sin productos en este cuadrante.</li>}
            </ul>
          </div>
        ))}
      </div>

      {cambiosDevoluciones && (
        <div>
          <h2 className="text-xl font-bold mb-2">🔄 Cambios vs. reembolsos</h2>
          <p className="text-gray-400 text-sm mb-2">
            De todas las devoluciones de la ventana elegida arriba, cuántas terminaron siendo un cambio de
            producto (la clienta se llevó otra prenda) en vez de un reembolso puro.
          </p>
          <div className="bg-[#151b2b] rounded-xl p-5 grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
            <div>
              <div className="text-gray-400">Devoluciones totales</div>
              <div className="text-lg font-semibold">{cambiosDevoluciones.total_devoluciones}</div>
            </div>
            <div>
              <div className="text-gray-400">Cambios</div>
              <div className="text-lg font-semibold">{cambiosDevoluciones.cantidad_cambios}</div>
            </div>
            <div>
              <div className="text-gray-400">Reembolsos</div>
              <div className="text-lg font-semibold">{cambiosDevoluciones.cantidad_reembolsos}</div>
            </div>
            <div>
              <div className="text-gray-400">Tasa de cambio</div>
              <div className="text-lg font-semibold">{cambiosDevoluciones.tasa_cambio_pct.toFixed(1)}%</div>
            </div>
            <div>
              <div className="text-gray-400">Monto cambiado</div>
              <div className="text-lg font-semibold">{fmt(cambiosDevoluciones.monto_cambiado)}</div>
            </div>
            <div>
              <div className="text-gray-400">Monto reembolsado</div>
              <div className="text-lg font-semibold">{fmt(cambiosDevoluciones.monto_reembolsado)}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
