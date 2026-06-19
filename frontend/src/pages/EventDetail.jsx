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
  const [activeTab, setActiveTab] = useState('oficial')

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
      setBlocks(blockList)
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

  const priceDiff = (listingPrice) => {
    if (!event.price) return null
    const diff = ((listingPrice - event.price) / event.price) * 100
    return diff
  }

  const tabBtn = (tab, label) => ({
    padding: '0.65rem 1.25rem',
    background: 'none',
    border: 'none',
    borderBottom: activeTab === tab ? '2px solid var(--accent)' : '2px solid transparent',
    marginBottom: '-2px',
    color: activeTab === tab ? 'var(--accent)' : 'var(--text-muted)',
    fontWeight: activeTab === tab ? '600' : '400',
    cursor: 'pointer',
    fontSize: '0.95rem',
    display: 'flex',
    alignItems: 'center',
    gap: '0.4rem',
  })

  return (
    <div style={{
      width: '100%',
      height: 'calc(100vh - 60px)',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      boxSizing: 'border-box',
    }}>

      {/* ── HEADER (full width, sin scroll) ── */}
      <div style={{ flexShrink: 0, padding: '1.25rem 1.5rem 0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <button className="btn btn-secondary btn-sm" onClick={() => navigate('/events')}>
            ← Volver a eventos
          </button>
          {isCreator && (
            <button className="btn btn-secondary btn-sm" onClick={() => navigate(`/admin/events/${event.id}/edit`)}>
              Editar evento
            </button>
          )}
        </div>

        {suspended && (
          <div className="alert alert-warning" style={{ marginBottom: '0.75rem' }}>
            Este evento está suspendido. No se pueden comprar ni transferir entradas.
          </div>
        )}

        <h1 style={{ fontSize: '1.75rem', marginBottom: '0.4rem' }}>{event.name}</h1>
        <div className="event-detail-meta" style={{ marginBottom: '0.75rem' }}>
          <span>📅 {formatDate(event.date)}</span>
          <span>📍 {event.venue}</span>
          <span>💰 {formatCurrency(event.price)}</span>
          <span>🎟 {available.toLocaleString('es-AR')} / {total.toLocaleString('es-AR')} disponibles</span>
        </div>
        {event.description && (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '0.75rem' }}>
            {event.description}
          </p>
        )}

        <div className="event-rules" style={{ marginBottom: '0.75rem' }}>
          <h3>Reglas del evento</h3>
          <div className="rules-grid">
            <div className="rule-item">
              <span className="rule-label">Precio máx. reventa</span>
              <span className="rule-value">{rules.precio_max ? `+${rules.precio_max}% del original` : '—'}</span>
            </div>
            <div className="rule-item">
              <span className="rule-label">Máx. reventas</span>
              <span className="rule-value">{rules.max_reventas != null ? rules.max_reventas : '—'}</span>
            </div>
            <div className="rule-item">
              <span className="rule-label">Entrada nominada</span>
              <span className="rule-value">{rules.nominada === true ? 'Sí' : rules.nominada === false ? 'No' : '—'}</span>
            </div>
            <div className="rule-item">
              <span className="rule-label">Ventana de venta</span>
              <span className="rule-value">{rules.ventana_venta ? `${rules.ventana_venta}h antes` : '—'}</span>
            </div>
          </div>
        </div>

        {buyMessage && <div className="alert alert-success" style={{ marginBottom: '0.5rem' }}>{buyMessage}</div>}
        {buyError   && <div className="alert alert-error"   style={{ marginBottom: '0.5rem' }}>{buyError}</div>}
      </div>

      {/* ── SPLIT (2 columnas con scroll independiente) ── */}
      <div style={{
        flex: 1,
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '1rem',
        overflow: 'hidden',
        padding: '0.75rem 1.5rem 1.25rem',
      }}>

        {/* Panel izquierdo: compra oficial + mercado secundario */}
        <div style={{
          overflowY: 'auto',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          display: 'flex',
          flexDirection: 'column',
        }}>
          {/* Tabs */}
          <div style={{
            display: 'flex',
            borderBottom: '2px solid var(--border)',
            padding: '0 1rem',
            flexShrink: 0,
          }}>
            <button onClick={() => setActiveTab('oficial')} style={tabBtn('oficial')}>
              🎟 Compra oficial
            </button>
            <button onClick={() => setActiveTab('reventa')} style={tabBtn('reventa')}>
              🔄 Mercado secundario
              {listings.length > 0 && (
                <span style={{
                  background: 'var(--accent)', color: '#fff',
                  borderRadius: '999px', fontSize: '0.7rem',
                  fontWeight: '700', padding: '0.1rem 0.45rem', lineHeight: '1.4',
                }}>
                  {listings.length}
                </span>
              )}
            </button>
          </div>

          <div style={{ padding: '1.25rem', flex: 1 }}>
            {/* Tab: Compra oficial */}
            {activeTab === 'oficial' && (
              suspended ? (
                <div className="empty-state"><p>El evento está suspendido.</p></div>
              ) : available === 0 ? (
                <div className="empty-state"><p>No quedan entradas disponibles en venta oficial.</p></div>
              ) : !user ? (
                <div className="notice"><a href="/login">Iniciá sesión</a> para comprar entradas.</div>
              ) : isAdmin ? (
                <div className="notice">Las cuentas de administrador no pueden comprar entradas.</div>
              ) : (
                <div style={{
                  background: 'var(--card-bg)', border: '1px solid var(--border)',
                  borderRadius: '12px', padding: '1.5rem',
                  display: 'flex', alignItems: 'center',
                  justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem',
                }}>
                  <div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>
                      Precio oficial
                    </div>
                    <div style={{ fontSize: '1.75rem', fontWeight: '700' }}>{formatCurrency(event.price)}</div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                      {available.toLocaleString('es-AR')} entradas disponibles
                    </div>
                  </div>
                  <button className="btn btn-primary" onClick={handleBuy} disabled={buying} style={{ minWidth: '160px' }}>
                    {buying ? <><span className="loading-spinner loading-spinner-sm" />Procesando…</> : 'Compra oficial'}
                  </button>
                </div>
              )
            )}

            {/* Tab: Mercado secundario */}
            {activeTab === 'reventa' && (
              suspended ? (
                <div className="empty-state"><p>El evento está suspendido.</p></div>
              ) : rules.nominada ? (
                <div className="empty-state"><p>Este evento no permite reventa de entradas.</p></div>
              ) : listings.length === 0 ? (
                <div className="empty-state">
                  <p style={{ marginBottom: '0.5rem' }}>No hay entradas en reventa por ahora.</p>
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                    Si tenés una entrada, podés publicarla desde <a href="/my-tickets">Mis entradas</a>.
                  </p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {listings.map(listing => {
                    const isOwn = user?.wallet_address === listing.seller_wallet
                    const diff = priceDiff(listing.price)
                    const diffLabel = diff != null ? `${diff > 0 ? '+' : ''}${diff.toFixed(0)}%` : null
                    const diffColor = diff == null ? 'var(--text-muted)' : diff <= 0 ? '#22c55e' : diff <= 15 ? '#f59e0b' : '#ef4444'

                    return (
                      <div key={listing.ticket_id} style={{
                        background: 'var(--card-bg)', border: '1px solid var(--border)',
                        borderRadius: '12px', padding: '1rem 1.25rem',
                        display: 'flex', alignItems: 'center',
                        justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap',
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                          <div style={{
                            width: '40px', height: '40px', borderRadius: '50%',
                            background: 'var(--border)', display: 'flex',
                            alignItems: 'center', justifyContent: 'center',
                            fontSize: '1.1rem', flexShrink: 0,
                          }}>🎫</div>
                          <div>
                            <div style={{ fontWeight: '600', fontSize: '0.95rem' }}>
                              Entrada #{listing.ticket_id.slice(-6)}
                            </div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                              {listing.seller_wallet}
                            </div>
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', flexWrap: 'wrap' }}>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: '1.2rem', fontWeight: '700' }}>{formatCurrency(listing.price)}</div>
                            {diffLabel && (
                              <div style={{ fontSize: '0.75rem', color: diffColor, fontWeight: '600' }}>
                                {diffLabel} vs oficial
                              </div>
                            )}
                          </div>
                          {!user ? (
                            <a href="/login" className="btn btn-secondary btn-sm">Ingresar</a>
                          ) : isOwn ? (
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', background: 'var(--border)', borderRadius: '6px', padding: '0.3rem 0.6rem' }}>
                              Tu publicación
                            </span>
                          ) : isAdmin ? null : (
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
              )
            )}
          </div>
        </div>

        {/* Panel derecho: blockchain completa */}
        <div style={{
          overflowY: 'auto',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          padding: '1.25rem',
        }}>
          <BlockchainViewer blocks={blocks} />
        </div>
      </div>
    </div>
  )
}
