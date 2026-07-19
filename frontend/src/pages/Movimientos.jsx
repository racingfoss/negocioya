import { useEffect, useState } from 'react'
import api, { getErrorMessage } from '../api'
import { aplanarArbol, etiquetaIndentada } from '../utils/categorias'

const nowLocal = () => {
  const d = new Date()
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 16) // formato datetime-local: YYYY-MM-DDTHH:mm
}

// crypto.randomUUID() requiere contexto seguro (https o localhost) en varios navegadores — este
// panel se accede seguido por IP de LAN sobre http (ver CLAUDE.md, nota de VITE_API_URL), donde
// esa función puede no existir. Fallback simple si no está disponible.
const generarSesionId = () =>
  crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`

const empty = {
  tipo: 'Venta',
  categoria_id: '',
  producto_id: '',
  cantidad: 1,
  monto: '',
  concepto: '',
  fecha: nowLocal(),
}

export default function Movimientos() {
  const [movimientos, setMovimientos] = useState([])
  const [productos, setProductos] = useState([])
  const [categorias, setCategorias] = useState([])
  const [stockProductos, setStockProductos] = useState([])
  const [form, setForm] = useState(empty)
  const [editId, setEditId] = useState(null)
  const [montoEditadoManualmente, setMontoEditadoManualmente] = useState(false)
  const [error, setError] = useState('')

  // Selectores en cascada para resolver la variante (si el producto elegido tiene variantes)
  const [atributosProducto, setAtributosProducto] = useState([])
  const [variantesProducto, setVariantesProducto] = useState([])
  const [valoresElegidos, setValoresElegidos] = useState({}) // atributo_id -> valor_id
  const [edicionVarianteId, setEdicionVarianteId] = useState(null)
  const [varianteIdOriginal, setVarianteIdOriginal] = useState(null)
  // venta original en edición: para no contar su propia cantidad como "ya vendida" al topear stock
  const [ventaOriginal, setVentaOriginal] = useState(null) // { productoId, varianteId, cantidad }

  // Carrito de un pedido de mostrador en armado (tipo Venta, sin estar editando un Movimiento
  // existente): se van agregando ítems acá y recién al confirmar se manda todo junto a POST /pedidos.
  const [itemsPedido, setItemsPedido] = useState([])
  const [facturarArca, setFacturarArca] = useState(false)
  const [clienteNombreCarrito, setClienteNombreCarrito] = useState('')
  // Identifica este carrito en armado ante el backend de reservas de stock (POST/DELETE /reservas):
  // se genera al agregar el primer ítem de un carrito vacío y se resetea al confirmar/cancelar.
  const [sesionId, setSesionId] = useState(null)
  // true si itemsPedido se reconstruyó desde reservas activas del backend (ver useEffect de abajo),
  // para avisarle a la usuaria que no es un carrito nuevo vacío.
  const [carritoRecuperado, setCarritoRecuperado] = useState(false)

  const cargar = () => {
    api.get('/movimientos').then((r) => setMovimientos(r.data))
    api.get('/productos', { params: { solo_activos: true } }).then((r) => setProductos(r.data))
    api.get('/categorias').then((r) => setCategorias(r.data))
    api.get('/stock/productos').then((r) => setStockProductos(r.data))
  }
  useEffect(() => {
    cargar()
  }, [])

  // Si al entrar a la pantalla ya hay reservas de stock activas (ej. la usuaria armó un pedido y
  // refrescó la página antes de confirmarlo o cancelarlo), se reconstruye el carrito visual a
  // partir de esas reservas en vez de perderlo — la reserva en Postgres es la fuente de verdad,
  // el sesionId en memoria de React no. Sin localStorage: se arma 100% desde GET /reservas.
  useEffect(() => {
    api.get('/reservas').then((r) => {
      const activas = r.data
      if (activas.length === 0) return
      // se queda con la sesión más reciente (primera, ya viene ordenado por creado_en desc) —
      // cubre el caso raro de dos carritos activos a la vez sin agregar más complejidad.
      const sesionMasReciente = activas[0].sesion_id
      const deEstaSesion = activas.filter((a) => a.sesion_id === sesionMasReciente)
      setSesionId(sesionMasReciente)
      setItemsPedido(
        deEstaSesion.map((a) => ({
          key: `${a.producto_id}-${a.variante_id ?? 'sv'}-${a.id}`,
          producto_id: a.producto_id,
          variante_id: a.variante_id,
          nombre_producto: a.nombre_producto,
          descripcion_variante: a.descripcion_variante,
          cantidad: a.cantidad,
          precio_unitario: Number(a.precio_unitario),
        }))
      )
      setCarritoRecuperado(true)
    })
  }, [])

  const categoriasArbol = aplanarArbol(categorias)
  const productoSeleccionado = productos.find((p) => String(p.id) === String(form.producto_id))
  const productosFiltrados = form.categoria_id
    ? productos.filter((p) => String(p.categoria_id) === String(form.categoria_id))
    : productos

  // true mientras se está armando un pedido nuevo de mostrador (no se está editando un Movimiento
  // ya existente) — es cuando el formulario de Venta pasa a agregar ítems al carrito en vez de
  // guardar directo.
  const enModoCarrito = form.tipo === 'Venta' && !editId

  useEffect(() => {
    setValoresElegidos({})
    if (form.tipo === 'Venta' && productoSeleccionado?.tiene_variantes) {
      Promise.all([
        api.get(`/productos/${productoSeleccionado.id}/atributos`),
        api.get(`/productos/${productoSeleccionado.id}/variantes`),
      ]).then(([{ data: atribs }, { data: variantes }]) => {
        setAtributosProducto(atribs)
        setVariantesProducto(variantes)
      })
    } else {
      setAtributosProducto([])
      setVariantesProducto([])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.producto_id, form.tipo])

  const varianteResuelta =
    atributosProducto.length > 0 && atributosProducto.every((a) => valoresElegidos[a.atributo_id])
      ? variantesProducto.find((v) =>
          atributosProducto.every((a) =>
            v.valores.some(
              (x) => x.atributo_id === a.atributo_id && x.valor_atributo_id === Number(valoresElegidos[a.atributo_id])
            )
          )
        )
      : null

  // Igual que Compras.jsx: el combo de un atributo solo ofrece valores que ya existen en alguna
  // Variante real de este producto, filtrado en cascada por lo elegido en los atributos anteriores.
  // A diferencia de Compras, acá además se marca cada opción con si tiene stock (conStock): en Ventas
  // no tiene sentido dejar elegir a ciegas una combinación sin unidades disponibles.
  const opcionesParaAtributo = (atributo, index) => {
    const previos = atributosProducto.slice(0, index)
    const candidatas = variantesProducto.filter((v) =>
      previos.every((pa) => {
        const elegido = valoresElegidos[pa.atributo_id]
        if (!elegido) return true
        return v.valores.some((x) => x.atributo_id === pa.atributo_id && x.valor_atributo_id === Number(elegido))
      })
    )
    const vistos = new Map()
    candidatas.forEach((v) => {
      const match = v.valores.find((x) => x.atributo_id === atributo.atributo_id)
      if (match) {
        const previo = vistos.get(match.valor_atributo_id)
        const conStock = Number(v.stock_actual) > 0 || (previo?.conStock ?? false)
        vistos.set(match.valor_atributo_id, { id: match.valor_atributo_id, valor: match.valor, conStock })
      }
    })
    return Array.from(vistos.values())
  }

  const elegirValorAtributo = (atributoId, index, valor) => {
    const nuevos = { ...valoresElegidos, [atributoId]: valor }
    // si cambia un atributo, los siguientes (en orden) pueden dejar de corresponder a una variante real
    atributosProducto.slice(index + 1).forEach((a) => delete nuevos[a.atributo_id])
    setValoresElegidos(nuevos)
  }

  const opcionesPrimerAtributo = atributosProducto.length > 0 ? opcionesParaAtributo(atributosProducto[0], 0) : []
  const sinStockEnNinguna =
    atributosProducto.length > 0 &&
    opcionesPrimerAtributo.length > 0 &&
    opcionesPrimerAtributo.every((o) => !o.conStock)

  // Tope de cantidad: stock_actual de la variante elegida (si el producto tiene variantes) o del
  // producto entero (si no). Al editar una Venta ya cargada, se le suma de vuelta su propia cantidad
  // original (ya está descontada del stock actual) para no bloquear la edición de su propio registro.
  const stockActualBase = productoSeleccionado?.tiene_variantes
    ? varianteResuelta?.stock_actual
    : stockProductos.find((s) => s.producto_id === productoSeleccionado?.id)?.stock_actual
  const esLaVentaOriginal =
    editId &&
    ventaOriginal &&
    String(form.producto_id) === String(ventaOriginal.productoId) &&
    (varianteResuelta?.id || null) === ventaOriginal.varianteId
  const stockDisponible =
    stockActualBase == null ? null : stockActualBase + (esLaVentaOriginal ? ventaOriginal.cantidad : 0)

  // En modo carrito, el tope real también descuenta lo que ya se agregó al pedido en armado para
  // esta misma variante/producto (si no, se podría agregar 2 líneas de 3 unidades contra un stock
  // de 4 sin que el frontend avise antes de confirmar).
  const yaEnCarrito = itemsPedido
    .filter((i) => i.producto_id === productoSeleccionado?.id && (i.variante_id || null) === (varianteResuelta?.id || null))
    .reduce((acc, i) => acc + i.cantidad, 0)
  const stockDisponibleEfectivo = enModoCarrito
    ? (stockDisponible == null ? null : stockDisponible - yaEnCarrito)
    : stockDisponible

  // al editar un movimiento ya cargado, prellenar los selectores con la variante que tenía
  useEffect(() => {
    if (edicionVarianteId && variantesProducto.length > 0) {
      const v = variantesProducto.find((x) => x.id === edicionVarianteId)
      if (v) {
        const elegidos = {}
        v.valores.forEach((x) => { elegidos[x.atributo_id] = x.valor_atributo_id })
        setValoresElegidos(elegidos)
      }
      setEdicionVarianteId(null)
    }
  }, [variantesProducto, edicionVarianteId])

  // Auto-calcula el monto = cantidad x precio de venta del producto, mientras el usuario no lo haya tocado a mano.
  useEffect(() => {
    if (form.tipo === 'Venta' && productoSeleccionado && !montoEditadoManualmente) {
      const total = Number(form.cantidad || 0) * Number(productoSeleccionado.precio_venta)
      setForm((f) => ({ ...f, monto: total ? String(total) : '' }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.producto_id, form.cantidad, form.tipo])

  const cambiarTipo = (tipo) => {
    setMontoEditadoManualmente(false)
    setValoresElegidos({})
    setVentaOriginal(null)
    setForm({ ...empty, tipo, fecha: form.fecha })
  }

  const guardar = async () => {
    setError('')
    if (form.tipo === 'Venta' && productoSeleccionado?.tiene_variantes && variantesProducto.length === 0 && !editId) {
      setError('Este producto no tiene variantes cargadas todavía, configuralas en Catálogo antes de registrar la venta.')
      return
    }
    if (form.tipo === 'Venta' && atributosProducto.length > 0 && !varianteResuelta && !editId) {
      setError('Elegí un valor para cada atributo, así se puede resolver la variante de la venta.')
      return
    }
    if (form.tipo === 'Venta' && stockDisponible != null && Number(form.cantidad || 0) > stockDisponible) {
      setError(`No hay stock suficiente: disponible ${stockDisponible}, pediste ${form.cantidad}.`)
      return
    }
    const payload = {
      tipo: form.tipo,
      concepto: form.concepto || null,
      cantidad: form.tipo === 'Venta' ? Number(form.cantidad || 1) : null,
      monto: Number(form.monto),
      producto_id: form.tipo === 'Venta' ? Number(form.producto_id) : null,
      variante_id: form.tipo === 'Venta' ? varianteResuelta?.id || (editId ? varianteIdOriginal : null) : null,
      fecha: form.fecha ? new Date(form.fecha).toISOString() : null,
    }
    try {
      if (editId) await api.put(`/movimientos/${editId}`, payload)
      else await api.post('/movimientos', payload)
      setForm({ ...empty, fecha: nowLocal() })
      setMontoEditadoManualmente(false)
      setEditId(null)
      setVarianteIdOriginal(null)
      setVentaOriginal(null)
      cargar()
    } catch (e) {
      setError(getErrorMessage(e))
    }
  }

  // Agrega el ítem resuelto (producto + variante si aplica + cantidad) al pedido en armado, en vez
  // de guardarlo directo — mismas validaciones que guardar() tenía para una Venta nueva, pero contra
  // el tope ajustado por lo que ya está en el carrito. Antes de tocar el carrito visual, reserva el
  // stock contra el backend (POST /reservas) — si otra sesión (otro pedido en armado, o el checkout
  // de e-commerce) ya se llevó ese stock, el backend rechaza y acá no se agrega la línea.
  const agregarAlCarrito = async () => {
    setError('')
    if (!productoSeleccionado) {
      setError('Elegí un producto.')
      return
    }
    if (productoSeleccionado.tiene_variantes && variantesProducto.length === 0) {
      setError('Este producto no tiene variantes cargadas todavía, configuralas en Catálogo antes de registrar la venta.')
      return
    }
    if (atributosProducto.length > 0 && !varianteResuelta) {
      setError('Elegí un valor para cada atributo, así se puede resolver la variante de la venta.')
      return
    }
    const cantidad = Number(form.cantidad || 0)
    if (cantidad <= 0) {
      setError('La cantidad tiene que ser mayor a 0.')
      return
    }
    if (stockDisponibleEfectivo != null && cantidad > stockDisponibleEfectivo) {
      setError(
        `No hay stock suficiente: disponible ${stockDisponibleEfectivo} (descontando lo ya agregado a este pedido), pediste ${cantidad}.`
      )
      return
    }
    const varianteId = varianteResuelta?.id || null
    const existente = itemsPedido.find(
      (i) => i.producto_id === productoSeleccionado.id && (i.variante_id || null) === varianteId
    )
    // reservar_stock reemplaza el total reservado de la línea, no lo suma — hay que mandar la
    // cantidad TOTAL que va a quedar en el carrito para esta línea, no solo lo que se agrega ahora.
    const cantidadTotalLinea = (existente?.cantidad || 0) + cantidad
    const sesion = sesionId || generarSesionId()
    if (!sesionId) setSesionId(sesion)
    try {
      await api.post('/reservas', {
        sesion_id: sesion,
        producto_id: productoSeleccionado.id,
        variante_id: varianteId,
        cantidad: cantidadTotalLinea,
      })
    } catch (e) {
      setError(getErrorMessage(e))
      return
    }
    const descripcionVariante = varianteResuelta
      ? atributosProducto
          .map((a) => varianteResuelta.valores.find((x) => x.atributo_id === a.atributo_id)?.valor)
          .filter(Boolean)
          .join(' / ')
      : null
    setItemsPedido((prev) => {
      // si ya hay una línea del mismo producto+variante, se suma la cantidad en vez de duplicar la línea
      if (existente) {
        return prev.map((i) => (i.key === existente.key ? { ...i, cantidad: cantidadTotalLinea } : i))
      }
      return [
        ...prev,
        {
          key: `${productoSeleccionado.id}-${varianteId ?? 'sv'}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          producto_id: productoSeleccionado.id,
          variante_id: varianteId,
          nombre_producto: productoSeleccionado.nombre,
          descripcion_variante: descripcionVariante,
          cantidad: cantidadTotalLinea,
          precio_unitario: Number(productoSeleccionado.precio_venta),
        },
      ]
    })
    setForm((f) => ({ ...f, producto_id: '', cantidad: 1 }))
    setValoresElegidos({})
  }

  // Best-effort: si el DELETE de la reserva falla (ej. error de red), igual se saca la línea del
  // carrito visual — la reserva vieja se autolimpia sola por TTL, no tiene sentido trabar a la
  // usuaria por un error de un cleanup que no es crítico.
  const sacarDelCarrito = async (key) => {
    const item = itemsPedido.find((i) => i.key === key)
    if (item && sesionId) {
      try {
        await api.delete('/reservas', {
          params: { sesion_id: sesionId, producto_id: item.producto_id, variante_id: item.variante_id },
        })
      } catch (e) {
        setError(getErrorMessage(e))
      }
    }
    setItemsPedido((prev) => prev.filter((i) => i.key !== key))
  }

  // Vacía el carrito en armado sin confirmar el pedido — libera todas las reservas de esta sesión
  // de una, para no depender solo del vencimiento por tiempo si Florencia decide no continuar.
  const cancelarPedido = async () => {
    if (sesionId) {
      try {
        await api.delete('/reservas', { params: { sesion_id: sesionId } })
      } catch (e) {
        setError(getErrorMessage(e))
      }
    }
    setItemsPedido([])
    setFacturarArca(false)
    setClienteNombreCarrito('')
    setSesionId(null)
    setCarritoRecuperado(false)
  }

  const totalCarrito = itemsPedido.reduce((acc, i) => acc + i.cantidad * i.precio_unitario, 0)

  const confirmarPedido = async () => {
    setError('')
    try {
      await api.post('/pedidos', {
        cliente_nombre: clienteNombreCarrito || null,
        facturar_arca: facturarArca,
        sesion_id: sesionId,
        lineas: itemsPedido.map((i) => ({ producto_id: i.producto_id, variante_id: i.variante_id, cantidad: i.cantidad })),
      })
      setItemsPedido([])
      setFacturarArca(false)
      setClienteNombreCarrito('')
      setSesionId(null)
      setCarritoRecuperado(false)
      setForm({ ...empty, fecha: nowLocal() })
      setMontoEditadoManualmente(false)
      cargar()
    } catch (e) {
      // no se vacía el carrito: el usuario puede sacar el ítem problemático y reintentar
      setError(getErrorMessage(e))
    }
  }

  const editar = (m) => {
    setEditId(m.id)
    setMontoEditadoManualmente(true) // no pisar el monto ya guardado al editar
    setEdicionVarianteId(m.variante_id || null)
    setVarianteIdOriginal(m.variante_id || null)
    setVentaOriginal(
      m.tipo === 'Venta'
        ? { productoId: m.producto_id, varianteId: m.variante_id || null, cantidad: m.cantidad || 0 }
        : null
    )
    const fechaLocal = new Date(m.fecha)
    fechaLocal.setMinutes(fechaLocal.getMinutes() - fechaLocal.getTimezoneOffset())
    setForm({
      tipo: m.tipo,
      categoria_id: m.producto?.categoria_id || '',
      producto_id: m.producto_id || '',
      cantidad: m.cantidad || 1,
      monto: m.monto,
      concepto: m.concepto || '',
      fecha: fechaLocal.toISOString().slice(0, 16),
    })
  }

  const borrar = async (id) => {
    if (!confirm('¿Borrar este movimiento?')) return
    try {
      await api.delete(`/movimientos/${id}`)
      cargar()
    } catch (e) {
      setError(getErrorMessage(e))
    }
  }

  const tipoColor = { Venta: 'text-green-400', Ingreso: 'text-blue-400', Egreso: 'text-red-400' }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold flex items-center gap-2">💰 Gestión de Caja Reales</h1>

      <div className="bg-[#151b2b] rounded-xl p-5 space-y-3">
        <h2 className="font-bold">
          {editId ? 'Editar Movimiento' : enModoCarrito ? 'Agregar ítem al pedido' : 'Registrar Movimiento'}
        </h2>
        {error && <p className="text-red-400 text-sm">{error}</p>}

        <div className="flex gap-2">
          {['Venta', 'Ingreso', 'Egreso'].map((t) => (
            <button
              key={t}
              onClick={() => cambiarTipo(t)}
              className={`px-4 py-2 rounded-lg text-sm font-medium ${
                form.tipo === t ? 'bg-blue-600 text-white' : 'bg-[#0b0f19] border border-gray-700 text-gray-300'
              }`}
            >
              {t === 'Venta' ? '🛍️ Venta' : t === 'Ingreso' ? '➕ Otro Ingreso' : '➖ Egreso'}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {form.tipo === 'Venta' && (
            <>
              <select
                className="bg-[#0b0f19] border border-gray-700 rounded-lg p-2"
                value={form.categoria_id}
                onChange={(e) => setForm({ ...form, categoria_id: e.target.value, producto_id: '' })}
              >
                <option value="">Todas las categorías</option>
                {categoriasArbol.map((c) => (
                  <option key={c.id} value={c.id}>
                    {etiquetaIndentada(c)}
                  </option>
                ))}
              </select>
              <select
                className="bg-[#0b0f19] border border-gray-700 rounded-lg p-2"
                value={form.producto_id}
                onChange={(e) => {
                  setMontoEditadoManualmente(false)
                  setForm({ ...form, producto_id: e.target.value })
                }}
              >
                <option value="">Seleccionar producto...</option>
                {productosFiltrados.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre} (${p.precio_venta})
                  </option>
                ))}
              </select>
              {!sinStockEnNinguna &&
                atributosProducto.map((a, i) => (
                  <select
                    key={a.atributo_id}
                    className="bg-[#0b0f19] border border-gray-700 rounded-lg p-2"
                    value={valoresElegidos[a.atributo_id] || ''}
                    onChange={(e) => elegirValorAtributo(a.atributo_id, i, e.target.value)}
                  >
                    <option value="">{a.atributo}...</option>
                    {opcionesParaAtributo(a, i).map((v) => (
                      <option key={v.id} value={v.id} disabled={!v.conStock}>
                        {v.valor}
                        {!v.conStock ? ' (sin stock)' : ''}
                      </option>
                    ))}
                  </select>
                ))}
              <input
                type="number"
                min="1"
                max={stockDisponibleEfectivo ?? undefined}
                className="bg-[#0b0f19] border border-gray-700 rounded-lg p-2"
                placeholder="Cantidad vendida"
                value={form.cantidad}
                onChange={(e) => {
                  setMontoEditadoManualmente(false)
                  setForm({ ...form, cantidad: e.target.value })
                }}
              />
            </>
          )}

          {!enModoCarrito && (
            <>
              <input
                type="number"
                className="bg-[#0b0f19] border border-gray-700 rounded-lg p-2"
                placeholder="Monto ($)"
                value={form.monto}
                onChange={(e) => {
                  setMontoEditadoManualmente(true)
                  setForm({ ...form, monto: e.target.value })
                }}
              />
              <input
                type="datetime-local"
                className="bg-[#0b0f19] border border-gray-700 rounded-lg p-2"
                value={form.fecha}
                onChange={(e) => setForm({ ...form, fecha: e.target.value })}
              />
              <input
                className="bg-[#0b0f19] border border-gray-700 rounded-lg p-2 md:col-span-2"
                placeholder="Detalle / concepto (opcional)"
                value={form.concepto}
                onChange={(e) => setForm({ ...form, concepto: e.target.value })}
              />
            </>
          )}
        </div>

        {form.tipo === 'Venta' && productoSeleccionado && (
          <p className="text-xs text-gray-500">
            Precio de venta del producto: ${productoSeleccionado.precio_venta}
            {!enModoCarrito && ' · el monto se calcula solo (cantidad × precio), pero lo podés pisar a mano si vendiste con descuento.'}
          </p>
        )}
        {form.tipo === 'Venta' && productoSeleccionado?.tiene_variantes && variantesProducto.length === 0 && (
          <p className="text-sm text-amber-400 bg-amber-950/30 border border-amber-800 rounded-lg p-3">
            Este producto no tiene variantes cargadas todavía, configuralas en Catálogo antes de registrar la venta.
          </p>
        )}
        {form.tipo === 'Venta' && sinStockEnNinguna && (
          <p className="text-sm text-red-400 bg-red-950/30 border border-red-800 rounded-lg p-3">
            Este producto no tiene stock disponible en ninguna variante.
          </p>
        )}
        {form.tipo === 'Venta' && atributosProducto.length > 0 && !sinStockEnNinguna && !varianteResuelta && !editId && (
          <p className="text-xs text-amber-400">
            Elegí un valor para cada atributo para resolver la variante puntual de esta venta.
          </p>
        )}
        {form.tipo === 'Venta' && stockDisponibleEfectivo != null && Number(form.cantidad || 0) > stockDisponibleEfectivo && (
          <p className="text-xs text-red-400">
            Stock disponible{enModoCarrito && yaEnCarrito > 0 ? ' (descontando lo ya agregado a este pedido)' : ''}:{' '}
            {stockDisponibleEfectivo}. La cantidad cargada lo supera.
          </p>
        )}

        <div className="flex gap-2">
          {enModoCarrito ? (
            <button onClick={agregarAlCarrito} className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg font-medium">
              + Agregar al pedido
            </button>
          ) : (
            <button onClick={guardar} className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg font-medium">
              {editId ? 'Guardar cambios' : '+ Registrar Movimiento'}
            </button>
          )}
          {editId && (
            <button
              onClick={() => {
                setEditId(null)
                setMontoEditadoManualmente(false)
                setVentaOriginal(null)
                setForm({ ...empty, fecha: nowLocal() })
              }}
              className="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg"
            >
              Cancelar
            </button>
          )}
        </div>
      </div>

      {enModoCarrito && (
        <div className="bg-[#151b2b] rounded-xl p-5 space-y-3">
          <h2 className="font-bold">Pedido en armado</h2>
          {carritoRecuperado && itemsPedido.length > 0 && (
            <p className="text-sm text-amber-400 bg-amber-950/30 border border-amber-800 rounded-lg p-3">
              Recuperamos un pedido que tenías en armado (todavía no lo habías confirmado). Podés
              seguir agregando ítems, sacar alguno, cancelarlo o confirmarlo.
            </p>
          )}
          {itemsPedido.length === 0 ? (
            <p className="text-gray-500 text-sm">Todavía no agregaste ningún ítem a este pedido.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-400 border-b border-gray-700">
                    <th className="py-2">Producto</th>
                    <th>Cantidad</th>
                    <th>Precio unit.</th>
                    <th>Subtotal</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {itemsPedido.map((it) => (
                    <tr key={it.key} className="border-b border-gray-800">
                      <td className="py-2">
                        {it.nombre_producto}
                        {it.descripcion_variante && <span className="text-gray-400"> — {it.descripcion_variante}</span>}
                      </td>
                      <td>{it.cantidad}</td>
                      <td>${it.precio_unitario.toLocaleString('es-AR')}</td>
                      <td>${(it.cantidad * it.precio_unitario).toLocaleString('es-AR')}</td>
                      <td className="text-right">
                        <button onClick={() => sacarDelCarrito(it.key)} className="text-red-400 hover:underline">
                          Sacar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-right font-bold mt-2">Total: ${totalCarrito.toLocaleString('es-AR')}</p>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-gray-800">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={facturarArca} onChange={(e) => setFacturarArca(e.target.checked)} />
              Facturar (ARCA)
            </label>
            <input
              className="bg-[#0b0f19] border border-gray-700 rounded-lg p-2 text-sm"
              placeholder="Cliente (opcional)"
              value={clienteNombreCarrito}
              onChange={(e) => setClienteNombreCarrito(e.target.value)}
            />
            <button
              onClick={cancelarPedido}
              disabled={itemsPedido.length === 0}
              className="bg-gray-700 hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed px-4 py-2 rounded-lg font-medium ml-auto"
            >
              Cancelar pedido
            </button>
            <button
              onClick={confirmarPedido}
              disabled={itemsPedido.length === 0}
              className="bg-green-600 hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed px-4 py-2 rounded-lg font-medium"
            >
              Confirmar venta
            </button>
          </div>
        </div>
      )}

      <div className="bg-[#151b2b] rounded-xl p-5 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-400 border-b border-gray-700">
              <th className="py-2">Fecha</th>
              <th>Tipo</th>
              <th>Producto</th>
              <th>Cantidad</th>
              <th>Monto</th>
              <th>Concepto</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {movimientos.map((m) => (
              <tr key={m.id} className="border-b border-gray-800">
                <td className="py-2">{new Date(m.fecha).toLocaleString('es-AR')}</td>
                <td className={tipoColor[m.tipo] || ''}>{m.tipo}</td>
                <td>{m.producto?.nombre || '—'}</td>
                <td>{m.cantidad || '—'}</td>
                <td>${Number(m.monto).toLocaleString('es-AR')}</td>
                <td className="text-gray-400">{m.concepto}</td>
                <td className="text-right space-x-2">
                  <button onClick={() => editar(m)} className="text-blue-400 hover:underline">
                    Editar
                  </button>
                  <button onClick={() => borrar(m.id)} className="text-red-400 hover:underline">
                    Borrar
                  </button>
                </td>
              </tr>
            ))}
            {movimientos.length === 0 && (
              <tr>
                <td colSpan={7} className="text-gray-500 py-4 text-center">
                  Todavía no hay movimientos registrados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
