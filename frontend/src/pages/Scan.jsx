import React, { useEffect, useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { CheckCircle, XCircle, AlertTriangle, Loader2, ArrowLeft, Ticket } from 'lucide-react'

export default function Scan() {
  const [searchParams] = useSearchParams()
  const [status, setStatus] = useState('loading')
  const [result, setResult] = useState(null)

  useEffect(() => { document.title = 'Validación de entrada — TicketChain' }, [])

  useEffect(() => {
    const token = searchParams.get('token')
    if (!token) {
      setStatus('error')
      setResult({ message: 'No se encontró token en el QR.' })
      return
    }
    fetch('/api/access/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then(res => res.json())
      .then(data => {
        setResult(data)
        setStatus(data.valid ? 'granted' : 'denied')
      })
      .catch(() => {
        setStatus('error')
        setResult({ message: 'No se pudo conectar con el servidor.' })
      })
  }, [searchParams])

  const statusConfig = {
    loading: {
      icon: <Loader2 className="w-16 h-16 text-[#6c63ff] animate-spin" />,
      title: 'Validando entrada…',
      titleClass: 'text-[#a1a1aa]',
    },
    granted: {
      icon: <CheckCircle className="w-16 h-16 text-success" />,
      title: 'Acceso concedido',
      titleClass: 'text-success',
    },
    denied: {
      icon: <XCircle className="w-16 h-16 text-error" />,
      title: 'Acceso denegado',
      titleClass: 'text-error',
    },
    error: {
      icon: <AlertTriangle className="w-16 h-16 text-warning" />,
      title: 'Error',
      titleClass: 'text-warning',
    },
  }

  const cfg = statusConfig[status]

  return (
    <main className="flex-1 flex items-center justify-center px-6 py-12 bg-[#070708]">
      <div className="w-full max-w-[400px] animate-slideUp">
        <div className="rounded-2xl border border-white/[0.08] bg-[#121214] p-8 text-center shadow-xl">
          <div className="flex flex-col items-center mb-6">
            <div className="mb-4">
              {cfg.icon}
            </div>
            <h2 className={`text-xl font-bold m-0 ${cfg.titleClass}`}>{cfg.title}</h2>
          </div>

          {status === 'granted' && (
            <div className="space-y-2">
              {result?.event_name && <p className="text-sm font-medium text-[#f4f4f5]">{result.event_name}</p>}
              {result?.ticket_id && <p className="text-xs text-[#a1a1aa] font-mono">Ticket #{result.ticket_id}</p>}
              {result?.wallet && <p className="text-[10px] text-[#71717a] font-mono break-all bg-white/[0.02] p-3 rounded-lg border border-white/[0.06]">{result.wallet}</p>}
              {result?.checked_in_at && (
                <p className="text-xs text-[#71717a] flex items-center justify-center gap-1 mt-2">
                  Ingresó a las {new Date(result.checked_in_at).toLocaleTimeString('es-AR')}
                </p>
              )}
            </div>
          )}

          {status === 'denied' && (
            <div className="space-y-2">
              <p className="text-sm text-[#a1a1aa]">{result?.message || 'QR inválido'}</p>
              {result?.checked_in_at && (
                <p className="text-xs text-[#71717a]">
                  Ya ingresó a las {new Date(result.checked_in_at).toLocaleTimeString('es-AR')}
                </p>
              )}
            </div>
          )}

          {status === 'error' && (
            <p className="text-sm text-[#a1a1aa]">{result?.message}</p>
          )}

          {status === 'loading' && (
            <p className="text-sm text-[#71717a]">Verificando el token del QR…</p>
          )}

          {status !== 'loading' && (
            <div className="mt-6 pt-5 border-t border-white/[0.06]">
              <Link to="/" className="btn btn-ghost btn-sm">
                <ArrowLeft className="w-4 h-4" /> Volver al inicio
              </Link>
            </div>
          )}
        </div>
      </div>
    </main>
  )
}
