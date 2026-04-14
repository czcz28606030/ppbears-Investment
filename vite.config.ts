import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import * as fs from 'fs'

const packageJson = JSON.parse(fs.readFileSync('./package.json', 'utf-8'))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(packageJson.version)
  },
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
      },
      '/api/twse-report': {
        target: 'https://www.twse.com.tw/exchangeReport',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/twse-report/, '')
      },
    }
  }
})
