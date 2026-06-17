import React, { useState, useEffect } from 'react'
import EventCard from '../components/EventCard.jsx'

export default function Events() {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

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
          throw new Error(data.detail || data.message || `Error ${res.status}`)
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

  return (
    <main className="page">
      <div className="page-header">
        <h1>Eventos disponibles</h1>
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

      {!loading && !error && events.length === 0 && (
        <div className="empty-state">
          <h3>No hay eventos disponibles</h3>
          <p>Volvé a intentarlo más tarde o contactá al administrador.</p>
        </div>
      )}

      {!loading && !error && events.length > 0 && (
        <div className="events-grid">
          {events.map(event => (
            <EventCard key={event.id} event={event} />
          ))}
        </div>
      )}
    </main>
  )
}
