import React, { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../../context/AuthContext.jsx'

function ServiceRow({ name, status, latency_ms }) {
  const isOk = status === 'ok' || status === 'healthy' || status === 'running' || status === true
  return (
    <div className="service-item">
      <span className="service-name">{name}</span>
      <span className={`service-status ${isOk ? 'status-ok' : 'status-error'}`}>
        <span className={`status-dot ${isOk ? 'ok' : 'error'}`} />
        {isOk ? 'OK' : 'Error'}
        {latency_ms != null && (
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '0.5rem' }}>
            {latency_ms} ms
          </span>
        )}
      </span>
    </div>
  )
}

export default function PlatformStatus() {
  const { authFetch } = useAuth()

  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [lastUpdated, setLastUpdated] = useState(null)

  useEffect(() => {
    document.title = 'Estado de plataforma — TicketChain'
  }, [])

  const fetchStatus = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await authFetch('/api/status/status')
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || data.detail || data.message || `Error ${res.status}`)
      }
      const data = await res.json()
      setStatus(data)
      setLastUpdated(new Date())
    } catch (err) {
      setError(err.message || 'No se pudo obtener el estado de servicios')
    } finally {
      setLoading(false)
    }
  }, [authFetch])

  useEffect(() => {
    fetchStatus()
  }, [fetchStatus])

  const SERVICE_ALIASES = {
    'auth-service':     'Autenticación',
    'event-registry':   'Registro de Eventos',
    'transaction-api':  'API de Transacciones',
    'access-control':   'Control de Acceso',
    'nct-miner':        'NCT — Nodo Coordinador',
    'redis':            'Redis (Blockchain)',
    'rabbitmq':         'RabbitMQ (Mensajería)',
  }

  const normalize = (name, val) => ({
    name: SERVICE_ALIASES[name] || name,
    status: typeof val === 'object' ? (val.status || val.health) : val,
    latency_ms: val?.latency_ms ?? null,
  })

  const services = status
    ? [
        ...(Array.isArray(status.services)
          ? status.services.map(s => normalize(s.name, s))
          : Object.entries(status.services || {}).map(([k, v]) => normalize(k, v))),
        ...Object.entries(status.infrastructure || {}).map(([k, v]) => normalize(k, v)),
      ]
    : []

  const allOk = services.length > 0 && services.every(s =>
    s.status === 'ok' || s.status === 'healthy' || s.status === 'running' || s.status === true
  )

  return (
    <main className="page">
      <div className="page-header">
        <h1>Estado de plataforma</h1>
        <button
          className="btn btn-secondary"
          onClick={fetchStatus}
          disabled={loading}
        >
          {loading ? 'Actualizando…' : 'Actualizar'}
        </button>
      </div>

      {lastUpdated && (
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
          Última actualización: {lastUpdated.toLocaleTimeString()}
        </p>
      )}

      {loading && (
        <div className="loading-container" style={{ padding: '2rem 0' }}>
          <div className="loading-spinner" />
        </div>
      )}

      {!loading && error && (
        <div className="alert alert-error">{error}</div>
      )}

      {!loading && !error && (
        <>
          {status?.status && (
            <div className={`alert ${allOk ? 'alert-success' : 'alert-warning'}`} style={{ marginBottom: '1.5rem' }}>
              Estado global: <strong>{status.status}</strong>
            </div>
          )}

          <h2 className="section-title">Microservicios</h2>

          {services.length > 0 ? (
            <div className="services-list">
              {services.map((svc, i) => (
                <ServiceRow key={i} name={svc.name} status={svc.status} latency_ms={svc.latency_ms} />
              ))}
            </div>
          ) : (
            <div className="alert alert-info">
              El endpoint de status no retornó información de servicios individuales.
            </div>
          )}
        </>
      )}
    </main>
  )
}
