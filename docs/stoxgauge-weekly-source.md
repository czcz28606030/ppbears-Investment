# StoxGauge 每週選股來源

探索股票頁使用 `/api/app-cache?type=weekly-top`，由後端讀取 StoxGauge `weekly-top` API，固定 `lookbackDays=10`。來源每週產生榜單；本站讀取最新公布快照，CDN 暫存一小時，手動重新抓取使用獨立 URL。報價仍由原有官方價格與盤中報價流程獨立更新。

## 部署設定

在 Vercel 專案的 Production / Preview 環境設定 `STOXGAUGE_ACCESS_TOKEN`，值為來源提供的 access token。不要使用 `VITE_` 前綴；不要把完整 API URL 或 token 寫入版本庫、前端或日誌。設定後重新部署才會生效。本機使用 Git 忽略的 `.env.local`。

## 資料語意

- 保留來源 `latest_rank` 的排序，顯示累積 AIT 值、前週排名與本週新入榜。
- `latest_rank` 空值的 `REMOVED` 股票不放進本週榜單。
- 分別顯示 `latest_week_end_date` 與 `data_updated_at`，後者不能當成榜單日期。
- 榜單超過 14 天顯示更新警示；不套用每日 IFAlgo 新鮮度判斷。
- API 不提供價格、報酬率、買賣訊號或 PSR／籌碼評分，因此不以這些舊欄位過濾、重排或生成建議。
- API 失敗時顯示錯誤及重試，不退回停止更新的 IFAlgo 推薦來源。
- 此切換範圍為探索／找股票；既有個股歷史、投資組合及電子報來源不在此變更範圍。

驗證：`npm run test:weekly-top`、`npm run build`；本機 GET `/api/app-cache?type=weekly-top` 可確認實際整合。
