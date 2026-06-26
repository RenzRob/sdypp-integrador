import React, { createContext, useContext, useState, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

const AuthContext = createContext(null)

const TOKEN_KEY = 'ticketchain_token'
const USER_KEY = 'ticketchain_user'

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      const stored = localStorage.getItem(USER_KEY)
      return stored ? JSON.parse(stored) : null
    } catch {
      return null
    }
  })

  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY))

  const isAdmin   = user?.role === 'admin'
  const isScanner = user?.role === 'scanner'

  const saveSession = (userData, jwt) => {
    localStorage.setItem(TOKEN_KEY, jwt)
    localStorage.setItem(USER_KEY, JSON.stringify(userData))
    setToken(jwt)
    setUser(userData)
  }

  const clearSession = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
    setToken(null)
    setUser(null)
  }, [])

  const login = async (email, password) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    })

    const data = await res.json()

    if (!res.ok) {
      throw new Error(data.error || data.detail || data.message || 'Error al iniciar sesión')
    }

    saveSession(data.user, data.token)
    return data
  }

  const register = async (email, password) => {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    })

    const data = await res.json()

    if (!res.ok) {
      throw new Error(data.error || data.detail || data.message || 'Error al registrarse')
    }

    return data
  }

  const logout = useCallback(() => {
    clearSession()
  }, [clearSession])

  // authFetch: fetch que adjunta Authorization header y maneja 401 automáticamente
  const authFetch = useCallback(async (url, options = {}) => {
    const currentToken = localStorage.getItem(TOKEN_KEY)
    const isFormData = options.body instanceof FormData
    const headers = {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...(options.headers || {}),
      ...(currentToken ? { Authorization: `Bearer ${currentToken}` } : {})
    }

    const res = await fetch(url, { ...options, headers })

    if (res.status === 401) {
      clearSession()
      window.location.href = '/login'
      throw new Error('Sesión expirada. Por favor, iniciá sesión nuevamente.')
    }

    return res
  }, [clearSession])

  return (
    <AuthContext.Provider value={{ user, token, isAdmin, isScanner, login, register, logout, authFetch }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider')
  return ctx
}
