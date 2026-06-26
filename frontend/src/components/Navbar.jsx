import React from 'react'
import { NavLink, Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { Ticket, Calendar, PlusCircle, Activity, LogOut, LogIn, UserPlus, Shield, ScanLine } from 'lucide-react'

export default function Navbar() {
  const { user, isAdmin, isScanner, logout } = useAuth()
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const linkClass = ({ isActive }) =>
    `flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium no-underline! transition-all duration-200 ${
      isActive
        ? 'bg-accent/10 text-accent shadow-[0_0_20px_rgba(108,99,255,0.08)]'
        : 'text-[#a1a1aa] hover:bg-white/[0.04] hover:text-[#f4f4f5]'
    }`

  return (
    <nav className="glass sticky top-0 z-50 px-6">
      <div className="max-w-[1280px] mx-auto flex items-center justify-between h-16">
        <Link to="/events" className="flex items-center gap-2.5 no-underline! group">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#6c63ff] to-[#8b5cf6] flex items-center justify-center shadow-[0_0_16px_rgba(108,99,255,0.25)] group-hover:shadow-[0_0_24px_rgba(108,99,255,0.35)] transition-shadow duration-300">
            <Ticket className="w-5 h-5 text-white" />
          </div>
          <span className="text-lg font-bold tracking-tight gradient-text">TicketChain</span>
        </Link>

        <div className="hidden md:flex items-center gap-1">
          {!isScanner && (
            <NavLink to="/events" className={linkClass}>
              <Calendar className="w-4 h-4" />
              Eventos
            </NavLink>
          )}

          {user && !isAdmin && !isScanner && (
            <NavLink to="/my-tickets" className={linkClass}>
              <Ticket className="w-4 h-4" />
              Mis Entradas
            </NavLink>
          )}

          {isAdmin && (
            <>
              <NavLink to="/admin/create-event" className={linkClass}>
                <PlusCircle className="w-4 h-4" />
                Crear Evento
              </NavLink>
              <NavLink to="/admin/platform-status" className={linkClass}>
                <Activity className="w-4 h-4" />
                Estado
              </NavLink>
            </>
          )}

          {isScanner && (
            <NavLink to="/scan" className={linkClass}>
              <ScanLine className="w-4 h-4" />
              Escanear
            </NavLink>
          )}
        </div>

        <div className="flex items-center gap-3">
          {user ? (
            <div className="flex items-center gap-3">
              <div className="hidden sm:flex items-center gap-2.5 px-3 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.06]">
                <div className="w-6 h-6 rounded-full bg-gradient-to-br from-[#6c63ff] to-[#8b5cf6] flex items-center justify-center text-[10px] font-bold text-white">
                  {user.email?.charAt(0).toUpperCase() || 'U'}
                </div>
                <span className="text-sm text-[#a1a1aa] max-w-[140px] truncate">{user.email}</span>
                {isAdmin && (
                  <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent/10 text-accent text-[10px] font-semibold uppercase tracking-wider">
                    <Shield className="w-3 h-3" /> Admin
                  </span>
                )}
                {isScanner && (
                  <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#22c55e]/10 text-[#22c55e] text-[10px] font-semibold uppercase tracking-wider">
                    <ScanLine className="w-3 h-3" /> Scanner
                  </span>
                )}
              </div>
              <button
                className="flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium text-[#a1a1aa] hover:bg-white/[0.05] hover:text-[#f4f4f5] transition-all duration-200 no-underline!"
                onClick={handleLogout}
              >
                <LogOut className="w-4 h-4" />
                <span className="hidden sm:inline">Salir</span>
              </button>
            </div>
          ) : (
            <>
              <Link
                to="/login"
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-[#a1a1aa] hover:bg-white/[0.05] hover:text-[#f4f4f5] transition-all duration-200 no-underline!"
              >
                <LogIn className="w-4 h-4" />
                <span className="hidden sm:inline">Ingresar</span>
              </Link>
              <Link
                to="/register"
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white bg-gradient-to-br from-[#6c63ff] to-[#8b5cf6] hover:shadow-[0_0_24px_rgba(108,99,255,0.3)] transition-all duration-200 no-underline! shadow-[0_0_16px_rgba(108,99,255,0.15)]"
              >
                <UserPlus className="w-4 h-4" />
                Registrarse
              </Link>
            </>
          )}
        </div>
      </div>
    </nav>
  )
}
