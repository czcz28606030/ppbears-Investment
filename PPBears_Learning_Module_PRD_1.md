# 🐻 小熊學投資 — 遊戲化學習模組 PRD & 技術規格書
# PPBears Investment App — Gamified Learning Module

> **版本**: v1.1
> **日期**: 2026-04-13
> **用途**: 交付 AI 開發代理（Antigravity）作為完整開發指引
> **狀態**: Slice 1 開發中

---

## 🔧 v1.1 修訂：與現有系統對齊（此段覆蓋下方同名條目）

此段於 2026-04-13 依現有 codebase 實況修訂，以下規則**優先於**原 PRD 其他章節中的對應描述：

1. **`/learn` 路由衝突處理**
   現況：`src/pages/Learn.tsx` 已存在，為靜態「知識卡片」閱讀頁，已整合進底部導覽「📚 學習」。
   修訂：
   - 現有 `Learn.tsx` 重新命名為 `LearnArticles.tsx`，對應路由 `/learn/articles`，作為「知識專欄」保留。
   - `/learn` 改指向新的 `LearnHome.tsx`（遊戲化學習首頁）。
   - 底部導覽「📚 學習」tab 的 `to` 維持 `/learn`，不需動。

2. **Zustand store 不切 slice**
   現況：`src/store.ts` 為單一大型 store（單檔 ~820 行，非 slice 模式）。
   修訂：學習模組的 state 與 actions 直接**新增在現有 `InvestmentStore` interface 內**，欄位以 `learning` 前綴命名（如 `learningProfile`、`learningWallet`、`fetchLearningProfile`）。不建立獨立 `learningSlice`。

3. **主帳號頁面命名空間**
   修訂：沿用原 PRD 的 `/parent/rewards/*` 路徑。入口從 `ManageChildren` 頁面（或 `ProfileSettings`）新增一張卡片導向，不動既有 `/manage-children`、`/withdrawal-approval`。

4. **新頁面 CSS 檔案位置**
   現況：現有頁面平放於 `src/pages/*.tsx` + `src/pages/*.css`，不使用子資料夾。
   修訂：新的學習模組頁面一律平放於 `src/pages/`，檔名使用 `Learn` / `Parent` 前綴（例：`LearnHome.tsx`、`LearnLesson.tsx`、`ParentRewardDashboard.tsx`）。**不建立 `src/pages/learn/` 子資料夾**。課程 JSON 仍放 `src/data/lessons/`。

5. **AI API 的 CORS 處理**
   現況：專案已有 proxy 機制處理 OpenAI CORS 限制（見 commit `c3c61ce`）。
   修訂：Phase 2 串接 Claude API 時必須走同一個 proxy，**禁止瀏覽器直接打 Anthropic API**。

6. **台股漲跌色慣例延伸到學習模組**
   修訂：學習模組內所有「增加」類 UI（XP 增加、學習幣獲得、連勝加成、正確答案）一律使用 `--profit`（紅），所有「減少」類（扣幣、錯誤、飽足度下降）使用 `--loss-color`（綠），與現有 app 一致。

### Slice 切分（實際執行順序）
原 Phase 1 工作量過大，實際交付依下列 slice 逐步推進：
- **Slice 1（地基）**：4 張核心表（learning_profiles / lesson_progress / learning_wallet / wallet_transactions）+ store 擴充 + 路由調整 + LearnHome 骨架 + 1 堂示範課程 JSON ← ✅ **已完成**
- **Slice 2（學習流程）**：`LessonView` + 選擇題 + 是非急速題 + XP / 連續登入計算 ← ✅ **已完成**
- **Slice 3（獎勵地基）**：`reward_rules` / `reward_shop_items` / `redemption_requests` + 預設模板 ← ✅ **已完成**
- **Slice 4（父母端頁面）**：`/parent/rewards/*` ← ✅ **已完成**
- **Slice 5（課程量產）**：補到 50 堂 Lv.1–10 JSON ← ✅ **已完成**

---

## 📌 專案總覽

### 目標
在現有的 PPBears Investment（兒童投資模擬器）APP 中，新增一個「遊戲化學習模組」，讓 6–15 歲兒童及成人初學者透過每日 3–5 分鐘的微課程 + 互動答題，循序漸進學習台灣股票投資知識。

### 核心理念
- 像「多鄰國」一樣的等級制度（10 大階段 × 5 小等級 = 50 級）
- 寵物養成 + 圖鑑收藏（多種動物可解鎖進化）
- 預製核心課程 + AI 動態出題（混合型）
- 學習獎勵由父母（主帳號）完全自訂規則與兌換商品
- 學習模組與現有模擬投資功能獨立運作，獎勵金獨立計算

### 不做什麼（Scope Out）
- 不修改現有的模擬投資買賣功能
- 不修改現有的帳號系統（主帳號/副帳號架構不變）
- 不做社群排行榜（Phase 4 才做）
- 不做即時對戰（Phase 4 才做）

---

## 🛠️ 現有技術棧（必須沿用）

```
前端框架: React 19 + TypeScript + Vite
狀態管理: Zustand v5（store.ts 集中管理）
路由: React Router DOM v7
樣式: 純 Vanilla CSS（無 Tailwind）
      深度依賴 index.css 全域 CSS 變數
      如：--bg-card, --primary, --text-secondary, --profit, --loss-color
設計風格: 兒童友善、高飽和度可愛風、大量圓角(16px/24px)、毛玻璃白底卡片、Emoji 圖示
後端: Supabase / PostgreSQL + RLS（無獨立後端伺服器）
認證: Supabase Auth
API: 原生 fetch
部署: Vercel（CSR，vercel.json 處理 SPA 路由重寫）
台股規範: 賺錢紅色、賠錢綠色
```

### 開發規則
- 所有新頁面組件放在 `src/pages/learn/` 目錄下
- 所有新 CSS 檔案放在對應組件旁邊（如 `LearnHome.css`）
- 新增 CSS 變數寫入 `index.css`
- Zustand store 新增 `learningSlice` 管理學習相關狀態
- Supabase 新 Table 都要設定 RLS Policy
- 預製課程資料存為 JSON 檔在 `src/data/lessons/` 目錄

---

## ⭐ 模組一：等級制度

### 結構：10 大階段 × 5 小等級 = 50 級

| 階段 | 名稱 | 等級範圍 | 建議年齡 | 學習重點 | 解鎖內容 |
|------|------|---------|---------|---------|---------|
| 1 | 🌱 小種子 | Lv.1–5 | 6+ | 認識錢、存錢觀念、什麼是股票 | 初始寵物「小熊熊」 |
| 2 | 🌿 小芽苗 | Lv.6–10 | 7+ | 公司與商品、為什麼股票有價格 | 寵物配件商店 |
| 3 | 🌳 小樹苗 | Lv.11–15 | 8+ | 買賣股票流程、漲跌概念、K線入門 | 第二隻寵物「小狐狸」 |
| 4 | 🧭 探險家 | Lv.16–20 | 9+ | 基本面入門：營收、EPS、殖利率 | 情境模擬題型 |
| 5 | 💎 尋寶者 | Lv.21–25 | 10+ | 技術面入門：均線、成交量、型態 | 第三隻寵物「小龍」 |
| 6 | ♟️ 策略師 | Lv.26–30 | 11+ | 籌碼面：三大法人、融資融券 | 寵物進化系統 |
| 7 | 📊 分析師 | Lv.31–35 | 12+ | 投資心理學：貪婪恐懼、損失趨避 | 第四隻寵物「鳳凰」 |
| 8 | 🎯 操盤手 | Lv.36–40 | 13+ | 風險管理、資產配置、停損停利 | AI 對戰模擬 |
| 9 | 🏆 投資達人 | Lv.41–45 | 14+ | 產業分析、財報深讀、總經指標 | 傳說寵物「麒麟」 |
| 10 | 👑 大師 | Lv.46–50 | 15+ | 綜合實戰、策略回測、投資哲學 | 大師稱號 + 金色頭像框 |

### 升級公式
```
每答對 1 題 = +10 XP
連續答對加成 = ×1.5
每日首次學習 = +20 XP 額外獎勵
每小等級升級需 = 100 XP
```

### 年齡說明
年齡只是建議起點，所有使用者都從 Lv.1 開始，依自身速度推進。系統不會強制年齡限制。

---

## 📚 模組二：每日學習流程（3–5 分鐘）

### 流程步驟

```
步驟 1（30秒）：開場動畫
  → 寵物打招呼 + 今日主題預告
  → 例：「小熊熊說：今天來認識什麼是 EPS 吧！」

步驟 2（90秒）：微課程卡片
  → 3–5 張可左右滑動的卡片
  → 圖文並茂解說一個概念
  → 用生活化比喻（如：EPS 就像你的成績單平均分數）
  → 低等級用簡單詞彙，高等級漸進導入真實術語

步驟 3（60秒）：互動練習 ×2
  → 從 6 種題型中隨機抽 2 題
  → 答對：立即獲得 XP + 飼料，播放慶祝動畫
  → 答錯：可愛動畫提示正確答案 + 解說

步驟 4（30秒）：今日摘要
  → 一句話回顧今天學的概念
  → 顯示 XP 累積進度條
  → 明日課程預告

步驟 5（30秒）：餵養寵物
  → 用獲得的飼料餵寵物
  → 寵物做出可愛反應動畫
  → 飽足度影響寵物外觀
```

### 課程內容生成方式
- **核心教材（微課程卡片）**：100% 預製，以 JSON 格式存放，確保正確性
- **練習題目**：70% 由 Claude API 動態生成 + 30% 預製經典題庫
- **AI Prompt 範本**（Claude API 呼叫時使用）：

```json
{
  "system": "你是一位專門教小朋友投資知識的可愛老師。請根據以下條件出一道題目，回傳嚴格的 JSON 格式。語氣要親切可愛、用生活化比喻。",
  "user": "主題：{lesson_topic}，等級：Lv.{user_level}，題型：{question_type}，年齡層提示：{age_hint}，歷史弱點主題：{weak_topics}",
  "response_format": {
    "question_type": "choice | matching | sorting | scenario | fill_blank | true_false_speed",
    "question_text": "題目文字",
    "options": ["選項A", "選項B", "選項C", "選項D"],
    "correct_answer": "正確答案",
    "explanation": "答對/答錯時的解說文字",
    "difficulty": 1-5,
    "topic_tags": ["基本面", "EPS"]
  }
}
```

---

## 🧩 模組三：6 種互動題型

### 題型規格

#### 1. 選擇題（全年齡）
- 經典四選一
- 加入可愛插圖與情境包裝
- 範例：「小明的雞排店今年賺了 100 萬，去年賺了 80 萬，營收是？」A) 成長 B) 衰退 C) 持平 D) 不知道

#### 2. 配對題（Lv.6+）
- 左右兩欄概念連線配對
- 拖拉或點選方式連線
- 範例：把「本益比」「殖利率」「EPS」配對到正確的解釋

#### 3. 拖拉排序題（Lv.11+）
- 把步驟或數值拖拉到正確順序
- 支援手機拖拉手勢
- 範例：「把買股票的步驟排對：開戶 → 研究 → 下單 → 觀察」

#### 4. 情境模擬題（Lv.16+）
- 給一個真實投資情境，讓使用者做決策
- 每個選擇導向不同結果動畫
- 範例：「你持有的股票今天跌了 5%，新聞說是短期利空。你會？」
  - A) 馬上全賣 → 動畫顯示後續反彈
  - B) 觀察幾天 → 動畫顯示理性分析
  - C) 加碼買進 → 動畫顯示風險提醒

#### 5. 填空題（Lv.6+）
- 關鍵數字或術語填空
- 支援數字鍵盤或文字輸入
- 範例：「台股的漲跌幅限制是 ____% 」

#### 6. 是非急速題（全年齡）
- 限時 5 秒判斷對錯
- 快速左右滑動回答（左=錯、右=對）
- 連續答對有 combo 加成
- 範例：「股票跌了一定要趕快賣掉」→ ✕

---

## 🐾 模組四：寵物養成 + 圖鑑收藏系統

### 可解鎖寵物（5 隻）

| 寵物 | 解鎖條件 | 進化路線（4 階段） | 代表投資風格 |
|------|---------|------------------|------------|
| 🐻 小熊熊 | 初始 | 幼熊 → 小熊 → 棕熊 → 金熊大師 | 穩健型（價值投資） |
| 🦊 小狐狸 | Lv.11 | 幼狐 → 赤狐 → 銀狐 → 九尾仙狐 | 靈活型（技術分析） |
| 🐉 小龍 | Lv.21 | 龍蛋 → 幼龍 → 飛龍 → 神龍 | 勇敢型（成長投資） |
| 🦅 鳳凰 | Lv.31 | 小鳥 → 火鳥 → 鳳凰 → 不死鳥 | 堅韌型（逆勢投資） |
| 🦄 麒麟 | Lv.41 | 幼麒 → 瑞獸 → 麒麟 → 聖麒麟 | 傳說型（全方位大師） |

### 養成機制
```
飼料來源: 答題獲得（每答對 1 題 = +1 飼料）
飽足度: 0–100，每天自然下降 10 點
親密度: 每次餵養 +5，每日互動 +3
進化條件: 親密度達到門檻 + 對應等級達到要求
外觀變化: 飽足度 < 30 時寵物會顯示餓的表情
```

### 寵物商店（用學習幣購買裝飾品）

| 類別 | 商品範例 |
|------|---------|
| 帽子 | 學士帽、皇冠、頭盔、兔耳朵 |
| 衣服 | 西裝、披風、太空衣、和服 |
| 背景 | 辦公室、森林、太空站、交易所 |
| 特效 | 金幣雨、星星光環、彩虹尾巴 |

### 收藏圖鑑
- 所有寵物 + 裝飾品 + 進化階段都記錄在圖鑑中
- 圖鑑完成度是一種成就指標
- 集滿特定系列可獲得隱藏徽章

---

## 🏅 模組五：徽章與成就系統

### 徽章清單

**🔥 連續學習類**
| 徽章名 | 達成條件 |
|--------|---------|
| 三日打卡 | 連續 3 天學習 |
| 一週不間斷 | 連續 7 天 |
| 月度學霸 | 連續 30 天 |
| 百日達人 | 連續 100 天 |

**📚 知識達成類**
| 徽章名 | 達成條件 |
|--------|---------|
| 基本面新手 | 完成 10 堂基本面課 |
| 技術面學徒 | 完成 10 堂技術面課 |
| 心理學大師 | 完成所有心理學課 |
| 全科狀元 | 四大領域各完成 20 堂 |

**🎯 答題成就類**
| 徽章名 | 達成條件 |
|--------|---------|
| 完美一課 | 單堂全部答對 |
| 十連勝 | 連續 10 題答對 |
| 千題達人 | 累計答對 1000 題 |
| 急速王者 | 是非急速題連對 20 題 |

**🐾 養成成就類**
| 徽章名 | 達成條件 |
|--------|---------|
| 第一次進化 | 任一寵物進化 |
| 收藏家 | 解鎖 3 隻寵物 |
| 時尚大師 | 購買 10 件裝飾 |
| 滿級傳說 | 任一寵物進化到最終型態 |

---

## 💰 模組六：獎勵系統（主帳號設定 × 副帳號申請）

### 核心原則
```
1. 學習幣與新台幣 1:1
2. 所有發幣規則由主帳號（父母）設定
3. 所有兌換需主帳號核可
4. 獎勵金 100% 獨立於投資績效，不影響報酬率
5. 獎勵可以是：現金、實體商品、體驗活動、模擬投資加碼金
6. 現有的「額度管理/出金」功能不受影響
```

### 三方流程

```
【主帳號（父母）】
  1. 設定發幣規則（選預設模板 或 完全自訂）
  2. 設定獎勵商城（新增可兌換的商品/現金/體驗）
  3. 收到兌換申請（APP 推播通知）
  4. 審核：核可 → 系統自動扣幣 / 駁回 → 附留言

【系統（自動）】
  1. 偵測學習成就（完課/升級/連續登入/徽章）
  2. 依父母設定的規則自動發放學習幣
  3. 更新副帳號可兌換清單
  4. 所有異動寫入 log

【副帳號（小孩）】
  1. 完成每日學習 → 獲得學習幣
  2. 查看「我的學習錢包」餘額與紀錄
  3. 逛「獎勵商城」瀏覽父母設定的商品
  4. 提出兌換申請 → 等待父母核可
```

### 預設模板（三種方案，父母可微調每一條）

**🌱 輕鬆型（低獎勵）**
- 每日完課：+3 幣
- 連續 7 天：+10 幣
- 連續 30 天：+50 幣
- 升小等級：+5 幣
- 升大階段：+30 幣
- 獲得徽章：+8 幣
- 預估月發放：約 NT$ 150–250

**⚡ 標準型（建議預設）**
- 每日完課：+5 幣
- 連續 7 天：+20 幣
- 連續 30 天：+100 幣
- 升小等級：+10 幣
- 升大階段：+50 幣
- 獲得徽章：+15 幣
- 預估月發放：約 NT$ 300–500

**🔥 激勵型（高獎勵）**
- 每日完課：+10 幣
- 連續 7 天：+50 幣
- 連續 30 天：+200 幣
- 升小等級：+20 幣
- 升大階段：+100 幣
- 獲得徽章：+30 幣
- 預估月發放：約 NT$ 600–1,000

### 自訂規則
父母可以新增完全自訂的規則，例如：
- 「數學考試 90 分以上」→ +200 幣（手動觸發）
- 「幫忙做家事一次」→ +30 幣（手動觸發）
- 「生日快樂」→ +500 幣（手動觸發＋留言）

每條自訂規則包含：
```json
{
  "trigger_type": "custom",
  "trigger_label": "數學考 90 分以上",
  "amount": 200,
  "is_active": true
}
```

### 獎勵商城品項格式
父母新增商品時需填寫：
```json
{
  "name": "Switch 遊戲卡帶",
  "icon": "🎮",
  "item_type": "product",       // cash | product | experience | invest_bonus
  "cost_coins": 1500,
  "cash_value": null,            // 若為 cash/invest_bonus 才填，如 100（= NT$100）
  "description": "存到足夠的學習幣才能兌換",
  "is_active": true
}
```

item_type 說明：
- `cash`：兌換現金零用錢，小孩申請後父母給實際現金
- `product`：實體商品，如玩具、書包、遊戲
- `experience`：體驗活動，如全家吃大餐、去遊樂園
- `invest_bonus`：轉入模擬投資的可用現金（1:1）

### 兌換申請流程
```
副帳號操作：
  1. 在獎勵商城選擇商品
  2. 確認彈窗顯示：商品名 + 扣除幣數 + 剩餘幣數預覽
  3. 送出申請（狀態 = pending）
  4. 幣數暫時凍結（不可重複使用）

主帳號操作：
  5. 收到推播通知
  6. 查看申請詳情
  7a. 核可 → 系統扣除凍結幣數 → 狀態 = approved → 推播通知副帳號
  7b. 駁回 → 凍結幣數退回 → 狀態 = rejected → 可附留言 → 推播通知副帳號
```

---

## 📖 模組七：課程內容架構

### 四大知識領域

**📊 基本面**
- Lv.1–5：什麼是公司、為什麼公司要賣股票
- Lv.6–10：營收是什麼、毛利率的比喻
- Lv.11–15：EPS、本益比（用雞排店解釋）
- Lv.16–20：殖利率、ROE、自由現金流
- Lv.21+：財報三表入門、護城河概念

**📈 技術面**
- Lv.1–5：什麼是股價圖、紅綠代表什麼
- Lv.6–10：K 線長什麼樣（用蠟燭比喻）
- Lv.11–15：均線是什麼、黃金交叉死亡交叉
- Lv.16–20：成交量、支撐壓力
- Lv.21+：型態學入門、MACD、KD

**🏦 籌碼面**
- Lv.1–5：誰在買賣股票（散戶 vs 大戶）
- Lv.6–10：什麼是外資、投信、自營商
- Lv.11–15：三大法人買賣超
- Lv.16–20：融資融券、借券
- Lv.21+：主力進出、分點資料入門

**🧠 投資心理學**
- Lv.1–5：為什麼存錢很重要
- Lv.6–10：貪心 vs 害怕的故事
- Lv.11–15：損失趨避、從眾效應
- Lv.16–20：錨定效應、過度自信
- Lv.21+：行為經濟學、投資紀律養成

### 課程 JSON 資料格式
每堂課存為一個 JSON 物件，放在 `src/data/lessons/` 目錄：

```json
{
  "lesson_id": "L001",
  "stage": 1,
  "level": 1,
  "domain": "basic",
  "title": "什麼是錢？",
  "cards": [
    {
      "type": "text_image",
      "title": "錢的故事",
      "body": "很久以前，人們用東西換東西。我用我的雞蛋換你的蘋果...",
      "image_key": "lesson_001_card_01"
    },
    {
      "type": "text_image",
      "title": "現在的錢",
      "body": "後來大家發明了「錢」，讓交換變得更方便...",
      "image_key": "lesson_001_card_02"
    }
  ],
  "preset_questions": [
    {
      "question_type": "choice",
      "question_text": "為什麼人們要發明「錢」？",
      "options": ["讓交換更方便", "因為很漂亮", "因為很重", "因為很好吃"],
      "correct_answer": 0,
      "explanation": "對！錢讓我們不用一直帶著雞蛋到處跑 🐣"
    }
  ],
  "ai_prompt_context": {
    "topic": "貨幣的基本概念",
    "age_hint": "6-8歲",
    "vocabulary_level": "simple",
    "metaphor_suggestions": ["便利商店", "零用錢", "存錢筒"]
  }
}
```

---

## 🗄️ 模組八：Supabase 資料庫設計

### 新增 Tables

#### 1. `learning_profiles` — 學習進度主表
```sql
CREATE TABLE learning_profiles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id),
  current_level INT DEFAULT 1,
  current_stage INT DEFAULT 1,
  total_xp INT DEFAULT 0,
  streak_days INT DEFAULT 0,
  longest_streak INT DEFAULT 0,
  last_learn_date DATE,
  total_lessons_completed INT DEFAULT 0,
  total_questions_correct INT DEFAULT 0,
  total_questions_answered INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- RLS: 只能讀寫自己的資料，主帳號可讀取所屬副帳號
```

#### 2. `lesson_progress` — 課程完成紀錄
```sql
CREATE TABLE lesson_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  lesson_id VARCHAR NOT NULL,
  completed_at TIMESTAMPTZ DEFAULT now(),
  score INT,
  xp_earned INT,
  time_spent_seconds INT,
  questions_correct INT,
  questions_total INT
);

-- RLS: user_id = auth.uid() 可 INSERT/SELECT
```

#### 3. `question_history` — 答題紀錄（AI 出題用）
```sql
CREATE TABLE question_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  lesson_id VARCHAR,
  question_type VARCHAR NOT NULL,
  topic_tags JSONB,
  is_correct BOOLEAN NOT NULL,
  time_spent_seconds INT,
  answered_at TIMESTAMPTZ DEFAULT now()
);

-- RLS: user_id = auth.uid() 可 INSERT/SELECT
-- INDEX: (user_id, is_correct) 用於查詢弱點主題
```

#### 4. `user_pets` — 使用者擁有的寵物
```sql
CREATE TABLE user_pets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  pet_type VARCHAR NOT NULL,  -- bear, fox, dragon, phoenix, qilin
  evolution_stage INT DEFAULT 1,  -- 1-4
  fullness INT DEFAULT 100,  -- 0-100, 每日 -10
  intimacy INT DEFAULT 0,
  equipped_items JSONB DEFAULT '{}',
  is_active BOOLEAN DEFAULT false,  -- 當前顯示的寵物
  unlocked_at TIMESTAMPTZ DEFAULT now()
);

-- RLS: user_id = auth.uid()
```

#### 5. `user_badges` — 徽章獲得紀錄
```sql
CREATE TABLE user_badges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  badge_id VARCHAR NOT NULL,
  earned_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, badge_id)
);

-- RLS: user_id = auth.uid() 可 SELECT, INSERT 由 trigger 執行
```

#### 6. `user_collection` — 圖鑑收藏（裝飾品）
```sql
CREATE TABLE user_collection (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  item_id VARCHAR NOT NULL,
  item_type VARCHAR NOT NULL,  -- hat, clothes, background, effect
  purchased_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, item_id)
);

-- RLS: user_id = auth.uid()
```

#### 7. `reward_rules` — 主帳號設定的發幣規則
```sql
CREATE TABLE reward_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id UUID REFERENCES auth.users(id) NOT NULL,
  child_id UUID REFERENCES auth.users(id),  -- NULL = 適用所有副帳號
  trigger_type VARCHAR NOT NULL,
  -- 可選值: daily_complete, streak_7, streak_30, level_up, stage_up,
  --         badge, pet_evolution, perfect_score, custom
  trigger_label VARCHAR,  -- custom 類型時的自訂名稱
  amount INT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS: parent_id = auth.uid() 可 CRUD
```

#### 8. `reward_shop_items` — 主帳號設定的可兌換商品
```sql
CREATE TABLE reward_shop_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id UUID REFERENCES auth.users(id) NOT NULL,
  name VARCHAR NOT NULL,
  description TEXT,
  icon VARCHAR,  -- emoji 或圖片 URL
  item_type VARCHAR NOT NULL,  -- cash, product, experience, invest_bonus
  cost_coins INT NOT NULL,
  cash_value INT,  -- 若為 cash/invest_bonus，對應台幣金額
  is_active BOOLEAN DEFAULT true,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS: parent_id = auth.uid() 可 CRUD
-- RLS: 副帳號透過 parent-child 關聯可 SELECT
```

#### 9. `learning_wallet` — 副帳號的學習幣錢包
```sql
CREATE TABLE learning_wallet (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id),
  balance INT DEFAULT 0,
  frozen INT DEFAULT 0,  -- 已申請兌換但尚未核可的凍結金額
  total_earned INT DEFAULT 0,
  total_spent INT DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- RLS: user_id = auth.uid() 可 SELECT
-- UPDATE 只能由 database function / trigger 執行
```

#### 10. `wallet_transactions` — 學習幣異動紀錄
```sql
CREATE TABLE wallet_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  amount INT NOT NULL,  -- 正=獲得, 負=兌換
  tx_type VARCHAR NOT NULL,  -- earn, redeem, parent_grant, refund, freeze, unfreeze
  source VARCHAR,  -- 觸發來源（rule_id 或 redemption_id）
  description TEXT,  -- 顯示用文字
  parent_message TEXT,  -- 父母手動發放時的留言
  created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS: user_id = auth.uid() 可 SELECT
-- INSERT 只能由 database function 執行
```

#### 11. `redemption_requests` — 副帳號的兌換申請
```sql
CREATE TABLE redemption_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id UUID REFERENCES auth.users(id) NOT NULL,
  parent_id UUID REFERENCES auth.users(id) NOT NULL,
  shop_item_id UUID REFERENCES reward_shop_items(id) NOT NULL,
  cost_coins INT NOT NULL,  -- 申請時的幣價快照
  status VARCHAR DEFAULT 'pending',  -- pending, approved, rejected, cancelled
  parent_note TEXT,  -- 父母回覆留言
  requested_at TIMESTAMPTZ DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

-- RLS: child_id = auth.uid() 可 INSERT/SELECT
-- RLS: parent_id = auth.uid() 可 SELECT/UPDATE(status, parent_note, resolved_at)
```

### Supabase Database Functions（建議）

```sql
-- 1. 發放學習幣（自動觸發或手動）
CREATE OR REPLACE FUNCTION grant_learning_coins(
  p_user_id UUID,
  p_amount INT,
  p_tx_type VARCHAR,
  p_source VARCHAR,
  p_description TEXT,
  p_parent_message TEXT DEFAULT NULL
) RETURNS void AS $$
BEGIN
  UPDATE learning_wallet
  SET balance = balance + p_amount,
      total_earned = total_earned + p_amount,
      updated_at = now()
  WHERE user_id = p_user_id;

  INSERT INTO wallet_transactions (user_id, amount, tx_type, source, description, parent_message)
  VALUES (p_user_id, p_amount, p_tx_type, p_source, p_description, p_parent_message);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. 處理兌換申請核可
CREATE OR REPLACE FUNCTION approve_redemption(
  p_request_id UUID,
  p_parent_note TEXT DEFAULT NULL
) RETURNS void AS $$
DECLARE
  v_request redemption_requests%ROWTYPE;
BEGIN
  SELECT * INTO v_request FROM redemption_requests WHERE id = p_request_id;

  UPDATE learning_wallet
  SET frozen = frozen - v_request.cost_coins,
      total_spent = total_spent + v_request.cost_coins,
      updated_at = now()
  WHERE user_id = v_request.child_id;

  UPDATE redemption_requests
  SET status = 'approved', parent_note = p_parent_note, resolved_at = now()
  WHERE id = p_request_id;

  INSERT INTO wallet_transactions (user_id, amount, tx_type, source, description)
  VALUES (v_request.child_id, -v_request.cost_coins, 'redeem', p_request_id::TEXT, '兌換：' || (SELECT name FROM reward_shop_items WHERE id = v_request.shop_item_id));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

---

## 📱 模組九：前端路由與頁面規劃

### 新增路由

**副帳號（小孩）頁面：**
```
/learn                    → LearnHome（學習首頁：今日課程入口 + 等級進度 + 寵物）
/learn/lesson/:lessonId   → LessonView（微課程卡片 + 答題）
/learn/pets               → PetView（寵物養成：餵養 + 裝扮）
/learn/pets/:petId        → PetDetail（單隻寵物詳情 + 進化）
/learn/collection         → CollectionView（圖鑑收藏）
/learn/badges             → BadgeView（徽章成就牆）
/learn/wallet             → WalletView（學習錢包：餘額 + 紀錄）
/learn/shop               → ShopView（獎勵商城：瀏覽 + 兌換）
/learn/requests           → RequestsView（我的兌換申請紀錄）
```

**主帳號（父母）頁面：**
```
/parent/rewards           → RewardDashboard（獎勵管理首頁：統計 + 待審核）
/parent/rewards/rules     → RewardRulesView（發幣規則設定：模板 + 自訂）
/parent/rewards/shop      → RewardShopManager（商城管理：新增/編輯/排序商品）
/parent/rewards/review    → RewardReviewView（兌換審核：核可/駁回）
/parent/rewards/grant     → RewardGrantView（手動發放學習幣）
/parent/rewards/history   → RewardHistoryView（所有異動紀錄 log）
```

### 整合到現有 APP
- 副帳號：在現有底部導航列新增「學習」tab（📚 icon）
- 主帳號：在現有管理頁面新增「獎勵管理」入口
- 推播通知：使用 Supabase Realtime 或 Web Push

### Zustand Store 新增

```typescript
// src/store.ts 新增 learningSlice

interface LearningState {
  // 學習進度
  profile: {
    currentLevel: number;
    currentStage: number;
    totalXp: number;
    streakDays: number;
    lastLearnDate: string | null;
  } | null;

  // 寵物
  pets: UserPet[];
  activePet: UserPet | null;

  // 徽章
  badges: string[];

  // 錢包
  wallet: {
    balance: number;
    frozen: number;
    totalEarned: number;
    totalSpent: number;
  } | null;

  // Actions
  fetchLearningProfile: () => Promise<void>;
  fetchPets: () => Promise<void>;
  fetchWallet: () => Promise<void>;
  addXp: (amount: number) => void;
  completeLession: (lessonId: string, score: number) => Promise<void>;
}
```

### 新增 CSS 變數（加入 index.css）
```css
:root {
  /* 學習模組專用色彩 */
  --learn-primary: #E17055;
  --learn-primary-light: #FFF5E6;
  --learn-secondary: #FDCB6E;
  --learn-xp: #6C5CE7;
  --learn-coin: #F0932B;
  --learn-success: #00B894;
  --learn-streak: #E17055;

  /* 等級階段色 */
  --stage-1: #A8E6CF;
  --stage-2: #88D8B0;
  --stage-3: #FFD3B6;
  --stage-4: #FFAAA5;
  --stage-5: #DCEDC1;
  --stage-6: #A8D8EA;
  --stage-7: #C3BEF7;
  --stage-8: #FFC8DD;
  --stage-9: #F9C74F;
  --stage-10: #F4A261;
}
```

---

## 🚀 模組十：MVP 分階段開發計畫

### Phase 1：核心學習體驗（4–6 週）

**必做功能：**
- [ ] 等級系統（10 階段 × 5 小級）+ XP 累積邏輯
- [ ] 每日學習流程（微課程卡片滑動 + 2 題練習）
- [ ] 選擇題 + 是非急速題（先做 2 種題型）
- [ ] 預製課程 Lv.1–10（約 50 堂 JSON 檔）
- [ ] 連續登入計算 + 基礎徽章（5 個）
- [ ] 學習獎勵金機制：
  - 主帳號選擇預設模板（三種）
  - 主帳號可微調每條規則金額
  - 系統自動發幣
  - 副帳號學習錢包（餘額 + 紀錄）
- [ ] Supabase 新 Tables + RLS Policies
- [ ] 學習入口整合到現有 APP 底部導航
- [ ] LearnHome + LessonView + WalletView 頁面

**Phase 1 不做：**
- 寵物系統（Phase 2）
- AI 出題（Phase 2）
- 配對題/填空題（Phase 2）
- 獎勵商城兌換商品（Phase 2）
- 拖拉排序題/情境模擬題（Phase 3）

### Phase 2：寵物 + AI + 商城（3–4 週）
- [ ] 寵物養成系統（小熊熊 + 飼料餵養 + 飽足度）
- [ ] Claude API 串接 AI 動態出題引擎
- [ ] 配對題 + 填空題（新增 2 種題型）
- [ ] 寵物商店 + 裝飾品系統
- [ ] 獎勵商城：
  - 主帳號新增可兌換商品
  - 副帳號瀏覽 + 提出兌換申請
  - 主帳號審核（核可/駁回）
  - 主帳號手動發放學習幣
- [ ] 預製課程 Lv.11–20（+50 堂）
- [ ] 更多徽章（累計 15 個）

### Phase 3：完整題型 + 多寵物（3–4 週）
- [ ] 拖拉排序題 + 情境模擬題
- [ ] 多寵物解鎖（狐狸、龍）
- [ ] 寵物進化系統
- [ ] 收藏圖鑑
- [ ] 預製課程 Lv.21–30（+50 堂）
- [ ] 家長學習報告頁面
- [ ] 主帳號自訂獎勵規則（完全自訂）

### Phase 4：社群 + 進階（持續迭代）
- [ ] 排行榜 + 好友 PK
- [ ] 預製課程 Lv.31–50（+100 堂）
- [ ] 鳳凰、麒麟等傳說寵物
- [ ] AI 對戰模擬（虛擬情境投資競賽）
- [ ] 家長儀表板進階版
- [ ] 社群功能

---

## 📝 附錄：給 AI 開發代理的注意事項

1. **沿用現有技術棧**：React 19 + TypeScript + Vanilla CSS + Zustand + Supabase，不要引入新框架
2. **CSS 變數優先**：所有顏色使用上方定義的 CSS 變數，不要 hardcode 色碼
3. **Supabase RLS 必設**：每張新 Table 都要寫 RLS Policy，特別注意主帳號/副帳號的權限區分
4. **漸進式開發**：嚴格按 Phase 1 → 2 → 3 → 4 順序開發，不要跳階
5. **課程 JSON**：Phase 1 需產出 50 堂課程 JSON 檔，內容要用台灣繁體中文、生活化比喻、適合兒童閱讀
6. **台股規範**：賺錢紅色、賠錢綠色，這是台灣股市慣例
7. **1:1 學習幣**：學習幣與新台幣 1:1，但不可直接出金，只能兌換父母設定的獎勵
8. **不修改現有功能**：模擬投資的買賣、出金、帳號系統等現有功能一律不動
9. **設計風格**：延續現有 APP 的兒童友善可愛風格，大圓角、毛玻璃卡片、Emoji 圖示
10. **部署**：繼續使用 Vercel，確保新路由在 vercel.json 中正確配置
