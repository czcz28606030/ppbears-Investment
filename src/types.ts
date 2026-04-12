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

export type TradeType = 'buy' | 'sell';
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
  availableBalance: number;  // 目前可用現金（無上限）
  initialBalance: number;    // 主帳號初始給予（參考用）
  parentId?: string;
}

export interface ChildAccount extends UserAccount {
  role: 'child';
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
