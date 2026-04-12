import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/ifalgo': {
        target: 'https://api.ifalgo.com.tw/frontapi',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/ifalgo/, '')
      },
      '/api/twse': {
        target: 'https://openapi.twse.com.tw/v1',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/twse/, '')
      }
    }
  }
})
