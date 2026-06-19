import React, { useEffect, useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'

export default function Scan() {
  const [searchParams] = useSearchParams()
  const [status, setStatus] = useState('loading') // loading | granted | denied | error
  const [result, setResult] = useState(null)

  useEffect(() => {
    document.title = 'Validación de entrada — TicketChain'
  }, [])

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

  return (
    <main style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--background)',
      padding: '1.5rem',
    }}>
      <div style={{
        width: '100%',
        maxWidth: '400px',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        padding: '2rem',
        textAlign: 'center',
      }}>

        {status === 'loading' && (
          <>
            <div className="loading-spinner" style={{ margin: '0 auto 1rem' }} />
            <p style={{ color: 'var(--text-muted)', margin: 0 }}>Validando entrada…</p>
          </>
        )}

        {status === 'granted' && (
          <>
            <div style={{ fontSize: '4rem', lineHeight: 1, marginBottom: '1rem' }}>✅</div>
            <h2 style={{ color: '#22c55e', margin: '0 0 0.5rem' }}>Acceso concedido</h2>
            {result?.event_name && (
              <p style={{ margin: '0 0 0.25rem', fontWeight: 600 }}>{result.event_name}</p>
            )}
            {result?.ticket_id && (
              <p style={{ margin: '0 0 0.25rem', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                Ticket #{result.ticket_id}
              </p>
            )}
            {result?.wallet && (
              <p style={{ margin: '0 0 1.25rem', color: 'var(--text-muted)', fontSize: '0.82rem', wordBreak: 'break-all' }}>
                {result.wallet}
              </p>
            )}
            {result?.checked_in_at && (
              <p style={{ margin: '0 0 1.25rem', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                Ingresó a las {new Date(result.checked_in_at).toLocaleTimeString('es-AR')}
              </p>
            )}
          </>
        )}

        {status === 'denied' && (
          <>
            <div style={{ fontSize: '4rem', lineHeight: 1, marginBottom: '1rem' }}>❌</div>
            <h2 style={{ color: '#ef4444', margin: '0 0 0.75rem' }}>Acceso denegado</h2>
            <p style={{ margin: '0 0 1.25rem', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
              {result?.message || 'QR inválido'}
            </p>
            {result?.checked_in_at && (
              <p style={{ margin: '0 0 1.25rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                Ya ingresó a las {new Date(result.checked_in_at).toLocaleTimeString('es-AR')}
              </p>
            )}
          </>
        )}

        {status === 'error' && (
          <>
            <div style={{ fontSize: '4rem', lineHeight: 1, marginBottom: '1rem' }}>⚠️</div>
            <h2 style={{ margin: '0 0 0.75rem' }}>Error</h2>
            <p style={{ margin: '0 0 1.25rem', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
              {result?.message}
            </p>
          </>
        )}

        {status !== 'loading' && (
          <Link to="/" className="btn btn-secondary btn-sm">
            Volver al inicio
          </Link>
        )}
      </div>
    </main>
  )
}
