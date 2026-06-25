import React, { useState, useEffect, useCallback } from 'react'
import QRCode from 'qrcode'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { Ticket, Wallet, Repeat, X, RefreshCw, Tag, CheckCircle, AlertCircle, ArrowRight, QrCode } from 'lucide-react'

function formatCurrency(amount) {
  if (amount == null) return '-'
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0
  }).format(amount)
}

function ListModal({ ticket, onClose, onSubmit, loading }) {
  const [price, setPrice] = useState('')
  const [error, setError] = useState('')

  const maxPrice = ticket.event_rules?.precio_max != null
    ? Math.floor((ticket.event_price ?? 0) * (1 + ticket.event_rules.precio_max / 100))
    : null

  const handleSubmit = (e) => {
    e.preventDefault()
    setError('')
    const p = parseFloat(price)
    if (isNaN(p) || p <= 0) { setError('Ingresá un precio válido.'); return }
    if (maxPrice != null && p > maxPrice) {
      setError(`El precio no puede superar ${formatCurrency(maxPrice)} (${ticket.event_rules.precio_max}% del original).`)
      return
    }
    onSubmit(p)
  }

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-6" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="animate-fadeIn w-full max-w-md p-6 rounded-2xl border border-white/[0.08] bg-[#121214] shadow-2xl">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#6c63ff]/20 to-[#8b5cf6]/20 flex items-center justify-center">
            <Tag className="w-5 h-5 text-[#6c63ff]" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Poner en venta</h2>
            <p className="text-xs text-[#71717a]">Ticket #{ticket.ticket_id} — {ticket.event_name}</p>
          </div>
        </div>

        {error && <div className="flex items-center gap-2 p-3 rounded-xl bg-error/10 border border-error/20 text-error text-sm mb-4"><AlertCircle className="w-4 h-4 flex-shrink-0" />{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="flex flex-col gap-2 mb-5">
            <label htmlFor="list-price" className="text-xs font-medium text-[#a1a1aa]">
              Precio de reventa
              {maxPrice != null && <span className="font-normal text-[#71717a]"> (máx. {formatCurrency(maxPrice)})</span>}
            </label>
            <input
              id="list-price"
              type="number"
              min="1"
              max={maxPrice || undefined}
              step="1"
              value={price}
              onChange={e => setPrice(e.target.value)}
              placeholder="Ej: 5000"
              autoFocus
              required
              className="input"
            />
          </div>
          <div className="flex gap-3 justify-end">
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={loading}>
              <X className="w-4 h-4" /> Cancelar
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? <><span className="spinner-sm" /> Publicando…</> : <><CheckCircle className="w-4 h-4" /> Publicar</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

const QR_REFRESH_SECS = 30

function QRModal({ ticket, onClose }) {
  const { authFetch } = useAuth()
  const [qrDataUrl, setQrDataUrl] = useState(null)
  const [secondsLeft, setSecondsLeft] = useState(QR_REFRESH_SECS)
  const [qrError, setQrError] = useState('')
  const [fetching, setFetching] = useState(false)

  const refresh = useCallback(async () => {
    if (!ticket) return
    setFetching(true)
    setQrError('')
    try {
      const res = await authFetch(`/api/transactions/qr-token/${ticket.event_id}/${ticket.ticket_id}`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Error al obtener QR')
      const scanUrl = `${window.location.origin}/scan?token=${encodeURIComponent(data.token)}`
      const url = await QRCode.toDataURL(scanUrl, { width: 260, margin: 2 })
      setQrDataUrl(url)
      setSecondsLeft(QR_REFRESH_SECS)
    } catch (err) {
      setQrError(err.message || 'No se pudo generar el QR')
    } finally {
      setFetching(false)
    }
  }, [ticket, authFetch])

  useEffect(() => { setQrDataUrl(null); refresh() }, [refresh])

  useEffect(() => {
    if (!ticket) return
    const id = setInterval(() => {
      setSecondsLeft(s => {
        if (s <= 1) { refresh(); return QR_REFRESH_SECS }
        return s - 1
      })
    }, 1000)
    return () => clearInterval(id)
  }, [ticket, refresh])

  const urgent = secondsLeft <= 8

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-6" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="animate-fadeIn w-full max-w-sm p-6 rounded-2xl border border-white/[0.08] bg-[#121214] shadow-2xl">
        <div className="flex items-center justify-between mb-5">
          <div>
            <p className="text-sm font-medium text-[#f4f4f5]">{ticket.event_name}</p>
            <p className="text-[10px] font-mono text-[#71717a] mt-0.5">#{ticket.ticket_id}</p>
          </div>
          <button className="btn btn-ghost btn-sm btn-icon" onClick={onClose}><X className="w-4 h-4" /></button>
        </div>

        {qrError && <div className="flex items-center gap-2 p-3 rounded-xl bg-error/10 border border-error/20 text-error text-xs mb-4"><AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />{qrError}</div>}

        <div className="flex justify-center items-center min-h-[260px]">
          {fetching && !qrDataUrl && (
            <div className="flex flex-col items-center gap-3 text-[#71717a]">
              <div className="spinner" />
              <span className="text-xs">Generando QR…</span>
            </div>
          )}
          {qrDataUrl && (
            <img
              src={qrDataUrl}
              alt="QR de acceso"
              className={`rounded-xl border-2 border-white/[0.08] ${fetching ? 'opacity-30' : 'opacity-100'} transition-opacity duration-300`}
            />
          )}
        </div>

        {qrDataUrl && (
          <div className="mt-5 flex flex-col items-center gap-2 w-full">
            <div className="w-full h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-1000"
                style={{
                  width: `${(secondsLeft / QR_REFRESH_SECS) * 100}%`,
                  background: urgent ? 'linear-gradient(90deg, #f59e0b, #f97316)' : 'linear-gradient(90deg, #6c63ff, #8b5cf6)',
                }}
              />
            </div>
            <div className="flex items-center gap-1.5">
              <RefreshCw className={`w-3 h-3 ${urgent ? 'text-warning' : 'text-[#71717a]'} ${fetching ? 'animate-spin' : ''}`} />
              <span className={`text-[11px] ${urgent ? 'text-warning' : 'text-[#71717a]'}`}>
                {fetching ? 'Renovando…' : `Renueva en ${secondsLeft}s`}
              </span>
            </div>
            {!fetching && (
              <button className="btn btn-ghost btn-sm mt-1" onClick={refresh}>
                <RefreshCw className="w-3.5 h-3.5" /> Renovar
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default function MyTickets() {
  const { authFetch } = useAuth()
  const navigate = useNavigate()
  const [tickets, setTickets] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [listTarget, setListTarget] = useState(null)
  const [qrTarget, setQrTarget] = useState(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [actionError, setActionError] = useState('')

  useEffect(() => { document.title = 'Mis Entradas — TicketChain' }, [])

  const fetchTickets = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await authFetch('/api/transactions/my-tickets')
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || data.detail || `Error ${res.status}`)
      }
      const data = await res.json()
      const list = Array.isArray(data) ? data : (data.tickets || [])
      setTickets(list)
    } catch (err) {
      setError(err.message || 'No se pudieron cargar tus entradas')
    } finally { setLoading(false) }
  }, [authFetch])

  useEffect(() => { fetchTickets() }, [fetchTickets])

  const handleList = async (price) => {
    setActionLoading(true); setMessage(''); setActionError('')
    try {
      const res = await authFetch('/api/transactions/list', {
        method: 'POST',
        body: JSON.stringify({ event_id: listTarget.event_id, ticket_id: listTarget.ticket_id, price }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`)
      setMessage(`Entrada ${listTarget.ticket_id} publicada a ${formatCurrency(price)}.`)
      setListTarget(null); fetchTickets()
    } catch (err) {
      setActionError(err.message || 'Error al publicar')
    } finally { setActionLoading(false) }
  }

  const handleUnlist = async (ticket) => {
    setActionLoading(true); setMessage(''); setActionError('')
    try {
      const res = await authFetch(`/api/transactions/list/${ticket.event_id}/${ticket.ticket_id}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`)
      setMessage(`Publicación de ${ticket.ticket_id} cancelada.`)
      fetchTickets()
    } catch (err) {
      setActionError(err.message || 'Error al cancelar')
    } finally { setActionLoading(false) }
  }

  const canList = (ticket) => {
    if (ticket.event_status === 'suspended') return false
    if (ticket.event_rules?.nominada) return false
    if (ticket.event_rules?.max_reventas != null && ticket.resale_count >= ticket.event_rules.max_reventas) return false
    return true
  }

  return (
    <main className="flex-1 overflow-y-auto">
      <div className="border-b border-white/[0.06] bg-gradient-to-b from-[#0c0c10] to-transparent px-6 py-10">
        <div className="max-w-[900px] mx-auto text-center">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#6c63ff] to-[#8b5cf6] flex items-center justify-center mx-auto mb-4 shadow-[0_0_30px_rgba(108,99,255,0.2)]">
            <Ticket className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-2xl md:text-3xl font-bold gradient-text mb-1">Mis Entradas</h1>
          <p className="text-sm text-[#a1a1aa]">Gestioná tus tickets y QR de acceso</p>
        </div>
      </div>

      <div className="max-w-[900px] mx-auto px-6 py-6">
        {message && <div className="flex items-center gap-2 p-3 rounded-xl bg-success/10 border border-success/20 text-success text-sm mb-4"><CheckCircle className="w-4 h-4 flex-shrink-0" />{message}</div>}
        {actionError && <div className="flex items-center gap-2 p-3 rounded-xl bg-error/10 border border-error/20 text-error text-sm mb-4"><AlertCircle className="w-4 h-4 flex-shrink-0" />{actionError}</div>}

        {loading && (
          <div className="flex flex-col items-center justify-center py-24 gap-4 text-[#a1a1aa]">
            <div className="spinner" />
            <span className="text-sm">Cargando tus entradas…</span>
          </div>
        )}

        {!loading && error && <div className="flex items-center gap-2 p-3 rounded-xl bg-error/10 border border-error/20 text-error text-sm mb-4"><AlertCircle className="w-4 h-4 flex-shrink-0" />{error}</div>}

        {!loading && !error && tickets.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <Ticket className="w-16 h-16 text-white/[0.06] mb-4" />
            <h3 className="text-lg font-medium text-[#a1a1aa] mb-1">No tenés entradas aún</h3>
            <p className="text-sm text-[#71717a]">Comprá tickets en los <a href="/events" className="text-[#6c63ff]">eventos disponibles</a>.</p>
          </div>
        )}

        {!loading && !error && tickets.length > 0 && (
          <div className="flex flex-col gap-3">
            {tickets.map((ticket, idx) => (
              <div
                key={ticket.ticket_id || idx}
                className="card p-4 animate-slideUp"
              >
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-center gap-3 min-w-0 flex-1" onClick={() => navigate(`/events/${ticket.event_id}`)}>
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#6c63ff]/20 to-[#8b5cf6]/20 flex items-center justify-center flex-shrink-0 cursor-pointer hover:from-[#6c63ff]/30 hover:to-[#8b5cf6]/30 transition-all">
                      <Ticket className="w-5 h-5 text-[#6c63ff]" />
                    </div>
                    <div className="min-w-0 cursor-pointer">
                      <p className="text-sm font-medium text-[#f4f4f5] truncate hover:text-[#6c63ff] transition-colors">{ticket.event_name || 'Evento desconocido'}</p>
                      <p className="text-[10px] font-mono text-[#71717a]">#{ticket.ticket_id}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setQrTarget(ticket)} title="Ver QR">
                      <QrCode className="w-4 h-4 text-[#a1a1aa]" />
                    </button>
                    {ticket.listed
                      ? <span className="badge bg-[#6c63ff]/10 text-[#6c63ff]">En venta · {formatCurrency(ticket.listing_price)}</span>
                      : <span className="badge bg-success/10 text-success">Activa</span>
                    }
                  </div>
                </div>

                <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-[#71717a] mb-3">
                  <span className="flex items-center gap-1"><Wallet className="w-3 h-3" /> {ticket.owner_wallet?.slice(0, 16) || ticket.wallet_address?.slice(0, 16) || '—'}…</span>
                  <span className="flex items-center gap-1"><Repeat className="w-3 h-3" /> Reventas: {ticket.resale_count ?? 0}{ticket.event_rules?.max_reventas != null ? ` / ${ticket.event_rules.max_reventas}` : ''}</span>
                </div>

                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <button className="btn btn-primary btn-sm" onClick={() => navigate(`/events/${ticket.event_id}`)}>
                    <ArrowRight className="w-3.5 h-3.5" /> Ir al evento
                  </button>
                  <div className="flex gap-2">
                    {ticket.listed ? (
                      <button className="btn btn-ghost btn-sm" disabled={actionLoading} onClick={e => { e.stopPropagation(); handleUnlist(ticket) }}>
                        <X className="w-3.5 h-3.5" /> Cancelar venta
                      </button>
                    ) : canList(ticket) ? (
                      <button className="btn btn-ghost btn-sm" onClick={() => { setMessage(''); setActionError(''); setListTarget(ticket) }}>
                        <Tag className="w-3.5 h-3.5" /> Poner en venta
                      </button>
                    ) : (
                      <span className="text-[11px] text-[#71717a] py-1">{ticket.event_rules?.nominada ? 'Nominada' : 'Sin reventas'}</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {listTarget && (
        <ListModal ticket={listTarget} loading={actionLoading} onClose={() => setListTarget(null)} onSubmit={handleList} />
      )}

      {qrTarget && (
        <QRModal ticket={qrTarget} onClose={() => setQrTarget(null)} />
      )}
    </main>
  )
}
