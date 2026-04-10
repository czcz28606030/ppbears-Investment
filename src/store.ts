// PPBears Investment - 本地資料存儲（模擬資料庫）
import type { UserAccount, Trade, Holding, PortfolioSnapshot } from './types';

const STORAGE_KEYS = {
  user: 'ppbears_user',
  trades: 'ppbears_trades',
  holdings: 'ppbears_holdings',
  snapshots: 'ppbears_snapshots',
};

// 預設小朋友帳號
const DEFAULT_USER: UserAccount = {
  id: 'child-001',
  name: '小小投資家',
  role: 'child',
  avatar: '🐻',
  totalBudget: 100000,
  availableBalance: 100000,
  parentId: 'parent-001',
};

function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveJSON<T>(key: string, data: T): void {
  localStorage.setItem(key, JSON.stringify(data));
}

// ---------- User ----------

export function getUser(): UserAccount {
  return loadJSON(STORAGE_KEYS.user, DEFAULT_USER);
}

export function saveUser(user: UserAccount): void {
  saveJSON(STORAGE_KEYS.user, user);
}

export function resetUser(): void {
  saveJSON(STORAGE_KEYS.user, DEFAULT_USER);
}

// ---------- Trades ----------

export function getTrades(): Trade[] {
  return loadJSON(STORAGE_KEYS.trades, []);
}

export function addTrade(trade: Trade): void {
  const trades = getTrades();
  trades.unshift(trade);
  saveJSON(STORAGE_KEYS.trades, trades);
}

// ---------- Holdings ----------

export function getHoldings(): Holding[] {
  return loadJSON(STORAGE_KEYS.holdings, []);
}

export function saveHoldings(holdings: Holding[]): void {
  saveJSON(STORAGE_KEYS.holdings, holdings);
}

export function updateHoldingPrice(code: string, price: number): void {
  const holdings = getHoldings();
  const h = holdings.find(h => h.stockCode === code);
  if (h) {
    h.currentPrice = price;
    saveHoldings(holdings);
  }
}

// ---------- Trading Logic ----------

export function executeBuy(
  stockCode: string,
  stockName: string,
  quantity: number,
  price: number,
  industry?: string
): { success: boolean; message: string } {
  const user = getUser();
  const totalCost = quantity * price;

  if (totalCost > user.availableBalance) {
    return { success: false, message: '餘額不足！需要更多零用錢才能買喔 💰' };
  }

  if (quantity <= 0) {
    return { success: false, message: '至少要買 1 股喔！' };
  }

  // 更新餘額
  user.availableBalance -= totalCost;
  saveUser(user);

  // 記錄交易
  const trade: Trade = {
    id: Date.now().toString(),
    stockCode,
    stockName,
    tradeType: 'buy',
    quantity,
    price,
    totalAmount: totalCost,
    timestamp: Date.now(),
  };
  addTrade(trade);

  // 更新持股
  const holdings = getHoldings();
  const existing = holdings.find(h => h.stockCode === stockCode);
  if (existing) {
    const totalShares = existing.totalShares + quantity;
    const totalCostBasis = existing.avgCost * existing.totalShares + price * quantity;
    existing.avgCost = totalCostBasis / totalShares;
    existing.totalShares = totalShares;
    existing.currentPrice = price;
  } else {
    holdings.push({
      stockCode,
      stockName,
      totalShares: quantity,
      avgCost: price,
      currentPrice: price,
      industry,
    });
  }
  saveHoldings(holdings);

  return { success: true, message: `成功買入 ${stockName} ${quantity} 股 🎉` };
}

export function executeSell(
  stockCode: string,
  quantity: number,
  price: number
): { success: boolean; message: string } {
  const holdings = getHoldings();
  const holding = holdings.find(h => h.stockCode === stockCode);

  if (!holding) {
    return { success: false, message: '你沒有持有這檔股票喔！' };
  }

  if (quantity > holding.totalShares) {
    return { success: false, message: `你只有 ${holding.totalShares} 股，不能賣超過喔！` };
  }

  if (quantity <= 0) {
    return { success: false, message: '至少要賣 1 股喔！' };
  }

  const totalReceived = quantity * price;

  // 更新餘額
  const user = getUser();
  user.availableBalance += totalReceived;
  saveUser(user);

  // 記錄交易
  const trade: Trade = {
    id: Date.now().toString(),
    stockCode,
    stockName: holding.stockName,
    tradeType: 'sell',
    quantity,
    price,
    totalAmount: totalReceived,
    timestamp: Date.now(),
  };
  addTrade(trade);

  // 更新持股
  holding.totalShares -= quantity;
  holding.currentPrice = price;
  if (holding.totalShares === 0) {
    const idx = holdings.indexOf(holding);
    holdings.splice(idx, 1);
  }
  saveHoldings(holdings);

  const profit = (price - holding.avgCost) * quantity;
  const emoji = profit >= 0 ? '📈' : '📉';
  return {
    success: true,
    message: `成功賣出 ${holding.stockName} ${quantity} 股 ${emoji}\n${profit >= 0 ? '賺了' : '虧了'} NT$${Math.abs(profit).toFixed(0)}`,
  };
}

// ---------- Portfolio ----------

export function getPortfolioSummary(): {
  totalMarketValue: number;
  totalCost: number;
  totalProfitLoss: number;
  profitLossPct: number;
  cashBalance: number;
  totalAssets: number;
} {
  const user = getUser();
  const holdings = getHoldings();

  const totalMarketValue = holdings.reduce((sum, h) => sum + h.currentPrice * h.totalShares, 0);
  const totalCost = holdings.reduce((sum, h) => sum + h.avgCost * h.totalShares, 0);
  const totalProfitLoss = totalMarketValue - totalCost;
  const profitLossPct = totalCost > 0 ? (totalProfitLoss / totalCost) * 100 : 0;

  return {
    totalMarketValue,
    totalCost,
    totalProfitLoss,
    profitLossPct,
    cashBalance: user.availableBalance,
    totalAssets: user.availableBalance + totalMarketValue,
  };
}

// ---------- Snapshots ----------

export function getSnapshots(): PortfolioSnapshot[] {
  return loadJSON(STORAGE_KEYS.snapshots, []);
}

export function saveDailySnapshot(): void {
  const today = new Date().toISOString().split('T')[0];
  const snapshots = getSnapshots();
  
  // 如果今天已經有快照就更新
  const existing = snapshots.find(s => s.date === today);
  const summary = getPortfolioSummary();
  
  const snapshot: PortfolioSnapshot = {
    date: today,
    totalValue: summary.totalAssets,
    totalCost: summary.totalCost,
    profitLoss: summary.totalProfitLoss,
    profitLossPct: summary.profitLossPct,
    cashBalance: summary.cashBalance,
  };

  if (existing) {
    Object.assign(existing, snapshot);
  } else {
    snapshots.push(snapshot);
  }

  saveJSON(STORAGE_KEYS.snapshots, snapshots);
}

// 格式化金額
export function formatMoney(amount: number): string {
  if (Math.abs(amount) >= 10000) {
    return (amount / 10000).toFixed(1) + '萬';
  }
  return amount.toLocaleString('zh-TW', { maximumFractionDigits: 0 });
}

export function formatPrice(price: number): string {
  return price.toLocaleString('zh-TW', { minimumFractionDigits: 1, maximumFractionDigits: 2 });
}
