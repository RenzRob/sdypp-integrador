import React, { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext.jsx'
import { PlusCircle, ArrowLeft, Image, Trash2, Calendar, MapPin, Ticket, DollarSign, Percent, Repeat, Clock, CheckSquare, Info, AlertCircle } from 'lucide-react'

const initialForm = {
  name: '', description: '', date: '', venue: '',
  total_tickets: '', price: '',
  precio_max: '', max_reventas: '', nominada: false, ventana_venta: ''
}

const Section = ({ title, icon, children }) => (
  <div className="rounded-2xl border border-white/[0.08] bg-[#121214] p-6 mb-5">
    <h3 className="text-sm font-semibold text-[#f4f4f5] flex items-center gap-2 pb-3 mb-5 border-b border-white/[0.06]">
      {icon} {title}
    </h3>
    {children}
  </div>
)

const Field = ({ label, children }) => (
  <div className="flex flex-col gap-1.5 mb-4">
    <label className="text-xs font-medium text-[#a1a1aa]">{label}</label>
    {children}
  </div>
)

const InputIcon = ({ icon, children }) => (
  <div className="relative">
    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#71717a]">{icon}</span>
    {children}
  </div>
)

export default function CreateEvent() {
  const [form, setForm] = useState(initialForm)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [imageFile, setImageFile] = useState(null)
  const [imagePreview, setImagePreview] = useState(null)
  const [imageError, setImageError] = useState('')

  const { authFetch } = useAuth()
  const navigate = useNavigate()

  const handleImageChange = (e) => {
    const file = e.target.files[0]
    if (!file) return
    setImageError('')
    if (!file.type.startsWith('image/')) { setImageError('Debe ser una imagen (jpg, png, webp, gif).'); return }
    if (file.size > 5 * 1024 * 1024) { setImageError('La imagen no puede superar 5 MB.'); return }
    setImageFile(file)
    setImagePreview(URL.createObjectURL(file))
  }

  const removeImage = () => { setImageFile(null); setImagePreview(null); setImageError('') }

  useEffect(() => { document.title = 'Crear Evento — TicketChain' }, [])

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target
    setForm(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }))
  }

  const validate = () => {
    if (!form.name.trim()) return 'El nombre es requerido.'
    if (!form.date) return 'La fecha es requerida.'
    if (new Date(form.date) <= new Date()) return 'La fecha del evento debe ser futura.'
    if (!form.venue.trim()) return 'El lugar es requerido.'
    const tickets = parseInt(form.total_tickets)
    if (isNaN(tickets) || tickets < 1 || tickets > 100000) return 'Los tickets deben estar entre 1 y 100.000.'
    const price = parseFloat(form.price)
    if (isNaN(price) || price <= 0) return 'El precio debe ser mayor a 0.'
    if (form.precio_max !== '') { const pm = parseFloat(form.precio_max); if (isNaN(pm) || pm <= 0) return 'Precio máx. reventa debe ser mayor a 0.' }
    if (form.max_reventas !== '') { const mr = parseInt(form.max_reventas); if (isNaN(mr) || mr < 0 || mr > 10) return 'Máx. reventas debe estar entre 0 y 10.' }
    if (form.ventana_venta !== '') { const vv = parseFloat(form.ventana_venta); if (isNaN(vv) || vv < 0) return 'Ventana de venta debe ser positiva.' }
    if (!imageFile) return 'El banner del evento es requerido.'
    return null
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    const validationError = validate()
    if (validationError) { setError(validationError); return }
    setLoading(true)
    let image_url = null
    if (imageFile) {
      try {
        const formData = new FormData()
        formData.append('image', imageFile)
        const uploadRes = await authFetch('/api/events/upload-image', { method: 'POST', body: formData })
        const uploadData = await uploadRes.json().catch(() => ({}))
        if (!uploadRes.ok) throw new Error(uploadData.error || 'Error al subir imagen')
        image_url = uploadData.url
      } catch (err) {
        setError(err.message || 'No se pudo subir la imagen'); setLoading(false); return
      }
    }
    try {
      const res = await authFetch('/api/events/', {
        method: 'POST',
        body: JSON.stringify({
          name: form.name.trim(), description: form.description.trim(),
          date: form.date, venue: form.venue.trim(),
          total_tickets: parseInt(form.total_tickets), price: parseFloat(form.price),
          rules: {
            precio_max: form.precio_max !== '' ? parseFloat(form.precio_max) : null,
            max_reventas: form.max_reventas !== '' ? parseInt(form.max_reventas) : 0,
            nominada: form.nominada,
            ventana_venta: form.ventana_venta !== '' ? parseFloat(form.ventana_venta) : null
          },
          image_url,
        })
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || data.message || `Error ${res.status}`)
      const createdId = data.id || data.event_id
      navigate(createdId ? `/events/${createdId}` : '/events')
    } catch (err) {
      setError(err.message || 'No se pudo crear el evento')
    } finally { setLoading(false) }
  }

  return (
    <main className="flex-1 overflow-y-auto">
      <div className="border-b border-white/[0.06] bg-gradient-to-b from-[#0c0c10] to-transparent px-6 py-8">
        <div className="max-w-[720px] mx-auto text-center">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#6c63ff] to-[#8b5cf6] flex items-center justify-center mx-auto mb-4 shadow-[0_0_30px_rgba(108,99,255,0.2)]">
            <PlusCircle className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-2xl md:text-3xl font-bold gradient-text mb-1">Crear Evento</h1>
          <p className="text-sm text-[#a1a1aa]">Completá los detalles del nuevo evento</p>
        </div>
      </div>

      <div className="max-w-[720px] mx-auto px-6 py-6">
        {error && <div className="flex items-center gap-2 p-3 rounded-xl bg-error/10 border border-error/20 text-error text-sm mb-4"><AlertCircle className="w-4 h-4 flex-shrink-0" />{error}</div>}

        <form onSubmit={handleSubmit} noValidate>
          <Section title="Información del evento" icon={<Info className="w-4 h-4 text-[#6c63ff]" />}>
            <Field label="Nombre del evento *">
              <input id="name" name="name" type="text" value={form.name} onChange={handleChange} placeholder="Ej: Rock en Río 2025" required autoFocus className="input" />
            </Field>

            <Field label="Descripción">
              <textarea id="description" name="description" value={form.description} onChange={handleChange} placeholder="Descripción del evento…" rows={3} className="input resize-y min-h-[60px]" />
            </Field>

            <div className="grid grid-cols-2 gap-4 max-md:grid-cols-1">
              <Field label="Fecha y hora *">
                <InputIcon icon={<Calendar className="w-4 h-4" />}>
                  <input id="date" name="date" type="datetime-local" value={form.date} onChange={handleChange} required className="input pl-10" />
                </InputIcon>
              </Field>
              <Field label="Lugar *">
                <InputIcon icon={<MapPin className="w-4 h-4" />}>
                  <input id="venue" name="venue" type="text" value={form.venue} onChange={handleChange} placeholder="Ej: Estadio Monumental" required className="input pl-10" />
                </InputIcon>
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-4 max-md:grid-cols-1">
              <Field label="Cantidad de tickets *">
                <InputIcon icon={<Ticket className="w-4 h-4" />}>
                  <input id="total_tickets" name="total_tickets" type="number" min="1" max="100000" value={form.total_tickets} onChange={handleChange} placeholder="Ej: 200" required className="input pl-10" />
                </InputIcon>
              </Field>
              <Field label="Precio base (ARS) *">
                <InputIcon icon={<DollarSign className="w-4 h-4" />}>
                  <input id="price" name="price" type="number" min="1" step="0.01" value={form.price} onChange={handleChange} placeholder="Ej: 15000" required className="input pl-10" />
                </InputIcon>
              </Field>
            </div>
          </Section>

          <Section title="Banner del evento *" icon={<Image className="w-4 h-4 text-[#6c63ff]" />}>
            {imageError && <div className="flex items-center gap-2 p-3 rounded-xl bg-error/10 border border-error/20 text-error text-xs mb-3"><AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />{imageError}</div>}
            {imagePreview ? (
              <div className="flex gap-4 items-start">
                <img src={imagePreview} alt="Preview" className="w-36 h-28 object-cover rounded-xl border border-white/[0.06] flex-shrink-0" />
                <div className="flex flex-col gap-2">
                  <span className="text-xs text-[#a1a1aa]">{imageFile.name}</span>
                  <span className="text-[10px] text-[#71717a]">{(imageFile.size / 1024).toFixed(0)} KB</span>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={removeImage}><Trash2 className="w-3.5 h-3.5" /> Quitar</button>
                </div>
              </div>
            ) : (
              <label className="flex flex-col items-center justify-center gap-3 border-2 border-dashed border-white/[0.08] rounded-xl py-10 px-6 cursor-pointer text-[#71717a] text-sm transition-all duration-200 hover:border-accent/30 hover:bg-accent/[0.02]">
                <Image className="w-8 h-8" />
                <span>Hacé click para subir una imagen</span>
                <span className="text-[10px]">JPG, PNG, WebP o GIF — máx. 5 MB</span>
                <input type="file" accept="image/*" className="hidden" onChange={handleImageChange} />
              </label>
            )}
          </Section>

          <Section title="Reglas de reventa" icon={<Percent className="w-4 h-4 text-[#6c63ff]" />}>
            <div className="grid grid-cols-2 gap-4 max-md:grid-cols-1">
              <Field label="Precio máx. reventa (% del original)">
                <InputIcon icon={<Percent className="w-4 h-4" />}>
                  <input id="precio_max" name="precio_max" type="number" min="0" step="1" value={form.precio_max} onChange={handleChange} placeholder="Ej: 150" className="input pl-10" />
                </InputIcon>
              </Field>
              <Field label="Máximo de reventas (0–10)">
                <InputIcon icon={<Repeat className="w-4 h-4" />}>
                  <input id="max_reventas" name="max_reventas" type="number" min="0" max="10" step="1" value={form.max_reventas} onChange={handleChange} placeholder="Ej: 3" className="input pl-10" />
                </InputIcon>
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-4 max-md:grid-cols-1">
              <Field label="Ventana de venta (horas antes)">
                <InputIcon icon={<Clock className="w-4 h-4" />}>
                  <input id="ventana_venta" name="ventana_venta" type="number" min="0" step="0.5" value={form.ventana_venta} onChange={handleChange} placeholder="Ej: 2" className="input pl-10" />
                </InputIcon>
              </Field>
              <div className="flex items-end pb-4">
                <label className="flex items-center gap-2.5 cursor-pointer text-sm text-[#a1a1aa] hover:text-[#f4f4f5] transition-colors">
                  <input type="checkbox" name="nominada" checked={form.nominada} onChange={handleChange} className="w-4 h-4 accent-[#6c63ff]" />
                  <CheckSquare className="w-4 h-4 text-[#6c63ff]" />
                  Entrada nominada (no transferible)
                </label>
              </div>
            </div>
          </Section>

          <div className="flex items-center justify-between">
            <Link to="/events" className="btn btn-ghost">
              <ArrowLeft className="w-4 h-4" /> Cancelar
            </Link>
            <button type="submit" className="btn btn-primary btn-lg" disabled={loading}>
              {loading ? <><span className="spinner-sm" /> Creando evento…</> : <><PlusCircle className="w-5 h-5" /> Crear evento</>}
            </button>
          </div>
        </form>
      </div>
    </main>
  )
}
