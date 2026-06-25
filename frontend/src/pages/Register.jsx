import React, { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { UserPlus, Mail, Lock, CheckCircle, Wallet, ArrowRight, Ticket, Shield } from 'lucide-react'

export default function Register() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [registered, setRegistered] = useState(null)

  const { register, user } = useAuth()
  const navigate = useNavigate()

  useEffect(() => { document.title = 'Registrarse — TicketChain' }, [])
  useEffect(() => { if (user) navigate('/events', { replace: true }) }, [user, navigate])

  const validate = () => {
    if (!email.trim()) return 'El email es requerido.'
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Email inválido.'
    if (password.length < 8) return 'La contraseña debe tener al menos 8 caracteres.'
    if (password !== confirmPassword) return 'Las contraseñas no coinciden.'
    return null
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    const validationError = validate()
    if (validationError) { setError(validationError); return }
    setLoading(true)
    try {
      const data = await register(email.trim(), password)
      setRegistered(data)
    } catch (err) {
      setError(err.message || 'Error al registrarse')
    } finally { setLoading(false) }
  }

  if (registered) {
    return (
      <main className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-[420px] animate-slideUp">
          <div className="flex flex-col items-center mb-8">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-success to-[#16a34a] flex items-center justify-center shadow-[0_0_30px_rgba(34,197,94,0.2)] mb-4">
              <CheckCircle className="w-7 h-7 text-white" />
            </div>
            <h1 className="text-2xl font-bold gradient-text">¡Registro exitoso!</h1>
            <p className="text-sm text-[#a1a1aa] mt-1">Tu cuenta fue creada correctamente</p>
          </div>

          <div className="rounded-2xl border border-white/[0.08] bg-[#121214] p-6 shadow-lg">
            <div className="flex items-center gap-2 p-3 rounded-xl bg-success/10 border border-success/20 text-success text-sm mb-4">
              <CheckCircle className="w-4 h-4 flex-shrink-0" />
              Cuenta creada. Tu wallet fue generada automáticamente.
            </div>

            {registered.user?.wallet_address && (
              <div className="p-4 rounded-xl bg-white/[0.02] border border-accent/20 mb-4">
                <div className="flex items-center gap-2 text-xs text-[#a1a1aa] mb-2">
                  <Wallet className="w-3.5 h-3.5 text-[#6c63ff]" />
                  Tu wallet address
                </div>
                <div className="font-mono text-sm text-accent font-semibold break-all bg-white/[0.02] p-3 rounded-lg border border-white/[0.06]">
                  {registered.user.wallet_address}
                </div>
                <p className="text-[10px] text-[#71717a] mt-2 flex items-center gap-1">
                  <Shield className="w-3 h-3" />
                  Guardá esta dirección. Es tu identidad en la blockchain de TicketChain.
                </p>
              </div>
            )}

            <Link to="/login" className="btn btn-primary btn-full btn-lg mt-2">
              <ArrowRight className="w-5 h-5" /> Iniciar sesión
            </Link>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="flex-1 flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-[420px] animate-slideUp">
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#6c63ff] to-[#8b5cf6] flex items-center justify-center shadow-[0_0_30px_rgba(108,99,255,0.2)] mb-4">
            <Ticket className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold gradient-text">Registrarse</h1>
          <p className="text-sm text-[#a1a1aa] mt-1">Creá tu cuenta en TicketChain</p>
        </div>

        <div className="rounded-2xl border border-white/[0.08] bg-[#121214] p-6 shadow-lg">
          {error && <div className="flex items-center gap-2 p-3 rounded-xl bg-error/10 border border-error/20 text-error text-sm mb-4">{error}</div>}

          <form onSubmit={handleSubmit} noValidate>
            <div className="flex flex-col gap-1.5 mb-4">
              <label htmlFor="email" className="text-xs font-medium text-[#a1a1aa]">Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#71717a]" />
                <input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="tu@email.com" autoComplete="email" autoFocus required className="input pl-10" />
              </div>
            </div>

            <div className="flex flex-col gap-1.5 mb-4">
              <label htmlFor="password" className="text-xs font-medium text-[#a1a1aa]">Contraseña</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#71717a]" />
                <input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Mínimo 8 caracteres" autoComplete="new-password" required className="input pl-10" />
              </div>
            </div>

            <div className="flex flex-col gap-1.5 mb-6">
              <label htmlFor="confirmPassword" className="text-xs font-medium text-[#a1a1aa]">Confirmar contraseña</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#71717a]" />
                <input id="confirmPassword" type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="Repetí tu contraseña" autoComplete="new-password" required className="input pl-10" />
              </div>
            </div>

            <button type="submit" className="btn btn-primary btn-full btn-lg" disabled={loading}>
              {loading ? <><span className="spinner-sm" /> Registrando…</> : <><UserPlus className="w-5 h-5" /> Crear cuenta</>}
            </button>
          </form>

          <div className="mt-6 pt-5 border-t border-white/[0.06] text-center">
            <p className="text-sm text-[#71717a]">
              ¿Ya tenés cuenta?{' '}
              <Link to="/login" className="text-[#6c63ff] font-medium hover:underline">Iniciá sesión</Link>
            </p>
          </div>
        </div>
      </div>
    </main>
  )
}
