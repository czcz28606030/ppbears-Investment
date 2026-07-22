export type RealizedTradeInput = {
  tradeType: string;
  stockCode: string;
  totalAmount: unknown;
  profit?: unknown;
};

export type RealizedTradeStats = {
  realizedProfit: number;
  realizedCostBasis: number;
  realizedReturnPct: number | null;
  winCount: number;
  lossCount: number;
  winRatePct: number | null;
  stockCount: number;
  tradeCount: number;
};

function toFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function calculateRealizedTradeStats(trades: RealizedTradeInput[]): RealizedTradeStats {
  let realizedProfit = 0;
  let realizedCostBasis = 0;
  let winCount = 0;
  let lossCount = 0;
  let tradeCount = 0;
  const stockCodes = new Set<string>();

  trades.forEach(trade => {
    if (trade.tradeType !== 'buy' && trade.tradeType !== 'sell') return;

    tradeCount += 1;
    const stockCode = trade.stockCode.trim();
    if (stockCode) stockCodes.add(stockCode);
    if (trade.tradeType !== 'sell') return;

    const profit = toFiniteNumber(trade.profit);
    if (profit === null) return;

    realizedProfit += profit;
    if (profit > 0) winCount += 1;
    else if (profit < 0) lossCount += 1;

    const totalAmount = toFiniteNumber(trade.totalAmount);
    if (totalAmount === null) return;
    const costBasis = totalAmount - profit;
    if (Number.isFinite(costBasis) && costBasis > 0) realizedCostBasis += costBasis;
  });

  const decisiveSellCount = winCount + lossCount;
  return {
    realizedProfit,
    realizedCostBasis,
    realizedReturnPct: realizedCostBasis > 0 ? (realizedProfit / realizedCostBasis) * 100 : null,
    winCount,
    lossCount,
    winRatePct: decisiveSellCount > 0 ? (winCount / decisiveSellCount) * 100 : null,
    stockCount: stockCodes.size,
    tradeCount,
  };
}
