import axios from 'axios'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const api = axios.create({ baseURL: API_URL, timeout: 10000 })

/**
 * Convierte cualquier error de axios en un string legible.
 * FastAPI puede devolver `detail` como string (errores de negocio)
 * o como lista de objetos (errores de validación 422) — hay que contemplar ambos.
 * Si no hay respuesta del servidor (red caída, URL mal apuntada, CORS), también avisa.
 */
export function getErrorMessage(e) {
  if (!e.response) {
    return `No se pudo conectar con la API (${API_URL}). Verificá que el backend esté corriendo y que la URL sea accesible desde tu navegador.`
  }
  const detail = e.response.data?.detail
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    return detail.map((d) => `${(d.loc || []).join('.')}: ${d.msg}`).join(' | ')
  }
  return `Error ${e.response.status} al comunicarse con la API.`
}

export default api
