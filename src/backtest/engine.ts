
// --- Types ---

export interface BacktestConfig {
  strategy: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'ai' | 'custom';
  startDate: string;       // YYYY-MM-DD
  endDate: string;
  initialCapital: number;  // Default 1,000,000
  maxPositions: number;    // Default 5
  positionSize: 'equal' | 'score_weighted'; 
  holdDays: number;        // Default 5 trading days
  stopLoss?: number;       // e.g., -7 for -7%
  takeProfit?: number;     // e.g., 15 for 15%
  brokerFeeRate: number;   // e.g., 0.001425
  brokerTaxRate: number;   // e.g., 0.003
}

export interface BacktestTrade {
  id: string;
  coid: string;
  stkname: string;
  in_date: string;
  buy_price: number;
  out_date: string;
  sell_price: number;
  quantity: number;
  total_cost: number;
  total_revenue: number;
  profit: number;
  return_pct: number;
  hold_days: number;
  reason: string;
  // Metadata for AI signals
  gvi_in?: number;
  gvi_out?: number;
}

export interface DailyEquity {
  date: string;
  cash: number;
  portfolio_value: number;
  total_equity: number;
}

export interface BacktestSummary {
  totalReturn: number;           // %
  annualizedReturn: number;      // %
  maxDrawdown: number;           // %
  sharpeRatio: number;           
  winRate: number;               // %
  totalTrades: number;           
  avgHoldDays: number;           
  profitFactor: number;          
  avgWinPct: number;             // %
  avgLossPct: number;            // %
  bestTrade: BacktestTrade | null;
  worstTrade: BacktestTrade | null;
}

export interface BacktestResult {
  config: BacktestConfig;
  trades: BacktestTrade[];
  dailyEquity: DailyEquity[];
  summary: BacktestSummary;
}

// --- Engine Core ---

/**
 * Deprecated signal simulation is deliberately retired. Existing database reports
 * remain untouched; they are historical legacy-source results, not weekly-trend-v1 performance.
 * A new simulation requires contemporaneously observed weekly membership and a
 * separately verified daily-price/execution timeline. Today's pool cannot be backfilled.
 */
export async function runAiSignalBacktest(_config: BacktestConfig): Promise<BacktestResult> {
  throw new Error('舊版訊號回測已停用。週榜趨勢回測需要各交易日當時已保存的週榜快照、完整官方日K與成交模擬；不能用目前週榜回填歷史，也不能把舊版績效當成新策略績效。既有歷史報告與資料保留。');
}
export function calculateSummary(trades: BacktestTrade[], initialCapital: number, finalCapital: number): BacktestSummary {
  if (trades.length === 0) {
    return {
      totalReturn: 0, annualizedReturn: 0, maxDrawdown: 0, sharpeRatio: 0,
      winRate: 0, totalTrades: 0, avgHoldDays: 0, profitFactor: 0,
      avgWinPct: 0, avgLossPct: 0, bestTrade: null, worstTrade: null
    };
  }

  let totalReturn = (finalCapital - initialCapital) / initialCapital;
  
  let wins = 0;
  let totalWinPct = 0;
  let totalLossPct = 0;
  let totalHoldDays = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  let bestTrade = trades[0];
  let worstTrade = trades[0];

  for (const t of trades) {
    if (t.profit > 0) {
      wins++;
      totalWinPct += t.return_pct;
      grossProfit += t.profit;
    } else {
      totalLossPct += t.return_pct;
      grossLoss += Math.abs(t.profit);
    }
    totalHoldDays += t.hold_days;
    
    if (t.return_pct > bestTrade.return_pct) bestTrade = t;
    if (t.return_pct < worstTrade.return_pct) worstTrade = t;
  }

  const winRate = wins / trades.length;
  const avgWinPct = wins > 0 ? totalWinPct / wins : 0;
  const avgLossPct = (trades.length - wins) > 0 ? totalLossPct / (trades.length - wins) : 0;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 999 : 0;
  const avgHoldDays = totalHoldDays / trades.length;

  return {
    totalReturn,
    annualizedReturn: totalReturn, // Simplified. Need to calculate actual years based on dates.
    maxDrawdown: 0, // Need daily equity to calculate properly
    sharpeRatio: 0, // Need daily returns
    winRate,
    totalTrades: trades.length,
    avgHoldDays,
    profitFactor,
    avgWinPct,
    avgLossPct,
    bestTrade,
    worstTrade
  };
}
