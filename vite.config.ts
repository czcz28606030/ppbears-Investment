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
      // Vercel serverless functions — 轉發到已部署的 production 環境
      '/api/send-newsletter-single': {
        target: 'https://ppbears-investment.vercel.app',
        changeOrigin: true,
      },
      '/api/cron-newsletter': {
        target: 'https://ppbears-investment.vercel.app',
        changeOrigin: true,
      },
      // 外部 API proxy
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
      '/api/tpex': {
        target: 'https://www.tpex.org.tw/openapi/v1',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/tpex/, '')
      },
      '/api/mis': {
        target: 'https://mis.twse.com.tw/stock/api',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/mis/, '')
      },
    }
  }
})
