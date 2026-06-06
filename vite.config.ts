import { createClient } from '@supabase/supabase-js'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import * as fs from 'fs'

const packageJson = JSON.parse(fs.readFileSync('./package.json', 'utf-8'))
const IFALGO_BASE = 'https://api.ifalgo.com.tw/frontapi'
const STOCK_SIGNAL_FEATURE_KEY = 'ai_stock_picking'

type DevUserRow = {
  id: string
  role: 'parent' | 'child'
  parent_id: string | null
  tier: 'free' | 'premium'
  is_admin: boolean
  subscription_expires_at: string | null
}

function sendJson(res: any, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(body))
}

function isPremium(row: Pick<DevUserRow, 'tier' | 'is_admin' | 'subscription_expires_at'> | null): boolean {
  if (!row) return false
  if (row.is_admin) return true
  if (row.tier !== 'premium') return false
  if (!row.subscription_expires_at) return true
  return new Date(row.subscription_expires_at) > new Date()
}

function normalizeDate(value: unknown): string {
  const raw = String(value ?? '').trim().replace(/\//g, '-')
  if (/^\d{8}$/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10)
  return raw
}

function parsePrice(value: unknown): number | null {
  const n = parseFloat(String(value ?? '').replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : null
}

async function devUserHasSignalFeature(supabase: any, token: string): Promise<boolean> {
  const { data: authData, error: authError } = await supabase.auth.getUser(token)
  if (authError || !authData.user) return false

  const { data: user } = await supabase
    .from('users')
    .select('id,role,parent_id,tier,is_admin,subscription_expires_at')
    .eq('id', authData.user.id)
    .maybeSingle() as { data: DevUserRow | null }
  if (!user) return false
  if (user.is_admin) return true

  const { data: override } = await supabase
    .from('feature_overrides')
    .select('enabled')
    .eq('user_id', user.id)
    .eq('feature_key', STOCK_SIGNAL_FEATURE_KEY)
    .maybeSingle() as { data: { enabled: boolean } | null }
  if (override) return Boolean(override.enabled)
  if (isPremium(user)) return true

  if (user.role === 'child' && user.parent_id) {
    const { data: parent } = await supabase
      .from('users')
      .select('tier,is_admin,subscription_expires_at')
      .eq('id', user.parent_id)
      .maybeSingle() as { data: Pick<DevUserRow, 'tier' | 'is_admin' | 'subscription_expires_at'> | null }
    return isPremium(parent || null)
  }

  return false
}

function sanitizeStockPayload(payload: any) {
  const stock = payload?.data?.stock
  if (!stock || typeof stock !== 'object') return payload
  return {
    ...payload,
    data: {
      ...payload.data,
      stock: {
        lastMdate: stock.lastMdate,
        position: stock.position,
      },
    },
  }
}

function ppbearsDevApiPlugin(env: Record<string, string>): Plugin {
  return {
    name: 'ppbears-dev-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url || '', 'http://127.0.0.1')

        if (req.method === 'GET' && url.pathname === '/api/ifalgo/stock') {
          try {
            const upstream = await fetch(`${IFALGO_BASE}/stock${url.search}`, {
              headers: { accept: 'application/json' },
            })
            const json: any = await upstream.json()
            return sendJson(res, upstream.status, sanitizeStockPayload(json))
          } catch (err) {
            return sendJson(res, 500, { error: err instanceof Error ? err.message : 'IFAlgo dev proxy failed' })
          }
        }

        if (
          req.method === 'GET' &&
          (
            url.pathname === '/api/stock-trading-signals' ||
            (url.pathname === '/api/app-cache' && url.searchParams.get('type') === 'stock-trading-signals')
          )
        ) {
          const coid = String(url.searchParams.get('coid') || '').trim()
          if (!/^\d{4,6}$/.test(coid)) {
            return sendJson(res, 400, { error: '缺少有效的股票代號' })
          }

          const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')
          if (!token) return sendJson(res, 401, { error: '請先登入會員帳號' })

          const supabaseUrl = env.VITE_SUPABASE_URL
          const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
          if (!supabaseUrl || !serviceRoleKey) {
            return sendJson(res, 500, { error: 'Missing local Supabase server configuration' })
          }

          try {
            const supabase = createClient(supabaseUrl, serviceRoleKey, {
              auth: { persistSession: false, autoRefreshToken: false },
            })
            const allowed = await devUserHasSignalFeature(supabase, token)
            if (!allowed) return sendJson(res, 403, { error: '此線圖訊號僅限 Premium 會員使用' })

            const upstream = await fetch(`${IFALGO_BASE}/stock?coid=${encodeURIComponent(coid)}`, {
              headers: { accept: 'application/json' },
            })
            if (!upstream.ok) return sendJson(res, upstream.status, { error: `IFAlgo HTTP ${upstream.status}` })
            const json: any = await upstream.json()
            const stock = json?.data?.stock
            const rows = Array.isArray(stock?.aiQuanBackDataTradingList) ? stock.aiQuanBackDataTradingList : []
            const signals = rows.map((row: any) => ({
              id: String(row.id ?? `${row.coid || coid}-${row.in_date || ''}-${row.out_date || ''}`),
              coid: String(row.coid || coid),
              stockName: String(row.stkname || ''),
              inDate: normalizeDate(row.in_date),
              buyClose: parsePrice(row.buy_close),
              outDate: normalizeDate(row.out_date),
              sellClose: parsePrice(row.sell_close),
              signal: String(row.sell_sig || '').trim(),
              returnPct: String(row.return || '').trim(),
              createdAt: String(row.created_at || ''),
              updatedAt: String(row.updated_at || ''),
            }))
            const signalUpdatedAt = signals
              .map((signal: any) => signal.updatedAt || signal.createdAt)
              .filter(Boolean)
              .sort()
              .at(-1) || ''

            return sendJson(res, 200, {
              coid,
              dataDate: normalizeDate(stock?.lastMdate || stock?.position?.chipStability?.mdate || ''),
              signalUpdatedAt,
              source: 'ifalgo-aiQuanBackDataTradingList',
              signals,
              generatedAt: new Date().toISOString(),
            })
          } catch (err) {
            return sendJson(res, 500, { error: err instanceof Error ? err.message : '讀取進出場訊號失敗' })
          }
        }

        return next()
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [ppbearsDevApiPlugin(env), react()],
    define: {
      'import.meta.env.VITE_APP_VERSION': JSON.stringify(packageJson.version)
    },
    server: {
      proxy: {
        // Vercel serverless functions — 轉發到已部署的 production 環境
        '/api/stock-analysis': {
          target: 'https://ppbears-investment.vercel.app',
          changeOrigin: true,
        },
        '/api/institution-cost': {
          target: 'https://ppbears-investment.vercel.app',
          changeOrigin: true,
        },
        '/api/send-newsletter-single': {
          target: 'https://ppbears-investment.vercel.app',
          changeOrigin: true,
        },
        '/api/app-cache': {
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
  }
})
