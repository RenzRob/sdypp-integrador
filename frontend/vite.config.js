import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: '0.0.0.0',
    allowedHosts: 'all',
    hmr: {
      host: 'localhost',
      port: 80,
      protocol: 'ws',
    },
    proxy: {
      '/api': {
        target: 'http://nginx:80',
        changeOrigin: true
      }
    }
  },
  // vite preview usa esta sección (distinta de server)
  preview: {
    port: 5173,
    host: '0.0.0.0',
    allowedHosts: 'all',
  }
})
