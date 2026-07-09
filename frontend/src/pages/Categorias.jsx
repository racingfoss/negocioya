import { useEffect, useState } from 'react'
import api, { getErrorMessage } from '../api'

export default function Categorias() {
  const [categorias, setCategorias] = useState([])
  const [nombre, setNombre] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [editId, setEditId] = useState(null)
  const [error, setError] = useState('')

  const cargar = () => api.get('/categorias').then((r) => setCategorias(r.data))
  useEffect(() => {
    cargar()
  }, [])

  const guardar = async () => {
    setError('')
    try {
      if (editId) {
        await api.put(`/categorias/${editId}`, { nombre, descripcion })
      } else {
        await api.post('/categorias', { nombre, descripcion })
      }
      setNombre('')
      setDescripcion('')
      setEditId(null)
      cargar()
    } catch (e) {
      setError(getErrorMessage(e))
    }
  }

  const editar = (c) => {
    setEditId(c.id)
    setNombre(c.nombre)
    setDescripcion(c.descripcion || '')
  }

  const borrar = async (id) => {
    if (!confirm('¿Borrar esta categoría? Los productos que la tengan asignada van a quedar sin categoría.')) return
    try {
      await api.delete(`/categorias/${id}`)
      cargar()
    } catch (e) {
      setError(getErrorMessage(e))
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold flex items-center gap-2">🗂️ Categorías de Producto</h1>
      <p className="text-gray-400 text-sm">
        Agrupá tus prendas en familias (ej: Remeras, Jeans, Abrigos, Accesorios). Las categorías las creás y editás vos, no vienen predefinidas.
      </p>

      <div className="bg-[#151b2b] rounded-xl p-5 space-y-3 max-w-lg">
        <h2 className="font-bold">{editId ? 'Editar Categoría' : '+ Añadir Categoría'}</h2>
        {error && <p className="text-red-400 text-sm">{error}</p>}
        <input
          className="w-full bg-[#0b0f19] border border-gray-700 rounded-lg p-2"
          placeholder="Nombre (ej: Remeras)"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
        />
        <input
          className="w-full bg-[#0b0f19] border border-gray-700 rounded-lg p-2"
          placeholder="Descripción (opcional)"
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
        />
        <div className="flex gap-2">
          <button onClick={guardar} className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg font-medium">
            {editId ? 'Guardar cambios' : '+ Añadir Categoría'}
          </button>
          {editId && (
            <button
              onClick={() => {
                setEditId(null)
                setNombre('')
                setDescripcion('')
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
              <th>Nombre</th>
              <th>Descripción</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {categorias.map((c) => (
              <tr key={c.id} className="border-b border-gray-800">
                <td className="py-2">{c.id}</td>
                <td>{c.nombre}</td>
                <td className="text-gray-400">{c.descripcion}</td>
                <td className="text-right space-x-2">
                  <button onClick={() => editar(c)} className="text-blue-400 hover:underline">
                    Editar
                  </button>
                  <button onClick={() => borrar(c.id)} className="text-red-400 hover:underline">
                    Borrar
                  </button>
                </td>
              </tr>
            ))}
            {categorias.length === 0 && (
              <tr>
                <td colSpan={4} className="text-gray-500 py-4 text-center">
                  Todavía no cargaste categorías.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
