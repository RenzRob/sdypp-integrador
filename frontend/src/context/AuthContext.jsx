import React, { createContext, useContext, useState, useCallback, useEffect } from 'react'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  const isAdmin   = user?.role === 'admin'
  const isScanner = user?.role === 'scanner'

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then(res => res.ok ? res.json() : null)
      .then(data => setUser(data?.user ?? null))
      .catch(() => setUser(null))
      .finally(() => setLoading(false))
  }, [])

  const login = async (email, password) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password })
    })

    const data = await res.json()

    if (!res.ok) {
      throw new Error(data.error || data.detail || data.message || 'Error al iniciar sesión')
    }

    setUser(data.user)
    return data
  }

  const register = async (email, password) => {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password })
    })

    const data = await res.json()

    if (!res.ok) {
      throw new Error(data.error || data.detail || data.message || 'Error al registrarse')
    }

    setUser(data.user)
    return data
  }

  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => {})
    setUser(null)
  }, [])

  const authFetch = useCallback(async (url, options = {}) => {
    const isFormData = options.body instanceof FormData
    const headers = {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...(options.headers || {}),
    }

    const res = await fetch(url, { ...options, headers, credentials: 'include' })

    if (res.status === 401) {
      setUser(null)
      window.location.href = '/login'
      throw new Error('Sesión expirada. Por favor, iniciá sesión nuevamente.')
    }

    return res
  }, [])

  if (loading) return null

  return (
    <AuthContext.Provider value={{ user, isAdmin, isScanner, login, register, logout, authFetch }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider')
  return ctx
}
