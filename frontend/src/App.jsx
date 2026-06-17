import React from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import Navbar from './components/Navbar.jsx'
import ProtectedRoute from './components/ProtectedRoute.jsx'
import AdminRoute from './components/AdminRoute.jsx'
import Login from './pages/Login.jsx'
import Register from './pages/Register.jsx'
import Events from './pages/Events.jsx'
import EventDetail from './pages/EventDetail.jsx'
import MyTickets from './pages/MyTickets.jsx'
import Dashboard from './pages/admin/Dashboard.jsx'
import CreateEvent from './pages/admin/CreateEvent.jsx'

export default function App() {
  return (
    <>
      <Navbar />
      <Routes>
        <Route path="/" element={<Navigate to="/events" replace />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/events" element={<Events />} />
        <Route path="/events/:id" element={<EventDetail />} />
        <Route
          path="/my-tickets"
          element={
            <ProtectedRoute>
              <MyTickets />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin"
          element={
            <AdminRoute>
              <Dashboard />
            </AdminRoute>
          }
        />
        <Route
          path="/admin/create-event"
          element={
            <AdminRoute>
              <CreateEvent />
            </AdminRoute>
          }
        />
        <Route
          path="*"
          element={
            <div className="page">
              <div className="empty-state">
                <h3>404 — Página no encontrada</h3>
                <p>La página que buscás no existe.</p>
              </div>
            </div>
          }
        />
      </Routes>
    </>
  )
}
