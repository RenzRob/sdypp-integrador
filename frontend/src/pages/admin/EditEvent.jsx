import React, { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext.jsx'
import { Save, ArrowLeft, Calendar, Ban, CheckCircle, AlertCircle, Edit3 } from 'lucide-react'

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

  useEffect(() => { document.title = 'Editar Evento — TicketChain' }, [])

  const fetchEvent = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const res = await authFetch(`/api/events/${id}`)
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || d.detail || `Error ${res.status}`) }
      const data = await res.json()
      if (data.creator_id !== user?.id) { navigate(`/events/${id}`); return }
      setEvent(data)
      setDate(data.date ? data.date.slice(0, 16) : '')
      setStatus(data.status || 'active')
    } catch (err) {
      setError(err.message || 'No se pudo cargar el evento')
    } finally { setLoading(false) }
  }, [id, authFetch, user, navigate])

  useEffect(() => { fetchEvent() }, [fetchEvent])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(''); setSaving(true)
    try {
      const payload = {}
      if (date) payload.date = new Date(date).toISOString()
      if (status) payload.status = status
      const res = await authFetch(`/api/events/${id}`, { method: 'PATCH', body: JSON.stringify(payload) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || data.detail || `Error ${res.status}`)
      navigate(`/events/${id}`)
    } catch (err) {
      setError(err.message || 'No se pudo guardar el evento')
    } finally { setSaving(false) }
  }

  if (loading) {
    return (
      <main className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-[#a1a1aa]">
          <div className="spinner" />
          <span className="text-sm">Cargando evento…</span>
        </div>
      </main>
    )
  }

  if (error && !event) {
    return (
      <main className="flex-1 max-w-[1280px] mx-auto px-6 py-8">
        <div className="max-w-lg mx-auto p-4 rounded-xl bg-error/10 border border-error/20 text-error text-sm mb-4">{error}</div>
        <div className="flex justify-center">
          <button className="btn btn-ghost" onClick={() => navigate('/events')}><ArrowLeft className="w-4 h-4" /> Volver</button>
        </div>
      </main>
    )
  }

  return (
    <main className="flex-1">
      <div className="border-b border-white/[0.06] bg-gradient-to-b from-[#0c0c10] to-transparent px-6 py-10">
        <div className="max-w-[560px] mx-auto text-center">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#6c63ff] to-[#8b5cf6] flex items-center justify-center mx-auto mb-4 shadow-[0_0_30px_rgba(108,99,255,0.2)]">
            <Edit3 className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-2xl md:text-3xl font-bold gradient-text mb-1">Editar evento</h1>
          {event && <p className="text-sm text-[#a1a1aa]">{event.name}</p>}
        </div>
      </div>

      <div className="max-w-[560px] mx-auto px-6 py-6">
        {error && <div className="flex items-center gap-2 p-3 rounded-xl bg-error/10 border border-error/20 text-error text-sm mb-4"><AlertCircle className="w-4 h-4 flex-shrink-0" />{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="rounded-2xl border border-white/[0.08] bg-[#121214] p-6 flex flex-col gap-5">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="date" className="text-xs font-medium text-[#a1a1aa]">Fecha y hora</label>
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#71717a]" />
                <input id="date" type="datetime-local" value={date} onChange={e => setDate(e.target.value)} required className="input pl-10" />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-[#a1a1aa]">Estado del evento</label>
              <div className="flex gap-6 py-1">
                <label className="flex items-center gap-2 cursor-pointer text-sm text-[#a1a1aa] hover:text-[#f4f4f5] transition-colors">
                  <input type="radio" name="status" value="active" checked={status === 'active'} onChange={() => setStatus('active')} className="w-4 h-4 accent-[#6c63ff]" />
                  <CheckCircle className="w-4 h-4 text-success" />
                  Activo
                </label>
                <label className="flex items-center gap-2 cursor-pointer text-sm text-[#a1a1aa] hover:text-[#f4f4f5] transition-colors">
                  <input type="radio" name="status" value="suspended" checked={status === 'suspended'} onChange={() => setStatus('suspended')} className="w-4 h-4 accent-[#6c63ff]" />
                  <Ban className="w-4 h-4 text-error" />
                  Suspendido
                </label>
              </div>
              {status === 'suspended' && (
                <p className="flex items-center gap-1.5 text-[11px] text-warning mt-1">
                  <AlertCircle className="w-3.5 h-3.5" />
                  No se podrán comprar ni transferir entradas. El control de acceso rechazará validaciones.
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between mt-6">
            <button type="button" className="btn btn-ghost" onClick={() => navigate(`/events/${id}`)} disabled={saving}>
              <ArrowLeft className="w-4 h-4" /> Cancelar
            </button>
            <button type="submit" className="btn btn-primary btn-lg" disabled={saving}>
              {saving ? <><span className="spinner-sm" /> Guardando…</> : <><Save className="w-5 h-5" /> Guardar cambios</>}
            </button>
          </div>
        </form>
      </div>
    </main>
  )
}
