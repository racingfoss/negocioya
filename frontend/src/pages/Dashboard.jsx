import { useEffect, useState } from 'react'
import {
  CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import api from '../api'
import Card from '../components/Card'

const fmt = (n) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 2 }).format(n || 0)

// Paleta categórica fija (8 colores, orden fijo — no se ciclan según ranking) validada para
// texto/legend en superficie oscura #151b2b. Si hay más de 8 categorías, el resto se agrupa en
// "Otras" en vez de generar un 9º color.
const COLORES_CATEGORIA = ['#3987e5', '#199e70', '#c98500', '#008300', '#9085e9', '#e66767', '#d55181', '#d95926']

// Se agrupa por el timestamp EXACTO del snapshot (no por día): todas las filas de una misma
// "tomada" comparten el mismo `fecha` al milisegundo (ver tomar_snapshot_mix en calculations.py),
// así que sumar por categoría dentro de un mismo timestamp es correcto (da ~100% entre categorías).
// Truncar a solo el día sería incorrecto: si se toman dos snapshots manuales el mismo día (o el
// automático dispara justo el día de una toma manual), sumaría dos "fotos" distintas en un solo
// punto e infla el mix% por encima del 100%.
function agruparSnapshotsPorCategoria(snapshots) {
  const porTimestamp = new Map()
  const totalPorCategoria = new Map()
  for (const s of snapshots) {
    const categoria = s.categoria_nombre || 'Sin categoría'
    if (!porTimestamp.has(s.fecha)) {
      porTimestamp.set(s.fecha, { fecha: s.fecha, etiqueta: s.fecha.slice(0, 10) })
    }
    const fila = porTimestamp.get(s.fecha)
    fila[categoria] = (fila[categoria] || 0) + s.mix_pct
    totalPorCategoria.set(categoria, (totalPorCategoria.get(categoria) || 0) + s.mix_pct)
  }
  const categoriasOrdenadas = [...totalPorCategoria.entries()].sort((a, b) => b[1] - a[1]).map(([nombre]) => nombre)
  const principales = categoriasOrdenadas.slice(0, 8)
  const resto = categoriasOrdenadas.slice(8)

  const datos = [...porTimestamp.values()].sort((a, b) => a.fecha.localeCompare(b.fecha))
  if (resto.length > 0) {
    for (const fila of datos) {
      fila['Otras'] = resto.reduce((acc, cat) => acc + (fila[cat] || 0), 0)
      for (const cat of resto) delete fila[cat]
    }
  }
  const categorias = resto.length > 0 ? [...principales, 'Otras'] : principales
  return { datos, categorias }
}

export default function Dashboard() {
  const [resumen, setResumen] = useState(null)
  const [pe, setPe] = useState(null)
  const [contrib, setContrib] = useState(null)
  const [modoMix, setModoMix] = useState('real')
  const [diasMix, setDiasMix] = useState(30)
  const [snapshots, setSnapshots] = useState([])
  const [tomandoSnapshot, setTomandoSnapshot] = useState(false)

  const cargarSnapshots = () => api.get('/mix-snapshots').then((r) => setSnapshots(r.data)).catch(() => {})

  useEffect(() => {
    api.get('/dashboard/resumen').then((r) => setResumen(r.data))
    api.get('/dashboard/contribucion-categorias').then((r) => setContrib(r.data)).catch(() => {})
    api.get('/configuracion').then((r) => setDiasMix(r.data.mix_real_ventana_dias_default)).catch(() => {})
    cargarSnapshots()
  }, [])

  useEffect(() => {
    api
      .get('/dashboard/punto-equilibrio', { params: { modo: modoMix, dias: diasMix } })
      .then((r) => setPe(r.data))
      .catch(() => {})
  }, [modoMix, diasMix])

  const tomarSnapshotAhora = async () => {
    setTomandoSnapshot(true)
    try {
      await api.post('/mix-snapshots/tomar')
      await cargarSnapshots()
    } finally {
      setTomandoSnapshot(false)
    }
  }

  const { datos: datosEvolucion, categorias: categoriasEvolucion } = agruparSnapshotsPorCategoria(snapshots)

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-bold flex items-center gap-2">📊 Panel de Control</h1>

      {resumen && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card title="Caja Actual" value={fmt(resumen.caja_actual)} color="green" />
          <Card title="Ingresos Reales" value={fmt(resumen.ingresos_reales)} color="blue" />
          <Card title="Egresos Reales" value={fmt(resumen.egresos_reales)} color="red" />
        </div>
      )}

      <div>
        <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
          <h2 className="text-xl font-bold flex items-center gap-2">
            🎯 Punto de Equilibrio Ponderado — {modoMix === 'real' ? `mix real, últimos ${diasMix} días` : 'mix manual'}
          </h2>
          <div className="flex items-center gap-2">
            <select
              className="bg-[#0b0f19] border border-gray-700 rounded-lg p-2 text-sm"
              value={modoMix}
              onChange={(e) => setModoMix(e.target.value)}
            >
              <option value="real">Mix real (últimos N días)</option>
              <option value="manual">Mix manual (catálogo)</option>
            </select>
            {modoMix === 'real' && (
              <select
                className="bg-[#0b0f19] border border-gray-700 rounded-lg p-2 text-sm"
                value={diasMix}
                onChange={(e) => setDiasMix(Number(e.target.value))}
              >
                <option value={7}>Últimos 7 días</option>
                <option value={30}>Últimos 30 días</option>
                <option value={90}>Últimos 90 días</option>
              </select>
            )}
          </div>
        </div>
        {pe?.error && (
          <div className="bg-[#151b2b] rounded-xl p-5 space-y-2">
            <p className="text-yellow-400">{pe.error}</p>
            {modoMix === 'real' && (
              <button
                className="text-sm text-blue-400 hover:text-blue-300 underline"
                onClick={() => setModoMix('manual')}
              >
                Cambiar a modo manual
              </button>
            )}
          </div>
        )}
        {pe && !pe.error && (
          <div className="bg-[#151b2b] rounded-xl p-5 space-y-3">
            <p className="text-gray-400 text-sm">Facturación Mínima Requerida</p>
            <p className="text-3xl font-bold">{fmt(pe.facturacion_minima_requerida)}</p>
            <p className="text-gray-300">
              Debés vender un mínimo de <b>{pe.unidades_totales_requeridas}</b> prendas mensuales
              {' '}(margen ponderado: {pe.margen_ponderado_pct}%).
            </p>
            {modoMix === 'manual' && Math.round(pe.mix_total_pct) !== 100 && (
              <p className="text-yellow-400 text-sm">
                ⚠️ El mix de productos activos suma {pe.mix_total_pct}%, debería sumar 100%.
              </p>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm mt-2">
                <thead>
                  <tr className="text-left text-gray-400 border-b border-gray-700">
                    <th className="py-2">Producto</th>
                    <th>Mix (%)</th>
                    {modoMix === 'real' && <th>Facturación (ventana)</th>}
                    <th>P. Venta ($)</th>
                    <th>Costo ($)</th>
                    <th>Margen (%)</th>
                    <th>Unidades Requeridas</th>
                  </tr>
                </thead>
                <tbody>
                  {pe.detalle.map((d) => (
                    <tr key={d.producto_id} className="border-b border-gray-800">
                      <td className="py-2">{d.producto}</td>
                      <td>{d.mix_pct}</td>
                      {modoMix === 'real' && <td>{fmt(d.facturacion_ventana)}</td>}
                      <td>{fmt(d.precio_venta)}</td>
                      <td>{fmt(d.costo)}</td>
                      <td>{d.margen_pct}%</td>
                      <td>{d.unidades_requeridas}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
          <h2 className="text-xl font-bold flex items-center gap-2">📈 Evolución del Mix Real</h2>
          <button
            onClick={tomarSnapshotAhora}
            disabled={tomandoSnapshot}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 px-3 py-2 rounded-lg text-sm font-medium"
          >
            {tomandoSnapshot ? 'Tomando...' : 'Tomar snapshot ahora'}
          </button>
        </div>
        <p className="text-gray-400 text-sm mb-2">
          Cada tanto (según lo configurado en ⚙️ Configuración) se guarda una foto del mix% real de facturación de
          cada categoría, para poder ver cómo cambia con el tiempo.
        </p>
        <div className="bg-[#151b2b] rounded-xl p-5">
          {datosEvolucion.length === 0 ? (
            <p className="text-gray-500 text-sm">
              Todavía no hay snapshots guardados. Tomá el primero con el botón de arriba, o esperá a que se tome
              automáticamente al abrir el Panel de Control.
            </p>
          ) : (
            <div style={{ height: 360 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={datosEvolucion} margin={{ top: 10, right: 20, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke="#1f2937" vertical={false} />
                  <XAxis dataKey="etiqueta" stroke="#9ca3af" tick={{ fontSize: 12 }} />
                  <YAxis stroke="#9ca3af" tick={{ fontSize: 12 }} unit="%" />
                  <Tooltip
                    contentStyle={{ background: '#0b0f19', border: '1px solid #374151' }}
                    formatter={(value) => `${Number(value).toFixed(1)}%`}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {categoriasEvolucion.map((cat, idx) => (
                    <Line
                      key={cat}
                      type="monotone"
                      dataKey={cat}
                      name={cat}
                      stroke={COLORES_CATEGORIA[idx % COLORES_CATEGORIA.length]}
                      strokeWidth={2}
                      dot={{ r: 4 }}
                      connectNulls
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {contrib && contrib.categorias?.length > 0 && (
        <div>
          <h2 className="text-xl font-bold mb-2">🏆 Contribución por Categoría</h2>
          <p className="text-gray-400 text-sm mb-2">
            Qué familia de productos es el "motor" del negocio (paga los costos fijos) y cuál es "decoración".
          </p>
          <div className="bg-[#151b2b] rounded-xl p-5 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-400 border-b border-gray-700">
                  <th className="py-2">Categoría</th>
                  <th>Unidades Vendidas</th>
                  <th>Margen Generado</th>
                  <th>% del Margen Total</th>
                </tr>
              </thead>
              <tbody>
                {contrib.categorias.map((c) => (
                  <tr key={c.categoria} className="border-b border-gray-800">
                    <td className="py-2">{c.categoria}</td>
                    <td>{c.unidades_vendidas}</td>
                    <td>{fmt(c.margen_generado)}</td>
                    <td>{c.pct_del_margen_total}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
