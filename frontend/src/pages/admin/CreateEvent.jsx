import React, { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext.jsx'

const initialForm = {
  name: '',
  description: '',
  date: '',
  venue: '',
  total_tickets: '',
  price: '',
  precio_max: '',
  max_reventas: '',
  nominada: false,
  ventana_venta: ''
}

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

    if (!file.type.startsWith('image/')) {
      setImageError('El archivo debe ser una imagen (jpg, png, webp, gif).')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setImageError('La imagen no puede superar 5 MB.')
      return
    }

    setImageFile(file)
    setImagePreview(URL.createObjectURL(file))
  }

  const removeImage = () => {
    setImageFile(null)
    setImagePreview(null)
    setImageError('')
  }

  useEffect(() => {
    document.title = 'Crear Evento — TicketChain'
  }, [])

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target
    setForm(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }))
  }

  const validate = () => {
    if (!form.name.trim()) return 'El nombre es requerido.'
    if (!form.date) return 'La fecha es requerida.'
    if (!form.venue.trim()) return 'El lugar es requerido.'

    const tickets = parseInt(form.total_tickets)
    if (isNaN(tickets) || tickets < 1 || tickets > 100000) {
      return 'La cantidad de tickets debe estar entre 1 y 100.000.'
    }

    const price = parseFloat(form.price)
    if (isNaN(price) || price <= 0) return 'El precio debe ser mayor a 0.'

    if (form.precio_max !== '') {
      const pm = parseFloat(form.precio_max)
      if (isNaN(pm) || pm <= 0) return 'El precio máximo de reventa debe ser mayor a 0.'
    }

    if (form.max_reventas !== '') {
      const mr = parseInt(form.max_reventas)
      if (isNaN(mr) || mr < 0 || mr > 10) {
        return 'El máximo de reventas debe estar entre 0 y 10.'
      }
    }

    if (form.ventana_venta !== '') {
      const vv = parseFloat(form.ventana_venta)
      if (isNaN(vv) || vv < 0) return 'La ventana de venta debe ser un número positivo.'
    }

    if (!imageFile) return 'El banner del evento es requerido.'

    return null
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    const validationError = validate()
    if (validationError) {
      setError(validationError)
      return
    }

    setLoading(true)

    let image_url = null
    if (imageFile) {
      try {
        const formData = new FormData()
        formData.append('image', imageFile)
        const uploadRes = await authFetch('/api/events/upload-image', {
          method: 'POST',
          body: formData,
        })
        const uploadData = await uploadRes.json().catch(() => ({}))
        if (!uploadRes.ok) throw new Error(uploadData.error || 'Error al subir imagen')
        image_url = uploadData.url
      } catch (err) {
        setError(err.message || 'No se pudo subir la imagen')
        setLoading(false)
        return
      }
    }

    const payload = {
      name: form.name.trim(),
      description: form.description.trim(),
      date: form.date,
      venue: form.venue.trim(),
      total_tickets: parseInt(form.total_tickets),
      price: parseFloat(form.price),
      rules: {
        precio_max: form.precio_max !== '' ? parseFloat(form.precio_max) : null,
        max_reventas: form.max_reventas !== '' ? parseInt(form.max_reventas) : 0,
        nominada: form.nominada,
        ventana_venta: form.ventana_venta !== '' ? parseFloat(form.ventana_venta) : null
      },
      image_url,
    }

    try {
      const res = await authFetch('/api/events/', {
        method: 'POST',
        body: JSON.stringify(payload)
      })

      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        throw new Error(data.detail || data.message || `Error ${res.status}`)
      }

      const createdId = data.id || data.event_id
      if (createdId) {
        navigate(`/events/${createdId}`)
      } else {
        navigate('/events')
      }
    } catch (err) {
      setError(err.message || 'No se pudo crear el evento')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="page">
      <div style={{ maxWidth: '680px', margin: '0 auto' }}>
        <div className="page-header">
          <h1>Crear Evento</h1>
          <Link to="/events" className="btn btn-secondary btn-sm">
            ← Dashboard
          </Link>
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        <form onSubmit={handleSubmit} noValidate>
          {/* Información básica */}
          <div
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              padding: '1.5rem',
              marginBottom: '1.25rem'
            }}
          >
            <h3 className="section-title">Información del evento</h3>

            <div className="form-group">
              <label htmlFor="name">Nombre del evento *</label>
              <input
                id="name"
                name="name"
                type="text"
                value={form.name}
                onChange={handleChange}
                placeholder="Ej: Rock en Río 2025"
                required
                autoFocus
              />
            </div>

            <div className="form-group">
              <label htmlFor="description">Descripción</label>
              <textarea
                id="description"
                name="description"
                value={form.description}
                onChange={handleChange}
                placeholder="Descripción del evento…"
                rows={3}
              />
            </div>

            <div className="form-row">
              <div className="form-group">
                <label htmlFor="date">Fecha y hora *</label>
                <input
                  id="date"
                  name="date"
                  type="datetime-local"
                  value={form.date}
                  onChange={handleChange}
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="venue">Lugar *</label>
                <input
                  id="venue"
                  name="venue"
                  type="text"
                  value={form.venue}
                  onChange={handleChange}
                  placeholder="Ej: Estadio Monumental"
                  required
                />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label htmlFor="total_tickets">Cantidad de tickets *</label>
                <input
                  id="total_tickets"
                  name="total_tickets"
                  type="number"
                  min="1"
                  max="100000"
                  value={form.total_tickets}
                  onChange={handleChange}
                  placeholder="Ej: 200"
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="price">Precio base (ARS) *</label>
                <input
                  id="price"
                  name="price"
                  type="number"
                  min="1"
                  step="0.01"
                  value={form.price}
                  onChange={handleChange}
                  placeholder="Ej: 15000"
                  required
                />
              </div>
            </div>
          </div>

          {/* Banner */}
          <div style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            padding: '1.5rem',
            marginBottom: '1.25rem'
          }}>
            <h3 className="section-title">Banner del evento *</h3>

            {imageError && <div className="alert alert-error" style={{ marginBottom: '0.75rem' }}>{imageError}</div>}

            {imagePreview ? (
              <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
                <img
                  src={imagePreview}
                  alt="Preview"
                  style={{ width: '160px', height: '120px', objectFit: 'cover', borderRadius: '8px', border: '1px solid var(--border)', flexShrink: 0 }}
                />
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{imageFile.name}</span>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{(imageFile.size / 1024).toFixed(0)} KB</span>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={removeImage}>
                    Quitar imagen
                  </button>
                </div>
              </div>
            ) : (
              <label style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
                border: '2px dashed var(--border)',
                borderRadius: '8px',
                padding: '2rem',
                cursor: 'pointer',
                color: 'var(--text-muted)',
                fontSize: '0.9rem',
                transition: 'border-color 0.2s',
              }}
              onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent)'}
              onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
              >
                <span style={{ fontSize: '2rem' }}>🖼</span>
                <span>Hacé click para subir una imagen</span>
                <span style={{ fontSize: '0.78rem' }}>JPG, PNG, WebP o GIF — máx. 5 MB</span>
                <input
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={handleImageChange}
                />
              </label>
            )}
          </div>

          {/* Reglas */}
          <div
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              padding: '1.5rem',
              marginBottom: '1.25rem'
            }}
          >
            <h3 className="section-title">Reglas de reventa</h3>

            <div className="form-row">
              <div className="form-group">
                <label htmlFor="precio_max">
                  Precio máx. reventa (% del original)
                </label>
                <input
                  id="precio_max"
                  name="precio_max"
                  type="number"
                  min="0"
                  step="1"
                  value={form.precio_max}
                  onChange={handleChange}
                  placeholder="Ej: 150 = 150%"
                />
              </div>

              <div className="form-group">
                <label htmlFor="max_reventas">Máximo de reventas (0–10)</label>
                <input
                  id="max_reventas"
                  name="max_reventas"
                  type="number"
                  min="0"
                  max="10"
                  step="1"
                  value={form.max_reventas}
                  onChange={handleChange}
                  placeholder="Ej: 3"
                />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label htmlFor="ventana_venta">Ventana de venta (horas antes del evento)</label>
                <input
                  id="ventana_venta"
                  name="ventana_venta"
                  type="number"
                  min="0"
                  step="0.5"
                  value={form.ventana_venta}
                  onChange={handleChange}
                  placeholder="Ej: 2"
                />
              </div>

              <div className="form-group" style={{ justifyContent: 'flex-end' }}>
                <label className="checkbox-label" style={{ marginTop: 'auto', paddingBottom: '0.6rem' }}>
                  <input
                    type="checkbox"
                    name="nominada"
                    checked={form.nominada}
                    onChange={handleChange}
                  />
                  Entrada nominada (no transferible)
                </label>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
            <Link to="/events" className="btn btn-secondary">
              Cancelar
            </Link>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading}
            >
              {loading ? (
                <>
                  <span className="loading-spinner loading-spinner-sm" />
                  Creando evento…
                </>
              ) : 'Crear evento'}
            </button>
          </div>
        </form>
      </div>
    </main>
  )
}
