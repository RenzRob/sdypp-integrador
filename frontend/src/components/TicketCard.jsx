import React from 'react'

export default function TicketCard({ ticket, event, onBuy, onResell, showBuy = false, showResell = false }) {
  const isAvailable = ticket.status === 'available' || ticket.status === 'disponible'

  const canResell =
    showResell &&
    event?.rules?.nominada === false &&
    (ticket.resale_count ?? ticket.count_reventas ?? 0) < (event?.rules?.max_reventas ?? 0)

  return (
    <div className="card ticket-card">
      <div className="ticket-info">
        <span className="ticket-id">#{ticket.id}</span>
        {ticket.event_name && (
          <span className="ticket-event-name">{ticket.event_name}</span>
        )}
        {ticket.wallet_address && (
          <span className="ticket-wallet">
            Wallet: {ticket.wallet_address.slice(0, 20)}…
          </span>
        )}
        {(ticket.resale_count != null || ticket.count_reventas != null) && (
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            Reventas: {ticket.resale_count ?? ticket.count_reventas}
            {event?.rules?.max_reventas != null
              ? ` / ${event.rules.max_reventas}`
              : ''}
          </span>
        )}
      </div>

      <div className="ticket-actions">
        <span className={`badge ${isAvailable ? 'badge-available' : 'badge-sold'}`}>
          {isAvailable ? 'Disponible' : 'Vendido'}
        </span>

        {showBuy && isAvailable && onBuy && (
          <button
            className="btn btn-primary btn-sm"
            onClick={() => onBuy(ticket)}
          >
            Comprar
          </button>
        )}

        {canResell && onResell && (
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => onResell(ticket)}
          >
            Revender
          </button>
        )}
      </div>
    </div>
  )
}
