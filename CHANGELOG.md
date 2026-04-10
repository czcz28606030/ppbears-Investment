# 更新日誌 (Changelog)

所有關於 PPBears Investment 的版本變更都會記錄在此檔案中。我們遵循 [語意化版本控制](https://semver.org/lang/zh-TW/) 的規範。

## [1.0.0] - 2026-04-10

### 新增 (Added)
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
  - 基於 LocalStorage 的本地資料庫，模擬買賣交易邏輯與損益計算
