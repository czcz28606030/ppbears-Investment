# PPBears Investment — 完整代碼知識文件 (SKILL)

> **目的**：任何 AI 讀完此文件後，應能完全理解本專案的架構、功能、技術棧、資料流、部署方式與開發慣例，並能立即開始修改或擴展代碼。
> **版本**：v1.9.0 ｜ **最後掃描日期**：2026-04-21

---

## 1. 專案概述

**PPBears Investment** 是一款**針對親子投資教育**的台股模擬交易 Web App。由家長（Parent）建立帳號，可邀請孩子（Child）使用副帳號進行模擬股票買賣、學習投資知識、完成課程賺取學習幣。

### 核心特色
- 🐻 **Kawaii 風格 UI**：暖色調（Coral/Yellow/Green）、Nunito 字型、圓角卡片設計
- 📈 **台股即時報價**：整合 TWSE/TPEx/MIS 即時 API + IFalgo Simons 量化模型
- 🤖 **AI 輔助選股**：GPT-4o-mini 提供技術面/籌碼面/消息面分析
- 📚 **55 堂互動課程**：JSON 定義的卡片式教學 + 答題系統
- 💰 **學習獎勵系統**：學習幣錢包、商城兌換、家長審核機制
- 📧 **每日 AI 電子報**：Vercel Cron + Resend，Premium 用戶每日收到選股推薦

---

## 2. 技術棧

| 層級 | 技術 |
|------|------|
| **前端框架** | React 19 + TypeScript 6 + Vite 8 |
| **狀態管理** | Zustand 5（單一 store，`src/store.ts`，1737 行） |
| **路由** | React Router DOM 7（`src/App.tsx`） |
| **CSS** | Vanilla CSS 設計系統（`src/index.css`），各頁面獨立 CSS |
| **後端資料庫** | Supabase（PostgreSQL + Auth + Storage + RLS） |
| **Serverless API** | Vercel Serverless Functions（`api/` 目錄，TypeScript） |
| **AI** | OpenAI GPT-4o-mini（stock-analysis + newsletter） |
| **郵件** | Resend SDK（電子報發送） |
| **外部 API** | IFalgo（Simons 量化）、TWSE/TPEx/MIS（台股行情）、Yahoo Finance（新聞爬取） |
| **部署** | Vercel（前端 SPA + Serverless + Cron） |

---

## 3. 目錄結構

```
ppbears-Investment/
├── api/                          # Vercel Serverless Functions
│   ├── _newsletter-utils.ts      # 電子報共用邏輯（601 行）
│   ├── cron-newsletter.ts        # 每日 07:00 (UTC+8) 發送電子報
│   ├── cron-newsletter-prepare.ts# 每日 06:00 預先準備快取
│   ├── send-newsletter-single.ts # 手動觸發單一用戶電子報
│   └── stock-analysis.ts         # AI 個股分析（GPT-4o-mini）
├── src/
│   ├── App.tsx                   # 路由定義 + 底部導覽列
│   ├── main.tsx                  # React 入口
│   ├── store.ts                  # Zustand 全域狀態（1737 行，核心）
│   ├── api.ts                    # 前端 API 呼叫層（728 行）
│   ├── types.ts                  # TypeScript 型別定義（267 行）
│   ├── supabase.ts               # Supabase Client 初始化
│   ├── index.css                 # 全域設計系統（992 行）
│   ├── components/
│   │   └── AdBanner.tsx          # 廣告橫幅（Free 用戶）
│   ├── data/lessons/             # 55 堂課程 JSON（L001~L055）+ index.ts
│   └── pages/                    # 24 個頁面（見下方）
├── supabase-schema.sql           # 主資料庫 Schema
├── supabase-learning-schema.sql  # 學習模組 Schema
├── supabase-rewards-schema.sql   # 獎勵模組 Schema
├── supabase-trade-rpc.sql        # 交易 RPC 函數（v1.9.0）
├── vercel.json                   # Cron + API Rewrites
├── vite.config.ts                # Vite 設定 + Dev Proxy
└── package.json                  # v1.9.0, type: module
```

---

## 4. 頁面與路由

| 路由 | 頁面檔案 | 功能描述 |
|------|---------|---------|
| `/` | `Dashboard.tsx` | 首頁：總資產卡（現金/股票市值/未平倉損益）、持股清單 |
| `/explore` | `Explore.tsx` | 找股票：6 種策略篩選 + AI 聰明選股 + Simons 量化評分 |
| `/portfolio` | `Portfolio.tsx` | 看庫存：持股列表、即時市值更新 |
| `/stock/:code` | `StockDetail.tsx` | 個股詳情（79K 行，最大檔案）：K線、買賣表單、AI 即時整理、Simons 量化模型、法人成本、Tooltip |
| `/history` | `TradeHistory.tsx` | 交易紀錄：日期區間篩選、損益統計、投資心得 |
| `/learn` | `LearnHome.tsx` | 學習首頁：今日課程、進度、連續天數 |
| `/learn/articles` | `LearnArticles.tsx` | 全部課程列表 |
| `/learn/lesson/:id` | `LessonView.tsx` | 上課：卡片教學 + 答題 + 計分 |
| `/learn/wallet` | `WalletView.tsx` | 學習幣錢包 |
| `/learn/shop` | `ShopView.tsx` | 學習幣商城 |
| `/learn/requests` | `ChildRequestsView.tsx` | 兌換申請紀錄（Child） |
| `/login` | `Login.tsx` | 登入 |
| `/register` | `Register.tsx` | 註冊（主帳號，初始 10 萬） |
| `/forgot-password` | `ForgotPassword.tsx` | 忘記密碼 |
| `/update-password` | `UpdatePassword.tsx` | 密碼重設 |
| `/settings` | `ProfileSettings.tsx` | 個人設定：暱稱、頭像、手續費率、電子報策略 |
| `/manage-children` | `ManageChildren.tsx` | 家長管理副帳號：建立/餘額調整 |
| `/withdrawal-approval` | `WithdrawalApproval.tsx` | 出金申請/審核 |
| `/parent/rewards` | `ParentRewardDashboard.tsx` | 獎勵系統總覽 |
| `/parent/rewards/rules` | `ParentRewardsSetup.tsx` | 發幣規則設定 |
| `/parent/rewards/shop` | `ParentRewardShopManager.tsx` | 商城商品管理 |
| `/parent/rewards/review` | `ParentRewardReview.tsx` | 兌換審核 |
| `/parent/rewards/grant` | `ParentRewardGrant.tsx` | 手動發幣 |
| `/parent/rewards/history` | `ParentRewardHistory.tsx` | 交易紀錄 |
| `/admin` | `AdminDashboard.tsx` | 管理員：用戶管理、Tier 升降、系統設定 |

---

## 5. 資料庫架構 (Supabase PostgreSQL)

### 5.1 核心表

| 表名 | 用途 | 關鍵欄位 |
|------|------|---------|
| `users` | 用戶（綁 auth.users） | `id(uuid PK)`, `role(parent/child)`, `tier(free/premium)`, `is_admin`, `available_balance`, `parent_id`, `broker_fee_rate/min_fee/tax_rate`, `newsletter_strategy` |
| `trades` | 交易紀錄 | `trade_type(buy/sell/deposit/withdraw)`, `stock_code`, `quantity`, `price`, `total_amount`, `profit`, `reason` |
| `holdings` | 持股 | `stock_code`, `total_shares`, `avg_cost`, `current_price`, `UNIQUE(user_id, stock_code)` |
| `withdrawal_requests` | 出金申請 | `child_id`, `parent_id`, `amount`, `status(pending/approved/rejected)` |
| `feature_overrides` | 功能開關（Admin 控制） | `user_id`, `feature_key`, `enabled` |
| `system_settings` | 全域設定 | `setting_key`, `setting_value`（如 free_max_holdings=5） |
| `stock_profiles` | AI 公司介紹快取 | `stock_code(PK)`, `kid_description` |
| `newsletter_daily_cache` | 電子報每日快取 | `cache_date(PK)`, `all_stocks(jsonb)`, `ai_filtered(jsonb)` |

### 5.2 學習模組表

| 表名 | 用途 |
|------|------|
| `learning_profiles` | 學習進度：level/stage/xp/streak |
| `lesson_progress` | 課程完成紀錄 |
| `learning_wallet` | 學習幣錢包：balance/frozen/total_earned/total_spent |
| `wallet_transactions` | 學習幣異動紀錄（earn/redeem/parent_grant/refund/freeze/unfreeze） |

### 5.3 獎勵模組表

| 表名 | 用途 |
|------|------|
| `reward_rules` | 家長設定的自動發幣規則（trigger: daily_complete/streak_7/level_up 等） |
| `reward_shop_items` | 商城商品（cash/product/experience/invest_bonus） |
| `redemption_requests` | 兌換申請（pending → approved/rejected） |

### 5.4 RPC 函數

| 函數 | 用途 |
|------|------|
| `execute_buy_trade()` | 原子性買入：驗餘額 → 扣款 → 寫 trades → upsert holdings（FOR UPDATE 鎖） |
| `execute_sell_trade()` | 原子性賣出：驗持股 → 計算損益 → 加餘額 → 寫 trades → 更新/刪除 holdings |
| `grant_learning_coins()` | 發學習幣（安全驗證：本人或家長） |
| `freeze_coins()` | 凍結學習幣（兌換申請時） |
| `approve_redemption()` | 核可兌換（扣凍結幣） |
| `reject_redemption()` | 駁回兌換（退還凍結幣） |
| `is_admin()` | SECURITY DEFINER 判斷管理員身分 |

### 5.5 RLS 原則
- 用戶只能存取自己的資料
- 家長可 SELECT 所屬副帳號資料
- 管理員透過 `is_admin()` 繞過 RLS
- 學習幣的 UPDATE 僅透過 SECURITY DEFINER 函數

---

## 6. 狀態管理 (store.ts)

**單一 Zustand store**（`useStore`），包含：

### State
```
session, user, children, holdings, trades,
withdrawalRequests, featureOverrides, systemSettings, allUsers,
loading, authLoading, isRecoveryMode,
learningProfile, learningWallet, learningWalletTxs,
childrenTxLog, rewardRules, completedLessonIds,
shopItems, redemptions
```

### 核心 Actions
- **Auth**: `initAuth`, `login`, `logout`, `registerParent`, `sendPasswordResetEmail`, `updatePassword`
- **Data**: `loadUserData`（平行載入 holdings/trades/children/settings）
- **Trading**: `executeBuy` / `executeSell`（呼叫 RPC，本地更新 store 不 reload）
- **Children**: `createChildAccount`, `setChildBalance`, `approveWithdrawal`, `rejectWithdrawal`
- **Learning**: `completeLesson`（XP 計算 + 連續天數 + 自動發幣）
- **Rewards**: `fetchRewardRules`, `applyRewardTemplate`, `grantCoinsManually`
- **Shop**: `fetchShopItems`, `requestRedemption`, `approveRedemption`, `rejectRedemption`
- **Admin**: `adminSetUserTier`, `adminDeleteUser`, `adminSetUserBalance`
- **Helpers**: `isPremiumUser`（含家庭方案繼承）、`hasFeature`、`getPortfolioSummary`

### 重要機制
- **閒置登出**：120 分鐘無操作自動 logout
- **Tab 切回刷新**：`visibilitychange` 事件重新載入資料
- **股價快取**：盤中 5 分鐘 / 盤後 24 小時 TTL
- **Timeout/Retry**：所有 DB 操作帶 timeout（`withWriteTimeout` 20s）+ retry

---

## 7. API 層 (api.ts)

### 外部 API 整合
| API | 前端路徑 | 實際目標 | 用途 |
|-----|---------|---------|------|
| IFalgo | `/api/ifalgo/*` | `api.ifalgo.com.tw/frontapi/*` | 個股資料、Simons 每日推薦、量化資料 |
| TWSE OpenAPI | `/api/twse/*` | `openapi.twse.com.tw/v1/*` | 上市股票收盤價、殖利率 |
| TPEx | `/api/tpex/*` | `tpex.org.tw/openapi/v1/*` | 上櫃股票收盤價 |
| TWSE MIS | `/api/mis/*` | `mis.twse.com.tw/stock/api/*` | 即時盤中報價（漲跌停即時反映） |
| TWSE Report | `/api/twse-report/*` | `twse.com.tw/exchangeReport/*` | 歷史殖利率、除權息 |

### 關鍵函數
- `fetchOfficialClosePrice(code)`: MIS 即時 → TWSE → TPEx fallback 鏈
- `fetchSimonsData(date)`: Simons 每日推薦清單
- `fetchStockQuantData(coid)`: 量化資料（AI推薦等級/累積報酬/籌碼穩定度）
- `calculateSimonsScore(item, quantData)`: Premium 專屬五維評分（AI推薦40分 + PSR30分 + 強度20分 + GVI15分 + 籌碼10分）
- `calculateAdvice(item)`: 免費版評分（PSR + 趨勢 + 強度 + 法人成本）
- `toRecommendation(item, quantData?)`: 統一推薦介面（有 quantData 用 Simons，否則用免費版）
- `getFreshStockAnalysis(code, ...)`: 呼叫 `/api/stock-analysis` 取 AI 分析

---

## 8. Serverless Functions (api/)

### stock-analysis.ts
- **POST** `/api/stock-analysis`，maxDuration=30s
- 平行抓取 IFalgo 個股資料 + Simons 近 5 天資料 + Yahoo 新聞
- 用 GPT-4o-mini 產生技術面/籌碼面/消息面分析（兒童友善語言）
- 失敗時 fallback 到規則式分析

### cron-newsletter-prepare.ts
- **Cron** 每天 UTC 22:00（台灣 06:00）
- 預先抓 Simons + AI 篩選 + OpenAI 分析，寫入 `newsletter_daily_cache`

### cron-newsletter.ts
- **Cron** 每天 UTC 23:00（台灣 07:00），maxDuration=60s
- 讀快取 → 取所有 Premium 用戶 → 逐一發信（600ms 間隔 rate limit）

### send-newsletter-single.ts
- 手動觸發單一用戶電子報（Admin Dashboard 使用）

### _newsletter-utils.ts（共用工具）
- 6 種策略篩選邏輯（A~F）
- AI 篩選（累積報酬正 + 中度以上推薦）
- HTML 電子報模板（精美卡片 + 庫存訊號）
- 庫存訊號判定（加碼/出場/中立）

---

## 9. 會員系統 (Tier)

| 功能 | Free | Premium |
|------|------|---------|
| 副帳號數量 | 最多 2 個 | 無限 |
| 持股檔數 | 最多 5 檔 | 無限 |
| 每日交易次數 | 最多 10 次 | 無限 |
| AI 聰明選股 | ✗ | ✓ |
| Simons 量化評分 | ✗ | ✓ |
| 每日電子報 | ✗ | ✓ |
| 廣告 | 顯示 AdBanner | 無 |

- **家庭方案繼承**：Child 繼承 Parent 的 Premium 狀態
- **到期檢查**：`subscription_expires_at` 比較當前時間
- **Feature Override**：管理員可逐一控制個別用戶的功能開關

---

## 10. 設計系統 (index.css)

- **字型**：`Nunito`（Google Fonts）+ Noto Sans TC fallback
- **色板**：Coral `#FF595E` / Yellow `#FFCA3A` / Green `#8AC926` / Blue `#1982C4` / Purple `#6A4C93`
- **背景**：Warm cream `#FFFBEF` + radial-gradient 裝飾
- **台股顏色慣例**：賺錢=紅（Coral）、賠錢=綠（Green）
- **CSS Variables**：完整的 design token 系統（顏色/陰影/圓角/間距/字型）
- **動畫**：`fadeIn` / `slideUp` / `spin` / `pulse` / `tooltipFadeIn`
- **響應式**：mobile-first，max-width 480px → 600px (768px+)
- **Safe Area**：bottom nav 支援 `env(safe-area-inset-bottom)`

---

## 11. 部署與環境

### 環境變數 (.env.local)
```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...   # Serverless 用
OPENAI_API_KEY=...               # AI 分析用
RESEND_API_KEY=...               # 電子報用
CRON_SECRET=...                  # Cron 驗證用
```

### Vercel 設定 (vercel.json)
- **Cron**：`cron-newsletter-prepare`（UTC 22:00）、`cron-newsletter`（UTC 23:00）
- **Rewrites**：5 組外部 API proxy + SPA fallback
- **maxDuration**：stock-analysis=30s, newsletter=60s

### 本地開發
```bash
npm run dev          # Vite dev server (port 5173)
```
- `vite.config.ts` 設定 6 組 dev proxy
- Serverless Functions 轉發到 production Vercel

### 部署流程
1. `git push` → Vercel 自動部署
2. 新 RPC 函數需手動在 Supabase SQL Editor 執行對應 `.sql`
3. 版本號在 `package.json` + `CHANGELOG.md` 同步更新

---

## 12. 關鍵資料流

### 12.1 買入流程
```
用戶輸入數量 → 前端 Paywall 檢查 → supabase.rpc('execute_buy_trade')
→ DB: 鎖 user row → 讀手續費 → 驗餘額 → 扣 balance → 寫 trades → upsert holdings
→ 回傳 new_balance/trade_id/new_shares → 前端更新 Zustand store（不 reload）
```

### 12.2 電子報流程
```
06:00 cron-newsletter-prepare → 抓 Simons → AI 篩選 Top 15 → OpenAI 分析 → 寫入 cache
07:00 cron-newsletter → 讀 cache → 取 Premium 用戶 → 逐一：
  ├─ 有 AI 功能 → 用 AI 快取
  └─ 有策略設定 → 用策略篩選 + OpenAI 分析
  → buildHoldingsWithSignals → buildEmailHtml → Resend 發信
```

### 12.3 學習完課流程
```
答題完成 → completeLesson() → 計算 XP + 連續天數 + 等級
→ 寫入 lesson_progress → 更新 learning_profiles
→ 查詢家長 reward_rules → 觸發對應規則 → grant_learning_coins RPC
→ 更新 learningWallet
```

### 12.4 股價刷新流程
```
refreshHoldingPrices() → 判斷快取 TTL（盤中5min/盤後24h）
→ 平行：fetchOfficialClosePrice(MIS→TWSE→TPEx) + fetchStockData(IFalgo)
→ 比較日期選最新 → 批次更新 Supabase holdings → 更新 Zustand store
```

---

## 13. 開發慣例與注意事項

### 代碼風格
- TypeScript strict mode
- ESM（`"type": "module"` in package.json）
- Serverless import 需要 `.js` 副檔名
- 中文註解為主，變數名用英文
- CSS 用 BEM-like 命名 + CSS Variables

### 錯誤處理模式
- 所有 DB 操作用 `withWriteTimeout`（20s）包裹
- 學習模組用 `withRetry`（1 次重試）
- Trading 用 try/catch 捕捉 RPC exception 並轉換為中文訊息
- `withTimeout` 用於非關鍵查詢（fallback 值）

### 效能最佳化
- 交易 RPC 化：8+ 次 DB 往返 → 1 次（v1.9.0）
- 登入速度：`getSession()` 立即解除 authLoading，資料背景載入
- 股價快取：盤中/盤後分段 TTL
- Explore 頁延遲載入量化資料（非 AI 推薦的股票進頁面才載）
- 電子報快取分離（prepare cron 提前 1 小時準備）

### 安全設計
- RLS 全表啟用
- 交易用 `FOR UPDATE` 行鎖防連按
- 學習幣操作全走 SECURITY DEFINER
- Cron 用 `CRON_SECRET` Bearer token 驗證
- 閒置 120 分鐘自動登出

---

## 14. 擴展指南

### 新增頁面
1. 在 `src/pages/` 建立 `NewPage.tsx` + `NewPage.css`
2. 在 `src/App.tsx` 加入 `<Route>`
3. 若需底部導覽，在 `<nav>` 加入 NavLink

### 新增 DB 表
1. 寫 SQL migration 檔案（`supabase-xxx.sql`）
2. 啟用 RLS + 建立 Policy
3. 在 `store.ts` 加入對應 state + action
4. 在 `types.ts` 加入 TypeScript interface

### 新增 Serverless Function
1. 在 `api/` 建立 `.ts` 檔案
2. export default handler + config
3. 若需長時間執行，設定 `maxDuration`
4. 在 `vite.config.ts` 加 dev proxy
5. 在 `vercel.json` 加 rewrite（如需代理外部 API）

### 新增課程
1. 在 `src/data/lessons/` 建立 `LXXX.json`
2. 在 `src/data/lessons/index.ts` import 並加入 `LESSON_MAP`

---

## 15. 環境需求

- **Node.js** 20+
- **npm** 10+
- **Supabase** 專案（含 Auth、Storage、PostgreSQL）
- **Vercel** 帳號（部署 + Cron）
- **OpenAI API Key**（GPT-4o-mini）
- **Resend API Key**（電子報）
- **IFalgo API**（免費，無需 key）
