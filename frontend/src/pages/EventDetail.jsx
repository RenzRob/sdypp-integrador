import React, { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import BlockchainViewer from '../components/BlockchainViewer.jsx'
import { ArrowLeft, Edit, Calendar, MapPin, DollarSign, Ticket, ShoppingCart, Repeat, Ban, CheckCircle, AlertCircle, ArrowUpRight, PanelRightClose, PanelRightOpen, X } from 'lucide-react'

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
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [searchParams, setSearchParams] = useSearchParams()

  useEffect(() => {
    if (searchParams.get('success') === 'true') {
      const tid = searchParams.get('ticket_id')
      setBuyMessage(`Entrada ${tid} confirmada — procesando en blockchain.`)
      setSearchParams({}, { replace: true })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    document.title = event ? `${event.name} — TicketChain` : 'Evento — TicketChain'
  }, [event])

  const fetchEvent = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const res = await fetch(`/api/events/${id}`)
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || d.detail || d.message || `Error ${res.status}`) }
      const data = await res.json()
      setEvent(data)
    } catch (err) { setError(err.message || 'No se pudo cargar el evento') }
    finally { setLoading(false) }
  }, [id])

  const fetchBlocks = useCallback(async () => {
    try {
      const res = await fetch(`/api/events/${id}/blockchain`)
      if (!res.ok) return
      const data = await res.json()
      setBlocks(Array.isArray(data) ? data : (data.blocks || data.chain || []))
    } catch {}
  }, [id])

  const fetchListings = useCallback(async () => {
    try {
      const res = await fetch(`/api/transactions/listings/${id}`)
      if (!res.ok) return
      const data = await res.json()
      setListings(Array.isArray(data) ? data : [])
    } catch {}
  }, [id])

  useEffect(() => { fetchEvent(); fetchBlocks(); fetchListings() }, [fetchEvent, fetchBlocks, fetchListings])

  const handleBuy = async () => {
    if (!user) { navigate('/login'); return }
    setBuying(true); setBuyMessage(''); setBuyError('')
    try {
      const res = await authFetch('/api/transactions/buy', {
        method: 'POST', body: JSON.stringify({ event_id: event.id }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || data.detail || data.message || `Error ${res.status}`)
      const params = new URLSearchParams({
        tx_id: data.tx_id, ticket_id: data.ticket_id,
        event_id: data.event_id, event_name: data.event_name, price: data.price,
      })
      window.open(`/checkout?${params}`, '_blank')
    } catch (err) { setBuyError(err.message || 'No se pudo procesar la compra') }
    finally { setBuying(false) }
  }

  const handleBuyListed = async (listing) => {
    if (!user) { navigate('/login'); return }
    setBuyingListed(listing.ticket_id); setBuyMessage(''); setBuyError('')
    try {
      const res = await authFetch('/api/transactions/buy-listed', {
        method: 'POST', body: JSON.stringify({ event_id: event.id, ticket_id: listing.ticket_id }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || data.detail || `Error ${res.status}`)
      const params = new URLSearchParams({
        tx_id: data.tx_id, ticket_id: data.ticket_id,
        event_id: data.event_id, event_name: data.event_name, price: data.price,
      })
      window.open(`/checkout?${params}`, '_blank')
    } catch (err) { setBuyError(err.message || 'No se pudo procesar la compra') }
    finally { setBuyingListed(null) }
  }

  if (loading) {
    return (
      <main className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-[#a1a1aa]"><div className="spinner" /><span className="text-sm">Cargando evento…</span></div>
      </main>
    )
  }

  if (error) {
    return (
      <main className="flex-1 max-w-[1280px] mx-auto px-6 py-8">
        <div className="max-w-lg mx-auto p-4 rounded-xl bg-error/10 border border-error/20 text-error text-sm mb-4">{error}</div>
        <div className="flex justify-center"><button className="btn btn-ghost" onClick={() => navigate('/events')}><ArrowLeft className="w-4 h-4" /> Volver</button></div>
      </main>
    )
  }

  if (!event) return null

  const suspended = event.status === 'suspended'
  const completed = event.status === 'completed'
  const past = completed || (event.date && new Date(event.date).getTime() <= Date.now())
  const available = event.available_tickets ?? 0
  const total = event.total_tickets ?? 0
  const rules = event.rules || {}
  const isCreator = isAdmin && event.creator_id === user?.id
  const priceDiff = (lp) => event.price ? ((lp - event.price) / event.price) * 100 : null

  const TabButton = ({ tab, label, icon, count }) => (
    <button
      onClick={() => setActiveTab(tab)}
      className={`flex items-center gap-2 px-5 py-3 text-sm font-medium transition-all duration-200 border-b-2 -mb-[2px] ${
        activeTab === tab
          ? 'text-[#6c63ff] border-[#6c63ff]'
          : 'text-[#71717a] border-transparent hover:text-[#a1a1aa]'
      }`}
    >
      {icon}{label}
      {count > 0 && <span className="px-1.5 py-0.5 rounded-full bg-[#6c63ff] text-white text-[10px] font-bold">{count}</span>}
    </button>
  )

  return (
    <main className="flex-1 overflow-y-auto">
      <div className="max-w-[1280px] mx-auto px-6 py-6">
        {/* toggle button for mobile */}
        <button
          className="fixed bottom-6 right-6 z-40 w-11 h-11 rounded-xl bg-[#6c63ff] shadow-[0_0_20px_rgba(108,99,255,0.3)] flex items-center justify-center text-white md:hidden"
          onClick={() => setSidebarOpen(o => !o)}
        >
          <PanelRightOpen className="w-5 h-5" />
        </button>

        <div className={`grid grid-cols-1 ${sidebarOpen ? 'lg:grid-cols-[1fr_320px]' : ''} gap-6`}>
          {/* ── LEFT COLUMN ── */}
          <div>
            {/* back + edit */}
            <div className="flex items-center justify-between mb-4">
              <button className="btn btn-ghost btn-sm" onClick={() => navigate('/events')}><ArrowLeft className="w-4 h-4" /> Volver</button>
              <div className="flex items-center gap-2">
                {isCreator && <button className="btn btn-ghost btn-sm" onClick={() => navigate(`/admin/events/${event.id}/edit`)}><Edit className="w-4 h-4" /> Editar</button>}
                <button
                  className="hidden lg:flex btn btn-ghost btn-sm"
                  onClick={() => setSidebarOpen(o => !o)}
                  title={sidebarOpen ? 'Ocultar blockchain' : 'Mostrar blockchain'}
                >
                  {sidebarOpen ? <PanelRightClose className="w-4 h-4" /> : <PanelRightOpen className="w-4 h-4" />}
                  <span className="hidden xl:inline ml-1">{sidebarOpen ? 'Ocultar blockchain' : 'Blockchain'}</span>
                </button>
              </div>
            </div>

            {suspended && (
              <div className="flex items-center gap-2 p-3 rounded-xl bg-warning/10 border border-warning/20 text-warning text-sm mb-4">
                <Ban className="w-4 h-4 flex-shrink-0" />Este evento está suspendido.
              </div>
            )}
            {past && (
              <div className="flex items-center gap-2 p-3 rounded-xl bg-white/[0.04] border border-white/[0.06] text-[#71717a] text-sm mb-4">
                <CheckCircle className="w-4 h-4 flex-shrink-0" />Este evento finalizó.
              </div>
            )}

            <h1 className="text-2xl md:text-3xl font-bold tracking-tight mb-3">{event.name}</h1>

            <div className="flex flex-wrap items-center gap-4 text-sm text-[#a1a1aa] mb-4">
              <span className="flex items-center gap-1.5"><Calendar className="w-4 h-4 text-[#71717a]" />{formatDate(event.date)}</span>
              <span className="flex items-center gap-1.5"><MapPin className="w-4 h-4 text-[#71717a]" />{event.venue}</span>
              <span className="flex items-center gap-1.5"><DollarSign className="w-4 h-4 text-[#71717a]" />{formatCurrency(event.price)}</span>
            </div>

            {event.description && <p className="text-sm text-[#71717a] mb-4">{event.description}</p>}

            {/* STATS BAR */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 rounded-xl bg-white/[0.02] border border-white/[0.06] mb-4">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-widest text-[#71717a]">Disponibles</div>
                <div className="text-lg font-bold text-[#f4f4f5]">{available.toLocaleString('es-AR')} <span className="text-sm font-normal text-[#71717a]">/ {total.toLocaleString('es-AR')}</span></div>
              </div>
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-widest text-[#71717a]">Precio reventa</div>
                <div className="text-sm font-semibold text-[#f4f4f5]">{rules.precio_max ? `+${rules.precio_max}% máx` : '—'}</div>
              </div>
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-widest text-[#71717a]">Reventas</div>
                <div className="text-sm font-semibold text-[#f4f4f5]">{rules.max_reventas != null ? `${rules.max_reventas} máx` : '—'}</div>
              </div>
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-widest text-[#71717a]">Nominada</div>
                <div className="text-sm font-semibold text-[#f4f4f5]">{rules.nominada === true ? 'Sí' : 'No'}</div>
              </div>
            </div>

            {buyMessage && <div className="flex items-center gap-2 p-3 rounded-xl bg-success/10 border border-success/20 text-success text-sm mb-4"><CheckCircle className="w-4 h-4 flex-shrink-0" />{buyMessage}</div>}
            {buyError && <div className="flex items-center gap-2 p-3 rounded-xl bg-error/10 border border-error/20 text-error text-sm mb-4"><AlertCircle className="w-4 h-4 flex-shrink-0" />{buyError}</div>}

            {/* BUY / RESELL TABS */}
            <div className="border border-white/[0.06] rounded-xl overflow-hidden">
              <div className="flex items-center border-b border-white/[0.06] bg-white/[0.01]">
                <TabButton tab="oficial" label="Compra oficial" icon={<ShoppingCart className="w-4 h-4" />} />
                <TabButton tab="reventa" label="Mercado secundario" icon={<Repeat className="w-4 h-4" />} count={listings.length} />
              </div>

              <div className="p-6">
                {activeTab === 'oficial' && (
                  past ? (
                    <div className="flex flex-col items-center py-12 text-[#71717a]"><CheckCircle className="w-10 h-10 mb-3 text-white/[0.1]" /><p>Evento finalizado</p></div>
                  ) : suspended ? (
                    <div className="flex flex-col items-center py-12 text-[#71717a]"><Ban className="w-10 h-10 mb-3 text-white/[0.1]" /><p>Evento suspendido</p></div>
                  ) : available === 0 ? (
                    <div className="flex flex-col items-center py-12 text-[#71717a]"><Ticket className="w-10 h-10 mb-3 text-white/[0.1]" /><p>No quedan entradas en venta oficial</p></div>
                  ) : !user ? (
                    <div className="flex flex-col items-center py-12"><div className="p-4 rounded-2xl bg-accent/10 border border-accent/20 text-sm text-[#a1a1aa]"><a href="/login" className="text-[#6c63ff] font-medium">Iniciá sesión</a> para comprar entradas</div></div>
                  ) : isAdmin ? (
                    <div className="flex flex-col items-center py-12"><div className="p-4 rounded-2xl bg-accent/10 border border-accent/20 text-sm text-[#a1a1aa]">Las cuentas de administrador no pueden comprar entradas</div></div>
                  ) : (
                    <div className="max-w-sm mx-auto w-full">
                      <div className="rounded-2xl border border-white/[0.08] bg-[#121214] p-6 text-center">
                        <div className="text-[10px] font-semibold uppercase tracking-widest text-[#71717a] mb-1">Precio oficial</div>
                        <div className="text-4xl font-bold gradient-text mb-1">{formatCurrency(event.price)}</div>
                        <div className="text-sm text-[#71717a] mb-5">{available.toLocaleString('es-AR')} entradas disponibles</div>
                        <button className="btn btn-primary btn-lg w-full" onClick={handleBuy} disabled={buying}>
                          {buying ? <><span className="spinner-sm" /> Procesando…</> : <><ShoppingCart className="w-5 h-5" /> Comprar entrada</>}
                        </button>
                      </div>
                    </div>
                  )
                )}

                {activeTab === 'reventa' && (
                  past ? (
                    <div className="flex flex-col items-center py-12 text-[#71717a]"><CheckCircle className="w-10 h-10 mb-3 text-white/[0.1]" /><p>Evento finalizado</p></div>
                  ) : suspended ? (
                    <div className="flex flex-col items-center py-12 text-[#71717a]"><Ban className="w-10 h-10 mb-3 text-white/[0.1]" /><p>Evento suspendido</p></div>
                  ) : rules.nominada ? (
                    <div className="flex flex-col items-center py-12 text-[#71717a]"><Repeat className="w-10 h-10 mb-3 text-white/[0.1]" /><p>Reventa no permitida</p></div>
                  ) : listings.length === 0 ? (
                    <div className="flex flex-col items-center py-12 text-center text-[#71717a]">
                      <Repeat className="w-10 h-10 mb-3 text-white/[0.1]" />
                      <p className="mb-1">No hay entradas en reventa</p>
                      <p className="text-xs">Publicá la tuya desde <a href="/my-tickets" className="text-[#6c63ff]">Mis entradas</a></p>
                    </div>
                  ) : (
                    <div className="max-w-2xl mx-auto space-y-3">
                      {listings.map(listing => {
                        const isOwn = user?.wallet_address === listing.seller_wallet
                        const diff = priceDiff(listing.price)
                        const diffLabel = diff != null ? `${diff > 0 ? '+' : ''}${diff.toFixed(0)}%` : null
                        return (
                          <div key={listing.ticket_id} className="rounded-2xl border border-white/[0.08] bg-[#121214] p-4 flex items-center justify-between gap-4 flex-wrap">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#6c63ff]/20 to-[#8b5cf6]/20 flex items-center justify-center flex-shrink-0">
                                <Ticket className="w-5 h-5 text-[#6c63ff]" />
                              </div>
                              <div>
                                <div className="text-sm font-medium text-[#f4f4f5]">Entrada #{listing.ticket_id.slice(-6)}</div>
                                <div className="text-[10px] font-mono text-[#71717a] mt-0.5">{listing.seller_wallet}</div>
                              </div>
                            </div>
                            <div className="flex items-center gap-4 flex-wrap">
                              <div className="text-right">
                                <div className="text-lg font-bold text-[#f4f4f5]">{formatCurrency(listing.price)}</div>
                                {diffLabel && <div className="text-[10px] font-semibold flex items-center gap-0.5 justify-end text-[#22c55e]"><ArrowUpRight className="w-3 h-3" />{diffLabel}</div>}
                              </div>
                              {!user ? <a href="/login" className="btn btn-secondary btn-sm">Ingresar</a>
                              : isOwn ? <span className="text-[10px] text-[#71717a] bg-white/[0.04] rounded-lg px-3 py-1.5">Tu publicación</span>
                              : isAdmin ? null
                              : <button className="btn btn-primary btn-sm" disabled={buyingListed === listing.ticket_id} onClick={() => handleBuyListed(listing)}>
                                  {buyingListed === listing.ticket_id ? 'Procesando…' : 'Comprar'}
                                </button>}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )
                )}
              </div>
            </div>
          </div>

          {/* ── RIGHT SIDEBAR ── */}
          {sidebarOpen && (
            <div className="lg:sticky lg:top-6 lg:self-start">
              {/* mobile overlay */}
              <div className="fixed inset-0 bg-black/60 z-30 lg:hidden" onClick={() => setSidebarOpen(false)} />
              <div className="relative z-40 lg:z-auto bg-[#070708] lg:bg-transparent border-l-0 lg:border-l border-white/[0.06] pl-0 lg:pl-6 fixed lg:static inset-0 lg:inset-auto overflow-y-auto lg:overflow-visible pt-6 lg:pt-0">
                <div className="flex items-center justify-between mb-4 lg:hidden">
                  <span className="text-sm font-medium text-[#a1a1aa]">Blockchain</span>
                  <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setSidebarOpen(false)}>
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <BlockchainViewer blocks={blocks} />
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  )
}
