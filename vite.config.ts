import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Bind to all interfaces so the app is reachable outside the sandbox,
    // and allow the live-preview host (e.g. https://5173-<id>.e2b.app).
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
  },
})
