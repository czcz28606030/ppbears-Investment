# 更新日誌 (Changelog)

所有關於 PPBears Investment 的版本變更都會記錄在此檔案中。我們遵循 [語意化版本控制](https://semver.org/lang/zh-TW/) 的規範。

## [1.6.17] - 2026-04-14
### Fixed
- Fixed Vercel routing where `/api/*` endpoints were incorrectly intercepted by the React SPA catch-all rule, preventing the background cron job from running.

## [1.6.16] - 2026-04-14
### Added
- Added force trigger parameter to newsletter cron API for testing
- Ensured all required environment dependencies for Vercel functions

## [1.6.15] - 2026-04-14

### 修復 (Fixed)
- **下單表單驗證提示 (Trade Form Validation)**: 修復了在未填寫「投資筆記」或「股數」時，下單按鈕僅會無效化而未跳出提示，導致使用者誤以為系統故障的問題。現在點擊時會明確跳出完整的警示視窗，引導使用者完成必填資訊。

## [1.6.14] - 2026-04-14

### 優化 (Optimized)
- **探索頁面排版最佳化 (Explore Page Layout)**: 調整手機版的「找股票」分類小卡排版，統一改為與 PC 版一致的「三欄兩列」展示，讓畫面更緊湊、更好瀏覽。

## [1.6.13] - 2026-04-14
- **個股殖利率資訊 (Dividend Yield)**: 在股票詳細頁「基本面分析」區塊中新增「殖利率」欄位。
  - 左側顯示最新殖利率（來自 TWSE BWIBBU_ALL 當日資料）
  - 右側顯示近10年平均殖利率（抓取過去10年12月底數值計算平均）
  - 搭配智能標籤判斷目前殖利率是否高於歷史均值，幫助小投資人快速判讀吸引力
- **代理設定更新**: 新增 `vercel.json` 與 `vite.config.ts` 的 `/api/twse-report/` 代理，指向 `www.twse.com.tw/exchangeReport/`，以支援個股歷史殖利率查詢



### 優化 (Optimized)
- **介面顏色調整 (UI Coloring)**: 將「買入」按鈕與相關標籤顏色調整為紅色 (Coral)，將「賣出」按鈕顏色調整為綠色 (Green)，進一步貼合台股「紅漲綠跌」的在地化視覺習慣。
- **首頁庫存顯示 (Dashboard Holdings)**: 解除首頁「我的持股」區塊最多只能顯示 3 檔股票的限制，現在會直接展開顯示使用者全部的庫存明細。

## [1.6.3] - 2026-04-13

### 修復 (Fixed)
- **股價小數點精確度顯示 (Price Precision Fix)**:
  - 取消了 Dashboard 首頁持股區塊的「股價四捨五入」機制。
  - 將 Dashboard 個股現價顯示由 `formatMoney` (無小數點) 替換為 `formatPrice` (會如實呈現小數點後兩位)，確保「中華電 134.5 元」此類有小數位數的報價得以真實呈現，不會被強制四捨五入至 135 元。

## [1.6.2] - 2026-04-13

### 修復 (Fixed)
- **即時行情資料源切換 (Real-time Price Provider Switch)**:
  - 徹底解決 `1.6.1` 中台灣證券交易所 (TWSE) 開放資料 (`STOCK_DAY_ALL`) 造成的兩大問題：
    1. **不支援上櫃股票**：導致「沛亨(6291)」等上櫃股票完全無法更新價格。
    2. **更新延遲**：下午時段 TWSE API 仍會返回上一個交易日的舊價格（如中華電 135.5元），導致當日最新收盤價無法呈現。
  - 將 `Dashboard` 首頁的今日損益計算與 `store.ts` 的 `refreshHoldingPrices()` 邏輯全面切換為呼叫 **IFalgo API**。
  - 現在系統支援上市、上櫃全市場股票，並能真正做到收盤後立即切換至最新報價（例如沛亨 437元、中華電 134.5元）。

## [1.6.1] - 2026-04-13

### 修復 (Fixed)
- **持股現價自動同步 (Price Auto-Refresh)**:
  - 修復了股票現價只有在「下單時」才會更新的問題，導致庫存損益與統計數據長期停留在舊數據。
  - 新增 `refreshHoldingPrices()` 方法：在使用者進入首頁 (Dashboard) 或庫存頁 (Portfolio) 時，自動從台灣證交所 (TWSE) API 抓取全部持股的最新收盤價，並批次更新 Supabase 資料庫與 Zustand store 狀態。
  - 此後所有頁面的「現價」、「未平倉損益」、「總市值」均以 TWSE 最新收盤價為準，確保統計數據準確。
  - TWSE API 呼叫具有 in-memory 快取（同一交易日只打一次 API），不影響效能。



### 新增與優化 (Added & Changed)
- **投資學習與測驗模組 (Learning Module)**:
  - 實作完整的投資小學堂架構，包含首頁導覽 (`LearnHome`)、文章閱讀 (`LearnArticles`) 與課程檢視 (`LessonView`)。
  - 新增 Supabase 學習相關資料表 (`supabase-learning-schema.sql`)。
- **任務與獎勵系統 (Rewards & Shop System)**:
  - 針對父母與孩童雙端打造獨立的任務與獎勵經濟系統。
  - 孩童端：新增願望清單檢視 (`ChildRequestsView`)、商店 (`ShopView`) 與錢包功能 (`WalletView`)。
  - 父母端：實作從建立任務、審核發放獎勵到願望清單商店管理的完整後台 (`ParentRewardDashboard`、`ParentRewardsSetup`、`ParentRewardHistory` 等子頁面)。
  - 新增 Supabase 獎勵相關資料表 (`supabase-rewards-schema.sql`)。

## [1.5.2] - 2026-04-12

### 新增與優化 (Added & Changed)
- **AI 公司介紹修正 (CORS Bypass)**:
  - 修復了前端瀏覽器直接呼叫 OpenAI API 發生 CORS 阻擋導致退回預設文字的問題。
  - 將呼叫邏輯全面改為透過系統開發伺服器與 Vercel Edge Serverless (Proxy) 同步發起，有效繞過瀏覽器限制。
- **動態版本號顯示 (Dynamic Version)**:
  - 修正了前端頁尾持續顯示舊版硬編碼 (1.4.0) 的問題，改為透過 Vite 在打包時自動寫入並同步 `package.json` 的最新版本號。

## [1.5.1] - 2026-04-12

### 新增與優化 (Added & Changed)
- **個股籌碼分析視覺化**: 在個股詳細頁面的「大人們買在哪裡」區塊，從原本的文字方塊升級為動態視覺化的長條圖，能以現在價格與外資、投信、自營商成本進行完美的視覺對位比較。
- **帳號設定介面優化**: 讓暱稱修改的文字輸入框更具立體感與外框焦點提示，不再像一般純文字；同時向副帳號開放檢視券商交易手續費率的權限（僅供檢視無法修改）。

## [1.5.0] - 2026-04-12

### 新增與優化 (Added & Changed)
- **AI 公司介紹 (ChatGPT Integration)**:
  - 導入 OpenAI `gpt-4o-mini` 模型，針對每一檔股票以兒童友善的語氣動態生成介紹。
  - 新增 Supabase `stock_profiles` 快取表，確保同一檔股票只呼叫一次 API 以節省成本。
  - 實作 SSE (Server-Sent Events) **串流文字打字動畫**，提升載入速度與使用者體驗。
- **UI/UX 優化**:
  - 管理後台儀表板現在能計算並顯示「未平倉損益」，並加入即時報價的同步功能。
  - 入金/出金交易在紀錄清單擁有專屬的顏色與對應標記。
  - 移除首頁冗餘 Logo，統一頭像縮圖比例。
  - 從我的庫存頁面移除「資金使用進度條」，使頁面更簡潔。

## [1.4.0] - 2026-04-12

### 新增與優化 (Added & Changed)
- **帳號分級系統 (Tier System)**:
  - 全新三級權限架構：管理員 (Admin)、免費用戶 (Free)、付費會員 (Premium)。
  - 資料庫新增 `tier`、`is_admin`、`subscription_expires_at` 欄位與 `feature_overrides` 功能開關表。
  - 家庭方案繼承：主帳號升級 Premium 後，底下所有副帳號自動享有付費功能。
- **管理員後台 (`/admin`)**:
  - 系統總覽（總用戶數、Free/Premium 分布）。
  - 用戶管理列表：搜尋、升級/降級、調整餘額、刪除帳號。
  - 功能開關面板：可逐一控制每個帳號的「AI 聰明選股」與「庫存 AI 建議」權限。
  - Premium 升級彈窗：支援 30/90/365 天或永久訂閱。
- **付費牆 (Paywall)**:
  - Free 用戶限制：副帳號 ≤ 2 個、持股 ≤ 5 檔、每日交易 ≤ 10 次。
  - 廣告橫幅 (AdBanner)：Free 用戶在首頁與探索頁看到升級提示。
  - AI 聰明選股卡片：Free 用戶顯示🔒鎖定覆蓋。
- **訂閱制基礎建設**:
  - 預埋 `subscription_expires_at` 到期日概念，為未來 Google Play 上架做準備。

## [1.3.0] - 2026-04-12

### 新增與優化 (Added & Changed)
- **交易筆記 (Trade Journal)**:
  - 買賣雙向強制輸入交易記錄：現在下單前必須填寫「投資筆記（告訴 PPBear 為什麼想買/賣）」，養成三思而後行的投資好習慣。
  - 新增 `/history` 專屬交易紀錄頁面，並具備搜尋功能。
  - 外部教學資源整合：在交易歷史卡片中，加入「查看技術線圖」按鈕，一鍵跳轉 Yahoo 奇摩股市還原當時決策。
- **UI/UX 在地化與策略選股**:
  - 探索頁面 (Explore) 卡片化設計：取消原本的產業標籤，升級為四張「台股策略選股卡片（穩穩大公司、最近變強、市場注意、AI）」，並實作了高自訂性的 Mock Data 展示以解決外部 API 的資料荒。
  - Dashboard 版面優化：移除了熱門股票與最近交易區塊，並將捷徑列調整為「找股票、看庫存、出金管理、交易紀錄」，使版面更聚焦於持股總覽。
  - 台灣證交所 (TWSE) 殖利率整合：首頁即時試算各檔持股的預估現金股利總額。
  - 色彩邏輯全數在地化：統一介面為「賺錢亮紅，賠錢亮綠」，符合台股操作直覺。

## [1.2.0] - 2026-04-12
- **登入與驗證 (Auth & Login)**:
  - 優化登入效能：將 Supabase 的使用者資料、庫存、交易紀錄改為「平行查詢 (Promise.all)」，解決讀取過久卡在「登入中...」的問題。
  - 修復忘記密碼流程：當點擊密碼重設信件後，確保系統正確導向至「輸入新密碼」畫面，避免自動登入並跳轉首頁的錯誤循環。
- **交易體驗 (Trading UX)**:
  - 獨立成功彈窗：交易成功後，原有的買賣表單會消失，完全替換為獨立的慶祝與成功畫面，徹底防止使用者手軟連續點擊「確認買入/賣出」。
  - 修復無法買賣的 Bug：不再依賴 IFalgo 歷史 K 線是否完整，改以使用者看到的真實畫面價格結算，確保各種情況下都能順利下單。
- **副帳號與管理 (Child View)**:
  - 副帳號出金紀錄：為副帳號開放底部導覽列的「出金紀錄」，讓小朋友能夠像大人一樣檢視自己過去所有的申請明細，並移除了審核按鈕權限。
- **系統穩定性**:
  - 全面棄用不穩定的免費代理服務 (`corsproxy.io`)，改用 Vite 內建 開發代理與 Vercel 規則，解決 API 抓不到股價顯示為 0 的災難。
  - 更正更新日誌：移除過時的單機 LocalStorage 敘述，澄清當前系統所有財務資料皆已全面上鏈至 Supabase。

## [1.1.0] - 2026-04-12

### 新增與優化 (Added & Changed)
- **正式環境與部署**:
  - 新增 `vercel.json` 修復 React Router 在 Vercel SPA 模式下重新整理 404 的問題。
- **使用者體驗 (UX)**:
  - 註冊流程：改進 Supabase Email 驗證流程，從跳轉頁面改為「彈出式確認視窗 (Modal)」，提供更直覺的註冊引導。
  - 副帳號管理：在建立副帳號的表單中新增「確認密碼」欄位、即時密碼一致性驗證，與顯示/隱藏密碼切換功能。
- **資料整合與 API**:
  - 新接 **台灣證券交易所 (TWSE) 開放資料平台 API (STOCK_DAY_ALL)**。
  - 股票詳細頁與探索列表現在會優先顯示「TWSE 取回的即時「當日收盤價」與開高低數據」，大幅提升資料即時性。
  - 實作快取機制 (Cache) 減少對 TWSE API 的過度請求。

## [1.0.0] - 2026-04-10
- **基礎架構**:
  - Vite + React + TypeScript 專案初始化
  - 完整設計系統與卡通可愛風格 UI (CSS 變數)
  - 底層導航 (Bottom Navigation)
- **核心頁面**:
  - `首頁 (Dashboard)`: 問候卡片、總資產概覽、快速操作、熱門股票、最近交易
  - `探索 (Explore)`: 股票搜尋、產業分類、AI 每日推薦列表
  - `股票詳情 (StockDetail)`: 即時報價、PPBear 兒童友善介紹、基本面分析 (P/E, P/B)、籌碼面分析、買賣交易功能
  - `庫存 (Portfolio)`: 總資產統計、零用錢預算進度、持股列表、歷史交易紀錄
  - `學習 (Learn)`: 6 堂投資小百科基礎課程
- **資料與功能**:
  - 串接 IFalgo API 取得台股即時報價與歷史數據
  - 串接 IFalgo Simons API 取得每日推薦與法人成本
  - 建立 AI 投資建議邏輯，提供評分與買進、觀望、賣出建議
  - 全面整合 **Supabase 雲端資料庫** (PostgreSQL)，安全且即時地記錄使用者帳號、買賣交易 (Trades)、庫存 (Holdings) 與資產變動。
