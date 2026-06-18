import React, { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext.jsx'

export default function EditEvent() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user, authFetch } = useAuth()

  const [event, setEvent] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [date, setDate] = useState('')
  const [status, setStatus] = useState('')

  useEffect(() => {
    document.title = 'Editar Evento — TicketChain'
  }, [])

  const fetchEvent = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await authFetch(`/api/events/${id}`)
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || data.detail || `Error ${res.status}`)
      }
      const data = await res.json()

      if (data.creator_id !== user?.id) {
        navigate(`/events/${id}`)
        return
      }

      setEvent(data)
      setDate(data.date ? data.date.slice(0, 16) : '')
      setStatus(data.status || 'active')
    } catch (err) {
      setError(err.message || 'No se pudo cargar el evento')
    } finally {
      setLoading(false)
    }
  }, [id, authFetch, user, navigate])

  useEffect(() => {
    fetchEvent()
  }, [fetchEvent])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setSaving(true)

    try {
      const payload = {}
      if (date) payload.date = new Date(date).toISOString()
      if (status) payload.status = status

      const res = await authFetch(`/api/events/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error || data.detail || `Error ${res.status}`)
      }

      navigate(`/events/${id}`)
    } catch (err) {
      setError(err.message || 'No se pudo guardar el evento')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <main className="page">
        <div className="loading-container">
          <div className="loading-spinner" />
          <span>Cargando evento…</span>
        </div>
      </main>
    )
  }

  if (error && !event) {
    return (
      <main className="page">
        <div className="alert alert-error">{error}</div>
        <button className="btn btn-secondary" onClick={() => navigate('/events')}>
          ← Volver a eventos
        </button>
      </main>
    )
  }

  return (
    <main className="page">
      <div style={{ maxWidth: '560px', margin: '0 auto' }}>
        <div className="page-header">
          <h1>Editar evento</h1>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => navigate(`/events/${id}`)}
          >
            ← Volver
          </button>
        </div>

        {event && (
          <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
            {event.name}
          </p>
        )}

        {error && <div className="alert alert-error" style={{ marginBottom: '1rem' }}>{error}</div>}

        <form onSubmit={handleSubmit}>
          <div
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              padding: '1.5rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '1.25rem',
            }}
          >
            <div className="form-group" style={{ margin: 0 }}>
              <label htmlFor="date">Fecha y hora</label>
              <input
                id="date"
                type="datetime-local"
                value={date}
                onChange={e => setDate(e.target.value)}
                required
              />
            </div>

            <div className="form-group" style={{ margin: 0 }}>
              <label>Estado del evento</label>
              <div className="radio-group">
                <label>
                  <input
                    type="radio"
                    name="status"
                    value="active"
                    checked={status === 'active'}
                    onChange={() => setStatus('active')}
                  />
                  Activo
                </label>
                <label>
                  <input
                    type="radio"
                    name="status"
                    value="suspended"
                    checked={status === 'suspended'}
                    onChange={() => setStatus('suspended')}
                  />
                  Suspendido
                </label>
              </div>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.4rem', minHeight: '2.4rem' }}>
                {status === 'suspended'
                  ? 'Al suspender, no se podrán comprar ni transferir entradas, y el control de acceso rechazará validaciones.'
                  : ''}
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1.25rem' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => navigate(`/events/${id}`)}
              disabled={saving}
            >
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? (
                <>
                  <span className="loading-spinner loading-spinner-sm" />
                  Guardando…
                </>
              ) : 'Guardar cambios'}
            </button>
          </div>
        </form>
      </div>
    </main>
  )
}
