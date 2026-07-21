import { useEffect, useState } from 'react'
import api, { getErrorMessage } from '../api'

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

  const pendientesCount = pedidos.filter(esPendienteDeFacturar).length
  const pedidosMostrados = soloPendientes ? pedidos.filter(esPendienteDeFacturar) : pedidos
  const pedidoEnPanel = panelDevolucionId ? pedidos.find((p) => p.id === panelDevolucionId) : null

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
                    ) : pendiente ? (
                      <button
                        onClick={() => facturar(p)}
                        disabled={enCurso}
                        className="bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-400 text-xs px-2 py-1 rounded"
                      >
                        {enCurso ? 'Facturando...' : 'Facturar'}
                      </button>
                    ) : (
                      <span
                        className={`px-2 py-1 rounded text-xs font-medium ${
                          p.facturar_arca ? 'bg-green-950/50 text-green-300' : 'bg-gray-800 text-gray-400'
                        }`}
                      >
                        {p.facturar_arca ? 'Sí' : 'No'}
                      </span>
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
                    <button
                      onClick={() => abrirPanelDevolucion(p)}
                      className="bg-red-950/50 hover:bg-red-900/60 text-red-300 text-xs px-2 py-1 rounded whitespace-nowrap"
                    >
                      {p.estado === 'Cancelado' ? 'Ver devoluciones' : 'Devolver / Cancelar'}
                    </button>
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
    </div>
  )
}
