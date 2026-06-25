import React, { useState, useEffect } from 'react'
import EventCard from '../components/EventCard.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { Calendar, Filter, Ticket, Compass } from 'lucide-react'

export default function Events() {
  const { user, isAdmin } = useAuth()
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('all')

  useEffect(() => {
    document.title = 'Eventos — TicketChain'
  }, [])

  useEffect(() => {
    const controller = new AbortController()

    const fetchEvents = async () => {
      setLoading(true)
      setError('')
      try {
        const res = await fetch('/api/events/', { signal: controller.signal })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.error || data.detail || data.message || `Error ${res.status}`)
        }
        const data = await res.json()
        setEvents(Array.isArray(data) ? data : (data.events || data.results || []))
      } catch (err) {
        if (err.name !== 'AbortError') {
          setError(err.message || 'No se pudieron cargar los eventos')
        }
      } finally {
        setLoading(false)
      }
    }

    fetchEvents()
    return () => controller.abort()
  }, [])

  const visibleEvents = filter === 'mine' && isAdmin
    ? events.filter(e => e.creator_id === user?.id)
    : events

  return (
    <main className="flex-1">
      <div className="relative overflow-hidden border-b border-white/[0.06] bg-gradient-to-b from-[#0c0c10] to-[var(--bg)]">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(108,99,255,0.06)_0%,transparent_60%)]" />
        <div className="relative max-w-[1280px] mx-auto px-6 py-12 md:py-16">
          <div className="flex flex-col items-center text-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#6c63ff] to-[#8b5cf6] flex items-center justify-center shadow-[0_0_30px_rgba(108,99,255,0.2)]">
              <Compass className="w-7 h-7 text-white" />
            </div>
            <div>
              <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
                <span className="gradient-text">Descubrí Eventos</span>
              </h1>
              <p className="text-[#a1a1aa] mt-2 max-w-lg">
                Encontrá los mejores eventos y asegurá tu entrada con TicketChain
              </p>
            </div>
            {isAdmin && (
              <div className="flex items-center gap-2 mt-2 bg-white/[0.03] border border-white/[0.06] rounded-xl p-1">
                <button
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                    filter === 'all'
                      ? 'bg-accent/10 text-accent shadow-[0_0_20px_rgba(108,99,255,0.08)]'
                      : 'text-[#a1a1aa] hover:text-[#f4f4f5]'
                  }`}
                  onClick={() => setFilter('all')}
                >
                  Todos
                </button>
                <button
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                    filter === 'mine'
                      ? 'bg-accent/10 text-accent shadow-[0_0_20px_rgba(108,99,255,0.08)]'
                      : 'text-[#a1a1aa] hover:text-[#f4f4f5]'
                  }`}
                  onClick={() => setFilter('mine')}
                >
                  Mis eventos
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-[1280px] mx-auto px-6 py-8">
        {loading && (
          <div className="flex flex-col items-center justify-center py-24 gap-4 text-[#a1a1aa]">
            <div className="spinner" />
            <span className="text-sm">Cargando eventos…</span>
          </div>
        )}

        {!loading && error && (
          <div className="max-w-lg mx-auto p-4 rounded-xl bg-error/10 border border-error/20 text-[#f87171] text-sm text-center">
            {error}
          </div>
        )}

        {!loading && !error && visibleEvents.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <Ticket className="w-16 h-16 text-white/[0.06] mb-4" />
            <h3 className="text-lg font-medium text-[#a1a1aa] mb-1">
              {filter === 'mine' ? 'No creaste ningún evento aún' : 'No hay eventos disponibles'}
            </h3>
            <p className="text-sm text-[#71717a]">
              {filter === 'mine' ? 'Usá "Crear Evento" para agregar uno.' : 'Volvé a intentarlo más tarde o contactá al administrador.'}
            </p>
          </div>
        )}

        {!loading && !error && visibleEvents.length > 0 && (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-2">
            {visibleEvents.map(event => (
              <div key={event.id} className="animate-slideUp">
                <EventCard event={event} />
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
