import React, { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { Ticket, CheckCircle, AlertCircle, Lock, ArrowLeft, Zap } from 'lucide-react'

function formatCurrency(amount) {
  if (amount == null) return '-'
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0
  }).format(amount)
}

export default function Checkout() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { authFetch } = useAuth()

  const tx_id      = searchParams.get('tx_id')
  const ticket_id  = searchParams.get('ticket_id')
  const event_id   = searchParams.get('event_id')
  const event_name = searchParams.get('event_name')
  const price      = Number(searchParams.get('price'))

  const [processing, setProcessing] = useState(false)
  const [error, setError]           = useState('')
  const [done, setDone]             = useState(false)

  useEffect(() => {
    document.title = 'Confirmar pago — TicketChain'
    if (!tx_id || !ticket_id || !event_id) navigate('/events', { replace: true })
  }, [tx_id, ticket_id, event_id, navigate])

  const handleConfirm = async () => {
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
        navigate(`/events/${event_id}?success=true&ticket_id=${ticket_id}`, { replace: true })
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
    navigate(`/events/${event_id}`, { replace: true })
  }

  if (done) {
    return (
      <main className="flex-1 flex items-center justify-center p-6">
        <div className="flex flex-col items-center gap-5 text-center">
          <div className="w-20 h-20 rounded-full bg-success/10 border border-success/20 flex items-center justify-center">
            <CheckCircle className="w-10 h-10 text-success" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-[#f4f4f5] mb-1">¡Pago confirmado!</h2>
            <p className="text-sm text-[#71717a]">Redirigiendo a tu entrada…</p>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="flex-1 flex items-center justify-center p-6">
      <div className="w-full max-w-sm">

        {/* Brand */}
        <div className="flex items-center justify-center gap-2.5 mb-8">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#6c63ff] to-[#8b5cf6] flex items-center justify-center shadow-[0_0_20px_rgba(108,99,255,0.3)]">
            <Zap className="w-4.5 h-4.5 text-white" />
          </div>
          <span className="text-xl font-bold gradient-text">TicketChain Pay</span>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-white/[0.08] bg-[#0e0e12] overflow-hidden shadow-[0_24px_64px_rgba(0,0,0,0.4)]">

          {/* Resumen */}
          <div className="px-6 pt-6 pb-5 border-b border-white/[0.06]">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[#52525b] mb-4">Resumen de compra</p>
            <div className="flex items-start gap-3">
              <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#6c63ff]/20 to-[#8b5cf6]/20 flex items-center justify-center flex-shrink-0">
                <Ticket className="w-5 h-5 text-[#6c63ff]" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[#f4f4f5] leading-tight">{event_name || 'Evento'}</p>
                <p className="text-xs text-[#71717a] mt-1 font-mono">Entrada #{ticket_id?.slice(-6)}</p>
              </div>
            </div>
          </div>

          {/* Total */}
          <div className="px-6 py-5 border-b border-white/[0.06] flex items-center justify-between">
            <span className="text-sm text-[#71717a]">Total</span>
            <span className="text-3xl font-bold gradient-text">{formatCurrency(price)}</span>
          </div>

          {/* Acciones */}
          <div className="px-6 py-5 space-y-3">
            {error && (
              <div className="flex items-center gap-2 p-3 rounded-xl bg-error/10 border border-error/20 text-error text-xs">
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />{error}
              </div>
            )}

            <button
              className="btn btn-primary btn-lg w-full"
              onClick={handleConfirm}
              disabled={processing}
            >
              {processing
                ? <><span className="spinner-sm" /> Procesando…</>
                : `Pagar ${formatCurrency(price)}`}
            </button>

            <button
              className="btn btn-ghost w-full"
              onClick={handleCancel}
              disabled={processing}
            >
              <ArrowLeft className="w-4 h-4" /> Cancelar
            </button>
          </div>
        </div>

        <div className="flex items-center justify-center gap-1.5 mt-5 text-[10px] text-[#3f3f46]">
          <Lock className="w-3 h-3" />
          Transacción segura — registrada en blockchain
        </div>
      </div>
    </main>
  )
}
