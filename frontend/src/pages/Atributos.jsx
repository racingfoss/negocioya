import { useEffect, useState } from 'react'
import api, { getErrorMessage } from '../api'

export default function Atributos() {
  const [atributos, setAtributos] = useState([])
  const [nombre, setNombre] = useState('')
  const [nuevoValor, setNuevoValor] = useState({}) // atributo_id -> texto en edición
  const [error, setError] = useState('')

  const cargar = () => api.get('/atributos').then((r) => setAtributos(r.data))
  useEffect(() => {
    cargar()
  }, [])

  const crearAtributo = async () => {
    setError('')
    if (!nombre.trim()) return
    try {
      await api.post('/atributos', { nombre })
      setNombre('')
      cargar()
    } catch (e) {
      setError(getErrorMessage(e))
    }
  }

  const borrarAtributo = async (id) => {
    if (!confirm('¿Borrar este atributo? También se van a borrar sus valores.')) return
    try {
      await api.delete(`/atributos/${id}`)
      cargar()
    } catch (e) {
      setError(getErrorMessage(e))
    }
  }

  const agregarValor = async (atributoId) => {
    const valor = (nuevoValor[atributoId] || '').trim()
    if (!valor) return
    try {
      await api.post(`/atributos/${atributoId}/valores`, { valor })
      setNuevoValor({ ...nuevoValor, [atributoId]: '' })
      cargar()
    } catch (e) {
      setError(getErrorMessage(e))
    }
  }

  const borrarValor = async (valorId) => {
    if (!confirm('¿Borrar este valor?')) return
    try {
      await api.delete(`/atributos/valores/${valorId}`)
      cargar()
    } catch (e) {
      setError(getErrorMessage(e))
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold flex items-center gap-2">🏷️ Atributos de Variante</h1>
      <p className="text-gray-400 text-sm">
        Definí acá los atributos que después vas a poder usar para armar variantes en el Catálogo (ej: "Talle" con
        valores S/M/L, "Color" con Verde/Azul). Se cargan una sola vez y se reutilizan entre productos.
      </p>

      <div className="bg-[#151b2b] rounded-xl p-5 space-y-3 max-w-lg">
        <h2 className="font-bold">+ Añadir Atributo</h2>
        {error && <p className="text-red-400 text-sm">{error}</p>}
        <div className="flex gap-2">
          <input
            className="flex-1 bg-[#0b0f19] border border-gray-700 rounded-lg p-2"
            placeholder="Nombre (ej: Talle)"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && crearAtributo()}
          />
          <button onClick={crearAtributo} className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg font-medium">
            + Añadir
          </button>
        </div>
      </div>

      <div className="space-y-4">
        {atributos.map((a) => (
          <div key={a.id} className="bg-[#151b2b] rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-lg">{a.nombre}</h3>
              <button onClick={() => borrarAtributo(a.id)} className="text-red-400 hover:underline text-sm">
                Borrar atributo
              </button>
            </div>
            <div className="flex flex-wrap gap-2 mb-3">
              {a.valores.map((v) => (
                <span
                  key={v.id}
                  className="bg-[#0b0f19] border border-gray-700 rounded-full px-3 py-1 text-sm flex items-center gap-2"
                >
                  {v.valor}
                  <button onClick={() => borrarValor(v.id)} className="text-red-400 hover:text-red-300">
                    ×
                  </button>
                </span>
              ))}
              {a.valores.length === 0 && <span className="text-gray-500 text-sm">Todavía no tiene valores.</span>}
            </div>
            <div className="flex gap-2 max-w-sm">
              <input
                className="flex-1 bg-[#0b0f19] border border-gray-700 rounded-lg p-2 text-sm"
                placeholder="Nuevo valor (ej: M)"
                value={nuevoValor[a.id] || ''}
                onChange={(e) => setNuevoValor({ ...nuevoValor, [a.id]: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && agregarValor(a.id)}
              />
              <button
                onClick={() => agregarValor(a.id)}
                className="bg-gray-700 hover:bg-gray-600 px-3 py-2 rounded-lg text-sm"
              >
                + Valor
              </button>
            </div>
          </div>
        ))}
        {atributos.length === 0 && (
          <p className="text-gray-500 text-sm">Todavía no cargaste atributos.</p>
        )}
      </div>
    </div>
  )
}
