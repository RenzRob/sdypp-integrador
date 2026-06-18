import React, { useState, useEffect } from 'react'
import EventCard from '../components/EventCard.jsx'
import { useAuth } from '../context/AuthContext.jsx'

export default function Events() {
  const { user, isAdmin } = useAuth()
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('all') // 'all' | 'mine'

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
    <main className="page">
      <div className="page-header">
        <h1>Eventos disponibles</h1>
        {isAdmin && (
          <div className="filter-tabs">
            <button
              className={`btn btn-sm ${filter === 'all' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setFilter('all')}
            >
              Todos
            </button>
            <button
              className={`btn btn-sm ${filter === 'mine' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setFilter('mine')}
            >
              Mis eventos
            </button>
          </div>
        )}
      </div>

      {loading && (
        <div className="loading-container">
          <div className="loading-spinner" />
          <span>Cargando eventos…</span>
        </div>
      )}

      {!loading && error && (
        <div className="alert alert-error">{error}</div>
      )}

      {!loading && !error && visibleEvents.length === 0 && (
        <div className="empty-state">
          <h3>{filter === 'mine' ? 'No creaste ningún evento aún' : 'No hay eventos disponibles'}</h3>
          <p>{filter === 'mine' ? 'Usá "Crear Evento" para agregar uno.' : 'Volvé a intentarlo más tarde o contactá al administrador.'}</p>
        </div>
      )}

      {!loading && !error && visibleEvents.length > 0 && (
        <div className="events-grid">
          {visibleEvents.map(event => (
            <EventCard key={event.id} event={event} />
          ))}
        </div>
      )}
    </main>
  )
}
