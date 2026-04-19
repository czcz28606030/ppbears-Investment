# 🐻 小熊學投資 — Phase 2 技術規格書
# PPBears Investment App — Phase 2: 寵物 + AI + 新題型 + 商城

> **版本**: v2.0
> **日期**: 2026-04-15
> **前置**: PPBears_Learning_Module_PRD_1.md（Phase 1 Slice 1–5 已完成）
> **用途**: 交付 AI 開發代理作為 Phase 2 完整開發指引

---

## 📌 Phase 2 總覽

### 完成前提（Phase 1 已交付）
- ✅ 4 張核心表 + RLS（learning_profiles / lesson_progress / learning_wallet / wallet_transactions）
- ✅ Zustand store 擴充（learningProfile / learningWallet / completeLesson）
- ✅ 路由調整（/learn, /learn/lesson/:id, /learn/articles, /learn/wallet）
- ✅ LearnHome + LessonView + LearnArticles + WalletView + ShopView 頁面
- ✅ 選擇題 + 是非急速題
- ✅ XP / 連續登入 / 自動發幣
- ✅ 獎勵系統（reward_rules / reward_shop_items / redemption_requests）
- ✅ 父母端 6 頁面（ParentRewardDashboard / Grant / History / Review / ShopManager / Setup）
- ✅ 50 堂 Lv.1–10 課程 JSON（L001–L050）

### Phase 2 交付目標
1. **寵物養成系統**（小熊熊 + 飼料餵養 + 飽足度 + 裝飾）
2. **AI 動態出題引擎**（Claude API 串接，走既有 proxy）
3. **新增 2 種題型**（配對題 + 填空題）
4. **獎勵商城完整流程**（兌換申請 + 審核 + 凍結/退回）
5. **課程擴充** Lv.11–20（L051–L100，+50 堂）
6. **更多徽章**（累計 15 個）

### Phase 2 Slice 切分

- **Slice 6（寵物地基）**：`user_pets` 表 + PetView 頁面 + 餵養邏輯 + 飽足度每日遞減
- **Slice 7（AI 出題）**：Vercel API Route `/api/generate-question` + Claude proxy + 前端整合
- **Slice 8（新題型）**：配對題 UI + 填空題 UI + LessonView 擴充
- **Slice 9（商城完整流程）**：兌換申請 → 凍結 → 審核 → 扣幣/退回完整鏈路
- **Slice 10（課程量產 2）**：L051–L100（Lv.11–20）+ 配對/填空題資料

---

## 🐾 Slice 6：寵物養成系統

### 6.1 資料庫

使用 PRD_1 模組八已定義的 `user_pets` 表結構，新增 Supabase migration：

```sql
-- 確認 user_pets 表已建立（若 Phase 1 未建，此處補建）
CREATE TABLE IF NOT EXISTS user_pets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  pet_type VARCHAR NOT NULL CHECK (pet_type IN ('bear', 'fox', 'dragon', 'phoenix', 'qilin')),
  pet_name VARCHAR DEFAULT NULL,   -- 使用者可自訂寵物名字
  evolution_stage INT DEFAULT 1 CHECK (evolution_stage BETWEEN 1 AND 4),
  fullness INT DEFAULT 100 CHECK (fullness BETWEEN 0 AND 100),
  intimacy INT DEFAULT 0 CHECK (intimacy >= 0),
  equipped_items JSONB DEFAULT '{}',
  is_active BOOLEAN DEFAULT false,
  unlocked_at TIMESTAMPTZ DEFAULT now(),
  last_fed_at TIMESTAMPTZ DEFAULT now()
);

-- RLS
ALTER TABLE user_pets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_own_pets" ON user_pets
  FOR ALL USING (user_id = auth.uid());
CREATE POLICY "parents_view_child_pets" ON user_pets
  FOR SELECT USING (
    user_id IN (SELECT id FROM users WHERE parent_id = auth.uid())
  );

-- 每日飽足度遞減 cron function（Supabase pg_cron 或 Vercel cron）
CREATE OR REPLACE FUNCTION decrease_pet_fullness()
RETURNS void AS $$
BEGIN
  UPDATE user_pets
  SET fullness = GREATEST(fullness - 10, 0)
  WHERE fullness > 0;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### 6.2 初始寵物發放邏輯

```
觸發時機：使用者首次進入 /learn（fetchLearningProfile 時）
條件：learning_profiles 存在 && user_pets 中無任何紀錄
動作：自動 INSERT 一隻 bear 寵物，is_active = true
```

### 6.3 寵物養成機制

| 屬性 | 初始值 | 變化規則 |
|------|--------|---------|
| fullness (飽足度) | 100 | 每日 -10（cron）；餵食 +20（最高 100）|
| intimacy (親密度) | 0 | 每次餵養 +5；每日首次互動 +3 |
| evolution_stage | 1 | 達到門檻時手動觸發進化 |

**進化門檻（小熊熊 bear）**：
| 階段 | 名稱 | 親密度要求 | 等級要求 |
|------|------|-----------|---------|
| 1 → 2 | 幼熊 → 小熊 | 50 | Lv.5 |
| 2 → 3 | 小熊 → 棕熊 | 150 | Lv.15 |
| 3 → 4 | 棕熊 → 金熊大師 | 300 | Lv.30 |

### 6.4 飼料系統

```
來源：答對 1 題 = +1 飼料（存在 learning_profiles 中新增欄位 feed_stock）
使用：餵養寵物 1 次 = -1 飼料，+20 飽足度，+5 親密度
每日最多餵養 5 次
```

**新增欄位**：
```sql
ALTER TABLE learning_profiles ADD COLUMN IF NOT EXISTS feed_stock INT DEFAULT 0;
```

### 6.5 前端頁面

#### PetView（/learn/pets）
```
頁面結構：
┌──────────────────────┐
│  🐻 小熊熊（我的寵物）  │  ← 寵物大圖 + 名字
│  ❤️ 飽足度 ████░░ 70%  │  ← 飽足度進度條
│  💕 親密度 156          │
│  🌟 進化：小熊（2/4）    │
│                        │
│  🍖 飼料×12            │
│  [餵食] [互動] [裝扮]   │  ← 三個操作按鈕
│                        │
│  ── 進化之路 ──         │
│  ✅ 幼熊 → ✅ 小熊      │
│  → ⬜ 棕熊 → ⬜ 金熊    │  ← 進化路線圖
└──────────────────────┘
```

**技術要點**：
- 寵物圖片使用 Emoji 組合 + CSS 動畫（不依賴外部圖片資源）
- 飽足度 < 30 時寵物表情切換為 😢
- 餵食按鈕需判斷飼料庫存 + 每日上限
- 進化按鈕在條件滿足時高亮顯示

#### Zustand Store 新增

```typescript
// 在 InvestmentStore interface 新增
learningPets: UserPet[];
learningActivePet: UserPet | null;
fetchLearningPets: () => Promise<void>;
feedPet: (petId: string) => Promise<void>;
evolvePet: (petId: string) => Promise<void>;
interactPet: (petId: string) => Promise<void>;
```

```typescript
interface UserPet {
  id: string;
  userId: string;
  petType: 'bear' | 'fox' | 'dragon' | 'phoenix' | 'qilin';
  petName: string | null;
  evolutionStage: number;  // 1-4
  fullness: number;         // 0-100
  intimacy: number;
  equippedItems: Record<string, string>;
  isActive: boolean;
  unlockedAt: string;
  lastFedAt: string;
}
```

### 6.6 LearnHome 整合

在 LearnHome 頁面新增「我的寵物」迷你卡片：
```
┌──────────────────┐
│ 🐻 小熊熊  ❤️ 70% │
│ [去看看 →]        │
└──────────────────┘
```
點擊導向 `/learn/pets`。

### 6.7 CSS 新增變數

```css
:root {
  --pet-bear: #8B6F47;
  --pet-fox: #E8753A;
  --pet-dragon: #6C5CE7;
  --pet-phoenix: #E84393;
  --pet-qilin: #F9CA24;
  --pet-fullness-high: #00B894;
  --pet-fullness-mid: #FDCB6E;
  --pet-fullness-low: #E17055;
}
```

---

## 🤖 Slice 7：AI 動態出題引擎

### 7.1 架構

```
前端 → Vercel API Route → Claude API（Anthropic）
       /api/generate-question.ts
```

**必須走 Vercel serverless function（proxy）**，禁止瀏覽器直接打 Anthropic API（參照 PRD_1 v1.1 第 5 條）。

### 7.2 API Route 規格

**檔案**：`api/generate-question.ts`

```typescript
// POST /api/generate-question
// Body:
interface GenerateQuestionRequest {
  lesson_id: string;
  question_type: 'choice' | 'true_false_speed' | 'matching' | 'fill_blank';
  user_level: number;
  age_hint: string;
  topic: string;
  vocabulary_level: string;
  metaphor_suggestions: string[];
  weak_topics?: string[];        // 從 question_history 統計出的弱點
  exclude_questions?: string[];  // 避免重複出同一題（傳已答過的 question_text）
}

// Response:
interface GenerateQuestionResponse {
  question_type: string;
  question_text: string;
  options?: string[];
  correct_answer: number | boolean | string;
  explanation: string;
  difficulty: number;
  topic_tags: string[];
}
```

### 7.3 Claude API 呼叫

```typescript
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// System prompt
const SYSTEM_PROMPT = `你是一位專門教小朋友投資知識的可愛老師「小熊老師」。
請根據使用者提供的條件出一道題目。

回傳格式必須為嚴格的 JSON，不要加任何 markdown 標記或多餘文字。

規則：
1. 語氣要親切可愛，用適合年齡的詞彙
2. 生活化比喻，讓小朋友容易理解
3. 解說部分要以鼓勵性語氣撰寫
4. 低等級（Lv.1-10）用最簡單的詞彙，避免專業術語
5. 中等級（Lv.11-25）可逐步引入術語但要附帶解釋
6. 高等級（Lv.26+）可使用真實投資術語
7. 選項要有誘答力，不能一眼看出正確答案
8. 台股規範：賺錢=紅色，賠錢=綠色`;

// User prompt template
function buildUserPrompt(req: GenerateQuestionRequest): string {
  return `請出一道「${req.question_type}」題目。

主題：${req.topic}
使用者等級：Lv.${req.user_level}
年齡層提示：${req.age_hint}
詞彙難度：${req.vocabulary_level}
建議比喻素材：${req.metaphor_suggestions.join('、')}
${req.weak_topics?.length ? `使用者的弱點主題：${req.weak_topics.join('、')}` : ''}

回傳 JSON 格式：
{
  "question_type": "${req.question_type}",
  "question_text": "題目文字",
  ${req.question_type === 'choice' ? '"options": ["選項A", "選項B", "選項C", "選項D"],' : ''}
  ${req.question_type === 'matching' ? '"left_items": ["左欄1", "左欄2", "左欄3"], "right_items": ["右欄1", "右欄2", "右欄3"], "correct_pairs": [[0,2],[1,0],[2,1]],' : ''}
  ${req.question_type === 'fill_blank' ? '"blank_hint": "填空提示", "accept_answers": ["可接受答案1", "可接受答案2"],' : ''}
  "correct_answer": "正確答案",
  "explanation": "答對/答錯時的解說文字（加 emoji）",
  "difficulty": 1-5,
  "topic_tags": ["標籤1", "標籤2"]
}`;
}
```

### 7.4 呼叫頻率與 Fallback

```
策略：
1. 每堂課 2 題練習，其中 1 題用預製、1 題嘗試 AI 出題
2. AI 出題失敗時 fallback 到第 2 題預製題
3. 每個使用者每日最多 AI 出題 10 次（rate limit）
4. Claude API timeout: 8 秒，超時直接 fallback

前端實作：
1. LessonView 進入 quiz 階段時，同時 fetch AI 題目
2. 若 AI 回應成功，插入為第 2 題
3. 若 AI 回應失敗/超時，使用 preset_questions[1]
```

### 7.5 弱點追蹤

利用已存在的 `question_history` 表（PRD_1 模組八第 3 項）分析使用者弱點：

```sql
-- 查詢使用者最近 50 題的錯誤主題分布
SELECT
  jsonb_array_elements_text(topic_tags) AS tag,
  COUNT(*) FILTER (WHERE NOT is_correct) AS wrong_count,
  COUNT(*) AS total_count
FROM question_history
WHERE user_id = $1
ORDER BY answered_at DESC
LIMIT 50
GROUP BY tag
ORDER BY wrong_count DESC
LIMIT 3;
```

前端在 `completeLesson` 後把每題作答紀錄寫入 `question_history`。

### 7.6 環境變數

```env
# .env（已有 OpenAI，新增 Anthropic）
ANTHROPIC_API_KEY=sk-ant-...
```

Vercel 環境變數需在 dashboard 設定。

---

## 🧩 Slice 8：新增題型 — 配對題 + 填空題

### 8.1 配對題（matching）

**JSON 格式**：
```json
{
  "question_type": "matching",
  "question_text": "把左邊的投資術語和右邊的解釋配對起來！",
  "left_items": ["EPS", "本益比", "殖利率"],
  "right_items": [
    "每股賺多少錢",
    "股價除以每股盈餘",
    "股利除以股價"
  ],
  "correct_pairs": [[0, 0], [1, 1], [2, 2]],
  "correct_answer": "all_matched",
  "explanation": "🎉 全部配對正確！EPS = 每股盈餘，本益比 = P/E ratio，殖利率 = 股利報酬率。"
}
```

**UI 規格**：
```
┌─ 配對題 ─────────────────┐
│  把左邊和右邊配對起來！      │
│                           │
│  [EPS]        [股利÷股價]  │
│  [本益比]      [每股賺多少]  │
│  [殖利率]     [股價÷EPS]   │
│                           │
│  操作：點選左邊 → 點選右邊   │
│  配對成功：連線 + 變色       │
│  全部配完 → 顯示結果        │
└──────────────────────────┘
```

**技術要點**：
- 右欄順序隨機打亂（不和 left_items 對齊）
- 點選左項後高亮，再點右項完成配對
- 已配對的項目連線顯示（使用 CSS border/SVG line）
- 配錯時震動動畫，可重新選擇
- 計分：全對 = 正確，任一錯 = 錯誤

**Types 擴充**：
```typescript
// 在 LessonQuestion interface 新增可選欄位
export interface LessonQuestion {
  question_type: QuestionType;
  question_text: string;
  options?: string[];
  left_items?: string[];       // matching 用
  right_items?: string[];      // matching 用
  correct_pairs?: number[][];  // matching 用 [[leftIdx, rightIdx], ...]
  blank_hint?: string;         // fill_blank 用
  accept_answers?: string[];   // fill_blank 用
  correct_answer: number | boolean | string;
  explanation: string;
}
```

### 8.2 填空題（fill_blank）

**JSON 格式**：
```json
{
  "question_type": "fill_blank",
  "question_text": "台灣股票的漲跌幅限制是 ____％",
  "blank_hint": "一個數字",
  "accept_answers": ["10", "10%", "十"],
  "correct_answer": "10",
  "explanation": "答對了！🎯 台灣股票每天最多漲或跌 10%，這個規定叫做「漲跌幅限制」，是為了保護投資人。"
}
```

**UI 規格**：
```
┌─ 填空題 ─────────────────┐
│                           │
│  台灣股票的漲跌幅限制是      │
│  [  ____  ] ％             │
│                           │
│  💡 提示：一個數字           │
│                           │
│  [1] [2] [3] [4] [5]      │
│  [6] [7] [8] [9] [0]      │  ← 數字鍵盤
│  [⌫ 刪除]  [✅ 確認]       │
│                           │
└──────────────────────────┘
```

**技術要點**：
- 自動判斷輸入類型：純數字顯示數字鍵盤，文字顯示文字輸入框
- 比對時忽略全半形、空白、% 符號等
- `accept_answers` 陣列中任一命中即為正確
- 輸入框字數限制（依 accept_answers 最長項 + 2）

### 8.3 LessonView 擴充

在 `LessonView.tsx` 的 quiz 階段新增 matching / fill_blank 渲染分支：

```typescript
// 現有
switch (currentQuestion.question_type) {
  case 'choice':
    return <ChoiceQuestion ... />;
  case 'true_false_speed':
    return <TrueFalseSpeed ... />;
  // 新增
  case 'matching':
    return <MatchingQuestion ... />;
  case 'fill_blank':
    return <FillBlankQuestion ... />;
}
```

建議將各題型拆為獨立子組件放在 `src/components/questions/`：
```
src/components/questions/
  ChoiceQuestion.tsx
  TrueFalseSpeed.tsx
  MatchingQuestion.tsx
  FillBlankQuestion.tsx
```

---

## 🛒 Slice 9：獎勵商城完整流程

### 9.1 副帳號端 — ShopView 擴充

**現有 ShopView 需補齊的功能**：

```
完整流程：
1. 載入父母設定的 reward_shop_items（is_active = true）
2. 顯示商品卡片列表（icon + name + cost_coins + description）
3. 點擊商品 → 彈出確認 modal：
   - 商品名稱 / icon
   - 花費：XX 學習幣
   - 目前餘額：YY 學習幣
   - 兌換後餘額：(YY - XX) 學習幣
   - [取消] [確認兌換]
4. 確認後：
   a. 呼叫 RPC create_redemption_request(child_id, shop_item_id, cost_coins)
   b. RPC 內部：扣 balance + 加 frozen、插入 redemption_requests(status=pending)、插入 wallet_transactions(tx_type=freeze)
   c. 前端更新 wallet state
   d. 顯示「已送出申請，等待爸媽核可 🎉」
5. 餘額不足時按鈕 disabled + 顯示「還差 XX 幣」
```

### 9.2 副帳號端 — ChildRequestsView（/learn/requests）

**新頁面**：顯示自己的兌換申請歷史

```
┌─ 我的兌換紀錄 ─────────────┐
│                             │
│  🎮 Switch 遊戲卡帶          │
│  花費 1500 幣 · 4/12 申請    │
│  ⏳ 等待爸媽核可              │
│                             │
│  🍰 全家吃大餐               │
│  花費 500 幣 · 4/8 申請      │
│  ✅ 已核可（4/9）             │
│  💬 爸爸說：表現很棒！        │
│                             │
│  📚 新書一本                 │
│  花費 200 幣 · 4/5 申請      │
│  ❌ 已駁回（4/6）             │
│  💬 媽媽說：家裡已經有這本了   │
└────────────────────────────┘
```

### 9.3 Supabase RPC — 建立兌換申請

```sql
CREATE OR REPLACE FUNCTION create_redemption_request(
  p_child_id UUID,
  p_shop_item_id UUID,
  p_cost_coins INT
) RETURNS UUID AS $$
DECLARE
  v_parent_id UUID;
  v_balance INT;
  v_request_id UUID;
BEGIN
  -- 檢查餘額
  SELECT balance INTO v_balance FROM learning_wallet WHERE user_id = p_child_id;
  IF v_balance < p_cost_coins THEN
    RAISE EXCEPTION 'Insufficient balance';
  END IF;

  -- 取得父母 ID
  SELECT parent_id INTO v_parent_id FROM users WHERE id = p_child_id;
  IF v_parent_id IS NULL THEN
    RAISE EXCEPTION 'No parent found';
  END IF;

  -- 凍結幣數
  UPDATE learning_wallet
  SET balance = balance - p_cost_coins,
      frozen = frozen + p_cost_coins,
      updated_at = now()
  WHERE user_id = p_child_id;

  -- 插入申請
  INSERT INTO redemption_requests (child_id, parent_id, shop_item_id, cost_coins, status)
  VALUES (p_child_id, v_parent_id, p_shop_item_id, p_cost_coins, 'pending')
  RETURNING id INTO v_request_id;

  -- 紀錄交易
  INSERT INTO wallet_transactions (user_id, amount, tx_type, source, description)
  VALUES (p_child_id, -p_cost_coins, 'freeze', v_request_id::TEXT, '兌換申請凍結');

  RETURN v_request_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### 9.4 Supabase RPC — 駁回申請（退回凍結）

```sql
CREATE OR REPLACE FUNCTION reject_redemption(
  p_request_id UUID,
  p_parent_note TEXT DEFAULT NULL
) RETURNS void AS $$
DECLARE
  v_request redemption_requests%ROWTYPE;
BEGIN
  SELECT * INTO v_request FROM redemption_requests WHERE id = p_request_id;

  IF v_request.status != 'pending' THEN
    RAISE EXCEPTION 'Request is not pending';
  END IF;

  -- 退回凍結幣數
  UPDATE learning_wallet
  SET balance = balance + v_request.cost_coins,
      frozen = frozen - v_request.cost_coins,
      updated_at = now()
  WHERE user_id = v_request.child_id;

  -- 更新申請狀態
  UPDATE redemption_requests
  SET status = 'rejected', parent_note = p_parent_note, resolved_at = now()
  WHERE id = p_request_id;

  -- 紀錄交易（退回）
  INSERT INTO wallet_transactions (user_id, amount, tx_type, source, description)
  VALUES (v_request.child_id, v_request.cost_coins, 'unfreeze', p_request_id::TEXT, '兌換申請被駁回，退回幣數');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### 9.5 父母端 — ParentRewardReview 擴充

**現有頁面需確認的完整審核流程**：
```
1. 載入 pending 的 redemption_requests（WHERE parent_id = auth.uid() AND status = 'pending'）
2. 每筆申請顯示：小孩名稱 + 商品名 + 幣數 + 申請日期
3. [核可] 按鈕 → 呼叫 approve_redemption RPC
4. [駁回] 按鈕 → 輸入留言（可選）→ 呼叫 reject_redemption RPC
5. 操作完成後重新載入列表
```

---

## 📊 Phase 2 新增表彚整

| 表名 | Phase 1 已建 | Phase 2 新增/修改 |
|------|-------------|-----------------|
| user_pets | ❌ | ✅ 新建 |
| user_collection | ❌ | ✅ 新建 |
| question_history | ❌ | ✅ 新建（AI 弱點追蹤用） |
| learning_profiles | ✅ | 新增 `feed_stock` 欄位 |

---

## 🏅 Phase 2 徽章擴充

Phase 1 僅有基礎邏輯，Phase 2 正式啟用 `user_badges` 表並實作 15 個徽章。

### 徽章判定邏輯

建議實作為 Supabase Database Function，由 `completeLesson` 完成後呼叫：

```sql
CREATE OR REPLACE FUNCTION check_and_grant_badges(p_user_id UUID)
RETURNS TEXT[] AS $$
DECLARE
  v_profile learning_profiles%ROWTYPE;
  v_new_badges TEXT[] := '{}';
BEGIN
  SELECT * INTO v_profile FROM learning_profiles WHERE user_id = p_user_id;

  -- 連續學習類
  IF v_profile.streak_days >= 3 AND NOT EXISTS (
    SELECT 1 FROM user_badges WHERE user_id = p_user_id AND badge_id = 'streak_3'
  ) THEN
    INSERT INTO user_badges (user_id, badge_id) VALUES (p_user_id, 'streak_3');
    v_new_badges := array_append(v_new_badges, 'streak_3');
  END IF;

  IF v_profile.streak_days >= 7 AND NOT EXISTS (
    SELECT 1 FROM user_badges WHERE user_id = p_user_id AND badge_id = 'streak_7'
  ) THEN
    INSERT INTO user_badges (user_id, badge_id) VALUES (p_user_id, 'streak_7');
    v_new_badges := array_append(v_new_badges, 'streak_7');
  END IF;

  IF v_profile.streak_days >= 30 AND NOT EXISTS (
    SELECT 1 FROM user_badges WHERE user_id = p_user_id AND badge_id = 'streak_30'
  ) THEN
    INSERT INTO user_badges (user_id, badge_id) VALUES (p_user_id, 'streak_30');
    v_new_badges := array_append(v_new_badges, 'streak_30');
  END IF;

  -- 知識達成類
  IF v_profile.total_lessons_completed >= 10 AND NOT EXISTS (
    SELECT 1 FROM user_badges WHERE user_id = p_user_id AND badge_id = 'lessons_10'
  ) THEN
    INSERT INTO user_badges (user_id, badge_id) VALUES (p_user_id, 'lessons_10');
    v_new_badges := array_append(v_new_badges, 'lessons_10');
  END IF;

  -- 答題成就類
  IF v_profile.total_questions_correct >= 100 AND NOT EXISTS (
    SELECT 1 FROM user_badges WHERE user_id = p_user_id AND badge_id = 'correct_100'
  ) THEN
    INSERT INTO user_badges (user_id, badge_id) VALUES (p_user_id, 'correct_100');
    v_new_badges := array_append(v_new_badges, 'correct_100');
  END IF;

  IF v_profile.total_questions_correct >= 1000 AND NOT EXISTS (
    SELECT 1 FROM user_badges WHERE user_id = p_user_id AND badge_id = 'correct_1000'
  ) THEN
    INSERT INTO user_badges (user_id, badge_id) VALUES (p_user_id, 'correct_1000');
    v_new_badges := array_append(v_new_badges, 'correct_1000');
  END IF;

  RETURN v_new_badges;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### Phase 2 完整徽章清單（15 個）

| badge_id | 名稱 | Emoji | 條件 |
|----------|------|-------|------|
| streak_3 | 三日打卡 | 🔥 | 連續學習 3 天 |
| streak_7 | 一週不間斷 | 🔥🔥 | 連續學習 7 天 |
| streak_30 | 月度學霸 | 🔥🔥🔥 | 連續學習 30 天 |
| lessons_10 | 學習初心者 | 📖 | 完成 10 堂課 |
| lessons_25 | 知識探索家 | 📚 | 完成 25 堂課 |
| lessons_50 | 學問達人 | 🎓 | 完成 50 堂課 |
| correct_100 | 百題精通 | 🎯 | 累計答對 100 題 |
| correct_500 | 五百勇士 | ⚔️ | 累計答對 500 題 |
| correct_1000 | 千題達人 | 👑 | 累計答對 1000 題 |
| perfect_first | 完美一課 | ⭐ | 單堂全部答對 |
| level_10 | 小芽苗認證 | 🌿 | 達到 Lv.10 |
| level_20 | 小樹苗認證 | 🌳 | 達到 Lv.20 |
| first_pet | 寵物主人 | 🐾 | 擁有第一隻寵物 |
| first_feed | 愛心餵養 | 💕 | 第一次餵養寵物 |
| first_evolve | 進化達成 | ✨ | 任一寵物進化 |

---

## 📱 Phase 2 新增路由彚整

```
/learn/pets               → PetView（寵物養成首頁）
/learn/pets/:petId        → PetDetail（單隻寵物詳情 + 進化）← Phase 3 才需要（多寵物時）
/learn/collection         → CollectionView ← Phase 3
/learn/badges             → BadgeView（徽章成就牆）
/learn/requests           → ChildRequestsView（兌換申請紀錄）
```

Phase 2 僅實作：`/learn/pets`、`/learn/badges`、`/learn/requests`

---

## 📋 Phase 2 開發檢查清單

### Slice 6 — 寵物系統
- [ ] 建立 `user_pets` 表 + RLS
- [ ] learning_profiles 新增 `feed_stock` 欄位
- [ ] 首次進入自動發放 bear 寵物
- [ ] PetView 頁面（餵養 + 飽足度 + 親密度）
- [ ] 飼料系統（答對 +1 飼料，餵養 -1 飼料）
- [ ] 飽足度每日遞減 cron
- [ ] LearnHome 寵物迷你卡

### Slice 7 — AI 出題
- [ ] `/api/generate-question.ts` API Route
- [ ] Claude API 串接 + System Prompt
- [ ] 前端 LessonView 整合 AI 題目
- [ ] Fallback 機制（超時/錯誤 → 預製題）
- [ ] question_history 表建立 + 寫入
- [ ] 弱點分析查詢

### Slice 8 — 新題型
- [ ] MatchingQuestion 組件
- [ ] FillBlankQuestion 組件
- [ ] LessonView quiz 階段路由分支
- [ ] Types 擴充（left_items, right_items, blank_hint 等）

### Slice 9 — 商城完整流程
- [ ] create_redemption_request RPC
- [ ] reject_redemption RPC
- [ ] ShopView 兌換確認 modal
- [ ] ChildRequestsView 頁面
- [ ] ParentRewardReview 審核功能確認

### Slice 10 — 課程量產
- [ ] L051–L100 共 50 堂課程 JSON
- [ ] 部分課程含 matching / fill_blank 題型
- [ ] lessons/index.ts 更新
- [ ] 15 個徽章定義 + check_and_grant_badges RPC
- [ ] user_badges 表建立 + BadgeView 頁面

---

## 📝 附錄：給 AI 開發代理的 Phase 2 注意事項

1. **proxy 規則**：Claude API 必須走 Vercel API Route，和 OpenAI 一樣走 proxy
2. **寵物圖片**：Phase 2 先用 Emoji 組合（🐻💪✨）+ CSS 動畫，不引入外部圖片
3. **題型拆分**：將各題型抽為獨立 React 組件，放在 `src/components/questions/`
4. **RPC 安全**：所有資金相關操作（發幣、凍結、扣幣、退回）必須在 Supabase RPC 中完成，前端只呼叫不直接 UPDATE
5. **漸進增強**：配對題的拖拉操作 Phase 2 先做「點選配對」，Phase 3 再加入拖拉手勢
6. **徽章通知**：獲得新徽章時顯示 toast 動畫（5 秒自動消失），不阻斷學習流程
7. **Rate Limit**：AI 出題每使用者每日 10 次上限，寫在 API Route 中用 Supabase 計數
8. **Lv.11–20 課程**：需包含配對題和填空題，每堂至少 1 題新題型
9. **寵物進化條件**：Phase 2 先實作 bear 寵物的 4 階段進化，其他寵物 Phase 3
10. **台股色彩延伸**：寵物飽足度增加用 `--profit`（紅），減少用 `--loss-color`（綠）
