import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    // Bind to all interfaces so the app is reachable in the live preview.
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
    // Browser code always calls a same-origin /api URL. The Vite server
    // forwards API requests to the private Node service; secrets stay server-side.
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
})
