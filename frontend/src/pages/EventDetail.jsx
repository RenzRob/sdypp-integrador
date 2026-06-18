import React, { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
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
  const { user, isAdmin, authFetch } = useAuth()

  const [event, setEvent] = useState(null)
  const [blocks, setBlocks] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [buying, setBuying] = useState(false)
  const [buyMessage, setBuyMessage] = useState('')
  const [buyError, setBuyError] = useState('')
  const [listings, setListings] = useState([])
  const [buyingListed, setBuyingListed] = useState(null)

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
        throw new Error(data.error || data.detail || data.message || `Error ${res.status}`)
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
      // blockchain puede no estar disponible todavía
    }
  }, [id])

  const fetchListings = useCallback(async () => {
    try {
      const res = await fetch(`/api/transactions/listings/${id}`)
      if (!res.ok) return
      const data = await res.json()
      setListings(Array.isArray(data) ? data : [])
    } catch {
      // listings no crítico
    }
  }, [id])

  useEffect(() => {
    fetchEvent()
    fetchBlocks()
    fetchListings()
  }, [fetchEvent, fetchBlocks, fetchListings])

  const handleBuy = async () => {
    if (!user) {
      navigate('/login')
      return
    }

    setBuying(true)
    setBuyMessage('')
    setBuyError('')

    try {
      const res = await authFetch('/api/transactions/buy', {
        method: 'POST',
        body: JSON.stringify({ event_id: event.id }),
      })

      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        throw new Error(data.error || data.detail || data.message || `Error ${res.status}`)
      }

      setBuyMessage(`Entrada asignada: ${data.ticket_id} — confirmación pendiente en blockchain.`)
      fetchEvent()
      fetchBlocks()
      fetchListings()
    } catch (err) {
      setBuyError(err.message || 'No se pudo procesar la compra')
    } finally {
      setBuying(false)
    }
  }

  const handleBuyListed = async (listing) => {
    if (!user) { navigate('/login'); return }
    setBuyingListed(listing.ticket_id)
    setBuyMessage('')
    setBuyError('')
    try {
      const res = await authFetch('/api/transactions/buy-listed', {
        method: 'POST',
        body: JSON.stringify({ event_id: event.id, ticket_id: listing.ticket_id }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || data.detail || `Error ${res.status}`)
      setBuyMessage(`Entrada ${listing.ticket_id} comprada — confirmación pendiente en blockchain.`)
      fetchEvent()
      fetchBlocks()
      fetchListings()
    } catch (err) {
      setBuyError(err.message || 'No se pudo procesar la compra')
    } finally {
      setBuyingListed(null)
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

  const suspended = event.status === 'suspended'
  const available = event.available_tickets ?? 0
  const total = event.total_tickets ?? 0
  const rules = event.rules || {}
  const isCreator = isAdmin && event.creator_id === user?.id

  return (
    <main className="page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <button className="btn btn-secondary btn-sm" onClick={() => navigate('/events')}>
          ← Volver a eventos
        </button>
        {isCreator && (
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => navigate(`/admin/events/${event.id}/edit`)}
          >
            Editar evento
          </button>
        )}
      </div>

      {suspended && (
        <div className="alert alert-warning" style={{ marginBottom: '1.5rem' }}>
          Este evento está suspendido. No se pueden comprar ni transferir entradas.
        </div>
      )}

      <div className="event-detail-header">
        <h1>{event.name}</h1>
        <div className="event-detail-meta">
          <span>📅 {formatDate(event.date)}</span>
          <span>📍 {event.venue}</span>
          <span>💰 {formatCurrency(event.price)}</span>
          <span>🎟 {available.toLocaleString('es-AR')} / {total.toLocaleString('es-AR')} disponibles</span>
        </div>
        {event.description && (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem', marginTop: '0.5rem' }}>
            {event.description}
          </p>
        )}
      </div>

      {buyMessage && (
        <div className="alert alert-success" style={{ margin: '1rem 0' }}>{buyMessage}</div>
      )}
      {buyError && (
        <div className="alert alert-error" style={{ margin: '1rem 0' }}>{buyError}</div>
      )}

      <div className="event-detail-body">
        <div>
          <div className="event-rules">
            <h3>Reglas del evento</h3>
            <div className="rules-grid">
              <div className="rule-item">
                <span className="rule-label">Precio máximo reventa</span>
                <span className="rule-value">
                  {rules.precio_max ? `${rules.precio_max}% del precio original` : '—'}
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
                  {rules.ventana_venta ? `${rules.ventana_venta}h antes del evento` : '—'}
                </span>
              </div>
            </div>
          </div>

          <div className="tickets-section">
            <h2>Entradas</h2>
            {suspended ? (
              <div className="empty-state">
                <p>El evento está suspendido. No se puede comprar entradas.</p>
              </div>
            ) : available === 0 ? (
              <div className="empty-state">
                <p>No quedan entradas disponibles.</p>
              </div>
            ) : !user ? (
              <div className="notice" style={{ marginTop: '0.5rem' }}>
                <a href="/login">Iniciá sesión</a> para comprar entradas.
              </div>
            ) : isAdmin ? (
              <div className="notice" style={{ marginTop: '0.5rem' }}>
                Las cuentas de administrador no pueden comprar entradas.
              </div>
            ) : (
              <div style={{ marginTop: '1rem' }}>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1rem' }}>
                  Quedan <strong>{available.toLocaleString('es-AR')}</strong> entradas al precio de <strong>{formatCurrency(event.price)}</strong>.
                </p>
                <button
                  className="btn btn-primary"
                  onClick={handleBuy}
                  disabled={buying}
                >
                  {buying ? (
                    <>
                      <span className="loading-spinner loading-spinner-sm" />
                      Procesando…
                    </>
                  ) : 'Comprar entrada'}
                </button>
              </div>
            )}
          </div>

          {!suspended && listings.length > 0 && (
            <div className="tickets-section" style={{ marginTop: '1.5rem' }}>
              <h2>Entradas en reventa</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.75rem' }}>
                {listings.map(listing => {
                  const isOwn = user?.wallet_address === listing.seller_wallet
                  return (
                    <div
                      key={listing.ticket_id}
                      className="card"
                      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}
                    >
                      <div>
                        <strong>#{listing.ticket_id}</strong>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                          Vendedor: {listing.seller_wallet}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                        <strong style={{ fontSize: '1rem' }}>{formatCurrency(listing.price)}</strong>
                        {!user ? (
                          <a href="/login" className="btn btn-secondary btn-sm">Ingresar para comprar</a>
                        ) : isOwn ? (
                          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Tu publicación</span>
                        ) : isAdmin ? (
                          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Admin</span>
                        ) : (
                          <button
                            className="btn btn-primary btn-sm"
                            disabled={buyingListed === listing.ticket_id}
                            onClick={() => handleBuyListed(listing)}
                          >
                            {buyingListed === listing.ticket_id ? 'Procesando…' : 'Comprar'}
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        <div>
          <BlockchainViewer blocks={blocks} />
        </div>
      </div>
    </main>
  )
}
