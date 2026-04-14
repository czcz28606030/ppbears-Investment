// PPBears Investment - 數據類型定義

export interface StockPrice {
  coid: string;
  mdate: string;
  open_d: string;
  high_d: string;
  low_d: string;
  close_d: string;
  volume: number;
  pe_ratio: string;
  pb_ratio: string;
  roia: string | null;
}

export interface StockData {
  coid: string;
  stkname: string;
  subindustry: string;
  status: string;
  prices: StockPrice[];
}

export interface SimonsItem {
  mdate: string;
  coid: string;
  stkname: string;
  close: string;
  strength: string;
  psr: number;
  subindustry: string | null;
  status: string | null;
  unusual: string;
  category: string;
  ret_w: string;
  ret_m: string;
  wtcost: string;
  fcost: string;
  tcost: string | null;
  dcost: string;
  gvi: number;
  tcr_today: string;
  fcr_today: string;
}

export type TradeType = 'buy' | 'sell' | 'deposit' | 'withdraw';
export type AccountRole = 'parent' | 'child';
export type AIAdvice = 'buy' | 'hold' | 'sell';
export type WithdrawalStatus = 'pending' | 'approved' | 'rejected';

export interface Trade {
  id: string;
  stockCode: string;
  stockName: string;
  tradeType: TradeType;
  quantity: number;
  price: number;
  totalAmount: number;
  reason?: string;
  profit?: number;
  timestamp: number;
}

export interface Holding {
  stockCode: string;
  stockName: string;
  totalShares: number;
  avgCost: number;
  currentPrice: number;
  industry?: string;
}

export interface UserAccount {
  id: string;
  email: string;
  displayName: string;
  avatar: string;
  role: AccountRole;
  tier: 'free' | 'premium';
  isAdmin: boolean;
  subscriptionExpiresAt?: string;
  availableBalance: number;  // 目前可用現金（無上限）
  initialBalance: number;    // 主帳號初始給予（參考用）
  brokerFeeRate: number;     // 交易手續費率 (e.g., 0.001425)
  brokerMinFee: number;      // 交易手續費低消 (e.g., 20)
  brokerTaxRate: number;     // 交易證交稅率 (e.g., 0.003)
  parentId?: string;
  newsletterStrategy?: string; // 電子報策略：'A'~'F' 或 null（使用 AI 選股）
}

export interface ChildAccount extends UserAccount {
  role: 'child';
}

export interface FeatureOverride {
  userId: string;
  featureKey: string;
  enabled: boolean;
}

export interface WithdrawalRequest {
  id: string;
  childId: string;
  childName?: string;
  childAvatar?: string;
  parentId: string;
  amount: number;
  reason?: string;
  status: WithdrawalStatus;
  reviewedAt?: string;
  createdAt: string;
}

export interface StockQuote {
  code: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  pe: number;
  pb: number;
  volume: number;
  industry: string;
  status: string;
  kidFriendlyDesc?: string;
}

export interface StockRecommendation extends SimonsItem {
  advice: AIAdvice;
  adviceText: string;
  kidAdvice: string;
  score: number;
}

export interface PortfolioSnapshot {
  date: string;
  totalValue: number;
  totalCost: number;
  profitLoss: number;
  profitLossPct: number;
  cashBalance: number;
}

export interface SystemSettings {
  free_max_child_accounts: number;
  free_max_holdings: number;
  free_max_daily_trades: number;
  newsletter_send_hour: number; // 電子報發送時段（台灣時間 0-23），預設 7
}

// ── Learning Module ──────────────────────────────────────

export type QuestionType = 'choice' | 'true_false_speed' | 'matching' | 'sorting' | 'scenario' | 'fill_blank';

export interface LessonQuestion {
  question_type: QuestionType;
  question_text: string;
  options?: string[];           // choice 題用
  correct_answer: number | boolean | string;
  explanation: string;
}

export interface LessonCard {
  type: string;
  title: string;
  body: string;
  image_key?: string;
}

export interface LessonData {
  lesson_id: string;
  stage: number;
  level: number;
  domain: 'basic' | 'technical' | 'chips' | 'psychology';
  title: string;
  summary: string;
  cards: LessonCard[];
  preset_questions: LessonQuestion[];
  ai_prompt_context: {
    topic: string;
    age_hint: string;
    vocabulary_level: string;
    metaphor_suggestions: string[];
  };
}

export interface LessonResult {
  questionsCorrect: number;
  questionsTotal: number;
  xpFromQuestions: number;
  timeSpentSeconds: number;
  score: number;
}

// ── Rewards Module ────────────────────────────────────────

export type RewardTriggerType =
  | 'daily_complete' | 'streak_7' | 'streak_30'
  | 'level_up' | 'stage_up' | 'badge' | 'pet_evolution'
  | 'perfect_score' | 'custom';

export interface RewardRule {
  id: string;
  parentId: string;
  childId: string | null;    // null = 適用所有副帳號
  triggerType: RewardTriggerType;
  triggerLabel: string | null;
  amount: number;
  isActive: boolean;
  createdAt: string;
}

export type ShopItemType = 'cash' | 'product' | 'experience' | 'invest_bonus';

export interface RewardShopItem {
  id: string;
  parentId: string;
  name: string;
  description: string | null;
  icon: string | null;
  itemType: ShopItemType;
  costCoins: number;
  cashValue: number | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
}

export type RedemptionStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface RedemptionRequest {
  id: string;
  childId: string;
  parentId: string;
  shopItemId: string;
  itemName: string;
  costCoins: number;
  status: RedemptionStatus;
  parentNote: string | null;
  requestedAt: string;
  resolvedAt: string | null;
}

export type WalletTxType = 'earn' | 'redeem' | 'parent_grant' | 'refund' | 'freeze' | 'unfreeze';

export interface WalletTransaction {
  id: string;
  userId: string;
  amount: number;
  txType: WalletTxType;
  source: string | null;
  description: string | null;
  parentMessage: string | null;
  createdAt: string;
}
