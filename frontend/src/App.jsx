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
import Scan from './pages/Scan.jsx'
import CreateEvent from './pages/admin/CreateEvent.jsx'
import EditEvent from './pages/admin/EditEvent.jsx'
import PlatformStatus from './pages/admin/PlatformStatus.jsx'
import Checkout from './pages/Checkout.jsx'

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
        <Route path="/checkout" element={<Checkout />} />
        <Route
          path="/scan"
          element={
            <ProtectedRoute allowedRoles={['scanner', 'admin']}>
              <Scan />
            </ProtectedRoute>
          }
        />
        <Route
          path="/my-tickets"
          element={
            <ProtectedRoute>
              <MyTickets />
            </ProtectedRoute>
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
          path="/admin/events/:id/edit"
          element={
            <AdminRoute>
              <EditEvent />
            </AdminRoute>
          }
        />
        <Route
          path="/admin/platform-status"
          element={
            <AdminRoute>
              <PlatformStatus />
            </AdminRoute>
          }
        />
        <Route
          path="*"
          element={
            <main className="flex-1 flex items-center justify-center px-6">
              <div className="text-center">
                <div className="w-16 h-16 rounded-2xl bg-white/[0.03] flex items-center justify-center mx-auto mb-4">
                  <span className="text-3xl font-bold gradient-text">404</span>
                </div>
                <h3 className="text-lg font-semibold text-[#a1a1aa] mb-1">Página no encontrada</h3>
                <p className="text-sm text-[#71717a]">La página que buscás no existe.</p>
              </div>
            </main>
          }
        />
      </Routes>
    </>
  )
}
