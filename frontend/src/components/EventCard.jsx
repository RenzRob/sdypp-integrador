import React from 'react'
import { useNavigate } from 'react-router-dom'
import { Calendar, MapPin, Ticket, DollarSign } from 'lucide-react'

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
  const completed = event.status === 'completed'
  const past = completed || (event.date && new Date(event.date).getTime() <= Date.now())

  const ticketsLabel =
    past ? 'Finalizado'
    : suspended ? 'Suspendido'
    : available === 0 ? 'Agotado'
    : `${available} / ${total}`

  const ticketsBadgeClass =
    past ? 'bg-white/[0.04] text-[#71717a]'
    : suspended ? 'bg-warning/10 text-warning'
    : available === 0 ? 'bg-error/10 text-error'
    : available <= Math.max(1, Math.floor(total * 0.1)) ? 'bg-warning/10 text-warning'
    : 'bg-white/[0.04] text-[#a1a1aa]'

  return (
    <div
      className="card card-clickable overflow-hidden group"
      onClick={() => navigate(`/events/${event.id}`)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && navigate(`/events/${event.id}`)}
      aria-label={`Ver evento ${event.name}`}
    >
      <div className="flex flex-row gap-0">
        <div className="relative w-[130px] min-w-[130px] flex-shrink-0 overflow-hidden bg-white/[0.03]">
          {event.image_url ? (
            <img
              src={event.image_url}
              alt={event.name}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            />
          ) : (
            <div className="flex flex-col items-center justify-center w-full h-full bg-gradient-to-br from-[#1a1a2e] to-[#16213e]">
              <Ticket className="w-8 h-8 text-white/[0.15]" />
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-r from-transparent to-[var(--surface)]" />
        </div>

        <div className="flex-1 flex flex-col gap-2 p-4 min-w-0">
          <div className="flex items-start justify-between gap-3">
            <h3 className="text-[15px] font-semibold text-[#f4f4f5] truncate m-0 leading-tight">
              {event.name}
            </h3>
            <span className={`badge flex-shrink-0 ${ticketsBadgeClass}`}>
              {ticketsLabel}
            </span>
          </div>

          <div className="flex flex-col gap-1.5 text-sm text-[#a1a1aa]">
            <span className="flex items-center gap-2 truncate">
              <Calendar className="w-3.5 h-3.5 text-[#71717a] flex-shrink-0" />
              <span>{formatDate(event.date)}</span>
            </span>
            <span className="flex items-center gap-2 truncate">
              <MapPin className="w-3.5 h-3.5 text-[#71717a] flex-shrink-0" />
              <span>{event.venue}</span>
            </span>
            {event.description && (
              <span className="text-xs text-[#71717a] line-clamp-1">
                {event.description}
              </span>
            )}
          </div>

          <div className="flex items-center justify-between mt-auto pt-3 border-t border-white/[0.06]">
            <span className="text-lg font-bold bg-gradient-to-r from-[#6c63ff] to-[#8b5cf6] bg-clip-text text-transparent">
              {formatCurrency(event.price)}
            </span>
            {!suspended && !past && available > 0 && (
              <span className="text-xs text-[#71717a]">
                {available} / {total} disponibles
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
