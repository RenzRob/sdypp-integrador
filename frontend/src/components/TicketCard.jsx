import React from 'react'
import { ShoppingCart, Repeat, Wallet, Ticket } from 'lucide-react'

export default function TicketCard({ ticket, event, onBuy, onResell, showBuy = false, showResell = false }) {
  const isAvailable = ticket.status === 'available' || ticket.status === 'disponible'

  const canResell =
    showResell &&
    event?.rules?.nominada === false &&
    (ticket.resale_count ?? ticket.count_reventas ?? 0) < (event?.rules?.max_reventas ?? 0)

  return (
    <div className="card flex items-center justify-between gap-4 flex-wrap p-4">
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#6c63ff]/20 to-[#8b5cf6]/20 flex items-center justify-center flex-shrink-0">
          <Ticket className="w-5 h-5 text-[#6c63ff]" />
        </div>
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="text-xs text-[#71717a] font-mono">#{ticket.id}</span>
          {ticket.event_name && (
            <span className="font-medium text-sm text-[#f4f4f5] truncate">{ticket.event_name}</span>
          )}
          {ticket.wallet_address && (
            <span className="flex items-center gap-1 text-xs text-[#71717a] font-mono truncate">
              <Wallet className="w-3 h-3" />
              {ticket.wallet_address.slice(0, 20)}…
            </span>
          )}
          {(ticket.resale_count != null || ticket.count_reventas != null) && (
            <span className="flex items-center gap-1 text-xs text-[#71717a]">
              <Repeat className="w-3 h-3" />
              Reventas: {ticket.resale_count ?? ticket.count_reventas}
              {event?.rules?.max_reventas != null ? ` / ${event.rules.max_reventas}` : ''}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2.5 flex-shrink-0">
        <span className={`badge ${isAvailable ? 'bg-success/10 text-success' : 'bg-error/10 text-error'}`}>
          {isAvailable ? 'Disponible' : 'Vendido'}
        </span>

        {showBuy && isAvailable && onBuy && (
          <button className="btn btn-primary btn-sm" onClick={() => onBuy(ticket)}>
            <ShoppingCart className="w-3.5 h-3.5" />
            Comprar
          </button>
        )}

        {canResell && onResell && (
          <button className="btn btn-secondary btn-sm" onClick={() => onResell(ticket)}>
            <Repeat className="w-3.5 h-3.5" />
            Revender
          </button>
        )}
      </div>
    </div>
  )
}
