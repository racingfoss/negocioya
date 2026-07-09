import { useEffect, useState } from 'react'
import { CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from 'recharts'
import api from '../api'

const colores = { Estrella: '#facc15', Vaca: '#38bdf8', Incognita: '#a78bfa', Perro: '#f87171' }
const descripciones = {
  Estrella: 'Alto margen, alto volumen. Nunca deben faltar en stock.',
  Vaca: 'Bajo margen, alto volumen. Traen tráfico y mueven el efectivo.',
  Incognita: 'Alto margen, bajo volumen. Apuestas / tendencias.',
  Perro: 'Bajo margen, bajo volumen. Liquidar para recuperar capital y espacio.',
}

export default function BCG() {
  const [data, setData] = useState(null)
  const [dias, setDias] = useState(30)

  useEffect(() => {
    api.get('/dashboard/bcg', { params: { dias } }).then((r) => setData(r.data))
  }, [dias])

  if (!data) return <p>Cargando...</p>
  if (data.error) return <p className="text-yellow-400">{data.error}</p>

  const grupos = { Estrella: [], Vaca: [], Incognita: [], Perro: [] }
  data.items.forEach((i) => grupos[i.cuadrante].push(i))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-3xl font-bold flex items-center gap-2">🎯 Matriz BCG de Producto</h1>
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
        Clasificación según margen (%) y volumen vendido. Umbrales: margen mediano {data.margen_mediano_pct}%, volumen
        mediano {data.volumen_mediano} u.
      </p>

      <div className="bg-[#151b2b] rounded-xl p-5" style={{ height: 400 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 0 }}>
            <CartesianGrid stroke="#1f2937" />
            <XAxis type="number" dataKey="volumen" name="Volumen" stroke="#9ca3af" />
            <YAxis type="number" dataKey="margen_pct" name="Margen %" stroke="#9ca3af" />
            <ReferenceLine x={data.volumen_mediano} stroke="#4b5563" />
            <ReferenceLine y={data.margen_mediano_pct} stroke="#4b5563" />
            <Tooltip
              contentStyle={{ background: '#151b2b', border: '1px solid #374151' }}
              formatter={(value, name) => [value, name]}
              labelFormatter={() => ''}
            />
            <Scatter data={data.items}>
              {data.items.map((it, idx) => (
                <Cell key={idx} fill={colores[it.cuadrante]} />
              ))}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </div>

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
                    {i.margen_pct}% · {i.volumen} u.
                  </span>
                </li>
              ))}
              {items.length === 0 && <li className="text-gray-600">Sin productos en este cuadrante.</li>}
            </ul>
          </div>
        ))}
      </div>
    </div>
  )
}
