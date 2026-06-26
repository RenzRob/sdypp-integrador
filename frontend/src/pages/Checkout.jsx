import React, { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { Ticket, CheckCircle, AlertCircle, Lock, Zap, CreditCard } from 'lucide-react'

function formatCurrency(amount) {
  if (amount == null) return '-'
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0
  }).format(amount)
}

const CARDS = [
  { id: 'visa1',   brand: 'VISA',       last4: '4242', holder: 'RENZO ROBLES',   color: 'from-[#1a1f6e] to-[#0d47a1]' },
  { id: 'mc1',     brand: 'MASTERCARD', last4: '5100', holder: 'RENZO ROBLES',   color: 'from-[#6d1a0e] to-[#b71c1c]' },
  { id: 'visa2',   brand: 'VISA',       last4: '0013', holder: 'AXEL RODRIGUEZ', color: 'from-[#1b4332] to-[#2d6a4f]' },
]

function CardLogo({ brand }) {
  if (brand === 'VISA') {
    return <span className="font-black italic text-white text-sm tracking-tighter">VISA</span>
  }
  return (
    <div className="flex items-center gap-0.5">
      <div className="w-4 h-4 rounded-full bg-[#eb001b] opacity-90" />
      <div className="w-4 h-4 rounded-full bg-[#f79e1b] opacity-90 -ml-2" />
    </div>
  )
}

export default function Checkout() {
  const [searchParams]           = useSearchParams()
  const { authFetch }            = useAuth()

  const tx_id      = searchParams.get('tx_id')
  const ticket_id  = searchParams.get('ticket_id')
  const event_id   = searchParams.get('event_id')
  const event_name = searchParams.get('event_name')
  const price      = Number(searchParams.get('price'))

  const [selected,   setSelected]   = useState(CARDS[0].id)
  const [processing, setProcessing] = useState(false)
  const [error,      setError]      = useState('')
  const [done,       setDone]       = useState(false)

  useEffect(() => {
    document.title = 'Confirmar pago — TicketChain Pay'
    if (!tx_id || !ticket_id || !event_id) window.close()
  }, [tx_id, ticket_id, event_id])

  const handlePay = async () => {
    setProcessing(true)
    setError('')
    try {
      const res  = await authFetch('/api/transactions/checkout/confirm', {
        method: 'POST',
        body: JSON.stringify({ tx_id }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`)

      setDone(true)
      setTimeout(() => {
        const url = `/events/${event_id}?success=true&ticket_id=${ticket_id}`
        if (window.opener && !window.opener.closed) {
          window.opener.location.href = url
          window.close()
        } else {
          window.location.href = url
        }
      }, 1500)
    } catch (err) {
      setError(err.message || 'No se pudo procesar el pago')
      setProcessing(false)
    }
  }

  const handleCancel = async () => {
    try {
      await authFetch(`/api/transactions/checkout/${tx_id}`, { method: 'DELETE' })
    } catch {}
    if (window.opener && !window.opener.closed) {
      window.close()
    } else {
      window.location.href = `/events/${event_id}`
    }
  }

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#070708]">
        <div className="flex flex-col items-center gap-5 text-center p-6">
          <div className="w-20 h-20 rounded-full bg-success/10 border border-success/20 flex items-center justify-center">
            <CheckCircle className="w-10 h-10 text-success" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-[#f4f4f5] mb-1">¡Pago aprobado!</h2>
            <p className="text-sm text-[#71717a]">Cerrando esta pestaña…</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#070708] flex flex-col">

      {/* Header */}
      <header className="border-b border-white/[0.06] px-6 py-4 flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#6c63ff] to-[#8b5cf6] flex items-center justify-center">
          <Zap className="w-4 h-4 text-white" />
        </div>
        <span className="text-base font-bold gradient-text">TicketChain Pay</span>
        <div className="ml-auto flex items-center gap-1.5 text-[11px] text-[#52525b]">
          <Lock className="w-3 h-3" /> Pago seguro
        </div>
      </header>

      {/* Body */}
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-3xl grid md:grid-cols-[1fr_1.4fr] gap-6">

          {/* ── Resumen ── */}
          <div className="flex flex-col gap-4">
            <div className="rounded-2xl border border-white/[0.08] bg-[#0e0e12] p-5">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-[#52525b] mb-4">Resumen</p>
              <div className="flex items-start gap-3 mb-5">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#6c63ff]/20 to-[#8b5cf6]/20 flex items-center justify-center flex-shrink-0">
                  <Ticket className="w-5 h-5 text-[#6c63ff]" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[#f4f4f5] leading-tight">{event_name}</p>
                  <p className="text-xs text-[#71717a] mt-1 font-mono">Entrada #{ticket_id?.slice(-6)}</p>
                </div>
              </div>
              <div className="pt-4 border-t border-white/[0.06] flex items-center justify-between">
                <span className="text-sm text-[#71717a]">Total</span>
                <span className="text-2xl font-bold gradient-text">{formatCurrency(price)}</span>
              </div>
            </div>

            <div className="rounded-xl border border-white/[0.04] bg-white/[0.01] p-4 text-[11px] text-[#52525b] space-y-1.5">
              <div className="flex items-center gap-2"><Lock className="w-3 h-3 flex-shrink-0" /> Transacción cifrada y segura</div>
              <div className="flex items-center gap-2"><CreditCard className="w-3 h-3 flex-shrink-0" /> Tus datos no son almacenados</div>
              <div className="flex items-center gap-2"><CheckCircle className="w-3 h-3 flex-shrink-0" /> Registrado en blockchain</div>
            </div>
          </div>

          {/* ── Pago ── */}
          <div className="rounded-2xl border border-white/[0.08] bg-[#0e0e12] p-6 flex flex-col gap-5">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-[#52525b] mb-4">Seleccioná tu tarjeta</p>

              <div className="space-y-3">
                {CARDS.map(card => (
                  <button
                    key={card.id}
                    onClick={() => setSelected(card.id)}
                    className={`w-full flex items-center gap-4 p-3.5 rounded-xl border transition-all duration-150 text-left ${
                      selected === card.id
                        ? 'border-[#6c63ff] bg-[#6c63ff]/10 shadow-[0_0_20px_rgba(108,99,255,0.08)]'
                        : 'border-white/[0.06] hover:border-white/[0.14] bg-white/[0.01]'
                    }`}
                  >
                    {/* mini card */}
                    <div className={`w-12 h-8 rounded-lg bg-gradient-to-br ${card.color} flex items-center justify-center flex-shrink-0`}>
                      <CardLogo brand={card.brand} />
                    </div>

                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[#f4f4f5]">
                        {card.brand === 'VISA' ? 'Visa' : 'Mastercard'} •••• {card.last4}
                      </p>
                      <p className="text-[11px] text-[#71717a] mt-0.5">{card.holder}</p>
                    </div>

                    <div className={`w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${
                      selected === card.id ? 'border-[#6c63ff]' : 'border-white/[0.2]'
                    }`}>
                      {selected === card.id && <div className="w-2 h-2 rounded-full bg-[#6c63ff]" />}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-auto space-y-3">
              {error && (
                <div className="flex items-center gap-2 p-3 rounded-xl bg-error/10 border border-error/20 text-error text-xs">
                  <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />{error}
                </div>
              )}
              <button
                className="btn btn-primary btn-lg w-full"
                onClick={handlePay}
                disabled={processing}
              >
                {processing
                  ? <><span className="spinner-sm" /> Procesando…</>
                  : `Pagar ${formatCurrency(price)}`}
              </button>
              <button
                className="btn btn-ghost w-full text-[#71717a] text-sm"
                onClick={handleCancel}
                disabled={processing}
              >
                Cancelar
              </button>
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}
