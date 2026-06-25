import React, { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../../context/AuthContext.jsx'
import { Activity, RefreshCw, CheckCircle, XCircle, Clock, Server, Shield } from 'lucide-react'

function ServiceRow({ name, status, latency_ms }) {
  const isOk = status === 'ok' || status === 'healthy' || status === 'running' || status === true
  return (
    <div className="card flex items-center justify-between p-3.5">
      <div className="flex items-center gap-3">
        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${isOk ? 'bg-success shadow-[0_0_8px_rgba(34,197,94,0.4)]' : 'bg-error shadow-[0_0_8px_rgba(239,68,68,0.4)]'}`} />
        <span className="text-sm font-medium text-[#f4f4f5]">{name}</span>
      </div>
      <span className="flex items-center gap-2">
        <span className={`text-[11px] font-semibold uppercase tracking-wider ${isOk ? 'text-success' : 'text-error'}`}>
          {isOk ? 'OK' : 'Error'}
        </span>
        {latency_ms != null && (
          <span className="text-[10px] text-[#71717a] font-mono">{latency_ms}ms</span>
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

  useEffect(() => { document.title = 'Estado de plataforma — TicketChain' }, [])

  const fetchStatus = useCallback(async () => {
    setLoading(true); setError('')
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
    } finally { setLoading(false) }
  }, [authFetch])

  useEffect(() => { fetchStatus() }, [fetchStatus])

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
    <main className="flex-1">
      <div className="border-b border-white/[0.06] bg-gradient-to-b from-[#0c0c10] to-transparent px-6 py-10">
        <div className="max-w-[1280px] mx-auto text-center">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#6c63ff] to-[#8b5cf6] flex items-center justify-center mx-auto mb-4 shadow-[0_0_30px_rgba(108,99,255,0.2)]">
            <Activity className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-2xl md:text-3xl font-bold gradient-text mb-1">Estado de plataforma</h1>
          <p className="text-sm text-[#a1a1aa]">Monitoreo de microservicios TicketChain</p>
        </div>
      </div>

      <div className="max-w-[800px] mx-auto px-6 py-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Server className="w-5 h-5 text-[#71717a]" />
            <h2 className="text-sm font-semibold text-[#f4f4f5]">Microservicios</h2>
            {services.length > 0 && (
              <span className={`badge ${allOk ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'}`}>
                {allOk ? 'Todos OK' : 'Con errores'}
              </span>
            )}
          </div>
          <button className="btn btn-ghost btn-sm" onClick={fetchStatus} disabled={loading}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            {loading ? 'Actualizando…' : 'Actualizar'}
          </button>
        </div>

        {lastUpdated && (
          <p className="flex items-center gap-1.5 text-[11px] text-[#71717a] mb-6">
            <Clock className="w-3.5 h-3.5" />
            Última actualización: {lastUpdated.toLocaleTimeString()}
          </p>
        )}

        {loading && (
          <div className="flex flex-col items-center justify-center py-16 text-[#a1a1aa]">
            <div className="spinner" />
          </div>
        )}

        {!loading && error && (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-error/10 border border-error/20 text-error text-sm">
            <XCircle className="w-4 h-4 flex-shrink-0" />{error}
          </div>
        )}

        {!loading && !error && (
          <>
            {status?.status && (
              <div className={`flex items-center gap-2 p-4 rounded-xl border mb-6 text-sm ${
                allOk
                  ? 'bg-success/10 border-success/20 text-success'
                  : 'bg-warning/10 border-warning/20 text-warning'
              }`}>
                {allOk ? <CheckCircle className="w-5 h-5 flex-shrink-0" /> : <Activity className="w-5 h-5 flex-shrink-0" />}
                Estado global: <strong>{status.status}</strong>
              </div>
            )}

            {services.length > 0 ? (
              <div className="space-y-2">
                {services.map((svc, i) => (
                  <ServiceRow key={i} name={svc.name} status={svc.status} latency_ms={svc.latency_ms} />
                ))}
              </div>
            ) : (
              <div className="p-4 rounded-xl bg-accent/10 border border-accent/20 text-sm text-[#a1a1aa]">
                No hay información de servicios individuales disponible.
              </div>
            )}
          </>
        )}
      </div>
    </main>
  )
}
