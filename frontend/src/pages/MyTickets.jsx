import React, { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../context/AuthContext.jsx'

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
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h2>Poner en venta</h2>
        <p className="modal-subtitle">Ticket #{ticket.ticket_id} — {ticket.event_name}</p>

        {error && <div className="alert alert-error">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="list-price">
              Precio de reventa
              {maxPrice != null && (
                <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>
                  {' '}(máx. {formatCurrency(maxPrice)})
                </span>
              )}
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
            />
          </div>
          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={loading}>
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? <><span className="loading-spinner loading-spinner-sm" /> Publicando…</> : 'Publicar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function MyTickets() {
  const { authFetch } = useAuth()
  const [tickets, setTickets] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [listTarget, setListTarget] = useState(null)
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
      setTickets(Array.isArray(data) ? data : (data.tickets || []))
    } catch (err) {
      setError(err.message || 'No se pudieron cargar tus entradas')
    } finally {
      setLoading(false)
    }
  }, [authFetch])

  useEffect(() => { fetchTickets() }, [fetchTickets])

  const handleList = async (price) => {
    setActionLoading(true)
    setMessage('')
    setActionError('')
    try {
      const res = await authFetch('/api/transactions/list', {
        method: 'POST',
        body: JSON.stringify({ event_id: listTarget.event_id, ticket_id: listTarget.ticket_id, price }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`)
      setMessage(`Entrada ${listTarget.ticket_id} publicada a ${formatCurrency(price)}.`)
      setListTarget(null)
      fetchTickets()
    } catch (err) {
      setActionError(err.message || 'Error al publicar')
    } finally {
      setActionLoading(false)
    }
  }

  const handleUnlist = async (ticket) => {
    setActionLoading(true)
    setMessage('')
    setActionError('')
    try {
      const res = await authFetch(`/api/transactions/list/${ticket.event_id}/${ticket.ticket_id}`, {
        method: 'DELETE',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`)
      setMessage(`Publicación de ${ticket.ticket_id} cancelada.`)
      fetchTickets()
    } catch (err) {
      setActionError(err.message || 'Error al cancelar')
    } finally {
      setActionLoading(false)
    }
  }

  const canList = (ticket) => {
    if (ticket.event_status === 'suspended') return false
    if (ticket.event_rules?.nominada) return false
    if (ticket.event_rules?.max_reventas != null && ticket.resale_count >= ticket.event_rules.max_reventas) return false
    if (ticket.event_rules?.ventana_venta) {
      // ventana_venta check would need event date — skip for now, backend validates
    }
    return true
  }

  return (
    <main className="page">
      <div className="page-header"><h1>Mis Entradas</h1></div>

      {message && <div className="alert alert-success">{message}</div>}
      {actionError && <div className="alert alert-error">{actionError}</div>}

      {loading && (
        <div className="loading-container">
          <div className="loading-spinner" />
          <span>Cargando tus entradas…</span>
        </div>
      )}

      {!loading && error && <div className="alert alert-error">{error}</div>}

      {!loading && !error && tickets.length === 0 && (
        <div className="empty-state">
          <h3>No tenés entradas aún</h3>
          <p>Comprá tickets en los <a href="/events">eventos disponibles</a>.</p>
        </div>
      )}

      {!loading && !error && tickets.length > 0 && (
        <div className="my-tickets-list">
          {tickets.map((ticket, idx) => (
            <div key={ticket.ticket_id || idx} className="my-ticket-card">
              <div className="my-ticket-header">
                <span className="my-ticket-event">
                  {ticket.event_name || 'Evento desconocido'}
                </span>
                {ticket.listed
                  ? <span className="badge badge-listed">En venta · {formatCurrency(ticket.listing_price)}</span>
                  : <span className="badge badge-available">Activa</span>
                }
              </div>

              <div className="my-ticket-details">
                <div className="my-ticket-detail">
                  <strong>Ticket ID:</strong> <span>#{ticket.ticket_id}</span>
                </div>
                <div className="my-ticket-detail">
                  <strong>Wallet:</strong>{' '}
                  <span>
                    {(ticket.owner_wallet || ticket.wallet_address)
                      ? (ticket.owner_wallet || ticket.wallet_address).slice(0, 24) + '…'
                      : '—'}
                  </span>
                </div>
                <div className="my-ticket-detail">
                  <strong>Reventas:</strong>{' '}
                  <span>
                    {ticket.resale_count ?? 0}
                    {ticket.event_rules?.max_reventas != null ? ` / ${ticket.event_rules.max_reventas}` : ''}
                  </span>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                {ticket.listed ? (
                  <button
                    className="btn btn-secondary btn-sm"
                    disabled={actionLoading}
                    onClick={() => handleUnlist(ticket)}
                  >
                    Cancelar venta
                  </button>
                ) : canList(ticket) ? (
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => { setMessage(''); setActionError(''); setListTarget(ticket) }}
                  >
                    Poner en venta
                  </button>
                ) : (
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                    {ticket.event_rules?.nominada ? 'Entrada nominada' : 'Sin reventas disponibles'}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {listTarget && (
        <ListModal
          ticket={listTarget}
          loading={actionLoading}
          onClose={() => setListTarget(null)}
          onSubmit={handleList}
        />
      )}
    </main>
  )
}
