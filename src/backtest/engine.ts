import { supabase } from '../supabase';

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
 * Run Backtest based on AI Trading Signals (Layer 1)
 */
export async function runAiSignalBacktest(config: BacktestConfig): Promise<BacktestResult> {
  const { data: signals, error } = await supabase!
    .from('ai_trading_signals')
    .select('*')
    .gte('in_date', config.startDate)
    .lte('in_date', config.endDate)
    .not('return_pct', 'is', null)
    .eq('sell_sig', '出場') // 確保是有明確出場的完整交易
    .order('in_date', { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch AI signals: ${error.message}`);
  }

  const trades: BacktestTrade[] = [];
  let currentCash = config.initialCapital;
  
  // Very simplified simulation: Execute all signals sequentially for now
  // A realistic simulation would manage positions day-by-day to respect maxPositions and positionSize.
  // We'll refine this.

  // 1. Group signals by day
  const signalsByDate: Record<string, any[]> = {};
  for (const sig of signals || []) {
    if (!signalsByDate[sig.in_date]) {
      signalsByDate[sig.in_date] = [];
    }
    signalsByDate[sig.in_date].push(sig);
  }

  const allDates = Object.keys(signalsByDate).sort();
  // We need to keep track of active positions
  const activePositions: any[] = [];
  const dailyEquity: DailyEquity[] = [];
  
  let idCounter = 1;

  for (const _date of allDates) {
    // 1. Check if any active position should be sold today
    // (In reality, we sell on out_date. We need a timeline of all dates, not just in_dates)
  }

  // To do a proper timeline simulation, we should fetch all unique dates (in and out)
  const timelineDatesSet = new Set<string>();
  (signals || []).forEach(sig => {
    timelineDatesSet.add(sig.in_date);
    if (sig.out_date) timelineDatesSet.add(sig.out_date);
  });
  const timelineDates = Array.from(timelineDatesSet).sort();

  for (const date of timelineDates) {
    // Process Sells
    const sellsToday = activePositions.filter(p => p.sig.out_date === date);
    for (const pos of sellsToday) {
      // Calculate sell metrics
      const sellAmount = pos.quantity * pos.sig.sell_close;
      const fee = Math.floor(sellAmount * config.brokerFeeRate);
      const tax = Math.floor(sellAmount * config.brokerTaxRate);
      const netRevenue = sellAmount - fee - tax;
      const profit = netRevenue - pos.total_cost;
      
      currentCash += netRevenue;
      
      trades.push({
        id: `T${idCounter++}`,
        coid: pos.sig.coid,
        stkname: pos.sig.stkname,
        in_date: pos.sig.in_date,
        buy_price: pos.sig.buy_close,
        out_date: pos.sig.out_date,
        sell_price: pos.sig.sell_close,
        quantity: pos.quantity,
        total_cost: pos.total_cost,
        total_revenue: netRevenue,
        profit: profit,
        return_pct: (netRevenue - pos.total_cost) / pos.total_cost,
        hold_days: pos.sig.hold_days,
        reason: 'AI Signal: 出場',
        gvi_in: pos.sig.gvi_in,
        gvi_out: pos.sig.gvi_out
      });

      // Remove from active
      const idx = activePositions.indexOf(pos);
      if (idx > -1) activePositions.splice(idx, 1);
    }

    // Process Buys
    const buysToday = (signals || []).filter(sig => sig.in_date === date);
    
    // Sort buys (e.g., by GVI or randomly, if we have more than maxPositions)
    buysToday.sort((a, b) => (b.gvi_in || 0) - (a.gvi_in || 0));

    for (const sig of buysToday) {
      if (activePositions.length >= config.maxPositions) break;
      
      // Calculate allocation
      const availableCashForPos = currentCash / (config.maxPositions - activePositions.length);
      const targetAllocation = config.positionSize === 'equal' 
        ? Math.min(availableCashForPos, currentCash)
        : Math.min(availableCashForPos, currentCash); // Simplify for now
        
      if (targetAllocation < sig.buy_close * 1000) continue; // Not enough cash for 1 lot (assume 1000 shares/lot)
      
      const quantity = Math.floor(targetAllocation / (sig.buy_close * 1000)) * 1000;
      if (quantity <= 0) continue;

      const buyAmount = quantity * sig.buy_close;
      const fee = Math.floor(buyAmount * config.brokerFeeRate);
      const totalCost = buyAmount + fee;
      
      if (currentCash >= totalCost) {
        currentCash -= totalCost;
        activePositions.push({
          sig,
          quantity,
          total_cost: totalCost
        });
      }
    }

    // Calculate daily equity (approximate portfolio value using buy price if current price not available)
    let portfolioValue = 0;
    for (const pos of activePositions) {
      portfolioValue += pos.quantity * pos.sig.buy_close; // Approximated. Ideally we'd fetch daily prices.
    }
    
    dailyEquity.push({
      date,
      cash: currentCash,
      portfolio_value: portfolioValue,
      total_equity: currentCash + portfolioValue
    });
  }
  
  // Close out remaining positions at the end of the simulation
  const lastDate = timelineDates[timelineDates.length - 1] || config.endDate;
  for (const pos of activePositions) {
     const sellAmount = pos.quantity * pos.sig.buy_close; // use buy close as fallback
     const fee = Math.floor(sellAmount * config.brokerFeeRate);
     const tax = Math.floor(sellAmount * config.brokerTaxRate);
     const netRevenue = sellAmount - fee - tax;
     currentCash += netRevenue;
     // Note: we don't push to trades to avoid skewing stats with forced close
  }
  if (activePositions.length > 0) {
      dailyEquity.push({
          date: lastDate,
          cash: currentCash,
          portfolio_value: 0,
          total_equity: currentCash
      });
  }

  const summary = calculateSummary(trades, config.initialCapital, currentCash);

  return {
    config,
    trades,
    dailyEquity,
    summary
  };
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
