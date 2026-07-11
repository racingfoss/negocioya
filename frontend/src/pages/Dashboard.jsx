import { useEffect, useState } from 'react'
import api from '../api'
import Card from '../components/Card'

const fmt = (n) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 2 }).format(n || 0)

export default function Dashboard() {
  const [resumen, setResumen] = useState(null)
  const [pe, setPe] = useState(null)
  const [contrib, setContrib] = useState(null)
  const [modoMix, setModoMix] = useState('real')
  const [diasMix, setDiasMix] = useState(30)

  useEffect(() => {
    api.get('/dashboard/resumen').then((r) => setResumen(r.data))
    api.get('/dashboard/contribucion-categorias').then((r) => setContrib(r.data)).catch(() => {})
  }, [])

  useEffect(() => {
    api
      .get('/dashboard/punto-equilibrio', { params: { modo: modoMix, dias: diasMix } })
      .then((r) => setPe(r.data))
      .catch(() => {})
  }, [modoMix, diasMix])

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
