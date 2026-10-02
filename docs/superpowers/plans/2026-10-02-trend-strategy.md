# 週榜趨勢訊號 Implementation Plan

Goal: 全面停止現行 IFAlgo 選股、買賣訊號、量化評分與訊號快取讀取，改為 StoxGauge 每週候選池及官方日 K 的持倉感知規則。使用者已在聊天明確授權實作與延續既有部署工作。

Architecture: 共用純 TypeScript 引擎產生訊號；後端以登入者的持倉、交易、現金取得風險資料，前端各頁與電子報共用後端計算。保留行情、法人和歷史非訊號功能，禁止把新規則稱為 IFAlgo 模型、AI 報酬或驗證過的策略績效。

Parameters: MA60 高於 5 交易日前；收盤突破此前 20 根最高價；ATR14；初始停損=首次實際進場價-2.5ATR；加碼門檻=首次進場價+2R 且平均成本仍獲利；移動保護=持有期最高收盤-3ATR，僅上調；連兩日低於 MA20 減碼事件（重新站回後可重設）；最多兩次加碼；新增股數限初始股數的 75%、現金、單檔20%權重與整筆自當前價格至保護線的風險≤帳戶淨值0.5%。出場>減碼>加碼>續抱。新突破事件只顯示一次，不能每天持續突破便重複加码。

Freshness: 不用目前榜單回填歷史候選資格。歷史週榜從啟用日起保存；個股歷史箭頭只用已存的當時週榜及真實交易紀錄。缺少完整交易/價格/候選資格時標示資料不足；退出後需新進場事件。收盤策略不代替即時委託，不自動下單。既有持倉可依完整交易紀錄重建第一筆風險；未知時停止加碼但可獨立判斷均線減碼。

Tasks:
- [x] 共用引擎及測試：突破無前視、MA/ATR、部位週期、初始R不重置、風險上限、訊號優先序、事件去重、資料失效。
- [x] 官方日K與週榜歷史保存、登入者後端端點、前端fetcher與hook；不接受客戶端任意userId。
- [x] 觀察、庫存頁切換共用訊號，移除舊量化卡、篩選與快取，保留報價、交易、名單功能。
- [x] 個股/K線切換共用訊號，分開當前狀態與歷史事件，不虛構歷史箭頭。
- [x] 找股票、store警示、快取排程、電子報與收集器切換；舊訊號端點退休且不再抓IFAlgo。
- [x] 功能測試、建置、來源殘留審查、Git/version/deployment、線上API驗證；不寄送測試郵件給真實會員。

API contract: `fetchStrategySignals(codes: string[], options?: {forceFresh?: boolean}): Promise<StrategySignalsPayload | null>` from src/api.ts; `useStrategySignals(codes: string[], enabled?: boolean)` from src/hooks/useStrategySignals.ts returns `{signals: Record<string, StrategyDecision>, loading: boolean, error: string, refresh: () => Promise<void>}`.

StrategyDecision (src/utils/trendStrategy.ts): `code, action: entry|neutral|add|hold|reduce|exit|unavailable, label, reason, dataDate, source='weekly-trend-v1', held, close, ma20, ma60, breakoutPrice, atr, initialRisk, protectionPrice, addTriggerPrice, suggestedQuantity, events: StrategyEvent[], weeklyRank, weeklyDate, status: ready|unavailable`. Nullable numeric indicators use null. StrategyEvent: `{date, action: entry|add|reduce|exit, label, reason}`. Payload: `{source:'weekly-trend-v1', generatedAt, signals:Record<string,StrategyDecision>}`.

Validation before deployment: 87 tests passed; frontend production build, backend TypeScript checks and targeted ESLint passed. Live official TWSE 2330 / TPEx 6488 each returned 159 bars (2026-02-02 through 2026-10-01). Signal event persistence reuses own RLS cache with in-worker serialization; cross-worker saves are best effort. No emails or trades executed.

Production verification: deployment dpl_2fkBj2hYWSVaKLxVZwW19WkScNFN READY; runtime commit 59311a8; production alias https://ppbears-investment.vercel.app. Official price map includes 6488 OTC and its real date/volume; default-market 6488 and 3529 each return 159 bars through 2026-10-01. Retired IFAlgo endpoint returns 410; unauthenticated strategy access returns 401. Signed-in Explore shows all 10 current candidates (9 neutral, owned 2303 hold), including all four OTC candidates. Signed-in Portfolio displays actual reduction/exit/hold rules, data dates and protection/2R levels. No trades or test emails were executed.

Limitations: strategy parameters are initial rules, not validated profitability. Official candles are raw exchange OHLC; corporate-action-adjusted backtesting and full split/dividend adjustment are not claimed. Sudden >25% latest moves and inconsistent account cost histories suspend advice. Missing monthly history, old quotes and incomplete first-entry trades suppress position sizing. A cross-instance journal merge remains best effort with the current cache schema.
