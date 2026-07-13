import { useRef, useState } from 'react'
import api, { getErrorMessage } from '../api'

export default function FotosProducto({ productoId, fotos, onChange }) {
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef(null)

  const fotosOrdenadas = [...fotos].sort((a, b) => a.orden - b.orden)

  const subir = async (e) => {
    const archivo = e.target.files[0]
    if (!archivo) return
    setError('')
    setCargando(true)
    const formData = new FormData()
    formData.append('archivo', archivo)
    try {
      await api.post(`/productos/${productoId}/fotos`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      onChange()
    } catch (e) {
      setError(getErrorMessage(e))
    } finally {
      setCargando(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const borrar = async (fotoId) => {
    if (!confirm('¿Borrar esta foto?')) return
    setError('')
    try {
      await api.delete(`/productos/${productoId}/fotos/${fotoId}`)
      onChange()
    } catch (e) {
      setError(getErrorMessage(e))
    }
  }

  const mover = async (index, direccion) => {
    const destino = index + direccion
    if (destino < 0 || destino >= fotosOrdenadas.length) return
    const nuevoOrden = [...fotosOrdenadas]
    ;[nuevoOrden[index], nuevoOrden[destino]] = [nuevoOrden[destino], nuevoOrden[index]]
    setError('')
    try {
      await api.put(`/productos/${productoId}/fotos/orden`, { orden_ids: nuevoOrden.map((f) => f.id) })
      onChange()
    } catch (e) {
      setError(getErrorMessage(e))
    }
  }

  return (
    <div className="space-y-3">
      <h2 className="font-bold">Fotos del producto</h2>
      {error && <p className="text-red-400 text-sm">{error}</p>}
      <div className="flex flex-wrap gap-3">
        {fotosOrdenadas.map((f, i) => (
          <div key={f.id} className="bg-[#0b0f19] border border-gray-700 rounded-lg p-2 space-y-1">
            <img
              src={`${api.defaults.baseURL}/fotos/${f.ruta_archivo}`}
              alt=""
              className="w-20 h-20 object-cover rounded-lg border border-gray-700"
            />
            {i === 0 && <p className="text-xs text-gray-500 text-center">Portada</p>}
            <div className="flex justify-center gap-2 text-xs">
              <button
                onClick={() => mover(i, -1)}
                disabled={i === 0}
                className="text-blue-400 hover:underline disabled:text-gray-600 disabled:no-underline"
              >
                ▲
              </button>
              <button
                onClick={() => mover(i, 1)}
                disabled={i === fotosOrdenadas.length - 1}
                className="text-blue-400 hover:underline disabled:text-gray-600 disabled:no-underline"
              >
                ▼
              </button>
              <button onClick={() => borrar(f.id)} className="text-red-400 hover:underline">
                Borrar
              </button>
            </div>
          </div>
        ))}
        {fotosOrdenadas.length === 0 && <p className="text-gray-500 text-sm">Todavía no subiste fotos.</p>}
      </div>
      <div>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={subir}
          disabled={cargando}
        />
        {cargando && <span className="text-xs text-gray-500 ml-2">Subiendo...</span>}
      </div>
      <p className="text-xs text-gray-500">JPG, PNG o WEBP, hasta 5MB. La primera foto es la portada.</p>
    </div>
  )
}
