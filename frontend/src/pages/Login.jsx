import React, { useState, useEffect } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { LogIn, Mail, Lock, ArrowRight, Ticket } from 'lucide-react'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const { login, user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const fromLocation = location.state?.from
  const from = (fromLocation?.pathname || '/events') + (fromLocation?.search || '')

  // Scanner: volver a la URL original si tiene token, sino ir a /scan
  const resolveRedirect = (role) => {
    if (role === 'scanner') return from.startsWith('/scan') ? from : '/scan'
    return from || '/events'
  }

  useEffect(() => { document.title = 'Iniciar sesión — TicketChain' }, [])
  useEffect(() => {
    if (user) navigate(resolveRedirect(user.role), { replace: true })
  }, [user]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (!email.trim() || !password) { setError('Completá todos los campos.'); return }
    setLoading(true)
    try {
      const data = await login(email.trim(), password)
      navigate(resolveRedirect(data.user.role), { replace: true })
    } catch (err) {
      setError(err.message || 'Error al iniciar sesión')
    } finally { setLoading(false) }
  }

  return (
    <main className="flex-1 flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-[420px] animate-slideUp">
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#6c63ff] to-[#8b5cf6] flex items-center justify-center shadow-[0_0_30px_rgba(108,99,255,0.2)] mb-4">
            <Ticket className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold gradient-text">Iniciar sesión</h1>
          <p className="text-sm text-[#a1a1aa] mt-1">Accedé a tu cuenta de TicketChain</p>
        </div>

        <div className="rounded-2xl border border-white/[0.08] bg-[#121214] p-6 shadow-lg">
          {error && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-error/10 border border-error/20 text-error text-sm mb-4">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate>
            <div className="flex flex-col gap-1.5 mb-4">
              <label htmlFor="email" className="text-xs font-medium text-[#a1a1aa]">Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#71717a]" />
                <input
                  id="email" type="email" value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="tu@email.com"
                  autoComplete="email" autoFocus required
                  className="input pl-10"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5 mb-6">
              <label htmlFor="password" className="text-xs font-medium text-[#a1a1aa]">Contraseña</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#71717a]" />
                <input
                  id="password" type="password" value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password" required
                  className="input pl-10"
                />
              </div>
            </div>

            <button type="submit" className="btn btn-primary btn-full btn-lg" disabled={loading}>
              {loading ? <><span className="spinner-sm" /> Ingresando…</> : <><LogIn className="w-5 h-5" /> Ingresar</>}
            </button>
          </form>

          <div className="mt-6 pt-5 border-t border-white/[0.06] text-center">
            <p className="text-sm text-[#71717a]">
              ¿No tenés cuenta?{' '}
              <Link to="/register" className="text-[#6c63ff] font-medium hover:underline">Registrate</Link>
            </p>
          </div>
        </div>
      </div>
    </main>
  )
}
