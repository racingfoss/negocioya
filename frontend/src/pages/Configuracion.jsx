import { useEffect, useState } from 'react'
import api, { getErrorMessage } from '../api'

const GRUPOS = [
  {
    titulo: 'Stock y Reposición',
    campos: [
      {
        key: 'demanda_ventana_dias',
        label: 'Ventana para calcular demanda (días)',
        ayuda: 'Cuántos días hacia atrás se miran para calcular cuánto se vende por día en promedio de cada producto.',
      },
      {
        key: 'lead_time_default_dias',
        label: 'Plazo de reposición por defecto (días)',
        ayuda: 'Se usa cuando un producto no tiene cargado su propio plazo de reposición del proveedor.',
      },
      {
        key: 'safety_days',
        label: 'Colchón de seguridad (días)',
        ayuda: 'Días extra que se suman al plazo de reposición antes de marcar "hay que reponer".',
      },
      {
        key: 'stock_dias_verde',
        label: 'Días de cobertura para estado "OK" (verde)',
        ayuda: 'Por encima de esta cantidad de días de cobertura, el stock se muestra en verde.',
      },
      {
        key: 'stock_dias_rojo',
        label: 'Días de cobertura para estado "Crítico" (rojo)',
        ayuda: 'Por debajo de esta cantidad de días de cobertura, el stock se muestra en rojo.',
      },
      {
        key: 'rotacion_alerta_dias',
        label: 'Alerta de stock estancado (días)',
        ayuda: 'Si una prenda lleva más de estos días sin venderse, se marca como estancada (rotación lenta).',
      },
    ],
  },
  {
    titulo: 'Compras',
    campos: [
      {
        key: 'umbral_cambio_costo_pct',
        label: '% de cambio de costo que dispara el aviso',
        ayuda:
          'Si al registrar una compra el costo cambia más de este % respecto a la última compra del mismo producto, se sugiere actualizar el precio de venta.',
      },
    ],
  },
  {
    titulo: 'Análisis',
    campos: [
      {
        key: 'renegociacion_margen_umbral_pct',
        label: 'Margen % considerado "bajo"',
        ayuda: 'Productos con un margen menor a este % son candidatos a marcarse para renegociar con el proveedor.',
      },
      {
        key: 'renegociacion_percentil_volumen',
        label: 'Percentil de volumen para candidatos (0 a 1)',
        ayuda: 'Solo se marcan como candidatos los productos de bajo margen que además estén entre los más vendidos (ej: 0.7 = el 30% más vendido).',
      },
      {
        key: 'motor_decoracion_pareto_pct',
        label: '% de Pareto para Motor vs Decoración',
        ayuda: 'Si todavía no cargaste costos fijos, se usa este % del margen total acumulado como corte entre categorías "Motor" y "Decoración".',
      },
    ],
  },
  {
    titulo: 'Punto de Equilibrio',
    campos: [
      {
        key: 'mix_real_ventana_dias_default',
        label: 'Ventana inicial del mix real (días)',
        ayuda: 'Con cuántos días viene tildado por defecto el selector al abrir el Punto de Equilibrio. Se puede seguir cambiando al vuelo desde esa pantalla.',
      },
      {
        key: 'snapshot_periodo_dias',
        label: 'Cada cuántos días guardar una foto del mix real',
        ayuda: 'Cada cuántos días se guarda automáticamente una foto del mix% real de facturación, para poder ver su evolución en el tiempo.',
      },
    ],
  },
  {
    titulo: 'Tienda Online',
    campos: [
      {
        key: 'nombre_ecommerce',
        label: 'Nombre de la tienda',
        ayuda: 'Nombre que se muestra en el storefront (logo, título de la página, pie de página). No es el nombre de este panel de gestión.',
        tipo: 'texto',
      },
      {
        key: 'whatsapp_numero',
        label: 'WhatsApp (con código de país, sin espacios ni +)',
        ayuda: 'Ej: 5491122334455. Se usa para el botón flotante de WhatsApp y el botón "Consultar" de cada producto en el storefront.',
        tipo: 'texto',
      },
      {
        key: 'instagram_url',
        label: 'Instagram (URL completa)',
        ayuda: 'Ej: https://instagram.com/tu_negocio. Dejalo vacío para no mostrar el ícono en el storefront.',
        tipo: 'texto',
      },
      {
        key: 'facebook_url',
        label: 'Facebook (URL completa)',
        ayuda: 'Ej: https://facebook.com/tu_negocio. Dejalo vacío para no mostrar el ícono en el storefront.',
        tipo: 'texto',
      },
    ],
  },
]

export default function Configuracion() {
  const [config, setConfig] = useState(null)
  const [guardando, setGuardando] = useState(false)
  const [guardado, setGuardado] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api.get('/configuracion').then((r) => setConfig(r.data))
  }, [])

  const cambiar = (key, value) => {
    setConfig((c) => ({ ...c, [key]: value }))
    setGuardado(false)
  }

  const guardar = async () => {
    setError('')
    setGuardando(true)
    try {
      const { id, ...payload } = config
      const r = await api.put('/configuracion', payload)
      setConfig(r.data)
      setGuardado(true)
    } catch (e) {
      setError(getErrorMessage(e))
    } finally {
      setGuardando(false)
    }
  }

  if (!config) return <p>Cargando...</p>

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold flex items-center gap-2">⚙️ Configuración</h1>
      <p className="text-gray-400 text-sm">
        Estos valores controlan cómo se calculan las alertas y los análisis del negocio. Si no estás segura, dejalos
        como están: son los valores recomendados por defecto.
      </p>

      {error && <p className="text-red-400 text-sm">{error}</p>}
      {guardado && <p className="text-green-400 text-sm">Cambios guardados.</p>}

      {GRUPOS.map((g) => (
        <div key={g.titulo} className="bg-[#151b2b] rounded-xl p-5 space-y-4">
          <h2 className="font-bold text-lg">{g.titulo}</h2>
          {g.campos.map((c) => (
            <div
              key={c.key}
              className="grid grid-cols-1 md:grid-cols-3 gap-2 items-start border-b border-gray-800 pb-3 last:border-0 last:pb-0"
            >
              <label className="md:col-span-1 font-medium text-sm pt-2">{c.label}</label>
              <div className="md:col-span-2">
                <input
                  type={c.tipo === 'texto' ? 'text' : 'number'}
                  step={c.tipo === 'texto' ? undefined : 'any'}
                  className="w-full md:w-72 bg-[#0b0f19] border border-gray-700 rounded-lg p-2"
                  value={config[c.key] ?? ''}
                  onChange={(e) => cambiar(c.key, e.target.value)}
                />
                <p className="text-gray-500 text-xs mt-1">{c.ayuda}</p>
              </div>
            </div>
          ))}
        </div>
      ))}

      <button
        onClick={guardar}
        disabled={guardando}
        className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 px-4 py-2 rounded-lg font-medium"
      >
        {guardando ? 'Guardando...' : 'Guardar cambios'}
      </button>
    </div>
  )
}
