import React, { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'

export default function Register() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [role, setRole] = useState('user')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [registered, setRegistered] = useState(null) // { wallet_address }

  const { register, user } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    document.title = 'Registrarse — TicketChain'
  }, [])

  useEffect(() => {
    if (user) navigate('/events', { replace: true })
  }, [user, navigate])

  const validate = () => {
    if (!email.trim()) return 'El email es requerido.'
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Email inválido.'
    if (password.length < 6) return 'La contraseña debe tener al menos 6 caracteres.'
    if (password !== confirmPassword) return 'Las contraseñas no coinciden.'
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
    try {
      const data = await register(email.trim(), password, role)
      setRegistered(data)
    } catch (err) {
      setError(err.message || 'Error al registrarse')
    } finally {
      setLoading(false)
    }
  }

  if (registered) {
    return (
      <main>
        <div className="form-container">
          <h1>¡Registro exitoso!</h1>
          <p className="form-subtitle">Tu cuenta fue creada correctamente</p>

          <div className="alert alert-success">
            Cuenta creada. Tu wallet fue generada automáticamente.
          </div>

          {registered.wallet_address && (
            <div className="wallet-box">
              <p>Tu wallet address:</p>
              <div className="wallet-address">{registered.wallet_address}</div>
              <p style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Guardá esta dirección. Es tu identidad en la blockchain de TicketChain.
              </p>
            </div>
          )}

          <div style={{ marginTop: '1.5rem' }}>
            <Link to="/login" className="btn btn-primary btn-full">
              Iniciar sesión
            </Link>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main>
      <div className="form-container">
        <h1>Registrarse</h1>
        <p className="form-subtitle">Creá tu cuenta en TicketChain</p>

        {error && <div className="alert alert-error">{error}</div>}

        <form onSubmit={handleSubmit} noValidate>
          <div className="form-group">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="tu@email.com"
              autoComplete="email"
              autoFocus
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Contraseña</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Mínimo 6 caracteres"
              autoComplete="new-password"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="confirmPassword">Confirmar contraseña</label>
            <input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              placeholder="Repetí tu contraseña"
              autoComplete="new-password"
              required
            />
          </div>

          <div className="form-group">
            <label>Tipo de cuenta</label>
            <div className="radio-group">
              <label>
                <input
                  type="radio"
                  name="role"
                  value="user"
                  checked={role === 'user'}
                  onChange={() => setRole('user')}
                />
                Usuario
              </label>
              <label>
                <input
                  type="radio"
                  name="role"
                  value="admin"
                  checked={role === 'admin'}
                  onChange={() => setRole('admin')}
                />
                Administrador
              </label>
            </div>
          </div>

          <button
            type="submit"
            className="btn btn-primary btn-full"
            disabled={loading}
            style={{ marginTop: '0.5rem' }}
          >
            {loading ? (
              <>
                <span className="loading-spinner loading-spinner-sm" />
                Registrando…
              </>
            ) : 'Crear cuenta'}
          </button>
        </form>

        <p className="form-footer">
          ¿Ya tenés cuenta?{' '}
          <Link to="/login">Iniciá sesión</Link>
        </p>
      </div>
    </main>
  )
}
