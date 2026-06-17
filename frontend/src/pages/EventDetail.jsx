import React, { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import TicketCard from '../components/TicketCard.jsx'
import BlockchainViewer from '../components/BlockchainViewer.jsx'

function formatDate(dateStr) {
  if (!dateStr) return 'Fecha por confirmar'
  const d = new Date(dateStr)
  return d.toLocaleDateString('es-AR', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function formatCurrency(amount) {
  if (amount == null) return '-'
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0
  }).format(amount)
}

export default function EventDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user, authFetch } = useAuth()

  const [event, setEvent] = useState(null)
  const [blocks, setBlocks] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [buyingTicket, setBuyingTicket] = useState(null) // ticket id being bought
  const [buyMessage, setBuyMessage] = useState('')
  const [buyError, setBuyError] = useState('')

  useEffect(() => {
    document.title = event ? `${event.name} — TicketChain` : 'Evento — TicketChain'
  }, [event])

  const fetchEvent = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/events/${id}`)
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.detail || data.message || `Error ${res.status}`)
      }
      const data = await res.json()
      setEvent(data)
    } catch (err) {
      setError(err.message || 'No se pudo cargar el evento')
    } finally {
      setLoading(false)
    }
  }, [id])

  const fetchBlocks = useCallback(async () => {
    try {
      const res = await fetch(`/api/events/${id}/blockchain`)
      if (!res.ok) return
      const data = await res.json()
      const blockList = Array.isArray(data) ? data : (data.blocks || data.chain || [])
      setBlocks(blockList.slice(-5))
    } catch {
      // Blockchain puede no estar disponible todavía
    }
  }, [id])

  useEffect(() => {
    fetchEvent()
    fetchBlocks()
  }, [fetchEvent, fetchBlocks])

  const handleBuy = async (ticket) => {
    if (!user) {
      navigate('/login')
      return
    }

    setBuyingTicket(ticket.id)
    setBuyMessage('')
    setBuyError('')

    try {
      const res = await authFetch('/api/transactions/buy', {
        method: 'POST',
        body: JSON.stringify({ event_id: event.id, ticket_id: ticket.id })
      })

      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        throw new Error(data.detail || data.message || `Error ${res.status}`)
      }

      setBuyMessage(`Transacción encolada — confirmación pendiente. ID: ${data.transaction_id || data.id || '(procesando)'}`)
      // Refrescar el evento para actualizar disponibilidad
      fetchEvent()
      fetchBlocks()
    } catch (err) {
      setBuyError(err.message || 'No se pudo procesar la compra')
    } finally {
      setBuyingTicket(null)
    }
  }

  if (loading) {
    return (
      <main className="page">
        <div className="loading-container">
          <div className="loading-spinner" />
          <span>Cargando evento…</span>
        </div>
      </main>
    )
  }

  if (error) {
    return (
      <main className="page">
        <div className="alert alert-error">{error}</div>
        <button className="btn btn-secondary" onClick={() => navigate('/events')}>
          ← Volver a eventos
        </button>
      </main>
    )
  }

  if (!event) return null

  const tickets = event.tickets || []
  const availableTickets = tickets.filter(
    t => t.status === 'available' || t.status === 'disponible'
  )
  const rules = event.rules || {}

  return (
    <main className="page">
      <button
        className="btn btn-secondary btn-sm"
        onClick={() => navigate('/events')}
        style={{ marginBottom: '1.5rem' }}
      >
        ← Volver a eventos
      </button>

      <div className="event-detail-header">
        <h1>{event.name}</h1>
        <div className="event-detail-meta">
          <span>📅 {formatDate(event.date)}</span>
          <span>📍 {event.venue}</span>
          <span>💰 {formatCurrency(event.price)}</span>
          <span>🎟 {availableTickets.length} disponibles de {tickets.length}</span>
        </div>
        {event.description && (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem', marginTop: '0.5rem' }}>
            {event.description}
          </p>
        )}
      </div>

      {buyMessage && (
        <div className="alert alert-success" style={{ marginBottom: '1rem' }}>
          {buyMessage}
        </div>
      )}
      {buyError && (
        <div className="alert alert-error" style={{ marginBottom: '1rem' }}>
          {buyError}
        </div>
      )}

      <div className="event-detail-body">
        {/* Left column: tickets */}
        <div>
          <div className="event-rules">
            <h3>Reglas del evento</h3>
            <div className="rules-grid">
              <div className="rule-item">
                <span className="rule-label">Precio máximo reventa</span>
                <span className="rule-value">
                  {rules.precio_max
                    ? `${rules.precio_max}% del precio original`
                    : '—'}
                </span>
              </div>
              <div className="rule-item">
                <span className="rule-label">Máx. reventas</span>
                <span className="rule-value">
                  {rules.max_reventas != null ? rules.max_reventas : '—'}
                </span>
              </div>
              <div className="rule-item">
                <span className="rule-label">Entrada nominada</span>
                <span className="rule-value">
                  {rules.nominada === true ? 'Sí' : rules.nominada === false ? 'No' : '—'}
                </span>
              </div>
              <div className="rule-item">
                <span className="rule-label">Ventana de venta</span>
                <span className="rule-value">
                  {rules.ventana_venta
                    ? `${rules.ventana_venta}h antes del evento`
                    : '—'}
                </span>
              </div>
            </div>
          </div>

          <div className="tickets-section">
            <h2>Tickets</h2>
            {tickets.length === 0 ? (
              <div className="empty-state">
                <p>No hay tickets registrados para este evento.</p>
              </div>
            ) : (
              <div className="tickets-list">
                {tickets.map(ticket => (
                  <TicketCard
                    key={ticket.id}
                    ticket={ticket}
                    event={event}
                    showBuy={!!user}
                    onBuy={buyingTicket === ticket.id ? null : handleBuy}
                  />
                ))}
              </div>
            )}

            {!user && availableTickets.length > 0 && (
              <div className="notice" style={{ marginTop: '1rem' }}>
                <a href="/login">Iniciá sesión</a> para comprar entradas.
              </div>
            )}
          </div>
        </div>

        {/* Right column: blockchain */}
        <div>
          <BlockchainViewer blocks={blocks} />
        </div>
      </div>
    </main>
  )
}
