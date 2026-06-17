import React, { useState, useEffect, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext.jsx'

function ServiceRow({ name, status }) {
  const isOk = status === 'ok' || status === 'healthy' || status === 'running' || status === true
  return (
    <div className="service-item">
      <span className="service-name">{name}</span>
      <span className={`service-status ${isOk ? 'status-ok' : 'status-error'}`}>
        <span className={`status-dot ${isOk ? 'ok' : 'error'}`} />
        {isOk ? 'OK' : 'Error'}
      </span>
    </div>
  )
}

export default function Dashboard() {
  const { authFetch } = useAuth()
  const navigate = useNavigate()

  const [status, setStatus] = useState(null)
  const [events, setEvents] = useState([])
  const [loadingStatus, setLoadingStatus] = useState(true)
  const [loadingEvents, setLoadingEvents] = useState(true)
  const [statusError, setStatusError] = useState('')
  const [eventsError, setEventsError] = useState('')

  useEffect(() => {
    document.title = 'Dashboard Admin — TicketChain'
  }, [])

  const fetchStatus = useCallback(async () => {
    setLoadingStatus(true)
    setStatusError('')
    try {
      const res = await authFetch('/api/status/status')
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.detail || data.message || `Error ${res.status}`)
      }
      const data = await res.json()
      setStatus(data)
    } catch (err) {
      setStatusError(err.message || 'No se pudo obtener el estado de servicios')
    } finally {
      setLoadingStatus(false)
    }
  }, [authFetch])

  const fetchEvents = useCallback(async () => {
    setLoadingEvents(true)
    setEventsError('')
    try {
      const res = await authFetch('/api/events/')
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.detail || data.message || `Error ${res.status}`)
      }
      const data = await res.json()
      setEvents(Array.isArray(data) ? data : (data.events || data.results || []))
    } catch (err) {
      setEventsError(err.message || 'No se pudieron cargar los eventos')
    } finally {
      setLoadingEvents(false)
    }
  }, [authFetch])

  useEffect(() => {
    fetchStatus()
    fetchEvents()
  }, [fetchStatus, fetchEvents])

  // Extraer servicios del status en cualquier formato posible
  const services = status
    ? (status.services
        ? Object.entries(status.services).map(([name, val]) => ({
            name,
            status: typeof val === 'object' ? (val.status || val.health) : val
          }))
        : status.components
          ? Object.entries(status.components).map(([name, val]) => ({
              name,
              status: typeof val === 'object' ? (val.status || val.health) : val
            }))
          : [])
    : []

  const totalEvents = events.length
  const totalTickets = events.reduce((sum, e) => sum + (e.total_tickets || 0), 0)
  const availableTickets = events.reduce(
    (sum, e) => sum + (e.available_tickets ?? e.tickets_disponibles ?? 0),
    0
  )

  return (
    <main className="page">
      <div className="page-header">
        <h1>Dashboard Admin</h1>
        <Link to="/admin/create-event" className="btn btn-primary">
          + Crear evento
        </Link>
      </div>

      {/* Stats */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-value">{loadingEvents ? '…' : totalEvents}</div>
          <div className="stat-label">Eventos</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{loadingEvents ? '…' : totalTickets}</div>
          <div className="stat-label">Tickets totales</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{loadingEvents ? '…' : availableTickets}</div>
          <div className="stat-label">Disponibles</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{loadingEvents ? '…' : totalTickets - availableTickets}</div>
          <div className="stat-label">Vendidos</div>
        </div>
      </div>

      {/* Services status */}
      <h2 className="section-title">Estado de servicios</h2>

      {loadingStatus && (
        <div className="loading-container" style={{ padding: '1.5rem 0' }}>
          <div className="loading-spinner" />
        </div>
      )}

      {!loadingStatus && statusError && (
        <div className="alert alert-error">{statusError}</div>
      )}

      {!loadingStatus && !statusError && (
        <>
          {status?.status && (
            <div className={`alert ${status.status === 'ok' || status.status === 'healthy' ? 'alert-success' : 'alert-warning'}`} style={{ marginBottom: '1rem' }}>
              Estado global: <strong>{status.status}</strong>
            </div>
          )}
          {services.length > 0 ? (
            <div className="services-list">
              {services.map((svc, i) => (
                <ServiceRow key={i} name={svc.name} status={svc.status} />
              ))}
            </div>
          ) : (
            <div className="alert alert-info">
              El endpoint de status no retornó información de servicios individuales.
            </div>
          )}
        </>
      )}

      {/* Events list */}
      <h2 className="section-title" style={{ marginTop: '2rem' }}>Eventos creados</h2>

      {loadingEvents && (
        <div className="loading-container" style={{ padding: '1.5rem 0' }}>
          <div className="loading-spinner" />
        </div>
      )}

      {!loadingEvents && eventsError && (
        <div className="alert alert-error">{eventsError}</div>
      )}

      {!loadingEvents && !eventsError && events.length === 0 && (
        <div className="empty-state">
          <p>No hay eventos creados aún.</p>
          <Link to="/admin/create-event" className="btn btn-primary" style={{ marginTop: '1rem' }}>
            Crear primer evento
          </Link>
        </div>
      )}

      {!loadingEvents && !eventsError && events.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {events.map(event => (
            <div
              key={event.id}
              className="card"
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}
            >
              <div>
                <strong>{event.name}</strong>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                  {event.venue} — {event.available_tickets ?? event.tickets_disponibles ?? '?'} tickets disponibles
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => navigate(`/events/${event.id}`)}
                >
                  Ver evento
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  )
}
