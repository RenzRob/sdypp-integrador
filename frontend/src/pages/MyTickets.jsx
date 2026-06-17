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

function ResellModal({ ticket, onClose, onSubmit, loading }) {
  const [price, setPrice] = useState('')
  const [walletDest, setWalletDest] = useState('')
  const [error, setError] = useState('')

  const maxPrice = ticket.event?.rules?.precio_max
    ? Math.floor((ticket.event.price ?? ticket.price ?? 0) * (ticket.event.rules.precio_max / 100))
    : null

  const handleSubmit = (e) => {
    e.preventDefault()
    setError('')

    const priceNum = parseFloat(price)
    if (isNaN(priceNum) || priceNum <= 0) {
      setError('Ingresá un precio válido.')
      return
    }
    if (maxPrice != null && priceNum > maxPrice) {
      setError(`El precio no puede superar ${formatCurrency(maxPrice)} (${ticket.event?.rules?.precio_max}% del precio original).`)
      return
    }
    if (!walletDest.trim()) {
      setError('Ingresá la wallet destino.')
      return
    }

    onSubmit({ price: priceNum, wallet_dest: walletDest.trim() })
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h2>Revender entrada</h2>
        <p className="modal-subtitle">
          Ticket #{ticket.ticket_id || ticket.id}
          {ticket.event_name ? ` — ${ticket.event_name}` : ''}
        </p>

        {error && <div className="alert alert-error">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="resell-price">
              Precio de reventa
              {maxPrice != null && (
                <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>
                  {' '}(máx. {formatCurrency(maxPrice)})
                </span>
              )}
            </label>
            <input
              id="resell-price"
              type="number"
              min="1"
              max={maxPrice || undefined}
              step="1"
              value={price}
              onChange={e => setPrice(e.target.value)}
              placeholder="Ej: 5000"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="wallet-dest">Wallet destino</label>
            <input
              id="wallet-dest"
              type="text"
              value={walletDest}
              onChange={e => setWalletDest(e.target.value)}
              placeholder="Wallet del comprador"
              required
            />
          </div>

          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={loading}>
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? (
                <>
                  <span className="loading-spinner loading-spinner-sm" />
                  Procesando…
                </>
              ) : 'Confirmar reventa'}
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
  const [resellTarget, setResellTarget] = useState(null)
  const [resellLoading, setResellLoading] = useState(false)
  const [resellMessage, setResellMessage] = useState('')
  const [resellError, setResellError] = useState('')

  useEffect(() => {
    document.title = 'Mis Entradas — TicketChain'
  }, [])

  const fetchTickets = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await authFetch('/api/transactions/my-tickets')
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.detail || data.message || `Error ${res.status}`)
      }
      const data = await res.json()
      setTickets(Array.isArray(data) ? data : (data.tickets || data.results || []))
    } catch (err) {
      setError(err.message || 'No se pudieron cargar tus entradas')
    } finally {
      setLoading(false)
    }
  }, [authFetch])

  useEffect(() => {
    fetchTickets()
  }, [fetchTickets])

  const handleResellSubmit = async ({ price, wallet_dest }) => {
    setResellLoading(true)
    setResellMessage('')
    setResellError('')

    try {
      const res = await authFetch('/api/transactions/resell', {
        method: 'POST',
        body: JSON.stringify({
          ticket_id: resellTarget.ticket_id || resellTarget.id,
          price,
          wallet_dest
        })
      })

      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        throw new Error(data.detail || data.message || `Error ${res.status}`)
      }

      setResellMessage(`Reventa encolada exitosamente. ID: ${data.transaction_id || data.id || '(procesando)'}`)
      setResellTarget(null)
      fetchTickets()
    } catch (err) {
      setResellError(err.message || 'Error al procesar la reventa')
    } finally {
      setResellLoading(false)
    }
  }

  const canResell = (ticket) => {
    const rules = ticket.event?.rules || {}
    if (rules.nominada === true) return false
    const maxReventas = rules.max_reventas ?? 0
    const countReventas = ticket.count_reventas ?? ticket.resale_count ?? 0
    return maxReventas > 0 && countReventas < maxReventas
  }

  return (
    <main className="page">
      <div className="page-header">
        <h1>Mis Entradas</h1>
      </div>

      {resellMessage && (
        <div className="alert alert-success">{resellMessage}</div>
      )}
      {resellError && (
        <div className="alert alert-error">{resellError}</div>
      )}

      {loading && (
        <div className="loading-container">
          <div className="loading-spinner" />
          <span>Cargando tus entradas…</span>
        </div>
      )}

      {!loading && error && (
        <div className="alert alert-error">{error}</div>
      )}

      {!loading && !error && tickets.length === 0 && (
        <div className="empty-state">
          <h3>No tenés entradas aún</h3>
          <p>Comprá tickets en los <a href="/events">eventos disponibles</a>.</p>
        </div>
      )}

      {!loading && !error && tickets.length > 0 && (
        <div className="my-tickets-list">
          {tickets.map((ticket, idx) => (
            <div key={ticket.ticket_id || ticket.id || idx} className="my-ticket-card">
              <div className="my-ticket-header">
                <span className="my-ticket-event">
                  {ticket.event_name || ticket.event?.name || 'Evento desconocido'}
                </span>
                <span className="badge badge-available">Activa</span>
              </div>

              <div className="my-ticket-details">
                <div className="my-ticket-detail">
                  <strong>Ticket ID:</strong>{' '}
                  <span>#{ticket.ticket_id || ticket.id}</span>
                </div>
                <div className="my-ticket-detail">
                  <strong>Wallet:</strong>{' '}
                  <span>
                    {ticket.wallet_address
                      ? ticket.wallet_address.slice(0, 24) + '…'
                      : '—'}
                  </span>
                </div>
                <div className="my-ticket-detail">
                  <strong>Reventas:</strong>{' '}
                  <span>
                    {ticket.count_reventas ?? ticket.resale_count ?? 0}
                    {ticket.event?.rules?.max_reventas != null
                      ? ` / ${ticket.event.rules.max_reventas}`
                      : ''}
                  </span>
                </div>
              </div>

              {canResell(ticket) ? (
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    setResellMessage('')
                    setResellError('')
                    setResellTarget(ticket)
                  }}
                >
                  Revender
                </button>
              ) : (
                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  {ticket.event?.rules?.nominada
                    ? 'Entrada nominada — no se puede revender'
                    : 'Sin reventas disponibles'}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {resellTarget && (
        <ResellModal
          ticket={resellTarget}
          loading={resellLoading}
          onClose={() => setResellTarget(null)}
          onSubmit={handleResellSubmit}
        />
      )}
    </main>
  )
}
