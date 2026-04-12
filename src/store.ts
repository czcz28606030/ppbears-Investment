import { create } from 'zustand';
import { supabase } from './supabase';
import type { Session } from '@supabase/supabase-js';
import type { UserAccount, Trade, Holding, WithdrawalRequest } from './types';

// ==========================================
// 輔助函式
// ==========================================
export function formatMoney(amount: number): string {
  if (Math.abs(amount) >= 10000) {
    return (amount / 10000).toFixed(1) + '萬';
  }
  return amount.toLocaleString('zh-TW', { maximumFractionDigits: 0 });
}

export function formatPrice(price: number): string {
  return price.toLocaleString('zh-TW', { minimumFractionDigits: 1, maximumFractionDigits: 2 });
}

export interface PortfolioSummary {
  totalMarketValue: number;
  totalCost: number;
  totalProfitLoss: number;
  profitLossPct: number;
  cashBalance: number;
  totalAssets: number;
}

// ==========================================
// Store 型別定義
// ==========================================
interface InvestmentStore {
  session: Session | null;
  user: UserAccount | null;
  children: UserAccount[];
  holdings: Holding[];
  trades: Trade[];
  withdrawalRequests: WithdrawalRequest[];
  loading: boolean;
  authLoading: boolean;

  // Auth
  initAuth: () => Promise<void>;
  registerParent: (email: string, password: string, displayName: string, avatar: string) => Promise<{ error: string | null; needsConfirmation?: boolean }>;
  login: (email: string, password: string) => Promise<{ error: string | null }>;
  logout: () => Promise<void>;
  sendPasswordResetEmail: (email: string) => Promise<{ error: string | null }>;
  updatePassword: (password: string) => Promise<{ error: string | null }>;
  isRecoveryMode: boolean;

  // Data
  loadUserData: (userId: string) => Promise<void>;

  // Parent Actions
  createChildAccount: (email: string, password: string, displayName: string, avatar: string, initialBalance: number) => Promise<{ error: string | null }>;
  setChildBalance: (childId: string, amount: number, mode: 'set' | 'add') => Promise<{ error: string | null }>;
  loadChildren: () => Promise<void>;
  loadWithdrawalRequests: () => Promise<void>;
  approveWithdrawal: (requestId: string) => Promise<{ error: string | null }>;
  rejectWithdrawal: (requestId: string) => Promise<{ error: string | null }>;

  // Child Actions
  requestWithdrawal: (amount: number, reason: string) => Promise<{ error: string | null }>;

  // Trading
  executeBuy: (stockCode: string, stockName: string, quantity: number, price: number, industry?: string) => Promise<{ success: boolean; message: string }>;
  executeSell: (stockCode: string, quantity: number, price: number) => Promise<{ success: boolean; message: string }>;

  // Profile
  updateProfile: (displayName: string, avatarUrl: string) => Promise<{ error: string | null }>;
  uploadAvatar: (file: File) => Promise<{ url: string | null; error: string | null }>;

  // Getters
  getPortfolioSummary: () => PortfolioSummary;
}

// DB Row → TypeScript
function rowToUser(row: Record<string, unknown>): UserAccount {
  return {
    id: row.id as string,
    email: row.email as string,
    displayName: row.display_name as string,
    avatar: row.avatar as string,
    role: row.role as 'parent' | 'child',
    availableBalance: Number(row.available_balance),
    initialBalance: Number(row.initial_balance),
    parentId: (row.parent_id as string) || undefined,
  };
}

// ==========================================
// Store 實作
// ==========================================
export const useStore = create<InvestmentStore>((set, get) => ({
  session: null,
  user: null,
  children: [],
  holdings: [],
  trades: [],
  withdrawalRequests: [],
  loading: false,
  authLoading: true,
  isRecoveryMode: false,

  // ─── Auth ─────────────────────────────────
  initAuth: async () => {
    if (!supabase) { set({ authLoading: false }); return; }

    const { data: { session } } = await supabase.auth.getSession();
    set({ session });

    if (session?.user) await get().loadUserData(session.user.id);
    set({ authLoading: false });

    supabase.auth.onAuthStateChange(async (event, newSession) => {
      set({ session: newSession });
      
      if (event === 'PASSWORD_RECOVERY') {
        set({ isRecoveryMode: true });
      }

      if (newSession?.user) {
        await get().loadUserData(newSession.user.id);
      } else {
        set({ user: null, children: [], holdings: [], trades: [], withdrawalRequests: [] });
      }
    });
  },

  registerParent: async (email, password, displayName, avatar) => {
    if (!supabase) return { error: '資料庫未連線' };
    try {
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) return { error: error.message };
      if (!data.user) return { error: '無法建立帳號' };

      const { error: insertError } = await supabase.from('users').insert([{
        id: data.user.id,
        email,
        display_name: displayName,
        avatar,
        role: 'parent',
        available_balance: 100000,
        initial_balance: 100000,
      }]);
      if (insertError) return { error: insertError.message };
      
      // Check if email confirmation is required (production)
      // data.session is null when Supabase requires email confirmation
      if (!data.session) {
        return { error: null, needsConfirmation: true };
      }
      
      // Auto-login flow (when email confirmation is disabled)
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        set({ session });
        await get().loadUserData(session.user.id);
      }
      
      return { error: null, needsConfirmation: false };
    } catch (e) { return { error: String(e) }; }
  },

  login: async (email, password) => {
    if (!supabase) return { error: '資料庫未連線' };
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return { error: error.message };
      return { error: null };
    } catch (e) { return { error: String(e) }; }
  },

  sendPasswordResetEmail: async (email) => {
    if (!supabase) return { error: '資料庫未連線' };
    try {
      // Local development will redirect back to localhost
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/update-password`,
      });
      if (error) return { error: error.message };
      return { error: null };
    } catch (e) { return { error: String(e) }; }
  },

  updatePassword: async (password) => {
    if (!supabase) return { error: '資料庫未連線' };
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) return { error: error.message };
      // 成功後解除恢復模式
      set({ isRecoveryMode: false });
      return { error: null };
    } catch (e) { return { error: String(e) }; }
  },

  logout: async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    set({ user: null, session: null, children: [], holdings: [], trades: [], withdrawalRequests: [] });
  },

  // ─── Data Loading ──────────────────────────
  loadUserData: async (userId) => {
    if (!supabase) return;
    set({ loading: true });

    const { data: userData } = await supabase.from('users').select('*').eq('id', userId).single();
    if (!userData) { set({ loading: false }); return; }

    const currentUser = rowToUser(userData);
    set({ user: currentUser });

    const { data: hData } = await supabase.from('holdings').select('*').eq('user_id', userId);
    const holdings: Holding[] = (hData || []).map(h => ({
      stockCode: h.stock_code, stockName: h.stock_name,
      totalShares: Number(h.total_shares), avgCost: Number(h.avg_cost),
      currentPrice: Number(h.current_price), industry: h.industry,
    }));

    const { data: tData } = await supabase.from('trades').select('*').eq('user_id', userId).order('timestamp', { ascending: false });
    const trades: Trade[] = (tData || []).map(t => ({
      id: t.id, stockCode: t.stock_code, stockName: t.stock_name,
      tradeType: t.trade_type as 'buy' | 'sell',
      quantity: Number(t.quantity), price: Number(t.price),
      totalAmount: Number(t.total_amount), timestamp: Number(t.timestamp),
    }));

    set({ holdings, trades, loading: false });

    if (currentUser.role === 'parent') {
      await get().loadChildren();
      await get().loadWithdrawalRequests();
    } else {
      await get().loadWithdrawalRequests();
    }
  },

  // ─── Parent Actions ────────────────────────
  loadChildren: async () => {
    if (!supabase) return;
    const { user } = get();
    if (!user || user.role !== 'parent') return;
    const { data } = await supabase.from('users').select('*').eq('parent_id', user.id);
    set({ children: (data || []).map(rowToUser) });
  },

  loadWithdrawalRequests: async () => {
    if (!supabase) return;
    const { user } = get();
    if (!user) return;
    const column = user.role === 'parent' ? 'parent_id' : 'child_id';
    const { data } = await supabase
      .from('withdrawal_requests')
      .select('*, child:child_id(display_name, avatar)')
      .eq(column, user.id)
      .order('created_at', { ascending: false });

    const requests: WithdrawalRequest[] = (data || []).map((r: Record<string, unknown>) => {
      const child = r.child as Record<string, unknown> | null;
      return {
        id: r.id as string,
        childId: r.child_id as string,
        childName: child?.display_name as string | undefined,
        childAvatar: child?.avatar as string | undefined,
        parentId: r.parent_id as string,
        amount: Number(r.amount),
        reason: r.reason as string | undefined,
        status: r.status as 'pending' | 'approved' | 'rejected',
        reviewedAt: r.reviewed_at as string | undefined,
        createdAt: r.created_at as string,
      };
    });
    set({ withdrawalRequests: requests });
  },

  createChildAccount: async (email, password, displayName, avatar, initialBalance) => {
    if (!supabase) return { error: '資料庫未連線' };
    const { user, children } = get();
    if (!user || user.role !== 'parent') return { error: '只有主帳號可以建立副帳號' };
    if (children.length >= 5) return { error: '最多只能建立 5 個副帳號' };

    try {
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) return { error: error.message };
      if (!data.user) return { error: '無法建立副帳號' };

      const { error: insertError } = await supabase.from('users').insert([{
        id: data.user.id, email, display_name: displayName, avatar,
        role: 'child', parent_id: user.id,
        available_balance: initialBalance,
        initial_balance: initialBalance,
      }]);
      if (insertError) return { error: insertError.message };

      await get().loadChildren();
      return { error: null };
    } catch (e) { return { error: String(e) }; }
  },

  // 主帳號可以直接設定或追加子帳號餘額（無上限限制）
  setChildBalance: async (childId, amount, mode) => {
    if (!supabase) return { error: '資料庫未連線' };
    const { user } = get();
    if (!user || user.role !== 'parent') return { error: '權限不足' };

    if (mode === 'set') {
      // 直接設定餘額
      const { error } = await supabase.from('users').update({
        available_balance: amount,
      }).eq('id', childId);
      if (error) return { error: error.message };
    } else {
      // 追加餘額
      const { data: child } = await supabase.from('users').select('available_balance').eq('id', childId).single();
      if (!child) return { error: '找不到此副帳號' };
      const { error } = await supabase.from('users').update({
        available_balance: Number(child.available_balance) + amount,
      }).eq('id', childId);
      if (error) return { error: error.message };
    }

    await get().loadChildren();
    return { error: null };
  },

  approveWithdrawal: async (requestId) => {
    if (!supabase) return { error: '資料庫未連線' };
    const { withdrawalRequests } = get();
    const req = withdrawalRequests.find(r => r.id === requestId);
    if (!req) return { error: '找不到此申請' };

    const { data: child } = await supabase.from('users').select('available_balance').eq('id', req.childId).single();
    if (!child) return { error: '找不到副帳號' };

    const oldBalance = Number(child.available_balance);
    if (oldBalance < req.amount) return { error: '副帳號餘額不足，無法出金' };

    // 只扣除可用餘額（永久減少，無上限概念）
    const { error: updateError } = await supabase.from('users').update({
      available_balance: oldBalance - req.amount,
    }).eq('id', req.childId);
    if (updateError) return { error: updateError.message };

    await supabase.from('withdrawal_requests').update({
      status: 'approved',
      reviewed_at: new Date().toISOString(),
    }).eq('id', requestId);

    await get().loadWithdrawalRequests();
    await get().loadChildren();
    return { error: null };
  },

  rejectWithdrawal: async (requestId) => {
    if (!supabase) return { error: '資料庫未連線' };
    await supabase.from('withdrawal_requests').update({
      status: 'rejected',
      reviewed_at: new Date().toISOString(),
    }).eq('id', requestId);
    await get().loadWithdrawalRequests();
    return { error: null };
  },

  // ─── Child Actions ─────────────────────────
  requestWithdrawal: async (amount, reason) => {
    if (!supabase) return { error: '資料庫未連線' };
    const { user } = get();
    if (!user || user.role !== 'child') return { error: '只有副帳號可以申請出金' };
    if (!user.parentId) return { error: '找不到主帳號' };
    if (amount <= 0) return { error: '申請金額必須大於 0' };
    if (amount > user.availableBalance) return { error: '申請金額超過可用餘額' };

    const { error } = await supabase.from('withdrawal_requests').insert([{
      child_id: user.id, parent_id: user.parentId,
      amount, reason: reason || null, status: 'pending',
    }]);
    if (error) return { error: error.message };
    await get().loadWithdrawalRequests();
    return { error: null };
  },

  // ─── Trading ───────────────────────────────
  executeBuy: async (stockCode, stockName, quantity, price, industry) => {
    const { user, holdings } = get();
    if (!user || !supabase) return { success: false, message: '尚未登入' };
    const totalCost = quantity * price;
    if (totalCost > user.availableBalance) return { success: false, message: '餘額不足！需要更多零用錢才能買喔 💰' };
    if (quantity <= 0) return { success: false, message: '至少要買 1 股喔！' };

    await supabase.from('users').update({ available_balance: user.availableBalance - totalCost }).eq('id', user.id);
    await supabase.from('trades').insert([{
      user_id: user.id, stock_code: stockCode, stock_name: stockName,
      trade_type: 'buy', quantity, price, total_amount: totalCost, timestamp: Date.now(),
    }]);

    const existing = holdings.find(h => h.stockCode === stockCode);
    if (existing) {
      const newShares = existing.totalShares + quantity;
      const newAvgCost = (existing.avgCost * existing.totalShares + totalCost) / newShares;
      await supabase.from('holdings').update({
        total_shares: newShares, avg_cost: newAvgCost, current_price: price,
        updated_at: new Date().toISOString(),
      }).eq('user_id', user.id).eq('stock_code', stockCode);
    } else {
      await supabase.from('holdings').insert([{
        user_id: user.id, stock_code: stockCode, stock_name: stockName,
        total_shares: quantity, avg_cost: price, current_price: price, industry: industry || '',
      }]);
    }
    await get().loadUserData(user.id);
    return { success: true, message: `成功買入 ${stockName} ${quantity} 股 🎉` };
  },

  executeSell: async (stockCode, quantity, price) => {
    const { user, holdings } = get();
    if (!user || !supabase) return { success: false, message: '尚未登入' };
    const holding = holdings.find(h => h.stockCode === stockCode);
    if (!holding) return { success: false, message: '你沒有持有這檔股票喔！' };
    if (quantity > holding.totalShares) return { success: false, message: `你只有 ${holding.totalShares} 股，不能賣超過喔！` };
    if (quantity <= 0) return { success: false, message: '至少要賣 1 股喔！' };

    const totalReceived = quantity * price;
    await supabase.from('users').update({ available_balance: user.availableBalance + totalReceived }).eq('id', user.id);
    await supabase.from('trades').insert([{
      user_id: user.id, stock_code: stockCode, stock_name: holding.stockName,
      trade_type: 'sell', quantity, price, total_amount: totalReceived, timestamp: Date.now(),
    }]);

    const remaining = holding.totalShares - quantity;
    if (remaining <= 0) {
      await supabase.from('holdings').delete().eq('user_id', user.id).eq('stock_code', stockCode);
    } else {
      await supabase.from('holdings').update({
        total_shares: remaining, current_price: price, updated_at: new Date().toISOString(),
      }).eq('user_id', user.id).eq('stock_code', stockCode);
    }

    await get().loadUserData(user.id);
    const profit = (price - holding.avgCost) * quantity;
    const emoji = profit >= 0 ? '📈' : '📉';
    return {
      success: true,
      message: `成功賣出 ${holding.stockName} ${quantity} 股 ${emoji}\n${profit >= 0 ? '賺了' : '虧了'} NT$${Math.abs(profit).toFixed(0)}`,
    };
  },

  // ─── Profile ───────────────────────────────
  updateProfile: async (displayName, avatarUrl) => {
    if (!supabase) return { error: '資料庫未連線' };
    const { user } = get();
    if (!user) return { error: '尚未登入' };

    const { error } = await supabase.from('users').update({
      display_name: displayName,
      avatar: avatarUrl,
    }).eq('id', user.id);

    if (error) return { error: error.message };
    set({ user: { ...user, displayName, avatar: avatarUrl } });
    return { error: null };
  },

  uploadAvatar: async (file) => {
    if (!supabase) return { url: null, error: '資料庫未連線' };
    const { user } = get();
    if (!user) return { url: null, error: '尚未登入' };

    const ext = file.name.split('.').pop();
    const path = `avatars/${user.id}.${ext}`;

    // 使用 base64 作為備選方案（Supabase Storage 需要額外設定）
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const base64 = e.target?.result as string;
        if (!base64) { resolve({ url: null, error: '讀取圖片失敗' }); return; }

        // 嘗試上傳到 Supabase Storage
        if (supabase) {
          const { error: uploadError } = await supabase.storage
            .from('avatars')
            .upload(path, file, { upsert: true });

          if (!uploadError) {
            const { data } = supabase.storage.from('avatars').getPublicUrl(path);
            resolve({ url: data.publicUrl, error: null });
            return;
          }
        }

        // Fallback：直接使用 base64 存在 DB
        resolve({ url: base64, error: null });
      };
      reader.readAsDataURL(file);
    });
  },

  getPortfolioSummary: () => {
    const { user, holdings } = get();
    if (!user) return { totalMarketValue: 0, totalCost: 0, totalProfitLoss: 0, profitLossPct: 0, cashBalance: 0, totalAssets: 0 };
    const totalMarketValue = holdings.reduce((s, h) => s + h.currentPrice * h.totalShares, 0);
    const totalCost = holdings.reduce((s, h) => s + h.avgCost * h.totalShares, 0);
    const totalProfitLoss = totalMarketValue - totalCost;
    const profitLossPct = totalCost > 0 ? (totalProfitLoss / totalCost) * 100 : 0;
    return { totalMarketValue, totalCost, totalProfitLoss, profitLossPct, cashBalance: user.availableBalance, totalAssets: user.availableBalance + totalMarketValue };
  },
}));

