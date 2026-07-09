import { useEffect, useState } from 'react'
import api, { getErrorMessage } from '../api'

export default function CostosFijos() {
  const [items, setItems] = useState([])
  const [concepto, setConcepto] = useState('')
  const [monto, setMonto] = useState('')
  const [editId, setEditId] = useState(null)
  const [error, setError] = useState('')

  const cargar = () => api.get('/costos-fijos').then((r) => setItems(r.data))
  useEffect(() => {
    cargar()
  }, [])

  const total = items.reduce((acc, i) => acc + Number(i.monto), 0)

  const guardar = async () => {
    setError('')
    const payload = { concepto, monto: Number(monto) }
    try {
      if (editId) await api.put(`/costos-fijos/${editId}`, payload)
      else await api.post('/costos-fijos', payload)
      setConcepto('')
      setMonto('')
      setEditId(null)
      cargar()
    } catch (e) {
      setError(getErrorMessage(e))
    }
  }

  const editar = (i) => {
    setEditId(i.id)
    setConcepto(i.concepto)
    setMonto(i.monto)
  }

  const borrar = async (id) => {
    if (!confirm('¿Borrar este costo fijo?')) return
    try {
      await api.delete(`/costos-fijos/${id}`)
      cargar()
    } catch (e) {
      setError(getErrorMessage(e))
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold flex items-center gap-2">🔧 Configuración de Estructura Fija</h1>
      <p className="text-xl">
        Gastos Operativos Fijos Totales: <b>${total.toLocaleString('es-AR')}</b> / mes
      </p>

      <div className="bg-[#151b2b] rounded-xl p-5 space-y-3 max-w-lg">
        <h2 className="font-bold">{editId ? 'Editar Costo Fijo' : '+ Añadir Costo Fijo'}</h2>
        {error && <p className="text-red-400 text-sm">{error}</p>}
        <input
          className="w-full bg-[#0b0f19] border border-gray-700 rounded-lg p-2"
          placeholder="Concepto (ej: Alquiler)"
          value={concepto}
          onChange={(e) => setConcepto(e.target.value)}
        />
        <input
          type="number"
          className="w-full bg-[#0b0f19] border border-gray-700 rounded-lg p-2"
          placeholder="Monto ($)"
          value={monto}
          onChange={(e) => setMonto(e.target.value)}
        />
        <div className="flex gap-2">
          <button onClick={guardar} className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg font-medium">
            {editId ? 'Guardar cambios' : '+ Añadir Costo Fijo'}
          </button>
          {editId && (
            <button
              onClick={() => {
                setEditId(null)
                setConcepto('')
                setMonto('')
              }}
              className="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg"
            >
              Cancelar
            </button>
          )}
        </div>
      </div>

      <div className="bg-[#151b2b] rounded-xl p-5 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-400 border-b border-gray-700">
              <th className="py-2">ID</th>
              <th>Concepto</th>
              <th>Monto</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id} className="border-b border-gray-800">
                <td className="py-2">{i.id}</td>
                <td>{i.concepto}</td>
                <td>${Number(i.monto).toLocaleString('es-AR')}</td>
                <td className="text-right space-x-2">
                  <button onClick={() => editar(i)} className="text-blue-400 hover:underline">
                    Editar
                  </button>
                  <button onClick={() => borrar(i.id)} className="text-red-400 hover:underline">
                    Borrar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
