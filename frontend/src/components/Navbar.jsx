import React from 'react'
import { NavLink, Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'

export default function Navbar() {
  const { user, isAdmin, logout } = useAuth()
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <nav className="navbar">
      <div className="navbar-inner">
        <Link to="/events" className="navbar-brand">
          ⛓ TicketChain
        </Link>

        <div className="navbar-links">
          <NavLink
            to="/events"
            className={({ isActive }) => `navbar-link${isActive ? ' active' : ''}`}
          >
            Eventos
          </NavLink>

          {user && (
            <NavLink
              to="/my-tickets"
              className={({ isActive }) => `navbar-link${isActive ? ' active' : ''}`}
            >
              Mis Entradas
            </NavLink>
          )}

          {isAdmin && (
            <>
              <NavLink
                to="/admin"
                className={({ isActive }) => `navbar-link${isActive ? ' active' : ''}`}
                end
              >
                Dashboard
              </NavLink>
              <NavLink
                to="/admin/create-event"
                className={({ isActive }) => `navbar-link${isActive ? ' active' : ''}`}
              >
                Crear Evento
              </NavLink>
            </>
          )}
        </div>

        <div className="navbar-user">
          {user ? (
            <>
              <span className="navbar-email">{user.email}</span>
              {isAdmin && <span className="navbar-badge">Admin</span>}
              <button className="btn btn-secondary btn-sm" onClick={handleLogout}>
                Salir
              </button>
            </>
          ) : (
            <>
              <Link to="/login" className="btn btn-secondary btn-sm">
                Ingresar
              </Link>
              <Link to="/register" className="btn btn-primary btn-sm">
                Registrarse
              </Link>
            </>
          )}
        </div>
      </div>
    </nav>
  )
}
