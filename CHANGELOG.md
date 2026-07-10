# 📦 PPBears Investment — 更新日誌

> **目前版本：v1.24.103**（2026-07-11）
> 最新更新：交易紀錄新增 WEBP 自動重點快照、手動附件、庫存歸零清理與管理員只讀查看。

---

## [v1.24.103] - 2026-07-11
### Added
- Added private Supabase trade attachments storage and schema for automatic trade snapshots and manual JPG/PNG/PDF note attachments.
- Added WEBP automatic trade snapshot generation after buy/sell orders, capturing trade date, buy/sell details, price, change, OHLC volume, AI recommendation, technical chart, holding summary, stock essence score, and cumulative return.
- Added manual attachment upload from the trade modal and Trade History, with image thumbnails, PDF cards, image lightbox preview, and manual attachment deletion.
- Added admin read-only viewing of every user's trade notes, automatic snapshots, and attachments from the Admin trade history modal.

### Changed
- Trade History now links stock rows to the in-app Stock Detail page instead of opening the old Yahoo technical-chart link.
- Full-sell flows now automatically clean manual attachments for that stock while preserving automatic trade snapshots as historical evidence.

## [v1.24.102] - 2026-07-07
### Fixed
- Changed Portfolio startup to render compatible same-day local signal cache first, even when daily AI cache version validation is still in progress.
- Added a short cloud-cache timeout so `/api/app-cache?type=user-market-cache&surface=portfolio` cannot block the first visible Portfolio signal render.
- Changed Portfolio daily AI cache version changes to reconcile in the background instead of clearing visible holding signals and forcing a full reload.
- Fixed the Portfolio 08:00 refresh-slot calculation so post-08:00 cache is keyed to the current day.

### Changed
- Portfolio stale-first rendering now accepts same-day rich signal cache for the current holding stock codes, then refreshes exact holding-key data in the background when needed.

## [v1.24.101] - 2026-07-07
### Fixed
- Changed Watchlist startup to render any compatible last-known local cache first, even while the daily AI cache version is still being checked.
- Added a short cloud-cache timeout so `/api/app-cache?type=user-market-cache&surface=watchlist` cannot block the first visible Watchlist render for too long.
- Changed daily AI cache version changes to trigger background reconciliation instead of clearing the visible Watchlist and forcing a full reload.
- Fixed the 08:00 refresh-slot calculation so post-08:00 local Watchlist cache is keyed to the current day instead of falling back to the previous day.

### Changed
- Reduced duplicate Watchlist DB fetches by letting the page skip its own initial fetch when the global user data load already supplied the watchlist.

## [v1.24.100] - 2026-07-07
### Added
- Added a Portfolio trend-status chip that separates clean post-rally AI exits from repeated AI entry/exit whipsaws.
- Added conservative MA5/MA20, IFAlgo signal-history, profit/loss, and chip-score logic for `趨勢結束`, `盤整震盪`, `轉弱觀察`, and `趨勢延續` labels.

### Changed
- Bumped the Portfolio signal cache key so holdings reload the richer trend-status payload instead of reusing old signal-only cards.

## [v1.24.99] - 2026-07-03
### Fixed
- Fixed Watchlist cloud cache version mismatch between the frontend reader and user-market warmup writer.
- Allowed compatible Watchlist cache payloads to render immediately and normalize to the current cache version locally.

## [v1.24.98] - 2026-07-03
### Removed
- Removed the `科技順風` indicator from Watchlist, Portfolio, and Stock Detail surfaces.
- Removed the technology tailwind data module and stopped using its score inside add-priority calculations.

### Changed
- Updated Stock Detail add-priority explanation copy so the score sources now match the remaining active signals.

## [v1.24.97] - 2026-07-03
### Added
- Added AI recommendation-level display beneath the stock-detail price area.
- Added a Watchlist filter for stocks that showed an AI exit signal and later showed an AI entry signal again.
- Added Watchlist sorting by observation time, supporting newest-to-oldest and oldest-to-newest order.

### Changed
- Changed Watchlist one-click observation-removal prompts so they only appear when the AI recommendation level drops to low, not when an AI exit signal appears.

## [v1.24.96] - 2026-07-01
### Fixed
- Fixed withdrawal approval and rejection so successful review actions update the visible request status immediately, with list and child-balance refreshes continuing in the background.
- Added an in-progress state to withdrawal review buttons to prevent duplicate clicks while approval or rejection is being sent.
- Updated child withdrawal submission to show the new pending request locally right after the insert succeeds, then reconcile with cloud data in the background.
## [v1.24.95] - 2026-07-01
### Fixed
- Fixed Watchlist startup so matching or covering local/cloud cache can render immediately even when K-line data is incomplete, with missing K-line and recommendation data refreshed in the background.
- Fixed Watchlist cache writes to wait for the daily AI cache version token before saving, preventing freshly loaded cache from being invalidated by a later version check.
- Added per-user Watchlist background-cache completeness markers so partial preload rows record missing K-line or recommendation coverage instead of forcing opaque full-page reloads.

## [v1.24.94] - 2026-07-01
### Fixed
- Fixed Portfolio startup cache validation so partial or schema-mismatched user-market cache payloads fall back to live AI quant fetching instead of showing neutral-only cards.
- Added Portfolio signal cache schema and incomplete-code markers to prevent old or incomplete AI payloads from being persisted and reused after returning from stock detail.

## [v1.24.93] - 2026-06-30
### Added
- Added a `user_market_daily_cache` Supabase table with RLS for per-user Watchlist and Portfolio daily page payloads.
- Added protected user-market warmup inside `/api/app-cache` with Vercel schedules for 05:00 Taiwan preload plus 08:10 weekday refresh.
- Added `/api/app-cache?type=user-market-cache` so signed-in users can read only their own prepared page cache before falling back to live fetches.

### Changed
- Changed Watchlist and Portfolio startup flow to prefer local cache, then user-level cloud cache, then the existing live per-stock fetch path.
- Updated the background warmup to prepare shared stock data, AI quant snapshots, recommendation counts, ETF radar, and Portfolio holding prices before users open the app.

## [v1.24.92] - 2026-06-24
### Added
- Added Watchlist search by stock name or code, persisted with the existing session filters and combined with AI filters, recommendation level filters, and sorting.

### Changed
- Changed Explore search to load the full official TWSE/TPEx price map before treating market search as ready, preventing partial recommendation-only maps from limiting results.

## [v1.24.91] - 2026-06-24
### Changed
- Changed Portfolio stop-loss holdings so any card at -20% or worse gets a full red frame, red-tinted background, stronger red loss text, and heavier warning shadow.
- Increased the `⚠ 建議停損` badge weight and border so stop-loss holdings are visible at a glance even when AI signal styling is also present.

## [v1.24.90] - 2026-06-23
### Changed
- Changed Portfolio profit/loss helper badges so any current holding at -20% or worse shows a prominent red `⚠ 建議停損` warning, regardless of AI signal state or membership feature visibility.
- Updated the stop-loss badge styling from a low-emphasis outline to a red filled alert so severe losses are easier to scan on holding cards.

## [v1.24.89] - 2026-06-22
### Added
- Added a shared daily AI cache version gate so Explore, Watchlist, Portfolio, and Stock Detail only reuse cached AI signals and K-line summaries when they match the latest daily data version.
- Added `pageshow` version checks for back/forward navigation so restored pages invalidate stale market-data cache before showing old AI signal results.

### Changed
- Versioned local Simons and quant TTL cache keys by the daily AI cache version, preventing old `AI 買進 / AI 中立 / AI 賣出` data from being reused after a daily refresh.
- Versioned Explore's stock-detail return list payload and invalidates old session lists when the daily data version changes.
- Changed the AI cache-version API response to `no-store` so freshness checks do not receive stale CDN responses.

## [v1.24.88] - 2026-06-22
### Added
- Added compact buy and sell actions directly on Portfolio holding cards so users can trade current holdings without opening the Stock Detail page first.
- Added a shared stock trade modal used by both Portfolio and Stock Detail, keeping trade unit selection, notes, fee/tax preview, success state, and buy-risk warnings consistent.
- Added a first-screen current inventory pill on Stock Detail pages showing the user's current holding quantity in shares or lots.

### Changed
- Hid the Portfolio category filter strip and made the holdings list always show all current inventory.
- Simplified the Portfolio holdings count label so it reports the total holding count instead of filtered counts.

## [v1.24.87] - 2026-06-18
### Added
- Added drag-to-scroll behavior to the Portfolio inventory category filter strip so users can move through many categories directly on desktop and mobile.
- Added compact four-character category labels with hover/focus or selected-state detail tooltips for full category names, market value, percentage, and holding count.

### Changed
- Removed category scroll arrow buttons and replaced them with a direct draggable strip with edge fade hints.
- Kept category filtering from triggering accidentally while the user is dragging the strip.

## [v1.24.86] - 2026-06-18
### Added
- Added a Portfolio stock-category donut chart under the total asset card, grouping current holdings by industry category rather than individual stocks or cash balance.
- Added category-level market value, holding count, and percentage rows so users can quickly see which industry groups dominate the stock inventory.

### Changed
- Enlarged the donut chart and tuned mobile layout so category labels, values, and percentages remain readable on narrow screens.

## [v1.24.85] - 2026-06-15
### Fixed
- Fixed MIS realtime price parsing so quotes skip zero levels and use the first valid bid/ask/trade price, covering cases like TPEx 6274 where成交價 is blank but the live bid price is available.
- Changed Portfolio, Watchlist, and Explore market-hour refreshes to prefer per-stock MIS realtime prices before falling back to the official daily close map or IFAlgo K-line data.
- Updated Watchlist price loading so a valid realtime price can display even when the K-line fallback is still on the previous trading day.

## [v1.24.84] - 2026-06-15
### Added
- Added compact price update time labels above stock prices in Explore, Watchlist, and Portfolio cards.
- Added a shared price update label formatter using `MM/DD HH:mm` so list pages show consistent timestamp text.

### Changed
- Kept price update timestamps tied to successful market-hour price refreshes so stale or off-market prices are not marked as newly updated.

## [v1.24.83] - 2026-06-12
### Added
- Added clickable industry explanation dialogs so stock cards can show what each industry category means and what signals to watch.
- Added industry classification support on Stock Detail pages, including a compact industry badge beside the watchlist action.
- Added source-backed stock industry classifications so common Taiwan market industry labels stay consistent across Explore, Watchlist, Portfolio, and Stock Detail.

### Changed
- Changed compact industry badges from symbol-only pills to readable short labels, improving scanability on mobile stock cards.
- Improved local auth failure messaging so Supabase network/API timeouts are shown separately from incorrect email or password errors.

### Fixed
- Added a profile-load timeout gate for stale sessions so users are offered refresh/logout actions when Supabase account data does not return.
- Changed logout to clear the local Supabase session without waiting on a failing network sign-out request.

## [v1.24.82] - 2026-06-11
### Added
- Added compact industry category icons to Explore recommendation cards, Watchlist cards, and Portfolio holding cards.
- Added a shared `IndustryIcon` component with distinct colors and glyphs for common industry groups such as semiconductor, electronics, finance, shipping, machinery, steel, construction, food, medical, biotech, tourism, retail, energy, telecom, and auto.
- Moved API helper modules and the one-off backtest init script out of the Vercel function scan path so production deploys stay within the Hobby plan's 12-function limit.

## [v1.24.81] - 2026-06-10
### Added
- Added automatic Watchlist return after a holding is fully sold, treating the completed position as the end of one swing while keeping the stock on radar for the next AI entry signal.
- Added the Watchlist note `已結束持倉，等待下一波訊號` for auto-returned stocks so the source remains visible without changing the AI recommendation state.

## [v1.24.80] - 2026-06-09
### Added
- Added the current AI recommendation level to Portfolio holding cards so users can compare add-timing, ETF support, cumulative return, chip stability, and AI recommendation strength in the same compact card row.
- Styled Portfolio AI recommendation chips by level (`超高度`, `高度`, `中度`, `低度`) and bumped the portfolio signal cache key so old cached cards refresh with the new indicator.

## [v1.24.79] - 2026-06-08
### Fixed
- Changed Portfolio holding quantities of 1,000 shares or more to display in lots (`張`) so large positions stay readable.
- Reworked Portfolio holding card layout on mobile so quantity and cost move below the stock identity area instead of overlapping stock names.

## [v1.24.78] - 2026-06-08
### Fixed
- Kept the Stock Detail technical chart card visible when IFAlgo K-line data is temporarily unavailable instead of hiding the entire section.
- Added a `重新讀取線圖` retry action so users can reload the chart data without leaving the stock detail page.

## [v1.24.77] - 2026-06-07
### Added
- Added a `LEARNING_QUESTIONS_AUDIT.md` review file listing all 100 learning lessons and 721 questions with answer keys for manual inspection.
- Added a Taiwan-time daily learning limit so users can complete at most 3 new learning units per day.
- Added Learning map and Lesson View lock states that show when the daily 3-unit limit has been reached, including direct lesson URL protection.

### Changed
- Reworked Learning quiz selection so lessons use their own lesson-specific preset question pool instead of shared dynamic template questions.
- Rewrote duplicated and highly similar Learning questions across the lesson catalog, especially lessons L061-L100, and cleaned older template-style definition questions.

### Fixed
- Removed exact duplicate Learning quiz prompts and template-equivalent prompts; the full 100-lesson audit now reports 0 exact duplicate groups and 0 normalized template duplicate groups.

## [v1.24.76] - 2026-06-07
### Fixed
- Fixed reward redemption approval so cash and investment-bonus shop items automatically credit the child account cash balance after parent approval.
- Added a server-side reward redemption approval API that verifies the parent session before updating redemption status, learning coins, cash balance, and deposit trade records.
- Backfilled the two approved `零用錢` redemptions from 2026-06-07 for child account `娃娃魚`, adding NT$100 each and leaving matching `學習獎勵現金` deposit records.

## [v1.24.75] - 2026-06-05
### Added
- Added Watchlist cleanup alerts for `AI出場` and `AI推薦低度` stocks so users can remove weak watchlist candidates in one click without switching filters.
- Added a merged cleanup alert when a stock is both AI exit and low recommendation, keeping the card action area to one clear removal prompt.

### Changed
- Changed Watchlist, Portfolio, and Stock Detail ETF chips to show `ETF+N`, where `N` means the number of tracked ETFs currently holding that stock.
- Hid ETF support chips when no tracked ETF currently holds the stock.

## [v1.24.74] - 2026-06-05
### Added
- Expanded ETF holding-flow import sources to track `0050`, `0056`, `00878`, `00919`, `006208`, `00981A`, and `00403A`, excluding bond ETF `00937B`.
- Added ETF holding share and share-change fields to the ETF support radar payload so Stock Detail pages can show fund-level holding details.
- Added a Stock Detail ETF support table with fund name, holding ratio, holding change, and current shares.

### Changed
- Renamed user-facing Active ETF language to `ETF支撐` / `ETF 支撐` so it reflects broader large Taiwan stock ETF backing.
- Kept Watchlist and Portfolio cards as compact ETF support chips while moving detailed ETF evidence into Stock Detail.
- Reordered Watchlist sort pills to `股票本質`, `累計報酬`, `籌碼分數`, and `推薦次數`.

## [v1.24.73] - 2026-06-05
### Changed
- Removed the Watchlist entry-timing score chip so watchlist cards rely on the original AI entry/neutral/exit signal flow.
- Changed the Watchlist default sort to `股票本質` so observed stocks are compared by the core quality score first.
- Removed the entry-timing sort option from Watchlist filters to avoid mixing incomplete composite scores with AI entry signals.

## [v1.24.72] - 2026-06-05
### Added
- Added a Stock Detail `加碼決策雷達` card that explains add-timing score sources including 股票本質, 科技順風, 主動ETF, 籌碼穩定, 推薦次數, and 累積報酬.
- Added expandable Active ETF detail rows on Stock Detail pages so users can inspect recent ETF add/reduce/remove signals.

### Changed
- Kept the technical K-line chart above the add-timing radar so Stock Detail pages still lead with price action before decision support.

## [v1.24.71] - 2026-06-05
### Changed
- Simplified the Watchlist stock-quality dialog so it only explains `股票本質` as the stock foundation.
- Simplified the Watchlist add-timing dialog so it only explains `加碼時機` as the entry signal.
- Removed cross-explanations and duplicate detail rows between the two dialogs to reduce text density.

## [v1.24.70] - 2026-06-05
### Changed
- Active ETF radar requests now bypass stale browser/CDN cache so newly imported ETF holdings can appear immediately.
- Watchlist Active ETF placeholders now distinguish between no imported data and imported data with no record for that stock.
- Updated Active ETF explanation copy to avoid implying an import failure when a stock is simply absent from 00981A/00403A holdings.

## [v1.24.69] - 2026-06-05
### Fixed
- Fixed the Active ETF importer so it parses the official `holdings` table cells directly instead of relying on flattened text line order.
- Confirmed `00981A` and `00403A` source pages can each parse 50 holdings from the current disclosed portfolio table.
- Kept `/api/cron-active-etf-import` ready for Vercel Cron and manual Vercel cron runs after deployment.

## [v1.24.68] - 2026-06-05
### Added
- Added `科技順風` signals to help connect TSMC earnings-call tailwinds with Taiwan technology supply-chain watchlist decisions.
- Added Active ETF radar data plumbing, schema, and scheduled import support for `00981A` and `00403A` disclosed holdings.
- Added clickable explanation dialogs for Watchlist small chips, including 加碼時機, 科技順風, 主動 ETF, 累積報酬, and 籌碼 stability.
- Added AI exit cleanup action so stocks filtered by `AI出場` can be removed from the watchlist in one click.

### Changed
- Renamed `股票本質評分` to `股票本質` and clarified that 股票本質 is the foundation while 加碼時機 is the entry signal.
- Renamed add-priority language to `加碼時機`, keeping it separate from the long-term stock-quality score.
- Updated Watchlist default sorting to prioritize 加碼時機 while retaining 股票本質 as the core quality reference.
- Removed the top technical-signal filter from the member Watchlist filter area while keeping card-level warnings visible.
- Updated Portfolio and Watchlist chips so Active ETF impact is shown as counts or holding markers instead of a separate score.

## [v1.24.67] - 2026-06-04
### Added
- Added a cached Simons recommendation-history institutional-cost lookup for Stock Detail pages.
- Added a purple `⭐ Simons` source badge with the matched Simons data date when a stock has recommendation-list cost data.

### Changed
- Stock Detail institutional costs now prefer Simons `fcost` / `tcost` / `dcost` and use Simons `wtcost` as the weighted-average headline cost.
- Stocks without Simons cost data continue to fall back to the original institutional-cost estimate source.

## [v1.24.66] - 2026-06-04
### Fixed
- Replaced temporary profit/loss emoji placeholders with a neutral `讀取中` AI badge while member Portfolio signals are loading.
- Fixed neutral Portfolio AI signal badges so a `0` streak count is no longer rendered under `AI 中立`.

## [v1.24.65] - 2026-06-04
### Fixed
- Explore search now loads the full-market official price map on demand when a user starts searching and no local price map is available.
- Search results now keep already-watched and currently-held stocks visible, labeling them as observed or in portfolio instead of hiding them as missing results.
- Added a search loading state so users see that the full-market stock list is being loaded instead of immediately seeing an empty result.
- Hardened the official price API so one interrupted TWSE/TPEx response no longer makes the whole full-market price map return empty.

## [v1.24.64] - 2026-06-04
### Changed
- Hid the IFalgo monthly raw value from the home monthly prediction gauge and market summary copy to avoid confusing `conv1=30` with the bullish/bearish direction.
- Kept the gauge direction driven by IFalgo `longshort` / `mforecast`, so `偏多` still points to the right-side bullish zone.

## [v1.24.63] - 2026-06-04
### Fixed
- Changed the home Simons monthly prediction gauge to use IFalgo `longshort` / `mforecast` for needle direction, so `偏多` points to the right-side bullish zone instead of being driven left by raw `conv1=30`.
- Kept the IFalgo raw monthly value visible as `原始值` while using the direction signal for the gauge position.
- Updated the home market-summary browser cache key so mobile clients discard the old monthly-gauge payload after deployment.

## [v1.24.62] - 2026-06-04
### Fixed
- Hid IFAlgo AI entry/neutral/exit signals, AI recommendation-level filters, cumulative-return chips, and chip-score chips from non-member Watchlist views.
- Prevented non-member Watchlist refreshes from loading Premium-only stock quant signal data, while keeping public watchlist scores, prices, K-lines, and technical signals available.
- Fixed Portfolio cumulative-return chips so member cards refill missing shared-cache returns from authorized live quant data instead of showing `--`.

### Changed
- Enlarged Portfolio AI signal badges for clearer neutral/buy/sell status on holding cards.

## [v1.24.61] - 2026-06-04
### Changed
- Reordered the Watchlist composite filters so model entry/neutral/exit signals appear first, followed by AI recommendation level and technical signals.
- Removed the Watchlist advice-label filter and the advice-label badge from stock cards, keeping the card focused on AI signal, recommendation level, comprehensive score, cumulative return, and chip stability.
- Changed Watchlist sorting to default to comprehensive score, placed `綜合評分` first in the sort controls, and removed the visible `預設排序` option.

## [v1.24.60] - 2026-06-04
### Added
- Added Premium-only IFAlgo model signal markers to the Stock Detail technical chart, with purple build/add arrows and black exit/end arrows.
- Added a protected `/api/stock-trading-signals` endpoint so non-Premium users cannot fetch IFAlgo trading signal records.
- Added MA5 and MA20 display toggles on the Stock Detail technical chart.

### Changed
- Updated the chart date display to daily `MM/DD` axis ticks and `YYYY/MM/DD` crosshair labels for a cleaner day-K view.
- Updated chart signal copy to explain that exit arrows represent prior unfinished model signals being cleared or ended.
- Sanitized the local and production IFAlgo stock proxy so browser stock data keeps K-line prices without exposing `aiQuanBackDataTradingList`.

## [v1.24.59] - 2026-06-03
### Fixed
- Split shared Simons cache access into manual update and read-only sync modes so automatic cross-user refreshes no longer update the global cache version.
- Changed forced Simons reads from the client to use a `read` query unless an explicit shared-cache update is requested.
- Verified locally that `type=simons&read=...` leaves the global AI cache version unchanged before deployment.

## [v1.24.58] - 2026-06-03
### Changed
- Bumped and redeployed the global AI cache version sync release to production.
- Kept Explore, Watchlist, Portfolio, and Stock Detail aligned on the shared AI cache version polling behavior.

## [v1.24.57] - 2026-06-03
### Added
- Added a lightweight global AI cache version endpoint backed by the shared Supabase daily Simons cache.
- Added client-side version polling for Explore, Watchlist, Portfolio, and Stock Detail so stale local browser caches are cleared automatically when another user refreshes the shared data.

### Changed
- Manual refresh now records the latest observed global AI cache version for the current page after updating shared data, avoiding repeated local refresh loops.

## [v1.24.56] - 2026-06-03
### Fixed
- Changed manual Simons refresh to check the current Taiwan trading date first, so published same-day IFAlgo data no longer waits until the next morning.
- Allowed manual stock quant snapshot collection to persist current-day IFAlgo snapshots while still falling back safely to the latest completed trading day if today is not ready.
- Cleared browser Simons and quant TTL caches during Explore, Watchlist, and Portfolio manual refreshes, and reran the refreshed analysis with force-fresh requests.

## [v1.24.55] - 2026-06-03
### Added
- Added add-on risk warnings for stocks already held, separating profit add-ons, loss averaging, near-stop-loss averaging, and over-stop-loss averaging.
- Added detailed consequence rows in the buy warning modal, including current shares, average cost, current P/L, buy-after average cost, total invested cost, position weight, stop-loss reference price, possible add-on loss, whole-position stop-loss scenario, and post-buy cash balance.

### Changed
- Updated high-risk confirmation copy so severe add-on warnings require users to acknowledge the consequence data before continuing.
- Kept existing 15% concentration and one-third add-on warnings while showing clearer numeric details for each warning.

## [v1.24.54] - 2026-06-03
### Fixed
- Deployed the final AI signal date-guard release so Portfolio, Watchlist, and shared quant snapshots use the latest data day's event only.
- Confirmed 6282 康舒 uses the 2026-06-02 quant snapshot and resolves to AI 中立 instead of carrying the 2026-06-01 加碼 event forward.

## [v1.24.53] - 2026-06-03
### Fixed
- Changed AI 加碼 / AI 出場 detection to use only the latest quant data date's trading event, so prior-day entries such as 6282 康舒 on 2026-06-01 no longer appear as 2026-06-02 AI 加碼.
- Bumped the browser quant TTL cache version and Portfolio / Watchlist persistent cache keys so old local AI signal payloads are ignored immediately after deployment.
- Applied the same daily-event signal rule to the cloud cache endpoint, local fallback parser, and daily snapshot collection script.

## [v1.24.52] - 2026-06-03
### Changed
- Changed the production Simons AI signal cron to the Vercel Hobby-compatible daily 08:00 Taipei run.
- Updated Explore, Watchlist, and Portfolio freshness labels to show `08:00 自動檢查；可手動重新抓取`.
- Added manual Simons readiness checks to the main refresh actions so users can click `重新抓取` outside the scheduled run.

## [v1.24.51] - 2026-06-03
### Changed
- Changed Explore, Watchlist, and Portfolio AI signal refreshes to use daily Simons-ready cache checks instead of refetching AI signals on every page entry.
- Set the production Vercel cron to the deployable daily 08:00 Taipei check because Hobby cron limits do not allow the full 05:00-09:00 hourly window.
- Added manual AI cache refresh checks from Explore, Watchlist, and Portfolio so users can re-check Simons readiness outside the scheduled run.
- Limited automatic stock-price refreshes to Taiwan market hours and kept off-market page entry on cached quote data where available.
- Updated the Stock Detail live analysis prompt and fallback wording to use professional, plain-language investment summaries instead of child-focused phrasing.

### Fixed
- Added front-end and Edge Function safeguards so cached company descriptions must match the current stock name, industry, and profile before being reused.
- Added conservative company-description fallback text for power-management and semiconductor component stocks such as 3317 尼克森.
- Updated `get-kid-description` cache validation so stale or mismatched `stock_profiles` content is regenerated or replaced with a conservative source-based description.

## [v1.24.50] - 2026-06-02
### Fixed
- Added a shared local quant-cache cleanup helper that removes all `ppbears_quant30_` browser cache entries during manual refresh.
- Updated Explore, Watchlist, and Portfolio manual refresh actions to clear all local quant signal TTL cache before forcing fresh data.
- Bumped the quant signal cache version to `v3` so older browser-stored `v2` entries are ignored.

## [v1.24.49] - 2026-06-02
### Fixed
- Changed MIS realtime quote fallback to use the first bid price, then first ask price, when the latest trade price is unavailable.
- Stopped using the intraday high as the current stock price for stocks such as 6257 and 6274 when MIS returns `z = -`.
- Applied the corrected quote parsing across Explore, Watchlist, and Portfolio price refreshes.

## [v1.24.48] - 2026-06-02
### Fixed
- Made Portfolio manual refresh bypass the holding-price throttle so refreshed prices can write back before AI signal refresh starts.
- Waited for forced holding-price refresh before clearing Portfolio signal caches and rebuilding AI helper badges.
- Reduced the chance that mobile app restarts show older persisted holding prices after a manual refresh.

## [v1.24.47] - 2026-06-02
### Changed
- Added separate Portfolio helper badges for AI add-on signals while holdings are still losing money.
- AI add-on loss states now show 低檔觀察 within -10%, 謹慎觀察 within -20%, and 風險優先 below -20%.
- Gave each Portfolio helper badge state a distinct outline color so profit, loss, observation, stop, and take-profit cues are easier to scan.

## [v1.24.46] - 2026-06-02
### Changed
- Linked Portfolio profit/loss helper badges to the active AI signal so neutral holdings stay visually clean.
- AI add-on signals now show 小心加碼 for 0% to +19.9% gains and 順勢加碼 at +20% or higher.
- AI exit signals now show 建議停損 at -20%, 分批停利 at +20%, and 持續觀察 for the remaining cases.

## [v1.24.45] - 2026-06-02
### Added
- Added Portfolio profit/loss level badges for add-on caution, add-on confidence, ongoing observation, and stop-loss suggestion.
- Added a two-column profit/loss icon legend below the Portfolio refresh controls without horizontal scrolling.

### Changed
- Increased holding quantity and price text size so the right-side figures match the stock-name emphasis.
- Switched profit/loss helper badges to low-emphasis outline styling so AI signal badges remain the primary visual focus.

## [v1.24.44] - 2026-06-02
### Changed
- Updated mobile Portfolio holding cards to use three stacked rows: stock name, stock code with market badge, and recommendation count.
- Kept the AI signal badge compact so the stock name has the full info-column width.

## [v1.24.43] - 2026-06-02
### Changed
- Updated mobile Portfolio holding cards to use three information columns: stock name, stock code with market badge, and recommendation count.
- Reduced the AI signal badge size on mobile so stock names have more room and are less likely to be truncated.

## [v1.24.42] - 2026-06-02
### Changed
- Updated Portfolio holding cards so stock name/code and market/recommendation count use fixed two-row columns.
- Kept long stock names from shifting the recommendation badge and market badge layout.

## [v1.24.41] - 2026-06-02
### Added
- Added visible data freshness status to Explore so stock-picking results show whether data is updating, current, or possibly stale.
- Added source timing details for Explore, including data update time, source data date, fixed update windows, and background price checks.

### Changed
- Enlarged the Explore manual refresh button so refreshing stock-picking data is a primary, obvious action.
- Explore manual refresh now clears quant caches for both recommendation and visible search result stocks before forcing fresh data.

## [v1.24.40] - 2026-06-02
### Added
- Added visible data freshness status for Watchlist and Portfolio so users can see when data is updating, current, or possibly stale.
- Added source timing details for today, data update time, source data date, fixed update windows, and background price checks.

### Changed
- Enlarged the Watchlist and Portfolio manual refresh buttons so refreshing data is a primary, obvious action.
- Portfolio manual refresh now also triggers a holding-price refresh before forcing fresh AI signal data.

## [v1.24.39] - 2026-06-01
### Changed
- Explore search results now reuse the richer recommendation-card layout and show available Simons quant details instead of staying as simple placeholder cards.
- Search quant details load in the background after the basic result list renders, limiting enrichment to the visible result set so typing remains responsive.

## [v1.24.38] - 2026-05-30
### Fixed
- Fixed Watchlist half-year K-line quick preview on mobile by invalidating stale Watchlist caches that do not include complete K-line data.
- Watchlist cached data now requires each observed stock to have enough K-line rows before it can skip a fresh reload.

## [v1.24.37] - 2026-05-30
### Fixed
- Fixed the mobile Stock Detail chip-cost summary footer so the explanatory text no longer reserves desktop-height space after switching to a vertical layout.

## [v1.24.36] - 2026-05-30
### Added
- Added lightweight price auto-refresh for Explore, Watchlist, and Portfolio during Taiwan market hours, refreshing every 5 minutes only while the page is visible.
- Added persistent refresh-slot caches for Watchlist and Portfolio so already-loaded daily data is reused until the next fixed update window.

### Changed
- Premium Explore now goes directly to AI stock picking and hides manual strategy cards.
- Explore, Watchlist, and Portfolio now use a simpler data-time display with today, data update time, fixed update schedule, and a manual refresh button.
- Watchlist and Portfolio refresh buttons now clear the new persistent caches before forcing a fresh reload.

## [v1.24.35] - 2026-05-30
### Added
- Added shared-cache metadata for stock quant data so Explore, Watchlist, and Portfolio can show fixed update windows, actual fetch time, source data date, and whether the data came from shared cache or a live IFAlgo request.
- Added extra app-cache warmup cron windows at Taiwan time 08:10 and 14:00, in addition to the existing 06:45 warmup and 23:30 after-market snapshot collection.

### Changed
- Stock quant API now checks `stock_quant_daily_snapshots` before hitting IFAlgo, then writes live misses back into the shared snapshot cache for later users.
- Explore now shows stock recommendations first while Simons quant details continue syncing in the background.
- Watchlist and Portfolio now clearly separate price update timing from lower-frequency Simons quant data timing.

## [v1.24.34] - 2026-05-29
### Added
- Added `推薦次數` as a Watchlist sort option using each stock's trailing 90-day Simons recommendation count.

### Changed
- Recommendation-count sorting now works with the existing ascending and descending sort direction controls.

## [v1.24.33] - 2026-05-29
### Added
- Added a 90-day Simons recommendation-count API so existing Watchlist and Portfolio stocks can show repeat recommendation badges.
- Watchlist and Portfolio stock names now show `推薦X2`, `推薦X3`, and higher badges only when a stock has appeared more than once in the last 90 days.

### Changed
- Explore now hides stocks that are already in the Watchlist or currently held in Portfolio, including both strategy lists and search results.
- Recommendation-count badges reset naturally by counting only Simons snapshots from the trailing 90-day window.

## [v1.24.32] - 2026-05-29
### Added
- Added Watchlist sort direction controls so cumulative return, chip score, and comprehensive score can sort descending or ascending.
- Added comprehensive-score fallback for watched stocks that have individual IFAlgo quant data but are not in the daily Simons recommendation list.

### Changed
- Watchlist filter controls now prioritize AI recommendation level, use clearer active states, and show recommendation-level mineral icons.
- Watchlist stock cards now use fixed badge rows: AI recommendation and AI state first, comprehensive score on its own row, then smaller supporting tags.
- Renamed Watchlist score labels from Simons/quant score wording to `綜合評分`.

## [v1.24.31] - 2026-05-29
### Added
- Added a server-side stock quant snapshot endpoint that saves Simons/IFAlgo chip-stability data into `stock_quant_daily_snapshots`.
- Watchlist additions now trigger a background snapshot so newly watched stocks start accumulating chip-stability trend data without opening the detail page.

### Changed
- Daily app-cache warmup now writes stock quant snapshots for Simons, holding, and Watchlist stocks instead of only warming short-lived quant cache.
- Stock detail entries now reset scroll position to the top and show a compact floating stock context bar while scrolling.

## [v1.24.30] - 2026-05-28
### Added
- Added a half-year candlestick mini chart to each Watchlist stock card using the existing IFAlgo K-line data.
- Added MA20 and six-month performance display inside the Watchlist mini chart.

### Changed
- Watchlist cards now preserve fast loading by reusing already-fetched stock data for charts instead of making extra chart API requests.
- Watchlist mini charts automatically move below the stock summary on narrow mobile screens to avoid crowding the card header.

## [v1.24.29] - 2026-05-28
### Added
- Added daily stock quant snapshots for 30/60 day chip-stability trend tracking on stock detail pages.
- Added a stock quant history API that combines new daily snapshots, existing Simons snapshots, and the latest IFAlgo value.
- Added Watchlist sorting by cumulative return, chip score, and Simons quant score.

### Changed
- Watchlist now renders existing cards first and refreshes quotes, quant data, and MA5/volume signals in the background.
- Portfolio now renders holdings first and refreshes AI entry/exit signals in the background.
- Automatic Watchlist and Portfolio loads now reuse short-lived quant cache; manual refresh still forces a fresh quant request.

## [v1.24.28] - 2026-05-20
### Added
- Buy order modal now estimates stop-loss risk before confirming, including the stop-loss reference price, estimated loss, and the loss as a share of available balance.
- Parent account settings now include an adjustable stop-loss alert percentage, defaulting to 20%, and sync the value to child accounts.
- Child-account creation now inherits broker fee and stop-loss settings from the parent account.

## [v1.24.27] - 2026-05-20
### Changed
- PPBear stock company introductions now use MoneyDJ company wiki facts before AI rewriting, prioritizing core products, revenue mix, and application scenarios over broad industry tags.
- Stock detail now calls the Supabase description function with the active session token so authenticated users do not fall back to generic local copy.
- Replaced the vague local fallback company text with more specific conservative copy, including a richer power-supply fallback for companies like 6282 康舒.

## [v1.24.26] - 2026-05-19
### Changed
- Watchlist AI entry and exit signals now reuse only same-day short-lived cache, then automatically refresh after the cache expires or the day changes.
- Watchlist automatic analysis now bypasses per-stock quant cache so users do not need to press "重新抓取" to see updated AI signal states.
- The Watchlist data source label now shows "今日快取" only when it is actually displaying a valid same-day cached result.

## [v1.24.25] - 2026-05-19
### Changed
- Portfolio AI entry and exit signals now reuse only same-day short-lived cache, then automatically refresh after the cache expires or the day changes.
- Portfolio signal refresh now bypasses per-stock quant cache during automatic analysis so users do not need to press "重新抓取" to see updated AI signal states.
- The Portfolio data source label now shows "今日快取" only when it is actually displaying a valid same-day cached signal result.

## [v1.24.24] - 2026-05-16
### Changed
- Restricted the Dashboard Simons quant model section to Premium, admin, or inherited Premium family accounts.
- Free users no longer render the Simons market panel or trigger the home-market summary request from the Dashboard.

## [v1.24.23] - 2026-05-16
### Changed
- Released the stock analysis shared-cache strategy as a production version bump.
- Stock analysis cache keeps one latest row per stock/type and removes entries that have not been updated for 30 days.

## [v1.24.22] - 2026-05-16
### Added
- Added a server-side `stock_daily_cache` Supabase table for shared per-stock daily analysis results.
- Stock analysis now reuses the same day's cached technical, chip, and news summary before calling IFAlgo, Yahoo, and OpenAI again.

### Changed
- Stock detail first-load release no longer waits for PPBear company description or AI three-way analysis, allowing the main stock page to appear while those sections finish in the background.

## [v1.24.21] - 2026-05-15
### Changed
- Explore stock cards now show the unified red AI entry icon only for active AI buy signals.
- AI neutral and AI exit states are hidden from Explore cards to keep the list focused and easier to scan.

## [v1.24.20] - 2026-05-15
### Fixed
- Portfolio AI signal loading now times out per stock request so one slow data source cannot leave the portfolio page spinning forever.
- Portfolio now falls back to showing holdings first when signal analysis is temporarily unavailable.
- Dashboard market prediction gauges now label the cards as AI daily/monthly bullish-bearish predictions.

## [v1.24.19] - 2026-05-15
### Fixed
- Watchlist AI signal filters now persist while opening a stock detail page and returning to the watchlist.
- Buying a stock now removes it from the watchlist immediately and blocks already-held stocks from being added back to the watchlist.
- Watchlist now cleans up any existing watched stocks that are already present in portfolio holdings.

## [v1.24.18] - 2026-05-13
### Added
- Added an admin-controlled `daily_newsletter` feature switch so each account can be included in or excluded from automatic daily newsletter delivery.
- Added an admin holdings view for each account, including holding count, market value, unrealized P/L, shares, average cost, and current price.

### Changed
- Daily newsletter preparation now targets Taiwan time 08:00 data, with scheduled delivery at 08:30 and an explicit data-time label in the email.
- Automatic and manual newsletter sending now respect the per-account newsletter switch, while keeping Premium enabled by default and Free disabled by default.

## [v1.24.17] - 2026-05-13
### Changed
- Changed Stock Detail first-load behavior to show a full progress loading panel while price, quant signals, chip-cost data, PPBear description, and AI analysis finish loading.
- Stock Detail now releases the full page only after the initial data pipeline has completed, avoiding partially rendered stock pages with empty chip or analysis sections.

## [v1.24.16] - 2026-05-13
### Fixed
- Fixed Goodinfo institutional cost fetching after its dynamic CLIENT_KEY redirect flow changed, restoring 3037 欣興 and other stock chip-cost estimates.
- Fixed refreshing a deep stock detail route so an existing Supabase session waits for the user profile to load instead of bouncing through login and returning to the home page.

## [v1.24.15] - 2026-05-13
### Fixed
- Fixed account sync refreshes leaving Stock Detail trade buttons stuck in "同步中" by preserving ready state during background refreshes and adding guarded timeouts.
- Fixed Learning quiz result counts exceeding the question total on mobile by locking each question to a single recorded answer and clamping result calculations to the active quiz length.
- Improved Learning completion save handling so a slow `lesson_progress` insert verifies whether the record actually exists before showing a retry error.

## [v1.24.14] - 2026-05-13
### Added
- Added FinMind institutional buy/sell flow as a supporting signal in the stock detail chip-cost API and summary card.
- Added a shared cute market badge component and used it on stock detail, Explore, Watchlist, and Portfolio stock rows.

### Changed
- Official price maps now include market type metadata (`listed` / `otc`) so list pages can show market badges without extra per-row calls.

## [v1.24.13] - 2026-05-13
### Added
- Added a compact market badge before the stock code on the stock detail page, showing "上市" for TWSE stocks and "上櫃" for TPEx stocks.

## [v1.24.12] - 2026-05-13
### Changed
- Removed the full "大人們買在哪裡？" institutional cost distribution section from the stock detail page.
- Removed the "查看完整成本分布" jump button from the chip-cost summary card while keeping the compact chip-cost summary visible.

## [v1.24.11] - 2026-05-13
### Added
- Added a stock detail chip-cost summary card that shows the institutional estimated average cost area near the technical chart.
- Added a `/api/institution-cost` endpoint that reads Goodinfo institutional buy amount and buy volume, then estimates buy-side average cost when IFAlgo cost data is missing.

### Changed
- Stock detail now prioritizes IFAlgo/Simons institutional costs, then fills missing foreign, investment trust, or dealer values with clearly labeled Goodinfo estimates.
- Updated chip-cost copy to say "法人估算成本" and mark Goodinfo-derived values as estimates instead of presenting them as official holding cost.

## [v1.24.10] - 2026-05-12
### Fixed
- Fixed withdrawal approvals staying pending after login by moving approval/rejection to a server-side API that verifies the parent session before writing status changes.
- Ensured approved withdrawals update the request status, deduct the child balance, and insert a withdrawal trade record as one guarded flow with visible errors on failure.
- Repaired the existing stuck NT$100 withdrawal request for 娃娃魚 and confirmed there are no pending withdrawal requests left in production data.

## [v1.24.9] - 2026-05-08
### Added
- Added a Vercel cron warmup at 06:45 Taiwan time to preload Home market summary, Simons daily data, official TWSE/TPEX prices, and shared stock quant endpoints before users open the app.
- Added cloud cache API routes for Home market summary, daily Simons/official price data, and stock quant data so users do not each trigger the same raw source requests.

### Changed
- Home now checks browser cache first, then cloud daily cache, and only falls back to raw source calculation when the cloud cache is unavailable.
- Explore now reads the cloud-prepared official price map instead of rebuilding TWSE/TPEX data on every cold page load.
- Simons daily recommendations are cached until the next 07:00 Taiwan refresh window.
- Stock quant data is shared through a cloud endpoint while keeping the existing 30-minute client TTL for signal freshness.

### Preserved
- Portfolio real-time holding prices still refresh during market hours with the existing short TTL/manual refresh behavior instead of being locked to the daily cache.

## [v1.24.8] - 2026-05-08
### Changed
- Updated the Home 今日市場氛圍 inference rules using the provided Threads samples, so 放鬆 is no longer triggered only by margin maintenance being above the safety line.
- Prioritized 貪婪 when AI日預測 is hot while monthly or macro signals are not fully aligned, 樂觀 for constructive but not overheated setups, and 放鬆 only when monthly direction and margin pressure are both supportive.
- Updated the mood help copy to state that the mood is inferred from IFalgo public data and the currently collected author samples.

### Known Limitations
- 冷靜 remains conservative because there are fewer confirmed author samples; future samples can further tune the rule.

## [v1.24.7] - 2026-05-08
### Changed
- Changed the Home Simons dashboard to use IFalgo's public `index/firstZoneData` API for monthly prediction, daily prediction, margin maintenance, and market fund momentum instead of image-calibrated or stock-level inferred values.
- Moved the 今日市場氛圍 card to the first position under Simons 量化模型 so users see the daily conclusion before the supporting charts.
- Removed the four static explanation cards and replaced them with click-to-expand help on the market fund momentum chart and daily market mood card.

### Fixed
- Fixed AI日預測 data sourcing so it reads `lastPtsTw.pts` from IFalgo's market dashboard API instead of deriving the value from a single stock's `gin8`.
- Removed hardcoded screenshot calibration values and stale fallback margin values that could make market data look live when it was not.

## [v1.24.6] - 2026-05-07
### Fixed
- Removed the generic answer-position memorization question from the Learning quiz pool because it was not investment-related and could repeat across lessons.
- Verified all 100 lessons still have enough available questions after removing that shared question.
- Reset production learning progress records and learning profile counters while preserving learning wallets and wallet transactions.

## [v1.24.5] - 2026-05-07
### Fixed
- Fixed Learning Home responsive layout so the top stats, progress panel, and shortcut actions keep the same single-row structure on mobile and desktop.
- Made perfect-score learning coin grant failures visible instead of silently returning 0 coins, and refreshes the wallet/transaction state after successful grants.
- Kept completed lessons from showing a retry action when only coin sync produced a warning, avoiding confusion after a successful all-correct retry.

## [v1.24.4] - 2026-05-06
### Changed
- Changed the Home Simons dashboard cache to a Taiwan-time daily refresh slot at 08:00, so the same user session reuses the daily market summary instead of refetching every visit.
- Bumped the Home market summary cache key to clear previous 30-minute cached data and adopt the daily update cadence.

## [v1.24.3] - 2026-05-06
### Fixed
- Made the margin maintenance API return the latest verified fallback value when the upstream source blocks server requests, keeping the Home Simons dashboard stable in production.

## [v1.24.2] - 2026-05-06
### Added
- Replaced the Home holdings preview with a Simons macro dashboard showing market fund momentum, AI monthly prediction, AI daily prediction, and margin maintenance rate.
- Added hover tooltips to the market fund momentum chart with monthly momentum and TAIEX values.
- Added market aspect scoring for 追價熱度、趨勢信心、槓桿安全、波動穩定, including an explanation that the four scores are simultaneous dimensions rather than exclusive moods.
- Added a serverless margin maintenance endpoint and dynamic cache versioning for the Home Simons summary.

### Changed
- Tuned the market fund momentum chart axes to match the Simons reference scale and restored 2026/04 monthly data.
- Renamed the previous emotional labels to clearer market aspect labels to reduce misinterpretation.

## [v1.24.1] - 2026-05-06
### Fixed
- Fixed the mobile Learning map so scene layout uses the same map rules as desktop, keeping lesson nodes aligned with the background artwork.
- Applied calibrated node positions for stages 2-10, so lessons 11-100 now match their scene platforms.
- Removed oversized translucent lesson shells from later stages; all stages now use the same compact circular lesson badge treatment.
- Replaced the Learning map scene art with atmosphere-only backgrounds that avoid island/platform shapes, reducing coordinate mismatch risk across desktop and mobile.

## [v1.24.0] - 2026-05-05
### Added
- Added 10 clean themed Learning map backgrounds for the 100-lesson course path, including spring sakura, summer beach, autumn maple, winter snow, deep sea, sky castle, crystal cave, lakeside, firefly forest, and lava castle scenes.
- Added a local-only Learning map calibration mode so level positions can be dragged, saved, copied, and reused during design tuning.

### Changed
- Learning map level nodes now use calibrated platform positions across all 10 scene sections.
- Completed lessons now visually change into green completed badges with check marks, while the current lesson remains highlighted and locked lessons stay subdued.
- Replaced old map backgrounds that contained baked-in numbers or lock icons with clean scene assets.

## [v1.23.1] - 2026-05-05
### Changed
- Rebuilt the Learning home page as a Duolingo-style vertical course map with 100 lesson nodes.
- Each lesson node now shows the lesson number, title, summary, level, and completion status.
- The map can be scrolled up and down, with alternating left/right lesson placement and stage markers.
- Added responsive mobile layout so the full 100-level path remains readable on small screens.

## [v1.23.0] - 2026-05-05
### Added
- Expanded the learning course catalog from 60 lessons to 100 investment lessons.
- Added chart-based learning visuals for K-line patterns, ETF/index concepts, allocation, orders, financial statements, valuation, risk, and safety lessons.
- Added dynamic scenario and chart questions so children must reason through the lesson instead of memorizing fixed answer positions.
- Added `supabase-learning-reset-2026-05-05.sql` for resetting learning progress while preserving existing learning coins.

### Changed
- Shuffled quiz answer choices per attempt and regenerated the correct option mapping automatically.
- Completed Learning Home quick actions, reward, wallet, shop, article, and request links so the learning interface is more fully clickable.

### Fixed
- Lesson completion now requires a perfect score before awarding XP and learning coins.
- Previously completed lessons can no longer be repeated for duplicate coin rewards.

## [v1.22.3] - 2026-05-05
### Changed
- Updated the Learning page into a full cute forest adventure-map layout while keeping lesson, XP, wallet, streak, correct-answer, and article entry points.
- Replaced the mobile app/logo bear icon with the new cute PPBears mascot artwork.
- Added Apple touch icon and web app manifest metadata for a better phone home-screen icon experience.

## [v1.22.2] - 2026-05-05
### Changed
- Redesigned PPBears UI visual system for a cuter, higher-quality child-friendly experience.
- Updated Learning page into a dark forest game-map style while preserving existing learning data, lesson links, wallet, XP, streak, and article entry points.
- Polished Home, Explore, Watchlist, Portfolio, Withdrawal Approval, shared cards, badges, and bottom navigation without changing API or data logic.

## [v1.22.1] - 2026-05-04
### Changed
- 電子報資料準備時間改為每日台灣時間 08:00，正式寄送改為每日台灣時間 08:30，並移除寄送 API 內部舊的整點檢查，避免資料庫舊設定讓 08:30 排程被略過。

## [v1.22.0] - 2026-05-04
### Added
- 新增股利自動入帳基礎系統：`dividend_payments` 記錄每位使用者、股票、除息日、最後買進日、真實現金發放日、符合資格股數與入帳狀態。
- 新增 `upsert_and_credit_dividend` Supabase RPC，會以除息日前一日收盤後持股數計算可領股數，並在發放日當天把現金股利加到 `users.available_balance`。
- 新增 Vercel 排程 `/api/cron-dividend-payments`，每日抓 Yahoo 股利頁的真實 `cashPayDate`，建立待發放紀錄並於發放日入帳。
- 新增 `/dividends` 股利入帳紀錄頁，顯示已入帳、待發放、除息日、最後買進日、股數、每股股利與入帳金額。

## [v1.21.4] - 2026-05-04
### Fixed
- 修正「看庫存」AI 連續訊號次數誤算：Simons `aiQuanBackDataTradingList` 同一天可能有多筆交易明細，現在會先合併成每日事件再計算，不會把同一天多筆出場誤顯示成 `X3`、`X5`。
- 連續次數改用完整事件序列計算：`in_date` 會視為進場/加碼事件，`out_date` 才視為出場或中立事件，因此中間有進場會正確打斷出場累計。
- `AI 中立` 不再顯示 `0`，也不會重置或增加進出場累計。

## [v1.21.3] - 2026-05-04
### Added
- 看庫存 AI 訊號新增連續次數顯示：同一檔持股連續出現 `AI 加碼` 或 `AI 出場` 時，badge 會顯示 `X2`、`X3` 等累計次數。
- 連續次數會從目前這輪持股開始日後計算，並在 `AI 加碼` / `AI 出場` 方向切換時重新累計；`AI 中立` 不會打斷既有方向累計。

## [v1.21.2] - 2026-05-03
### Fixed
- 修復管理副帳號建立流程，避免 Supabase Auth 已建立但 public.users 未寫入時留下孤兒帳號。
- 新增後端 `/api/create-child-account`，由 server-side service role 一次完成 Auth 建立、父子帳號關聯與失敗回滾。
- 支援修復 Auth 已存在但尚未綁定 `public.users` 的副帳號資料。

## [v1.21.1] - 2026-04-29
### Fixed
- **下單轉圈問題根治：加入資料就緒 Guard（`dataReady`）**
  - **問題根本原因**：App 重新開啟時，會立即從 localStorage 讀取舊 session（~50ms）並顯示頁面，但 `loadUserData()` 在背景執行需 1~3 秒。若使用者在背景載入完成前點擊下單，會使用過期的快取資料，導致下單請求卡住轉圈
  - **修正方式**：Store 新增 `dataReady: boolean` 狀態（初始為 `false`），`loadUserData` 開始時設為 `false`，所有資料平行載入完成後才設為 `true`
  - **UI 防護**：個股頁「🛒 買入」/「💰 賣出」按鈕在 `dataReady === false` 時顯示 `⏳ 同步中...` 並 disable，頁面上方顯示橘色提示橫幅「帳號資料同步中，請稍候再下單以確保數據正確」
  - **彈窗二重防護**：即使強制開啟交易面板，確認按鈕同樣在資料未就緒時顯示 `資料同步中...` 並 disable，點擊時顯示 alert 提示
- **閒置自動登出縮短為 30 分鐘**（原 120 分鐘）
  - 縮短後每次重新登入都會執行完整的 `loadUserData()`，確保資料絕對新鮮，從根本減少舊快取造成的操作異常

## [v1.21.0] - 2026-04-28
### Fixed
- **「看庫存」重新整理按鈕失效修正**
  - **問題**：按下「🔄 重新抓取」後清空了 `aiSignals`，但 `useEffect` 的依賴項（`holdings`, `hasAiFeature`, `enableCustomSignal`）沒有任何變化，導致 `useEffect` **不會重新執行**，loading overlay 也永遠不會出現，頁面看起來像當掉了
  - **修正**：新增 `refreshKey` 計數器 state，按下重新整理時遞增，強制 `useEffect` 重新執行並正常觸發 loading 流程
  - **快取邏輯優化**：首次進頁面（`refreshKey === 0`）仍讀快取節省 API；手動重整後直接跳過快取，保證取得最新資料
- **AI 訊號判讀邏輯修正**：解決 ifalgo 同日佔位符 `out_date` 導致已出場訊號被誤判為「AI 加碼」的問題

### Added
- **AI 訊號載入動畫進度條**：Loading overlay 新增紅→橘漸層進度條，依每支股票分析完成即時推進（20% 起跳，每股均分至 90%，完成後推至 100%）
  - 進度條 `0.4s` cubic-bezier 平滑過渡，視覺流暢不跳動
  - 同步顯示「正在分析 聯電（1/10）...」逐股進度文字
  - 完成後顯示「分析完成！100%」停留 400ms 再關閉 overlay

## [v1.20.5] - 2026-04-28
### Fixed
- **根本解決建立副帳號的 Auth Token Lock 衝突錯誤**
  - **錯誤訊息**：`Lock "lock:sb-...-auth-token" was released because another request stole it`
  - **根本原因**：父帳號的主 Supabase client 持有 auth token lock，再呼叫 `signUp()` 會對同一 lock 緣，導致 lock 被就成
  - **修正方法**：在 `createChildAccount` 中建立完全隔離的臨時 Supabase 實例专門用於 `signUp()`
    - 臨時實例使用唯一 `storageKey`，不與主 client 共享任何 localStorage key
    - `persistSession: false` — 註冊完即棄，不留下任何 session 痕跡
    - `autoRefreshToken: false` — 不起背景 token 刷新線程，很從根本消除衝突可能
    - 主 client 的 session 和父帳號登入狀態完全不受影響

## [v1.20.4] - 2026-04-28
### Added
- **父帳號管理副帳號：編輯與刪除功能**
  - 每個副帳號卡片新增「✏️ 編輯」按鈕：可修改子帳號暱稱和頭像
  - 每個副帳號卡片新增「🗑️ 刪除」按鈕：含二次確認強警示對話框
  - 刪除操作會同步清除持股、交易紀錄、學習進度、錢包流水、出金申請等關聯資料
  - Store 新增 `updateChildProfile()` 和 `deleteChildAccount()` 函數
  - 所有操作均有雙重安全防護（驗證 `parent_id` 屬適）

## [v1.20.3] - 2026-04-28
### Fixed
- **建立副帳號出現 406 錯誤與父帳號失登問題**
  - **問題一**：`loadUserData` 使用 `.single()` 查詢尚未建立的子帳號，回傳 Supabase 406 Not Acceptable
    - 修正：改為 `.maybeSingle()`，找不到資料時回傳 null，不再丟出 406
  - **問題二**：`supabase.auth.signUp()` 建立子帳號時可能將父帳號的 session 切換成子帳號，導致父帳號被登出
    - 修正：`createChildAccount` 建立前先存儲父帳號 session，若 signUp 後 session 被切換，立刻呼叫 `setSession()` 恢復父帳號登入狀態

## [v1.20.2] - 2026-04-28
### Fixed
- **重要修正：`pickQuestions()`出題區塊固定僅抽 2 題的邏輯錯誤**
  - 舊邏輯：`return picked.slice(0, 2)` 導致無論題庫有多少題永遠只出 2 題
  - 新邏輯：每次測驗隨機出 **5 題**（choice 至少 3 題、true_false_speed 至少 2 題）
  - 題目顺序再次隨機排序，每次入場都會有不同組合
  - 題庫不足 5 題時自動补充，保證題目完整出完

## [v1.20.1] - 2026-04-28
### Fixed
- 重新部署確認 L056-L060 技術分析課程與 L043/L044 升級內容完整上線

## [v1.20.0] - 2026-04-28
### Added
- **K線與均線完整技術分析學習區塊（L056-L060）**：新增 5 堂進階技術分析專屬課程
  - **L056：K線圖完整解析**：蔗燭圖起源、OHLC四要素、紅黑K辨識、上下影線買賣壓力解讀（ASCII圖解內嵌）
  - **L057：常見K線型態**：鎔頭線、射擊之星、吞噬型態、十字星，並教導型態+位置+量能三要素驗證
  - **L058：移動平均線（MA）完整攻略**：MA5/20/60意義、多空頭排列、支撑壓力轉換、均線口抵進階技巧
  - **L059：黃金交叉與死亡交叉**：交叉訊號原理、假訊號過濾、MA20×MA60中期訊號、四條件完美買點
  - **L060：技術分析綜合實戰**：三層框架、四種量價關係、實戰買賣點案例、技術分析限制與正確心態

### Changed
- **L043「什麼是股利？」全面升級**：7 Cards + 10 題
  - 新增：股利來源說明、現金股利計算公式詳解、股票股利計算方法、除息日完整流程、填息貼息圖解、股利再投資複利效果
- **L044「殖利率完整解析+存股策略」全面升級**：7 Cards + 10 題
  - 新增：高殖利率四大陏阱、優質存股六大指標、計算現金+股票存股綜合殖利率、定期定額策略、存股 10/20 年複利試算
- **課程總數**：從 55 堂增加至 **60 堂**

## [v1.19.0] - 2026-04-28
### Added
- **學習模組題庫大幅擴充**：55 課全面補充題目，每課從 3 題增加至 **7 題**
  - 總題目數從 165 題增加至 **385 題**（增加 220 題）
  - 每課新增 4 題，涵蓋 `choice`（四選一）與 `true_false_speed`（是非題）兩種題型
  - 題目設計符合各課主題，並配合適齡（6-12歲）語言風格
  - 題庫覆蓋所有55課：基礎理財（L001-L015）、公司與股票（L016-L030）、技術分析（L031-L040）、財務指標（L041-L045）、投資心理學（L046-L050）、Simons量化模型（L051-L055）

## [v1.18.0] - 2026-04-28
### Fixed
- **根治 AI 訊號顯示錯誤（3231 緯創 顯示「AI中立」但 Simons 網站顯示進場）**
  - **核心問題 1 — `sell_sig` 辨識不完整**：舊邏輯只判斷 `'出場'` 與 `'賣出'`，漏掉 Simons API 可能回傳的 `'進場'`、`'加碼'`、`'買進'`、`'buy'` 等進場類值；一旦 `out_date` 有填日期但 `sell_sig='進場'`，就會錯誤地落入 `neutral`。現在以 `BUY_SIGS`（進場/加碼/買進/buy/Buy/BUY）與 `SELL_SIGS`（出場/賣出/減碼/sell/Sell/SELL）兩組 Set 完整比對，不再遺漏任何進場訊號值
  - **核心問題 2 — 量化訊號全天快取導致訊號延遲一整天**：`fetchStockQuantData` 原先使用 `getDailyCache`（每日快取，隔天才過期），盤中若 Simons 訊號改變，使用者整天看到的仍是早上快取的舊資料，可能因此錯過進場機會。現改用 **30 分鐘 TTL 快取**（`getTTLCache`），訊號最多延遲 30 分鐘（快取 key 升版為 `ppbears_quant30_*` 自動清除舊快取）
  - **核心問題 3 — Simons 每日推薦也是全天快取**：`fetchSimonsData` 原先對當日資料也用每日快取，改為今日資料同樣使用 **30 分鐘 TTL 快取**（歷史日期查詢仍維持每日快取）

### Added
- **TTL 短效快取工具函式**：新增 `getTTLCache` / `setTTLCache` / `clearTTLCache` / `getTTLRemaining` 四個通用工具，支援任意毫秒 TTL，供盤中高頻更新的資料使用
- **重新抓取按鈕同步清除 TTL 快取**：Watchlist「🔄 重新抓取」與 Portfolio「🔄 重新抓取」按鈕現在同時清除對應股票的 `localStorage` TTL 快取（`ppbears_quant30_*`），確保手動刷新後一定抓到最新資料
- **完整的 sell_sig 兜底日誌**：Console 日誌格式升級為 `[QuantData] {code} | out_date='...' | sell_sig='...' | hasOpenPosition=...`，方便後續排查任何訊號異常

## [v1.17.1] - 2026-04-26
### Fixed
- **學習幣永遠為 0 的根本原因修正**：`completeLesson` 函式從 `reward_rules` 查到的原始 DB 資料（欄位名為蛇形命名法 `trigger_type`），被直接強制轉型為 TypeScript 的 `RewardRule[]`（期望駝峰命名法 `triggerType`），導致 `rule.triggerType` 永遠是 `undefined`，任何觸發條件都無法匹配，`grant_learning_coins` RPC 從未被呼叫
  - 修正方式：改為透過 `rowToRewardRule()` 函式正確映射欄位（`trigger_type` → `triggerType` 等），與 `fetchRewardRules` 其他地方的寫法一致

## [v1.17.0] - 2026-04-26
### Changed
- **觀察名單自動排序升級**：觀察名單股票現在以「AI 推薦等級」作為第二排序鍵，同層訊號內依 超高度 → 高度 → 中度 → 低度 自動由高到低排列，讓最值得關注的標的排最前面
  - 第一層排序維持原邏輯（🔥 雙重確認 > 🟢 MA5 支撐 > 🔵 縮量回檔 > 無訊號 > 警告 > 建議移除）
  - 第二層（同優先層內）：`超高度（4）> 高度（3）> 中度（2）> 低度（1）> 無資料（0）`
  - 不需要手動操作，進入頁面後自動依等級排序

## [v1.16.0] - 2026-04-26
### Changed
- **看庫存 AI 訊號 UI 全面簡化**：移除 Simons 評分輔助列，專注呈現三種核心 AI 訊號
  - 移除每張持股卡片下方的「💎 Simons XX分」評分列與輔助標籤
  - **AI 進場** 名稱統一改為 **AI 加碼**（與找股票頁保持一致）
  - AI 訊號 Badge 尺寸從 52×52px 放大至 **72×72px**（emoji 從 22px → 32px），視覺更醒目
  - **AI 出場 badge 改為綠色**（`#16a34a`），符合台股賣出用綠色的慣例，三色對比更鮮明
  - 資料來源標籤由「Simons 量化模型」改為「AI 量化分析」
  - 三種訊號色系：🚀 AI 加碼（紅）、⚖️ AI 中立（灰）、⚠️ AI 出場（綠）

## [v1.15.0] - 2026-04-25
### Added
- **觀察名單 AI 進出場訊號**：觀察名單頁面新增 Simons 量化模型 AI 進出場訊號功能
  - **三色大型圖示篩選卡片**：🔴 AI進場（紅色上升趨勢圖示）、⚪ AI中立（灰色橫線圖示）、🟢 AI出場（綠色下降趨勢圖示），三個大型圖示卡片，點擊即可篩選
  - **股票卡片 AI 訊號 Badge**：每張觀察股票卡片上顯示圓形圖示 + 文字的大型 AI 訊號 Badge
  - 資料來源為 Simons 量化模型的 `aiQuanBackDataTradingList`（最後一筆的持倉狀態判斷）
  - 三組篩選（進場訊號 / 建議移除 / AI 訊號）互斥切換
  - 篩選啟用時顯示「篩選中」提示列與「取消篩選」按鈕
  - 底部圖例說明區新增 AI 進出場訊號的定義與解釋

## [v1.14.0] - 2026-04-25
### Added
- **個股頁內嵌即時技術線圖**：進入個股頁直接顯示日 K 線圖，不需再點外連按鈕跳轉 Yahoo
  - 使用 lightweight-charts 開源圖表庫 + ifalgo 本地 K 線資料繪製，無任何外部授權限制
  - 台股配色：漲紅跌綠 K 線 + MA5（黃色）+ MA20（紫色）均線 + 成交量長條圖
  - 支援觸控拖拽、縮放、十字線即時價格顯示
  - **預設顯示近半年（130 個交易日）**，K 棒大小適中不需手動放大
  - 手機版自適應高度（360px），桌面版 420px
  - 內建 Error Boundary 防止圖表錯誤影響整頁
- 移除原有的「📈 查看 Yahoo 最新技術線圖」按鈕（已被內嵌圖表取代）

## [v1.13.1] - 2026-04-25
### Changed
- **AI 篩選預設啟用**：「AI 中度以上 + 累積報酬正值」篩選按鈕預設為打勾狀態，進入「找股票」頁面時直接顯示篩選後的推薦結果，不需每次手動勾選

## [v1.13.0] - 2026-04-24
### Fixed
- **學習幣無法發放（主因）**：修正 `completeLesson` 中發幣邏輯僅限 `child` 帳號（`user.parentId` 存在時才執行）的問題。現在父母帳號學習時也能查詢自己設定的發幣規則（`parent_id = user.id`），並正確發放學習幣
- **最後一題 XP 計算遺失（Stale Closure）**：`LessonView` 的 `handleNextQuestion` 因 React state 閉包問題，`answers` 在最後一題答完後仍取得舊快照，導致最後一題 XP 未被計入。改用 `answersRef`（`useRef`）即時追蹤最新答案，確保全部題目 XP 正確累積
- **移除冗餘的 `learning_wallet` upsert 呼叫**：前端不再對 `learning_wallet` 直接做 upsert（會被 Supabase RLS 阻擋），改由 `grant_learning_coins` SQL 函式內部的原子性 upsert 處理錢包初始化
- **結果頁誤導訊息移除**：完課結果頁的「請主帳號設定發幣規則」已移除，避免父母帳號看到不必要的提示

### Added
- **模組級快取系統（Portfolio 頁）**：`Portfolio` 頁面的 AI 訊號（Simons + 量化資料）加入 5 分鐘快取機制，切換頁面回來後直接讀取快取，不重複呼叫 API
- **快取 UI 指示（Portfolio 頁）**：加入「⚡ 快取中」綠色徽章與「🔄 重新抓取」手動刷新按鈕，讓使用者清楚知道資料來源狀態
- **模組級快取系統（Explore 頁）**：`Explore` 頁面的 TWSE/TPEX 全市場報價與 Simons 每日推薦各自加入 10 分鐘快取，大幅減少頁面切換時的重複 API 請求

## [v1.12.0] - 2026-04-23
### Changed
- **AI 每日推薦篩選按鈕升級**：將「AI 中度以上 + 累積報酬正值」篩選由傳統 checkbox 改為一鍵切換方框按鈕
  - 點擊按鈕立即篩選股票，無需再按「重新整理」
  - 啟用時顯示金色漸層背景 + 白色文字 + ✓ 方框 + 發光陰影，視覺反饋更直覺
  - 未啟用時預覽灰色底 + 空白方框，股票總數徽章常駐顯示（不限是否篩選中）
- **移除 AI 推薦頁「重新整理」按鈕**：進入 AI 聰明選股頁時資料已自動載入，重新整理功能等同重整頁面，按鈕不再需要

## [v1.11.2] - 2026-04-22
### Changed
- **觀察名單卡片同步「找股票」量化資訊**：觀察名單中的股票現在會顯示與「找股票」卡片一致的關鍵欄位（建議徽章、Simons 量化評分、AI 推薦等級、累積報酬、籌碼穩定度）
- **資料來源整合補強**：觀察頁面新增整合 Simons 清單與個股量化資料；若當日無資料則自動降級顯示，避免卡片空白或報錯

## [v1.11.1] - 2026-04-21
### Changed
- **觀察名單數據來源資訊移至頂部**：進入頁面即可看到「📡 IFAlgo K線 API · 📅 最新K線日期 · 🕐 分析時間」，不需滑到底部
- 改為單行橫排顯示，更簡潔不佔空間

## [v1.11.0] - 2026-04-21
### Added
- **觀察名單智慧警告指標**：觀察名單新增自動健康檢查機制，提醒用戶何時該移除不適合的標的
  - 🚨 **建議移除**：已買入持有中的股票自動標記，或從加入價跌超過 -15% 趨勢已破壞
  - ⏰ **注意警告**：觀察超過 30 天未進場，機會可能已過
  - 💡 **提醒**：已觀察超過 2 週，是否該做決定？
  - 「建議移除」的股票顯示紅框 + **一鍵移除按鈕**
  - 頁面頂部新增警告摘要 Banner
  - 排序邏輯更新：進場訊號排最前 → 無訊號 → 有提醒 → 建議移除排最後
  - 訊號說明區塊新增「移除建議」段落

### Changed
- **MA5 支撐 / 縮量回檔訊號已驗證**：實際以台積電 (2330) 與環球晶 (6488) 的 IFAlgo API 數據手動驗算，確認 MA5 與量能計算邏輯 100% 正確
- **進場訊號說明**區塊重新組織，分為「進場訊號」與「移除建議」兩個段落

### Fixed
- 修正 `趋勢` → `趨勢` 簡體字混入
- 移除未使用的 `recent3Close` 變數

## [v1.10.0] - 2026-04-21
### Added
- **觀察名單（Watchlist）**：新增底部導覽「觀察」頁面，讓使用者追蹤感興趣的股票
  - 新增 `watchlist` Supabase 資料表（見 `supabase-watchlist.sql`），支援 RLS 隔離
  - 個股頁右下角可一鍵加入/移除觀察名單
  - 觀察頁顯示即時報價、技術訊號（加碼/出場/中立）與進場提醒
  - store 新增 `watchlist`、`watchlistSignals`、`watchlistWarnings` 狀態與對應 action

### Fixed
- **AI 聰明選股數據混淆修正**：修正三項連環 bug，確保所有卡片都顯示 Simons 量化評分
  - `loadData()` 一開始清空舊 `quantDataMap`，防止重整後新分數配上舊 badge
  - quant `useEffect` dependency 從 `recommendations.length` 改為 `simonsMeta`，重整後一定重新執行
  - `quantLoading` 期間隱藏卡片、改顯示 spinner，Phase-1 `calculateAdvice` 分數不再出現

## [v1.9.0] - 2026-04-21
### Changed
- **交易效能大幅優化**：買入、賣出從 8+ 次序列 DB 往返壓縮為 **1 次 RPC 呼叫**，一般情況下從 1–3 秒縮短至 < 500 ms，並根治「資料庫操作逾時」錯誤
  - **新增 Supabase RPC 函數**：`execute_buy_trade` 與 `execute_sell_trade`（見 `supabase-trade-rpc.sql`），於單一 PostgreSQL transaction 完成「讀手續費 → 驗餘額/持股 → 更新 users → 寫入 trades → upsert holdings」，並以 `FOR UPDATE` 鎖防止連按造成重複扣款
  - **移除每次交易 `loadUserData()` 重撈整包資料**：改為根據 RPC 回傳直接更新本地 Zustand store，省下 6 個網路往返
  - **移除交易前 `users.available_balance` 預讀**：餘額驗證交由 DB 原子性處理，避免 Tab 閒置時仍多打一次查詢
  - **子帳號手續費查詢移入 RPC**：不再從前端額外打一次父帳號讀取
- **部署需求**：v1.9.0 需先在 Supabase SQL Editor 執行 `supabase-trade-rpc.sql`，否則前端會顯示「交易服務尚未部署」提示訊息

## [v1.8.4] - 2026-04-21
### Fixed
- **桌機 Tooltip 閃現後消失修復**：將所有說明視窗觸發改為「點擊問號開啟/再次點擊關閉」，移除 hover 離開即關閉機制，解決滑鼠移動時視窗閃現與裁切問題
- **Tooltip 置中動畫修復**：修正 `tooltipFadeIn` 的 `transform` 動畫，保留 `translate(-50%, -50%)` 置中定位，避免動畫期間跑位導致內容不可見
- **桌機操作體驗優化**：新增鍵盤 `Esc` 快捷鍵，可在 Tooltip 開啟時快速關閉說明視窗

## [v1.8.3] - 2026-04-21
### Added
- **【Premium 專屬】Simons 量化模型評分系統**：Premium 會員在 AI 聰明選股策略下，現在使用全新的 Simons 五維評分模型取代舊的 PSR/強度/趨勢評分
  - **五大評分維度**（佔比均衡分配）：
    1. **AI推薦等級**（40分）：超高度 +30 / 高度 +22 / 中度 +12 / 低度 +2
    2. **熱度值 PSR**（30分）：PSR 5-7 為正常水位，>7 優秀、<5 冷門
    3. **強度指標**（20分）：>2.5 極佳 +15 分、>2.0 優良 +12 分、>1.5 不錯 +8 分
    4. **氣動指數 GVI**（15分）：與中位數比較，高於 1.2 倍表示資金流入明顯
    5. **籌碼穩定度**（10分）：0-10 分評分，>=8 最乾淨 +10 分
  - **新的建議等級**（基於 Simons 評分）：
    - ≥75 分：🔥 **強烈建議買進**（原為 ≥70）
    - 60-74 分：💚 **建議考慮買進**（中度推薦）
    - 45-59 分：🟡 **繼續觀望**（混合訊號）
    - 30-44 分：😐 **保守等待**（偏弱訊號）
    - <30 分：❌ **避免或出場**（多數指標弱勢）
  - **UI 更新**：
    - Explore 頁 AI 卡片上顯示「💎 Simons量化評分 XX分」金色徽章，與免費評分明確區隔
    - StockDetail 個股頁建議框改為顯示「💎 Simons量化評分 (XX分)」標籤，替代非會員的評分制度
  - **不顯示舊評分制度**：當有量化資料時，Premium 會員只看 Simons 評分，完全隱藏非會員的 PSR/強度/趨勢計算
- **【法人成本判讀 + Simons 量化模型】Tooltip 排版美化與響應式改進**：改進所有 Tooltip 的桌面和手機版本設計
  - **桌面版改進**（769px 以上）：
    - Tooltip 寬度升級為 360px（更寬敞、易讀）
    - 位置改為 `left: 50%; transform: translateX(-50%)` 確保居中，不會超出畫面邊界
    - 防止被切掉：自動計算最大寬度 `calc(100vw - 40px)`、`max-height: 70vh` 可滾動
    - 陰影升級：`0 16px 48px rgba(0, 0, 0, 0.2)` 更立體清晰
  - **手機版改進**（≤ 768px）：
    - **模態框設計**：Tooltip 改為 `position: fixed` 居中顯示（寬度 90vw，max 480px）
    - **遮蔽層**：手機版點擊任何欄位後自動加上半透明背景 `rgba(0, 0, 0, 0.5)`，點擊遮蔽層可關閉
    - **關閉按鈕**：右上角 36×36px 藍色 X 按鈕，點擊可關閉 Tooltip
    - **動畫**：`tooltipSlideIn` 平滑從中上方滑入，`backdropFade` 背景淡入淡出
    - **友善性**：所有 Tooltip 內容支援滾動（max-height 85vh），適合長內容
  - **內容設計統一**：
    - 主標題改為藍色漸層背景（`linear-gradient(135deg, var(--primary) 0%, #2563eb 100%)`），白色文字，居中顯示
    - 副標題更清晰（14px、深灰色、行高 1.7）
    - 代碼示例、分類說明、投資建議的色塊邊距均勻，易掃讀
    - 首尾段落自動分隔，避免壅擠
  - **使用 TooltipBox 可複用組件**：新增 React 組件自動判斷裝置，桌面版用 Hover，手機版用 Modal + 遮蔽層
- **【Simons 量化模型】互動式 Tooltip 提示**：StockDetail 個股頁的「Simons 量化模型」各卡片，所有數據欄位現在都有可點擊的「❓」圖示
  - **🤖 AI 推薦等級** → 解釋 4 個等級（超高/高/中/低）與累積報酬意義
  - **🔥 熱度值 PSR** → 說明市場關注度分級與投資參考價值
  - **📊 強度指標** → 詳解籌碼推力強度分級與最適買進條件
  - **💨 氣動指數對比** → 解釋個股與板塊中位數的相對比較方式
  - **🧲 籌碼穩定度** → 從 GVI 推導的綜合評分，買進組合標準
  - **設計統一**：與法人成本判讀 Tooltip 保持同樣風格，320px 寬度、色碼分類、流暢動畫
- **toRecommendation() 函式擴展**：支援可選的 quantData 參數，有量化資料時自動調用 calculateSimonsScore
- **Explore 量化資料加載流程優化**：獲取 quantData 後立即重新計算 Simons 評分並按新評分排序
- **StockDetail 量化評分整合**：當量化資料加載完成且是 Premium 會員時，自動用 Simons 評分重新計算個股頁建議

## [v1.8.2] - 2026-04-21
### Fixed
- **AI 每日推薦結果篩選與排序優化**：只保留「中度以上推薦」且「正累積報酬」的股票優先顯示；其他股票進入個股頁才載入量化資料，大幅減少初始 API 呼叫數量並加快 Explore 頁面載入速度
- **量化資料顯示完整性**：移除前 25 支的限制，改為批次抓取全部 AI 推薦股票的量化資料，確保所有符合條件的股票都有完整的「AI 推薦等級」「累積報酬」「籌碼穩定度」標籤顯示

### Changed
- **AI 推薦流程重新設計**：優先級分層為「中度以上 + 正報酬」的精選推薦（已完全抓取量化資料顯示），其次為其他推薦（進頁面才載）

## [v1.8.1] - 2026-04-20
### Fixed
- **個股頁同策略推薦補強**：修正推薦滑塊互動（箭頭切換、桌面拖曳）與資料狀態顯示邏輯，將「載入中」與「無資料」分離，避免無資料時長期停留載入狀態

## [v1.8.0] - 2026-04-20
### Fixed
- **Session 過期後下單卡住**：`initAuth` 改用 `getSession()` 快速讀取本機 session（~50ms），`onAuthStateChange` 僅負責後續 token 刷新，解決 token 過期時操作無回應問題
- **下單使用舊餘額計算**：`executeBuy` / `executeSell` 下單前先即時查詢 DB 最新 `available_balance`（5 秒 timeout），不再依賴 store 快取值，避免多裝置或長時間閒置後餘額計算錯誤
- **下單永遠轉圈不停**：所有 Supabase `update`/`insert`/`delete` 操作加上 `withWriteTimeout`（20 秒），逾時後回傳明確錯誤訊息而非永遠等待
- **登出卡住無回應**：`logout()` 改為先立即清除本地 state（UI 瞬間回應），`signOut()` 在背景執行不阻塞

### Added
- **切回 Tab 自動刷新資料**：`initAuth` 新增 `visibilitychange` 監聽，用戶切回頁面時自動重新載入最新餘額與持倉
- **閒置 120 分鐘自動登出**：偵測 `mousedown`/`mousemove`/`keydown`/`touchstart`/`scroll`/`click` 6 種事件，120 分鐘無操作自動登出保護帳號安全
- **AI 聰明選股量化三指標**：Explore 頁面 AI 模式下，每支股票小卡新增顯示「AI 推薦等級」「累積報酬」「籌碼穩定度」三個即時標籤，資料來源 ifalgo API

### Changed
- **登入速度大幅提升**：`authLoading` 解除時機從「所有資料載入完成」改為「session 確認後立即解除」，資料在背景繼續載入，首頁出現速度從 1–3 秒縮短至 ~50ms

## [v1.7.0] - 2026-04-19
### Fixed
- **PPBear 即時整理本地開發無法運作**：`vite.config.ts` 新增 `/api/stock-analysis` proxy 配置，使本地開發時能正確轉發到 Vercel production 環境
- **Simons 量化模型資料顯示缺失**：修改 `StockDetail.tsx` 條件邏輯，改為只需 `quantData` 即可顯示 Simons 區塊（移除對 `recommendation` 的強制依賴），使不在近期推薦清單的股票也能看到 AI 等級、累積報酬、籌碼穩定度等資料
- **買賣交易延遲視覺反饋缺失**：為「確認買入」與「確認賣出」按鈕加入旋轉 spinner 動畫與「交易中，請稍候...」提示文字，避免使用者誤認為頁面當機

### Changed
- **探索頁策略切換體驗優化**：
  - 所有策略的 loading spinner 改為統一顯示，非 AI 策略不再無回應
  - 切換策略卡片時自動平滑滾動至結果標題，避免使用者看不到新篩選結果

### Added
- **`fetchStockQuantData()` 非同步最佳化**：`StockDetail.tsx` 的 Simons 量化模型詳細資料改為非同步載入（不阻塞主流程），確保 `loading` 狀態能及時設為 false，`loadLiveAnalysis` 可立即觸發

## [v1.6.37] - 2026-04-17
### Changed
- **個股頁移除最佳建議**：`PPBear 即時整理` 改回只顯示技術面、籌碼面、消息面，移除重複性高且建設性不足的「最佳建議」區塊，連同後端 AI prompt 與回傳欄位一併精簡

## [v1.6.36] - 2026-04-17
### Fixed
- **即時整理前端防呆**：`StockDetail` 新增請求節流、錯誤提示與「重新整理」按鈕，避免同一資料短時間重複呼叫 `/api/stock-analysis` 並提升失敗時可恢復性
- **下單卡住補強**：`executeSell` 補上與買入流程一致的父帳號券商設定查詢 timeout，降低子帳號下單偶發停留「處理中...」的風險

## [v1.6.35] - 2026-04-17
### Fixed
- **發版與部署更新**：同步更新應用程式版本號至 `1.6.35`，準備部署目前包含登出防重點、下單防重複送出與 Premium 電子報 fallback 修復的版本

## [v1.6.34] - 2026-04-15
### Changed
- **看庫存頁總資產卡改為首頁同版型**：`Portfolio` 頁面上方總資產卡已由舊的雙列/摘要式布局，改成與首頁完全相同的三欄卡片布局（可用現金 / 股票市值 / 未平倉損益）

## [v1.6.33] - 2026-04-15
### Changed
- **看庫存頁總資產樣式同步首頁**：`Portfolio` 頁面上方的總資產標題改為「我的總資產 💰」，並同步首頁的 `NT$` 縮小與數字排列樣式，讓兩頁的資產卡視覺一致

## [v1.6.32] - 2026-04-15
### Changed
- **首頁總資產卡手機版整理**：移除右下角小熊浮水印，縮小 `NT$` 幣別字級，並為三欄資訊加入欄位分隔線，優先提升手機版閱讀整齊度

## [v1.6.31] - 2026-04-15
### Changed
- **首頁總資產卡版面調整**：移除「今日損益」，並將「可用現金 / 股票市值 / 未平倉損益」改為同一列三欄顯示
- **未平倉損益色彩規則**：損益顯示改為賺錢紅字（`--profit`）、賠錢綠字（`--loss-color`），符合台股慣例

## [v1.6.30] - 2026-04-15
### Added
- **完課儲存逾時提示 UX**：答題結束後若儲存超過 8 秒，按鈕會改為「網路較慢，先看結果」，使用者可先進入結果頁，不再被等待狀態綁住
- **背景同步提示**：結果頁新增「背景同步中」提示，讓使用者知道學習資料仍在更新，避免誤判為故障

## [v1.6.29] - 2026-04-15
### Fixed
- **完課儲存第二次卡住熱修復**：`LessonView` 在完課後改為背景刷新 `fetchLearningProfile`，不再阻塞結果頁顯示，避免查詢卡住時按鈕長時間停留在「儲存中...」
- **學習資料讀寫 timeout 強化**：`fetchLearningProfile` 新增 timeout 與錯誤防護，避免 `learning_profiles` 查詢或初始化卡住造成流程連鎖阻塞
- **完課寫入重試機制**：`completeLesson` 的 `lesson_progress` / `learning_profiles` / `grant_learning_coins` 加入較寬 timeout（12s）與一次重試，降低行動網路抖動時誤判 timeout 的機率

## [v1.6.28] - 2026-04-15
### Fixed
- **學習流程卡住修復**：`LessonView` 的完課儲存流程補上 `try/catch/finally`，避免 Supabase 回應失敗時按鈕永遠停在「儲存中...」
- **今日課程進度修復**：`LearnHome` 不再寫死顯示 `L001`，改為依已完成課程自動指向下一堂未完成課程
- **完課寫入容錯強化**：`store.ts` 為 `lesson_progress`、`learning_profiles` 與發幣 RPC 補上 timeout 與錯誤保護，即使後端暫時無回應也不阻塞前端流程

## [v1.6.27] - 2026-04-15
### Fixed
- **即時股價改用 TWSE MIS API**：舊的 `tpex_mainboard_daily_close_quotes` 只有昨日收盤，無法反映盤中漲跌停。改用 `mis.twse.com.tw/stock/api/getStockInfo.jsp`，上市股票查 `tse_{code}.tw`、上櫃查 `otc_{code}.tw`，直接取得今日即時報價。`z`（最新成交）有值時優先使用，成交為 `-`（如鎖漲停）則改用 `h`（今日最高），修正 6274 台耀整日漲停仍顯示昨收 860 而非 946 的問題

### Changed
- `fetchOfficialClosePrice` 重寫：優先呼叫 MIS 即時 API（`fetchMISRealtime`），失敗時再 fallback 至 TWSE/TPEx OpenAPI 昨日收盤
- `vite.config.ts` 及 `vercel.json` 各新增 `/api/mis` → `https://mis.twse.com.tw/stock/api` proxy/rewrite 路由

## [v1.6.26] - 2026-04-15
### Added
- **出金紀錄頁面整合**：子帳號在「出金紀錄」頁面上方，新增申請出金表單（金額、原因），下方繼續顯示出金紀錄，一次體驗完整出金流程而無需跳頁

## [v1.6.25] - 2026-04-15
### Added
- **交易紀錄全面升級**：
  - 日期區間快選列：1 週 / 1 月 / 1 季 / 半年 / 1 年 / 全部 / 自訂日期區間
  - 新增明細統計卡：顯示區間淨損益、勝/敗筆數、總筆數
  - 投資心得欄位：每筆交易可點擊直接編輯和儲存心得，不限新交易時填寫
  - `store.ts` 新增 `updateTradeNote` action，支援即時更新 Supabase 導流至全頁面

## [v1.6.24] - 2026-04-15
### Optimized
- **股價刷新智慧快取**：`refreshHoldingPrices` 加入盤中/盤後分段快取控制。台股盤中（平日 09:00–13:30）快取 5 分鐘，收盤後與週末快取 24 小時，避免收盤後或假日持續浪費 API 請求

## [v1.6.23] - 2026-04-15
### Fixed
- **ESM 模組解析修復**：`package.json` 設有 `"type": "module"`，Node.js ESM 嚴格要求相對路徑 import 必須含副檔名；`cron-newsletter.ts`、`cron-newsletter-prepare.ts`、`send-newsletter-single.ts` 三個 api 函數的 `_newsletter-utils` import 改為 `.js` 副檔名，修復 `FUNCTION_INVOCATION_FAILED / ERR_MODULE_NOT_FOUND` 錯誤

## [v1.6.22] - 2026-04-15
### Fixed
- **電子報 cron 逾時修復**：`cron-newsletter.ts` 補上 `export const config = { maxDuration: 60 }`，與 `cron-newsletter-prepare` 及 `send-newsletter-single` 一致，解決 Vercel 預設 10 秒上限導致 7 點電子報發送被強制中斷、用戶收不到信的問題

## [v1.6.21] - 2026-04-14
### Fixed
- **股價時序落差全面修復**：TWSE/TPEx OpenAPI 盤後有延遲時，自動比較日期並 fallback 至較新的 ifalgo 收盤價，確保個股頁、探索搜尋、Dashboard/Portfolio 三處顯示完全一致
- **上櫃股 vite proxy 補漏**：`vite.config.ts` 補上 `/api/tpex` 開發 proxy，修正 dev 模式下上櫃股（如台耀 6274）查詢全部 404 的問題
- **買賣無動作 Bug**：`executeBuy`/`executeSell`/`doExecuteTrade` 加入 try/catch，Supabase 偶發錯誤時改為顯示錯誤訊息，不再造成頁面無反應
- `TPEXStockQuote` 介面補入 `Date` 及 `LatestBidPrice` 等欄位；上櫃股個股頁補顯示開/高/低/量
- `store.ts refreshHoldingPrices` 改用 TWSE→TPEx→ifalgo 日期比較邏輯，取最新收盤價更新持股現值

## [v1.6.20] - 2026-04-14
### Fixed
- **後台發送電子報逾時修復**：`send-newsletter-single` 函數加入 `maxDuration: 60` 設定，將 Vercel 執行上限從預設 10 秒提升至 60 秒，解決 AI 模式下呼叫多個外部 API 導致函數逾時、前端收到非 JSON 回應的問題
- **外部 API fetch 超時保護**：`_newsletter-utils.ts` 新增 `fetchWithTimeout` 工具函式，為 ifalgo API（8s）、Yahoo Finance 新聞爬取（5s）、OpenAI API（25s）各自設定超時，防止單一請求掛住耗盡整體執行時間

## [v1.6.18] - 2026-04-14
- feat: 升級每日電子報 (cron-newsletter) 選股邏輯，加入即時擷取奇摩股市真實新聞做為 OpenAI 多維解析依據
- style: 重新設計電子報中的「我的庫存狀況」，還原精細卡片式排版與 AI 策略狀態標籤徽章

# ?湔?亥? (Changelog)

?????PPBears Investment ???祈??湧???甇斗?獢葉???敺?[隤????祆?跑(https://semver.org/lang/zh-TW/) ??蝭?
## [1.6.17] - 2026-04-14
### Fixed
- Fixed Vercel routing where `/api/*` endpoints were incorrectly intercepted by the React SPA catch-all rule, preventing the background cron job from running.

## [1.6.16] - 2026-04-14
### Added
- Added force trigger parameter to newsletter cron API for testing
- Ensured all required environment dependencies for Vercel functions

## [1.6.15] - 2026-04-14

### 靽桀儔 (Fixed)
- **銝銵典撽??內 (Trade Form Validation)**: 靽桀儔鈭?芸‵撖怒?鞈?閮???詻?嚗??格???????頝喳?內嚗??港蝙?刻炊隞亦蝟餌絞????憿?券?????蝣箄歲?箏??渡?霅衣內閬?嚗?撠蝙?刻???憛怨?閮?
## [1.6.14] - 2026-04-14

### ?芸? (Optimized)
- **?Ｙ揣????雿喳? (Explore Page Layout)**: 隤踵??????∠巨??憿??⊥???蝯曹??寧??PC ???渡???甈??蝷綽?霈?Ｘ蝺??憟賜汗??
## [1.6.13] - 2026-04-14
- **?畾??閮?(Dividend Yield)**: ?刻蟡刻底蝝圈???祇????憛葉?啣????拍???雿?  - 撌血憿舐內??唳??拍?嚗???TWSE BWIBBU_ALL ?嗆鞈?嚗?  - ?喳憿舐內餈?0撟游像???拍?嚗?????0撟?2???詨潸?蝞像??
  - ?剝??箄璅惜?斗?桀?畾??阡??潭風?脣??潘?撟怠撠?鞈犖敹恍霈?詨???- **隞??閮剖??湔**: ?啣? `vercel.json` ??`vite.config.ts` ??`/api/twse-report/` 隞??嚗???`www.twse.com.tw/exchangeReport/`嚗誑?舀?甇瑕畾?閰?


### ?芸? (Optimized)
- **隞憿隤踵 (UI Coloring)**: 撠眺?乓????賊?璅惜憿隤踵?箇???(Coral)嚗??都?箝????脰矽?渡蝬 (Green)嚗脖?甇亥票??～?瞍脩?頝??典??閬箇????- **擐?摨怠?憿舐內 (Dashboard Holdings)**: 閫?擐??????～?憛?憭?賡＊蝷?3 瑼蟡函??嚗?冽??湔撅?憿舐內雿輻??函?摨怠??敦??
## [1.6.3] - 2026-04-13

### 靽桀儔 (Fixed)
- **?∪撠暺移蝣箏漲憿舐內 (Price Precision Fix)**:
  - ??鈭?Dashboard 擐???憛???孵??其??乓??嗚?  - 撠?Dashboard ??曉憿舐內??`formatMoney` (?∪??賊?) ?踵???`formatPrice` (??撖血??曉??賊?敺雿?嚗Ⅱ靽葉?舫 134.5 ?迨憿?撠雿??孵?隞亦?撖血??橘?銝?鋡怠撥?嗅??其??亥 135 ??
## [1.6.2] - 2026-04-13

### 靽桀儔 (Fixed)
- **?單?銵?鞈?皞???(Real-time Price Provider Switch)**:
  - 敺孵?閫?捱 `1.6.1` 銝剖????訾漱?? (TWSE) ?鞈? (`STOCK_DAY_ALL`) ???憭批?憿?
    1. **銝?港?瑹蟡?*嚗??氬?鈭?6291)??銝??∠巨摰?⊥??湔?寞??    2. **?湔撱園**嚗???畾?TWSE API 隞?餈?銝??漱????寞嚗?銝剛??135.5??嚗??渡?交??唳?文?⊥????  - 撠?`Dashboard` 擐????交???蝞? `store.ts` ??`refreshHoldingPrices()` ?摩?券???箏??**IFalgo API**??  - ?曉蝟餌絞?舀銝???瑹撣?∠巨嚗蒂?賜?甇???唳?文?蝡???單??啣?對?靘?瘝漕 437?葉?舫 134.5????
## [1.6.1] - 2026-04-13

### 靽桀儔 (Fixed)
- **??曉?芸??郊 (Price Auto-Refresh)**:
  - 靽桀儔鈭蟡函?孵????格?????啁???嚗??游澈摮???蝯梯??豢??瑟????刻??豢???  - ?啣? `refreshHoldingPrices()` ?寞?嚗雿輻?脣擐? (Dashboard) ?澈摮? (Portfolio) ???芸?敺???鈭斗? (TWSE) API ???券????唳?文嚗蒂?寞活?湔 Supabase 鞈?摨怨? Zustand store ???  - 甇文?????Ｙ???嫘撟喳??蜇撣潦?隞?TWSE ??唳?文?箸?嚗Ⅱ靽絞閮??蝣箝?  - TWSE API ?澆?瑟? in-memory 敹怠?嚗?銝鈭斗??亙??甈?API嚗?銝蔣?踵??賬?


### ?啣????(Added & Changed)
- **??摮貊??葫撽芋蝯?(Learning Module)**:
  - 撖虫?摰??鞈?摮詨??嗆?嚗??恍???閬?(`LearnHome`)??蝡霈 (`LearnArticles`) ?玨蝔炎閬?(`LessonView`)??  - ?啣? Supabase 摮貊??賊?鞈?銵?(`supabase-learning-schema.sql`)??- **隞餃????萇頂蝯?(Rewards & Shop System)**:
  - ???嗆??酋蝡仿?蝡舀??蝡?隞餃????萇?瞈頂蝯晞?  - 摮拍咱蝡荔??啣?憿?皜瑼Ｚ? (`ChildRequestsView`)??摨?(`ShopView`) ?????(`WalletView`)??  - ?嗆?蝡荔?撖虫?敺遣蝡遙?祟?貊?曄??萄憿?皜??蝞∠????游???(`ParentRewardDashboard`?ParentRewardsSetup`?ParentRewardHistory` 蝑??)??  - ?啣? Supabase ??賊?鞈?銵?(`supabase-rewards-schema.sql`)??
## [1.5.2] - 2026-04-12

### ?啣????(Added & Changed)
- **AI ?砍隞晶靽格迤 (CORS Bypass)**:
  - 靽桀儔鈭?蝡舐汗?函?亙??OpenAI API ?潛? CORS ?餅?撠???閮剜?摮?????  - 撠?恍?頛臬?Ｘ?粹?蝟餌絞?隡箸??刻? Vercel Edge Serverless (Proxy) ?郊?潸絲嚗????汗?券??嗚?- **????＊蝷?(Dynamic Version)**:
  - 靽格迤鈭?蝡舫?撠暹?蝥＊蝷箄??′蝺函Ⅳ (1.4.0) ??憿??寧?? Vite ?冽????芸?撖怠銝血?甇?`package.json` ???啁??祈???
## [1.5.1] - 2026-04-12

### ?啣????(Added & Changed)
- **?蝐Ⅳ??閬死??*: ?典閰喟敦??之鈭箏眺?典鋆～?憛?敺??祉????孵????箏???閬箏??璇?嚗隞亦?典?潸?憭???靽～????脰?摰???閬箏?雿?頛?- **撣唾?閮剖?隞?芸?**: 霈蝔曹耨?寧???頛詨獢?瑞?擃???獢暺?蝷綽?銝????祉???嚗????臬董???暹炎閬?漱??蝥祥??甈?嚗?靘炎閬瘜耨?對???
## [1.5.0] - 2026-04-12

### ?啣????(Added & Changed)
- **AI ?砍隞晶 (ChatGPT Integration)**:
  - 撠 OpenAI `gpt-4o-mini` 璅∪?嚗?撠?銝瑼蟡其誑?咱????瘞??????蝝嫘?  - ?啣? Supabase `stock_profiles` 敹怠?銵剁?蝣箔???瑼蟡典?澆銝甈?API 隞亦????研?  - 撖虫? SSE (Server-Sent Events) **銝脫??????**嚗????仿漲?蝙?刻?撽?- **UI/UX ?芸?**:
  - 蝞∠?敺?銵冽?曉?質?蝞蒂憿舐內?撟喳???銝血??亙??寧??郊???  - ?仿?/?粹?鈭斗??函????格???撅祉?憿????閮?  - 蝘駁擐??? Logo嚗絞銝?剖?蝮桀?瘥???  - 敺??澈摮??Ｙ宏?扎??蝙?券脣漲璇?雿輸??Ｘ蝪⊥???
## [1.4.0] - 2026-04-12

### ?啣????(Added & Changed)
- **撣唾???蝟餌絞 (Tier System)**:
  - ?冽銝?甈??嗆?嚗恣? (Admin)??鞎餌??(Free)??鞎餅???(Premium)??  - 鞈?摨急憓?`tier`?is_admin`?subscription_expires_at` 甈???`feature_overrides` ???銵具?  - 摰嗅滬?寞?蝜潭嚗蜓撣唾??? Premium 敺?摨???撣唾??芸?鈭急?隞祥???- **蝞∠??∪???(`/admin`)**:
  - 蝟餌絞蝮質汗嚗蜇?冽?詻ree/Premium ??嚗?  - ?冽蝞∠??”嚗?撠?蝝????矽?湧?憿?文董??  - ????Ｘ嚗???批瘥董???I ?唳??貉???澈摮?AI 撱箄降????  - Premium ??敶?嚗??30/90/365 憭拇?瘞訾?閮??- **隞祥??(Paywall)**:
  - Free ?冽?嚗撣唾? ??2 ??????5 瑼??乩漱????10 甈～?  - 撱??璈怠? (AdBanner)嚗ree ?冽?券????Ｙ揣???啣?蝝?蝷箝?  - AI ?唳??貉?∠?嚗ree ?冽憿舐內????閬???- **閮?嗅蝷遣閮?*:
  - ?? `subscription_expires_at` ?唳??交?敹蛛??箸靘?Google Play 銝????
## [1.3.0] - 2026-04-12

### ?啣????(Added & Changed)
- **鈭斗?蝑? (Trade Journal)**:
  - 鞎瑁都??撘瑕頛詨鈭斗?閮?嚗?其??桀?敹?憛怠神??鞈?閮??迄 PPBear ?箔?暻潭鞎?鞈????擗?銝?銵???憟賜????  - ?啣? `/history` 撠惇鈭斗?蝝???ｇ?銝血??撠??賬?  - 憭?飛鞈??游?嚗鈭斗?甇瑕?∠?銝哨?????銵?????銝?菔歲頧?Yahoo 憟?∪????嗆?瘙箇???- **UI/UX ?典??蝑?貉**:
  - ?Ｙ揣? (Explore) ?∠??身閮?????璆剜?蝐歹????箏?撘萸?∠??仿?∪??蝛拍帘憭批?詻?餈?撘瑯??湔釣?I嚗?銝血祕雿?擃閮抒? Mock Data 撅內隞亥圾瘙箏???API ??????  - Dashboard ??芸?嚗宏?支??梢??∠巨??餈漱??憛?銝血??瑕??矽?渡??∠巨??摨怠???恣?漱????雿輻??Ｘ??潭??∠蜇閬賬?  - ?啁霅漱? (TWSE) 畾???擐??單?閰衣??????隡啁??拍蜇憿?  - ?脣蔗?摩?冽?典??蝯曹?隞?箝竟?Ｖ漁蝝?鞈鈭桃???蝚血??啗???渲死??
## [1.2.0] - 2026-04-12
- **?餃??霅?(Auth & Login)**:
  - ?芸??餃?嚗? Supabase ?蝙?刻??澈摮漱????箝像銵閰?(Promise.all)??閫?捱霈??銋?具?乩葉...??????  - 靽桀儔敹?撖Ⅳ瘚?嚗暺?撖Ⅳ?身靽∩辣敺?蝣箔?蝟餌絞甇?Ⅱ撠??喋撓?交撖Ⅳ??ｇ??踹??芸??餃銝西歲頧????航炊敺芰??- **鈭斗?擃? (Trading UX)**:
  - ?函???敶?嚗漱????嚗???鞎瑁都銵典??憭梧?摰?踵??箇蝡??嗥?????ｇ?敺孵??脫迫雿輻??頠??暺??Ⅱ隤眺??鞈???  - 靽桀儔?⊥?鞎瑁都??Bug嚗???鞈?IFalgo 甇瑕 K 蝺?血??湛??嫣誑雿輻???啁??祕?恍?寞蝯?嚗Ⅱ靽?蝔格?瘜??質?銝??- **?臬董??蝞∠? (Child View)**:
  - ?臬董??????箏撣唾??摨撠汗???????霈????賢??之鈭箔?璅?炎閬撌梢??餅????唾??敦嚗蒂蝘駁鈭祟?豢?????- **蝟餌絞蝛拙???*:
  - ?券璉銝帘摰??祥隞???? (`corsproxy.io`)嚗??Vite ?批遣 ?隞????Vercel 閬?嚗圾瘙?API ???啗?寥＊蝷箇 0 ????  - ?湔迤?湔?亥?嚗宏?日????格? LocalStorage ?膩嚗?皜?頂蝯望??瓷????撌脣?Ｖ?? Supabase??
## [1.1.0] - 2026-04-12

### ?啣????(Added & Changed)
- **甇???啣??蝵?*:
  - ?啣? `vercel.json` 靽桀儔 React Router ??Vercel SPA 璅∪?銝??唳??404 ??憿?- **雿輻??撽?(UX)**:
  - 閮餃?瘚?嚗??Supabase Email 撽?瘚?嚗?頝唾???寧???箏?蝣箄?閬? (Modal)?????渡閬箇?閮餃?撘???  - ?臬董?恣???典遣蝡撣唾??”?桐葉?啣??Ⅱ隤?蝣潦?雿??蝣潔??湔折?霅??＊蝷??梯?撖Ⅳ?????- **鞈??游???API**:
  - ?唳 **?啁霅鈭斗?? (TWSE) ?鞈?撟喳 API (STOCK_DAY_ALL)**??  - ?∠巨閰喟敦???Ｙ揣?”?曉??＊蝷箝WSE ?????交?文????雿??憭批???鞈??單??扼?  - 撖虫?敹怠?璈 (Cache) 皜?撠?TWSE API ??摨西?瘙?
## [1.0.0] - 2026-04-10
- **?箇??嗆?**:
  - Vite + React + TypeScript 撠?????  - 摰閮剛?蝟餌絞???◢??UI (CSS 霈)
  - 摨惜撠 (Bottom Navigation)
- **?詨??**:
  - `擐? (Dashboard)`: ??蜇鞈璁汗?翰??雿??∠巨??餈漱??  - `?Ｙ揣 (Explore)`: ?∠巨???璆剖?憿I 瘥?刻?”
  - `?∠巨閰單? (StockDetail)`: ?單??勗?PBear ?咱??隞晶??祇?? (P/E, P/B)??蝣潮???眺鞈?漱????  - `摨怠? (Portfolio)`: 蝮質??Ｙ絞閮?券???脣漲???∪?銵具風?脖漱????  - `摮貊? (Learn)`: 6 ??鞈??曄??箇?隤脩?
- **鞈?????*:
  - 銝脫 IFalgo API ???啗?單??勗?風?脫??  - 銝脫 IFalgo Simons API ??瘥?刻??鈭箸???  - 撱箇? AI ??撱箄降?摩嚗?靘???鞎琿脯??都?箏遣霅?  - ?券?游? **Supabase ?脩垢鞈?摨?* (PostgreSQL)嚗??其??單??啗??蝙?刻董?眺鞈?漱??(Trades)?澈摮?(Holdings) ???Ｚ???
