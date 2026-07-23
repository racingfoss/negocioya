import { useEffect, useState } from 'react'
import api, { getErrorMessage } from '../api'
import { aplanarArbol, etiquetaIndentada } from '../utils/categorias'

const ESTADOS_BASE = ['Pendiente', 'Preparando', 'Entregado', 'Cancelado']

const opcionesEstado = (pedido) =>
  pedido.forma_entrega === 'Envío' ? [...ESTADOS_BASE.slice(0, 2), 'Enviado', ...ESTADOS_BASE.slice(2)] : [...ESTADOS_BASE.slice(0, 2), 'Listo para retirar', ...ESTADOS_BASE.slice(2)]

const facturaEmitida = (pedido) =>
  pedido.facturas?.find((f) => f.tipo_comprobante === 11 && f.estado === 'Emitida')

const esPendienteDeFacturar = (pedido) =>
  pedido.facturar_arca && !facturaEmitida(pedido) && pedido.estado !== 'Cancelado' && Number(pedido.monto_neto) > 0

export default function Pedidos() {
  const [pedidos, setPedidos] = useState([])
  const [error, setError] = useState('')
  const [facturando, setFacturando] = useState(new Set())
  const [soloPendientes, setSoloPendientes] = useState(false)
  const [actualizandoFacturarArca, setActualizandoFacturarArca] = useState(new Set())

  // Panel de devolución/cancelación (Fase D parte 1) — no hay modal en el proyecto, es una
  // sección condicional debajo de la tabla, mismo criterio que enModoCarrito en Movimientos.jsx.
  const [panelDevolucionId, setPanelDevolucionId] = useState(null)
  const [devolucionesPanel, setDevolucionesPanel] = useState([])
  const [cantidadesDevolver, setCantidadesDevolver] = useState({})
  const [motivoDevolucion, setMotivoDevolucion] = useState('')
  const [tipoDevolucion, setTipoDevolucion] = useState('Devolucion')
  const [devolviendo, setDevolviendo] = useState(new Set())
  const [errorPanel, setErrorPanel] = useState('')
  // Nota de Crédito (Fase D parte 2), Set de ids de Devolucion en vuelo — mismo patrón que
  // facturando/devolviendo, para que un doble click no dispare dos SOAP contra ARCA.
  const [emitiendoNC, setEmitiendoNC] = useState(new Set())

  // Panel de Cambio de producto: devolución del ítem original (Paso 1) + pedido nuevo con el ítem
  // de cambio (Paso 2), estado propio para no pisar el panel de devolución si coexistieran.
  const [panelCambioId, setPanelCambioId] = useState(null)
  const [devolucionesParaCambio, setDevolucionesParaCambio] = useState([])
  const [cambiosPanel, setCambiosPanel] = useState([])
  const [cantidadesCambiarDevolver, setCantidadesCambiarDevolver] = useState({})
  const [motivoCambio, setMotivoCambio] = useState('')
  const [cambiando, setCambiando] = useState(new Set())
  const [errorCambio, setErrorCambio] = useState('')
  const [mensajeCambioExito, setMensajeCambioExito] = useState('')

  // Catálogo para el Paso 2 (qué prenda entra) — Pedidos.jsx no lo trae para la pantalla normal,
  // se carga recién al abrir el panel de cambio. Selector categoría→producto→atributos→variante
  // copiado de Movimientos.jsx (mismo criterio ya usado entre Movimientos.jsx y Compras.jsx: cada
  // pantalla tiene su propia copia, no un hook compartido) — sin el mecanismo de reserva de stock,
  // que no aplica acá (un cambio es una acción atómica de un solo paso, no un carrito armado en el
  // tiempo).
  const [productosCambio, setProductosCambio] = useState([])
  const [categoriasCambio, setCategoriasCambio] = useState([])
  const [stockProductosCambio, setStockProductosCambio] = useState([])
  const [categoriaCambioId, setCategoriaCambioId] = useState('')
  const [productoCambioId, setProductoCambioId] = useState('')
  const [cantidadCambioNueva, setCantidadCambioNueva] = useState(1)
  const [atributosCambio, setAtributosCambio] = useState([])
  const [variantesCambio, setVariantesCambio] = useState([])
  const [valoresElegidosCambio, setValoresElegidosCambio] = useState({})
  const [itemsCambioNuevos, setItemsCambioNuevos] = useState([])

  useEffect(() => {
    api.get('/pedidos').then((r) => setPedidos(r.data)).catch((e) => setError(getErrorMessage(e)))
  }, [])

  const cambiarEstado = async (pedido, nuevoEstado) => {
    const anterior = pedido.estado
    setPedidos((prev) => prev.map((p) => (p.id === pedido.id ? { ...p, estado: nuevoEstado } : p)))
    try {
      await api.put(`/pedidos/${pedido.id}/estado`, { estado: nuevoEstado })
    } catch (e) {
      setError(getErrorMessage(e))
      setPedidos((prev) => prev.map((p) => (p.id === pedido.id ? { ...p, estado: anterior } : p)))
    }
  }

  const cambiarFacturarArca = async (pedido, nuevoValor) => {
    const anterior = pedido.facturar_arca
    setPedidos((prev) => prev.map((p) => (p.id === pedido.id ? { ...p, facturar_arca: nuevoValor } : p)))
    setActualizandoFacturarArca((prev) => new Set(prev).add(pedido.id))
    try {
      await api.put(`/pedidos/${pedido.id}/facturar-arca`, { facturar_arca: nuevoValor })
    } catch (e) {
      setError(getErrorMessage(e))
      setPedidos((prev) => prev.map((p) => (p.id === pedido.id ? { ...p, facturar_arca: anterior } : p)))
    } finally {
      setActualizandoFacturarArca((prev) => {
        const next = new Set(prev)
        next.delete(pedido.id)
        return next
      })
    }
  }

  const facturar = async (pedido) => {
    setError('')
    setFacturando((prev) => new Set(prev).add(pedido.id))
    try {
      // Timeout más largo que el default (10s) de la instancia `api`: esto dispara un SOAP
      // real contra ARCA (WSAA + WSFEv1), que puede tardar más que una llamada CRUD normal,
      // sobre todo cuando toca renovar el ticket de WSAA (cada ~12hs).
      const { data: factura } = await api.post(`/pedidos/${pedido.id}/facturar`, null, { timeout: 30000 })
      setPedidos((prev) =>
        prev.map((p) => (p.id === pedido.id ? { ...p, facturas: [...(p.facturas || []), factura] } : p))
      )
    } catch (e) {
      const mensaje = getErrorMessage(e)
      // La request puede haber fallado del lado del navegador (timeout) DESPUÉS de que el
      // backend ya terminó de facturar, o puede ser un reintento que choca con "ya facturado"
      // de un intento anterior. En los dos casos, el pedido ya tiene la factura real del lado
      // del servidor — se refresca y, si es así, se muestra el CAE en vez de un error falso.
      try {
        const { data } = await api.get('/pedidos')
        setPedidos(data)
        const actualizado = data.find((p) => p.id === pedido.id)
        setError(actualizado && facturaEmitida(actualizado) ? '' : mensaje)
      } catch {
        setError(mensaje)
      }
    } finally {
      setFacturando((prev) => {
        const next = new Set(prev)
        next.delete(pedido.id)
        return next
      })
    }
  }

  const abrirPanelDevolucion = async (pedido) => {
    setErrorPanel('')
    setPanelDevolucionId(pedido.id)
    setDevolucionesPanel([])
    setCantidadesDevolver({})
    setMotivoDevolucion('')
    setTipoDevolucion(pedido.estado === 'Entregado' ? 'Devolucion' : 'Cancelacion')
    try {
      const { data } = await api.get(`/pedidos/${pedido.id}/devoluciones`)
      setDevolucionesPanel(data)
    } catch (e) {
      setErrorPanel(getErrorMessage(e))
    }
  }

  const cerrarPanelDevolucion = () => {
    setPanelDevolucionId(null)
    setDevolucionesPanel([])
    setCantidadesDevolver({})
    setErrorPanel('')
  }

  const yaDevuelto = (pedidoItemId) =>
    devolucionesPanel.reduce(
      (acc, d) =>
        acc + d.items.filter((it) => it.pedido_item_id === pedidoItemId).reduce((a, it) => a + it.cantidad, 0),
      0
    )

  const confirmarDevolucion = async (pedido) => {
    setErrorPanel('')
    const items = Object.entries(cantidadesDevolver)
      .map(([pedido_item_id, cantidad]) => ({ pedido_item_id: Number(pedido_item_id), cantidad: Number(cantidad) }))
      .filter((it) => it.cantidad > 0)
    if (items.length === 0) {
      setErrorPanel('Ingresá al menos una cantidad a devolver.')
      return
    }
    setDevolviendo((prev) => new Set(prev).add(pedido.id))
    try {
      await api.post(`/pedidos/${pedido.id}/devoluciones`, {
        motivo: motivoDevolucion || null,
        tipo: tipoDevolucion,
        items,
      })
      // No se cierra el panel: se refresca in situ (pedidos + historial de devoluciones de
      // ESTE pedido) para que la devolución recién creada, y su botón de Nota de Crédito si
      // corresponde, aparezcan de inmediato sin tener que cerrar y volver a abrir el panel.
      const [{ data: pedidosData }, { data: devolucionesData }] = await Promise.all([
        api.get('/pedidos'),
        api.get(`/pedidos/${pedido.id}/devoluciones`),
      ])
      setPedidos(pedidosData)
      setDevolucionesPanel(devolucionesData)
      setCantidadesDevolver({})
      setMotivoDevolucion('')
    } catch (e) {
      setErrorPanel(getErrorMessage(e))
    } finally {
      setDevolviendo((prev) => {
        const next = new Set(prev)
        next.delete(pedido.id)
        return next
      })
    }
  }

  const emitirNotaCredito = async (pedido, devolucion) => {
    setErrorPanel('')
    setEmitiendoNC((prev) => new Set(prev).add(devolucion.id))
    try {
      // Mismo motivo que en facturar(): esto dispara un SOAP real contra ARCA, con margen
      // extra sobre el timeout default de la instancia `api`.
      const { data: notaCredito } = await api.post(
        `/pedidos/${pedido.id}/devoluciones/${devolucion.id}/nota-credito`,
        null,
        { timeout: 30000 }
      )
      setDevolucionesPanel((prev) =>
        prev.map((d) => (d.id === devolucion.id ? { ...d, nota_credito: notaCredito } : d))
      )
    } catch (e) {
      const mensaje = getErrorMessage(e)
      // Mismo criterio de reconciliación que facturar(): si la NC en realidad ya se emitió del
      // lado del servidor (timeout del navegador, o reintento sobre una ya emitida), refrescar
      // el historial y mostrar el CAE real en vez de un error falso.
      try {
        const { data } = await api.get(`/pedidos/${pedido.id}/devoluciones`)
        setDevolucionesPanel(data)
        const actualizada = data.find((d) => d.id === devolucion.id)
        setErrorPanel(actualizada?.nota_credito ? '' : mensaje)
      } catch {
        setErrorPanel(mensaje)
      }
    } finally {
      setEmitiendoNC((prev) => {
        const next = new Set(prev)
        next.delete(devolucion.id)
        return next
      })
    }
  }

  const abrirPanelCambio = async (pedido) => {
    setErrorCambio('')
    setMensajeCambioExito('')
    setPanelCambioId(pedido.id)
    setDevolucionesParaCambio([])
    setCambiosPanel([])
    setCantidadesCambiarDevolver({})
    setMotivoCambio('')
    setItemsCambioNuevos([])
    setCategoriaCambioId('')
    setProductoCambioId('')
    setValoresElegidosCambio({})
    try {
      const [
        { data: devolucionesData },
        { data: cambiosData },
        { data: productosData },
        { data: categoriasData },
        { data: stockData },
      ] = await Promise.all([
        api.get(`/pedidos/${pedido.id}/devoluciones`),
        api.get(`/pedidos/${pedido.id}/cambios`),
        api.get('/productos', { params: { solo_activos: true } }),
        api.get('/categorias'),
        api.get('/stock/productos'),
      ])
      setDevolucionesParaCambio(devolucionesData)
      setCambiosPanel(cambiosData)
      setProductosCambio(productosData)
      setCategoriasCambio(categoriasData)
      setStockProductosCambio(stockData)
    } catch (e) {
      setErrorCambio(getErrorMessage(e))
    }
  }

  const cerrarPanelCambio = () => {
    setPanelCambioId(null)
    setDevolucionesParaCambio([])
    setCantidadesCambiarDevolver({})
    setItemsCambioNuevos([])
    setErrorCambio('')
    setMensajeCambioExito('')
  }

  const yaDevueltoCambio = (pedidoItemId) =>
    devolucionesParaCambio.reduce(
      (acc, d) =>
        acc + d.items.filter((it) => it.pedido_item_id === pedidoItemId).reduce((a, it) => a + it.cantidad, 0),
      0
    )

  const categoriasArbolCambio = aplanarArbol(categoriasCambio)
  const productoSeleccionadoCambio = productosCambio.find((p) => String(p.id) === String(productoCambioId))
  const productosFiltradosCambio = categoriaCambioId
    ? productosCambio.filter((p) => String(p.categoria_id) === String(categoriaCambioId))
    : productosCambio

  useEffect(() => {
    setValoresElegidosCambio({})
    if (productoSeleccionadoCambio?.tiene_variantes) {
      Promise.all([
        api.get(`/productos/${productoSeleccionadoCambio.id}/atributos`),
        api.get(`/productos/${productoSeleccionadoCambio.id}/variantes`),
      ]).then(([{ data: atribs }, { data: variantes }]) => {
        setAtributosCambio(atribs)
        setVariantesCambio(variantes)
      })
    } else {
      setAtributosCambio([])
      setVariantesCambio([])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productoCambioId])

  const varianteResueltaCambio =
    atributosCambio.length > 0 && atributosCambio.every((a) => valoresElegidosCambio[a.atributo_id])
      ? variantesCambio.find((v) =>
          atributosCambio.every((a) =>
            v.valores.some(
              (x) =>
                x.atributo_id === a.atributo_id &&
                x.valor_atributo_id === Number(valoresElegidosCambio[a.atributo_id])
            )
          )
        )
      : null

  const opcionesParaAtributoCambio = (atributo, index) => {
    const previos = atributosCambio.slice(0, index)
    const candidatas = variantesCambio.filter((v) =>
      previos.every((pa) => {
        const elegido = valoresElegidosCambio[pa.atributo_id]
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

  const elegirValorAtributoCambio = (atributoId, index, valor) => {
    const nuevos = { ...valoresElegidosCambio, [atributoId]: valor }
    atributosCambio.slice(index + 1).forEach((a) => delete nuevos[a.atributo_id])
    setValoresElegidosCambio(nuevos)
  }

  const opcionesPrimerAtributoCambio =
    atributosCambio.length > 0 ? opcionesParaAtributoCambio(atributosCambio[0], 0) : []
  const sinStockEnNingunaCambio =
    atributosCambio.length > 0 &&
    opcionesPrimerAtributoCambio.length > 0 &&
    opcionesPrimerAtributoCambio.every((o) => !o.conStock)

  const stockActualBaseCambio = productoSeleccionadoCambio?.tiene_variantes
    ? varianteResueltaCambio?.stock_actual
    : stockProductosCambio.find((s) => s.producto_id === productoSeleccionadoCambio?.id)?.stock_actual
  const yaEnCarritoCambio = itemsCambioNuevos
    .filter(
      (i) =>
        i.producto_id === productoSeleccionadoCambio?.id &&
        (i.variante_id || null) === (varianteResueltaCambio?.id || null)
    )
    .reduce((acc, i) => acc + i.cantidad, 0)
  const stockDisponibleCambio =
    stockActualBaseCambio == null ? null : stockActualBaseCambio - yaEnCarritoCambio

  const agregarItemCambio = () => {
    setErrorCambio('')
    if (!productoSeleccionadoCambio) {
      setErrorCambio('Elegí el producto que entra en el cambio.')
      return
    }
    if (productoSeleccionadoCambio.tiene_variantes && variantesCambio.length === 0) {
      setErrorCambio('Este producto no tiene variantes cargadas todavía.')
      return
    }
    if (atributosCambio.length > 0 && !varianteResueltaCambio) {
      setErrorCambio('Elegí un valor para cada atributo, así se puede resolver la variante.')
      return
    }
    const cantidad = Number(cantidadCambioNueva || 0)
    if (cantidad <= 0) {
      setErrorCambio('La cantidad tiene que ser mayor a 0.')
      return
    }
    if (stockDisponibleCambio != null && cantidad > stockDisponibleCambio) {
      setErrorCambio(`No hay stock suficiente: disponible ${stockDisponibleCambio}, pediste ${cantidad}.`)
      return
    }
    const varianteId = varianteResueltaCambio?.id || null
    const descripcionVariante = varianteResueltaCambio
      ? atributosCambio
          .map((a) => varianteResueltaCambio.valores.find((x) => x.atributo_id === a.atributo_id)?.valor)
          .filter(Boolean)
          .join(' / ')
      : null
    setItemsCambioNuevos((prev) => {
      const existente = prev.find(
        (i) => i.producto_id === productoSeleccionadoCambio.id && (i.variante_id || null) === varianteId
      )
      if (existente) {
        return prev.map((i) => (i === existente ? { ...i, cantidad: i.cantidad + cantidad } : i))
      }
      return [
        ...prev,
        {
          producto_id: productoSeleccionadoCambio.id,
          variante_id: varianteId,
          nombre_producto: productoSeleccionadoCambio.nombre,
          descripcion_variante: descripcionVariante,
          cantidad,
          precio_unitario: Number(productoSeleccionadoCambio.precio_venta),
        },
      ]
    })
    setProductoCambioId('')
    setCantidadCambioNueva(1)
    setValoresElegidosCambio({})
  }

  const sacarItemCambio = (idx) => {
    setItemsCambioNuevos((prev) => prev.filter((_, i) => i !== idx))
  }

  const confirmarCambio = async (pedido) => {
    setErrorCambio('')
    setMensajeCambioExito('')
    const items_devolver = Object.entries(cantidadesCambiarDevolver)
      .map(([pedido_item_id, cantidad]) => ({ pedido_item_id: Number(pedido_item_id), cantidad: Number(cantidad) }))
      .filter((it) => it.cantidad > 0)
    if (items_devolver.length === 0) {
      setErrorCambio('Ingresá al menos una cantidad a devolver.')
      return
    }
    if (itemsCambioNuevos.length === 0) {
      setErrorCambio('Agregá al menos una prenda nueva para el cambio.')
      return
    }
    setCambiando((prev) => new Set(prev).add(pedido.id))
    try {
      const items_nuevos = itemsCambioNuevos.map((i) => ({
        producto_id: i.producto_id,
        variante_id: i.variante_id,
        cantidad: i.cantidad,
      }))
      const { data: cambio } = await api.post(`/pedidos/${pedido.id}/cambios`, {
        items_devolver,
        items_nuevos,
        motivo: motivoCambio || null,
      })
      const diferencia = Number(cambio.diferencia_monto)
      const monto = Math.abs(diferencia).toLocaleString('es-AR')
      let mensaje
      if (diferencia > 0) {
        mensaje = `Cambio confirmado. La clienta te debe $${monto} más — se puede facturar el pedido nuevo (#${cambio.pedido_nuevo.id}) con el botón "Facturar" si corresponde.`
      } else if (diferencia < 0) {
        mensaje = `Cambio confirmado. Hay que devolverle $${monto} a la clienta.`
        if (cambio.devolucion.requiere_nota_credito) {
          mensaje +=
            ' El pedido original tiene Factura emitida — se puede emitir la Nota de Crédito desde el historial de devoluciones de acá abajo.'
        }
      } else {
        mensaje = 'Cambio confirmado a precio igual — no hace falta tocar la facturación, la Factura original sigue siendo válida.'
      }
      setMensajeCambioExito(mensaje)
      const [{ data: pedidosData }, { data: devolucionesData }, { data: cambiosData }] = await Promise.all([
        api.get('/pedidos'),
        api.get(`/pedidos/${pedido.id}/devoluciones`),
        api.get(`/pedidos/${pedido.id}/cambios`),
      ])
      setPedidos(pedidosData)
      setDevolucionesParaCambio(devolucionesData)
      setCambiosPanel(cambiosData)
      setCantidadesCambiarDevolver({})
      setItemsCambioNuevos([])
      setMotivoCambio('')
    } catch (e) {
      setErrorCambio(getErrorMessage(e))
    } finally {
      setCambiando((prev) => {
        const next = new Set(prev)
        next.delete(pedido.id)
        return next
      })
    }
  }

  const pendientesCount = pedidos.filter(esPendienteDeFacturar).length
  const pedidosMostrados = soloPendientes ? pedidos.filter(esPendienteDeFacturar) : pedidos
  const pedidoEnPanel = panelDevolucionId ? pedidos.find((p) => p.id === panelDevolucionId) : null
  const pedidoEnPanelCambio = panelCambioId ? pedidos.find((p) => p.id === panelCambioId) : null

  // Preview informativo en el cliente — el backend recalcula la diferencia de forma autoritativa
  // al confirmar, esto es solo para que la usuaria vea el número antes de mandar el POST.
  const totalADevolverPreview = Object.entries(cantidadesCambiarDevolver).reduce((acc, [itemId, cantidad]) => {
    const item = pedidoEnPanelCambio?.items.find((it) => it.id === Number(itemId))
    const cant = Number(cantidad || 0)
    return item && cant > 0 ? acc + Number(item.precio_unitario) * cant : acc
  }, 0)
  const totalNuevoPreview = itemsCambioNuevos.reduce((acc, i) => acc + i.precio_unitario * i.cantidad, 0)
  const diferenciaPreview = totalNuevoPreview - totalADevolverPreview

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold flex items-center gap-2">📦 Pedidos</h1>
      <p className="text-gray-400 text-sm">
        Pedidos de los dos canales de venta: e-commerce y mostrador (Caja). Cada línea generó
        automáticamente una Venta en Caja.
      </p>
      {pendientesCount > 0 && (
        <div className="flex items-center justify-between text-sm text-amber-400 bg-amber-950/30 border border-amber-800 rounded-lg p-3">
          <span>
            {pendientesCount} pedido{pendientesCount === 1 ? '' : 's'} pendiente{pendientesCount === 1 ? '' : 's'} de
            facturar
          </span>
          <button onClick={() => setSoloPendientes((v) => !v)} className="underline hover:text-amber-300">
            {soloPendientes ? 'Ver todos' : 'Ver solo pendientes'}
          </button>
        </div>
      )}
      {error && <p className="text-red-400 text-sm">{error}</p>}

      <div className="bg-[#151b2b] rounded-xl p-5 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-400 border-b border-gray-700">
              <th className="py-2">Canal</th>
              <th>Fecha</th>
              <th>Cliente</th>
              <th>Items</th>
              <th>Total</th>
              <th>Facturar</th>
              <th>Estado</th>
              <th>Devolución</th>
            </tr>
          </thead>
          <tbody>
            {pedidosMostrados.map((p) => {
              const factura = facturaEmitida(p)
              const pendiente = esPendienteDeFacturar(p)
              const enCurso = facturando.has(p.id)
              return (
                <tr key={p.id} className="border-b border-gray-800 align-top">
                  <td className="py-2">
                    <span
                      className={`px-2 py-1 rounded text-xs font-medium ${
                        p.canal === 'ecommerce' ? 'bg-blue-950/50 text-blue-300' : 'bg-purple-950/50 text-purple-300'
                      }`}
                    >
                      {p.canal === 'ecommerce' ? '🛒 E-commerce' : '🏬 Mostrador'}
                    </span>
                  </td>
                  <td>{new Date(p.fecha).toLocaleString('es-AR')}</td>
                  <td>
                    {p.cliente_nombre || (p.canal === 'local' ? 'Mostrador' : '—')}
                    {p.cliente_email && <div className="text-gray-500 text-xs">{p.cliente_email}</div>}
                    {p.cliente_telefono && <div className="text-gray-500 text-xs">{p.cliente_telefono}</div>}
                    {p.cambio_origen && (
                      <div className="text-purple-300 text-xs whitespace-nowrap">
                        🔄 Cambio del pedido #{p.cambio_origen.pedido_original_id}
                      </div>
                    )}
                  </td>
                  <td>
                    {p.items.map((it) => (
                      <div key={it.id}>
                        {it.producto?.nombre || `Producto #${it.producto_id}`} x{it.cantidad}
                      </div>
                    ))}
                  </td>
                  <td>
                    ${Number(p.total).toLocaleString('es-AR')}
                    {Number(p.monto_neto) !== Number(p.total) && (
                      <div className="text-gray-500 text-xs">Neto ${Number(p.monto_neto).toLocaleString('es-AR')}</div>
                    )}
                  </td>
                  <td>
                    {factura ? (
                      <div className="text-xs text-green-400 whitespace-nowrap">
                        <div>CAE {factura.cae}</div>
                        <div>Vto {factura.cae_vencimiento}</div>
                        <div>${Number(factura.importe_total).toLocaleString('es-AR')}</div>
                        <a
                          href={`${api.defaults.baseURL}/pedidos/${p.id}/facturas/${factura.id}/pdf`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-blue-400 hover:underline"
                        >
                          Ver PDF
                        </a>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-1 items-start">
                        <label className="flex items-center gap-1 text-xs text-gray-300">
                          <input
                            type="checkbox"
                            checked={p.facturar_arca}
                            disabled={actualizandoFacturarArca.has(p.id)}
                            onChange={(e) => cambiarFacturarArca(p, e.target.checked)}
                          />
                          Facturar
                        </label>
                        {pendiente && (
                          <button
                            onClick={() => facturar(p)}
                            disabled={enCurso}
                            className="bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-400 text-xs px-2 py-1 rounded"
                          >
                            {enCurso ? 'Facturando...' : 'Facturar'}
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                  <td>
                    <select
                      className="bg-[#0b0f19] border border-gray-700 rounded-lg p-1 text-xs"
                      value={p.estado}
                      onChange={(e) => cambiarEstado(p, e.target.value)}
                    >
                      {!opcionesEstado(p).includes(p.estado) && <option value={p.estado}>{p.estado}</option>}
                      {opcionesEstado(p).map((estado) => (
                        <option key={estado} value={estado}>
                          {estado}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <div className="flex flex-col gap-1 items-start">
                      <button
                        onClick={() => abrirPanelDevolucion(p)}
                        className="bg-red-950/50 hover:bg-red-900/60 text-red-300 text-xs px-2 py-1 rounded whitespace-nowrap"
                      >
                        {p.estado === 'Cancelado' ? 'Ver devoluciones' : 'Devolver / Cancelar'}
                      </button>
                      <button
                        onClick={() => abrirPanelCambio(p)}
                        className="bg-purple-950/50 hover:bg-purple-900/60 text-purple-300 text-xs px-2 py-1 rounded whitespace-nowrap"
                      >
                        Cambiar producto
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
            {pedidosMostrados.length === 0 && (
              <tr>
                <td colSpan={8} className="text-gray-500 py-4 text-center">
                  {soloPendientes ? 'No hay pedidos pendientes de facturar.' : 'Todavía no hay pedidos.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pedidoEnPanel && (
        <div className="bg-[#151b2b] rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Devolver / Cancelar — Pedido #{pedidoEnPanel.id}</h2>
            <button onClick={cerrarPanelDevolucion} className="text-gray-400 hover:text-white text-sm">
              Cerrar
            </button>
          </div>
          {errorPanel && <p className="text-red-400 text-sm">{errorPanel}</p>}
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-400 border-b border-gray-700">
                <th className="py-2">Producto</th>
                <th>Cantidad original</th>
                <th>Ya devuelto</th>
                <th>Disponible</th>
                <th>Cantidad a devolver</th>
              </tr>
            </thead>
            <tbody>
              {pedidoEnPanel.items.map((it) => {
                const devuelto = yaDevuelto(it.id)
                const disponible = it.cantidad - devuelto
                return (
                  <tr key={it.id} className="border-b border-gray-800">
                    <td className="py-2">
                      {it.producto?.nombre || `Producto #${it.producto_id}`}
                      {it.variante_descripcion && (
                        <span className="text-gray-500"> ({it.variante_descripcion})</span>
                      )}
                    </td>
                    <td>{it.cantidad}</td>
                    <td>{devuelto}</td>
                    <td>{disponible}</td>
                    <td>
                      <input
                        type="number"
                        min="0"
                        max={disponible}
                        disabled={disponible <= 0}
                        value={cantidadesDevolver[it.id] ?? ''}
                        onChange={(e) =>
                          setCantidadesDevolver((prev) => ({ ...prev, [it.id]: e.target.value }))
                        }
                        className="bg-[#0b0f19] border border-gray-700 rounded-lg p-1 w-20 text-sm disabled:opacity-40"
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {devolucionesPanel.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-gray-300">Historial de devoluciones</h3>
              {devolucionesPanel.map((d) => (
                <div key={d.id} className="bg-[#0b0f19] rounded-lg p-3 text-xs space-y-1">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div>
                      <span className="font-medium">{d.tipo === 'Cancelacion' ? 'Cancelación' : 'Devolución'}</span>
                      {' — '}
                      {new Date(d.fecha).toLocaleString('es-AR')}
                      {d.motivo && <span className="text-gray-500"> · {d.motivo}</span>}
                    </div>
                    {d.nota_credito ? (
                      <div className="text-green-400 whitespace-nowrap">
                        NC CAE {d.nota_credito.cae} · ${Number(d.nota_credito.importe_total).toLocaleString('es-AR')}{' '}
                        <a
                          href={`${api.defaults.baseURL}/pedidos/${pedidoEnPanel.id}/facturas/${d.nota_credito.id}/pdf`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-blue-400 hover:underline"
                        >
                          Ver PDF
                        </a>
                      </div>
                    ) : d.requiere_nota_credito ? (
                      <button
                        onClick={() => emitirNotaCredito(pedidoEnPanel, d)}
                        disabled={emitiendoNC.has(d.id)}
                        className="bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-400 px-2 py-1 rounded whitespace-nowrap"
                      >
                        {emitiendoNC.has(d.id) ? 'Emitiendo NC...' : 'Emitir Nota de Crédito'}
                      </button>
                    ) : null}
                  </div>
                  <div className="text-gray-400">
                    {d.items.map((it) => {
                      const pedidoItem = pedidoEnPanel.items.find((pi) => pi.id === it.pedido_item_id)
                      return (
                        <div key={it.id}>
                          {pedidoItem?.producto?.nombre || `Item #${it.pedido_item_id}`} x{it.cantidad}
                        </div>
                      )
                    })}
                  </div>
                  {d.cambio && (
                    <div className="text-purple-300">
                      🔄 Parte de un cambio → pedido #{d.cambio.pedido_nuevo_id}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <select
              value={tipoDevolucion}
              onChange={(e) => setTipoDevolucion(e.target.value)}
              className="bg-[#0b0f19] border border-gray-700 rounded-lg p-2 text-sm"
            >
              <option value="Devolucion">Devolución</option>
              <option value="Cancelacion">Cancelación</option>
            </select>
            <input
              type="text"
              placeholder="Motivo (opcional)"
              value={motivoDevolucion}
              onChange={(e) => setMotivoDevolucion(e.target.value)}
              className="bg-[#0b0f19] border border-gray-700 rounded-lg p-2 text-sm flex-1 min-w-[200px]"
            />
            <button
              onClick={() => confirmarDevolucion(pedidoEnPanel)}
              disabled={devolviendo.has(pedidoEnPanel.id)}
              className="bg-red-600 hover:bg-red-500 disabled:bg-gray-700 disabled:text-gray-400 text-sm px-3 py-2 rounded"
            >
              {devolviendo.has(pedidoEnPanel.id) ? 'Procesando...' : 'Confirmar'}
            </button>
          </div>
        </div>
      )}

      {pedidoEnPanelCambio && (
        <div className="bg-[#151b2b] rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Cambiar producto — Pedido #{pedidoEnPanelCambio.id}</h2>
            <button onClick={cerrarPanelCambio} className="text-gray-400 hover:text-white text-sm">
              Cerrar
            </button>
          </div>
          {errorCambio && <p className="text-red-400 text-sm">{errorCambio}</p>}
          {mensajeCambioExito && <p className="text-green-400 text-sm">{mensajeCambioExito}</p>}

          <div>
            <h3 className="text-sm font-semibold text-gray-300 mb-2">Paso 1 — Qué se devuelve</h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-400 border-b border-gray-700">
                  <th className="py-2">Producto</th>
                  <th>Cantidad original</th>
                  <th>Ya devuelto/cambiado</th>
                  <th>Disponible</th>
                  <th>Cantidad a devolver</th>
                </tr>
              </thead>
              <tbody>
                {pedidoEnPanelCambio.items.map((it) => {
                  const devuelto = yaDevueltoCambio(it.id)
                  const disponible = it.cantidad - devuelto
                  return (
                    <tr key={it.id} className="border-b border-gray-800">
                      <td className="py-2">
                        {it.producto?.nombre || `Producto #${it.producto_id}`}
                        {it.variante_descripcion && (
                          <span className="text-gray-500"> ({it.variante_descripcion})</span>
                        )}
                      </td>
                      <td>{it.cantidad}</td>
                      <td>{devuelto}</td>
                      <td>{disponible}</td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          max={disponible}
                          disabled={disponible <= 0}
                          value={cantidadesCambiarDevolver[it.id] ?? ''}
                          onChange={(e) =>
                            setCantidadesCambiarDevolver((prev) => ({ ...prev, [it.id]: e.target.value }))
                          }
                          className="bg-[#0b0f19] border border-gray-700 rounded-lg p-1 w-20 text-sm disabled:opacity-40"
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-gray-300 mb-2">Paso 2 — Qué prenda entra</h3>
            <div className="flex flex-wrap items-end gap-2">
              <select
                value={categoriaCambioId}
                onChange={(e) => {
                  setCategoriaCambioId(e.target.value)
                  setProductoCambioId('')
                }}
                className="bg-[#0b0f19] border border-gray-700 rounded-lg p-2 text-sm"
              >
                <option value="">Todas las categorías</option>
                {categoriasArbolCambio.map((c) => (
                  <option key={c.id} value={c.id}>
                    {etiquetaIndentada(c)}
                  </option>
                ))}
              </select>
              <select
                value={productoCambioId}
                onChange={(e) => setProductoCambioId(e.target.value)}
                className="bg-[#0b0f19] border border-gray-700 rounded-lg p-2 text-sm min-w-[180px]"
              >
                <option value="">Elegí un producto...</option>
                {productosFiltradosCambio.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
              </select>
              {!sinStockEnNingunaCambio &&
                atributosCambio.map((a, i) => (
                  <select
                    key={a.atributo_id}
                    className="bg-[#0b0f19] border border-gray-700 rounded-lg p-2 text-sm"
                    value={valoresElegidosCambio[a.atributo_id] || ''}
                    onChange={(e) => elegirValorAtributoCambio(a.atributo_id, i, e.target.value)}
                  >
                    <option value="">{a.atributo}...</option>
                    {opcionesParaAtributoCambio(a, i).map((v) => (
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
                max={stockDisponibleCambio ?? undefined}
                disabled={stockDisponibleCambio != null && stockDisponibleCambio <= 0}
                value={cantidadCambioNueva}
                onChange={(e) => setCantidadCambioNueva(e.target.value)}
                className="bg-[#0b0f19] border border-gray-700 rounded-lg p-2 text-sm w-20 disabled:opacity-40"
              />
              <button
                onClick={agregarItemCambio}
                disabled={stockDisponibleCambio != null && stockDisponibleCambio <= 0}
                className="bg-purple-600 hover:bg-purple-500 disabled:bg-gray-700 disabled:text-gray-400 text-sm px-3 py-2 rounded"
              >
                + Agregar
              </button>
            </div>
            {productoSeleccionadoCambio?.tiene_variantes && variantesCambio.length === 0 && (
              <p className="text-yellow-400 text-xs mt-2">
                Este producto no tiene variantes cargadas todavía.
              </p>
            )}
            {sinStockEnNingunaCambio && (
              <p className="text-yellow-400 text-xs mt-2">
                Ninguna combinación de este producto tiene stock disponible.
              </p>
            )}
            {stockDisponibleCambio != null && Number(cantidadCambioNueva || 0) > stockDisponibleCambio && (
              <p className="text-xs text-red-400 mt-2">
                Stock disponible{yaEnCarritoCambio > 0 ? ' (descontando lo ya agregado a este cambio)' : ''}:{' '}
                {stockDisponibleCambio}. La cantidad cargada lo supera.
              </p>
            )}

            {itemsCambioNuevos.length > 0 && (
              <ul className="text-sm mt-3 space-y-1">
                {itemsCambioNuevos.map((i, idx) => (
                  <li key={idx} className="flex items-center justify-between border-b border-gray-800 py-1">
                    <span>
                      {i.nombre_producto}
                      {i.descripcion_variante && (
                        <span className="text-gray-500"> ({i.descripcion_variante})</span>
                      )}{' '}
                      x{i.cantidad}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="text-gray-400">
                        ${(i.precio_unitario * i.cantidad).toLocaleString('es-AR')}
                      </span>
                      <button onClick={() => sacarItemCambio(idx)} className="text-red-400 hover:underline text-xs">
                        Sacar
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {(totalADevolverPreview > 0 || totalNuevoPreview > 0) && (
            <p className="text-sm text-gray-300">
              Diferencia estimada:{' '}
              <span className={diferenciaPreview === 0 ? 'text-gray-400' : diferenciaPreview > 0 ? 'text-amber-400' : 'text-green-400'}>
                {diferenciaPreview === 0
                  ? '$0 (precio igual)'
                  : diferenciaPreview > 0
                  ? `la clienta paga $${diferenciaPreview.toLocaleString('es-AR')} más`
                  : `hay que devolverle $${Math.abs(diferenciaPreview).toLocaleString('es-AR')}`}
              </span>{' '}
              (el backend recalcula el monto real al confirmar)
            </p>
          )}

          {cambiosPanel.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-gray-300">Historial de cambios</h3>
              {cambiosPanel.map((c) => (
                <div key={c.id} className="bg-[#0b0f19] rounded-lg p-3 text-xs space-y-1">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div>
                      {new Date(c.fecha).toLocaleString('es-AR')}
                      {c.motivo && <span className="text-gray-500"> · {c.motivo}</span>}
                    </div>
                    <div
                      className={
                        Number(c.diferencia_monto) === 0
                          ? 'text-gray-400'
                          : Number(c.diferencia_monto) > 0
                          ? 'text-amber-400'
                          : 'text-green-400'
                      }
                    >
                      {Number(c.diferencia_monto) === 0
                        ? 'Precio igual'
                        : Number(c.diferencia_monto) > 0
                        ? `Cobrado de más: $${Number(c.diferencia_monto).toLocaleString('es-AR')}`
                        : `Devuelto: $${Math.abs(Number(c.diferencia_monto)).toLocaleString('es-AR')}`}
                    </div>
                  </div>
                  <div className="text-gray-400">
                    {c.devolucion.items.map((it) => {
                      const original = pedidoEnPanelCambio.items.find((pi) => pi.id === it.pedido_item_id)
                      return (
                        <div key={it.id}>
                          {original?.producto?.nombre || `Item #${it.pedido_item_id}`} x{it.cantidad} → pedido #
                          {c.pedido_nuevo.id}
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <input
              type="text"
              placeholder="Motivo (opcional)"
              value={motivoCambio}
              onChange={(e) => setMotivoCambio(e.target.value)}
              className="bg-[#0b0f19] border border-gray-700 rounded-lg p-2 text-sm flex-1 min-w-[200px]"
            />
            <button
              onClick={() => confirmarCambio(pedidoEnPanelCambio)}
              disabled={cambiando.has(pedidoEnPanelCambio.id)}
              className="bg-purple-600 hover:bg-purple-500 disabled:bg-gray-700 disabled:text-gray-400 text-sm px-3 py-2 rounded"
            >
              {cambiando.has(pedidoEnPanelCambio.id) ? 'Procesando...' : 'Confirmar cambio'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
