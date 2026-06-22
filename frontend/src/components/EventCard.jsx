import React from 'react'
import { useNavigate } from 'react-router-dom'

function formatDate(dateStr) {
  if (!dateStr) return 'Fecha por confirmar'
  const d = new Date(dateStr)
  return d.toLocaleDateString('es-AR', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
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

export default function EventCard({ event }) {
  const navigate = useNavigate()

  const available = event.available_tickets ?? event.tickets_disponibles ?? 0
  const total = event.total_tickets ?? 0
  const suspended = event.status === 'suspended'
  const finished = event.status === 'finished'

  const ticketsClass =
    suspended || finished || available === 0
      ? 'sold-out'
      : available <= Math.max(1, Math.floor(total * 0.1))
      ? 'low'
      : ''

  const ticketsLabel =
    finished
      ? 'Finalizado'
      : suspended
      ? 'Suspendido'
      : available === 0
      ? 'Agotado'
      : `${available} / ${total} disponibles`

  return (
    <div
      className="card card-clickable event-card"
      onClick={() => navigate(`/events/${event.id}`)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && navigate(`/events/${event.id}`)}
      aria-label={`Ver evento ${event.name}`}
    >
      {/* Imagen izquierda */}
      <div className="event-card-image">
        {event.image_url ? (
          <img src={event.image_url} alt={event.name} />
        ) : (
          <div className="event-card-image-placeholder">
            🎟
          </div>
        )}
      </div>

      {/* Contenido derecho */}
      <div className="event-card-body">
        <div className="event-card-header">
          <h3 className="event-card-title">{event.name}</h3>
          {finished
            ? <span className="badge badge-finished">Finalizado</span>
            : suspended
            ? <span className="badge badge-suspended">Suspendido</span>
            : available === 0 && <span className="badge badge-sold">Agotado</span>
          }
        </div>

        <div className="event-card-meta">
          <span>📅 {formatDate(event.date)}</span>
          <span>📍 {event.venue}</span>
          {event.description && (
            <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
              {event.description.length > 60
                ? event.description.slice(0, 60) + '…'
                : event.description}
            </span>
          )}
        </div>

        <div className="event-card-footer">
          <span className="event-price">{formatCurrency(event.price)}</span>
          <span className={`event-tickets-left ${ticketsClass}`}>{ticketsLabel}</span>
        </div>
      </div>
    </div>
  )
}
