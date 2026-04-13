import { create } from 'zustand';
import { supabase } from './supabase';
import type { Session } from '@supabase/supabase-js';
import type { UserAccount, Trade, Holding, WithdrawalRequest, FeatureOverride, SystemSettings, LessonResult, RewardRule, RewardTriggerType, WalletTransaction, RewardShopItem, RedemptionRequest } from './types';

// ==========================================
// 輔助函式
// ==========================================
export function formatMoney(amount: number): string {
  // 移除「萬」的概數格式，一律顯示精確數字，避免計算上產生混淆（例如 79423 顯示為 7.9萬）
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
export interface LearningProfile {
  currentLevel: number;
  currentStage: number;
  totalXp: number;
  streakDays: number;
  longestStreak: number;
  lastLearnDate: string | null;
  totalLessonsCompleted: number;
  totalQuestionsCorrect: number;
  totalQuestionsAnswered: number;
}

export interface LearningWallet {
  balance: number;
  frozen: number;
  totalEarned: number;
  totalSpent: number;
}

interface InvestmentStore {
  session: Session | null;
  user: UserAccount | null;
  children: UserAccount[];
  holdings: Holding[];
  trades: Trade[];
  withdrawalRequests: WithdrawalRequest[];
  featureOverrides: FeatureOverride[];
  systemSettings: SystemSettings;
  allUsers: UserAccount[];
  loading: boolean;
  authLoading: boolean;

  // Learning module (Slice 1–3)
  learningProfile: LearningProfile | null;
  learningWallet: LearningWallet | null;
  learningWalletTxs: WalletTransaction[];
  childrenTxLog: WalletTransaction[];
  rewardRules: RewardRule[];
  fetchLearningProfile: () => Promise<void>;
  fetchLearningWallet: () => Promise<void>;
  fetchWalletTransactions: () => Promise<void>;
  fetchChildrenTransactions: () => Promise<void>;
  completeLesson: (lessonId: string, result: LessonResult) => Promise<{ error: string | null; xpEarned: number; coinsEarned: number; levelUp: boolean; newStreak: number }>;
  // Reward rules (parent actions)
  fetchRewardRules: () => Promise<void>;
  applyRewardTemplate: (template: 'light' | 'standard' | 'intensive') => Promise<{ error: string | null }>;
  saveRewardRule: (rule: Omit<RewardRule, 'id' | 'parentId' | 'createdAt'>) => Promise<{ error: string | null }>;
  deleteRewardRule: (ruleId: string) => Promise<{ error: string | null }>;
  grantCoinsManually: (childId: string, amount: number, message: string) => Promise<{ error: string | null }>;
  // Shop items
  shopItems: RewardShopItem[];
  fetchShopItems: () => Promise<void>;
  saveShopItem: (item: Pick<RewardShopItem, 'name' | 'description' | 'icon' | 'itemType' | 'costCoins' | 'cashValue'>) => Promise<{ error: string | null }>;
  deleteShopItem: (itemId: string) => Promise<{ error: string | null }>;
  toggleShopItem: (itemId: string, isActive: boolean) => Promise<{ error: string | null }>;
  // Redemptions
  redemptions: RedemptionRequest[];
  fetchRedemptions: () => Promise<void>;
  requestRedemption: (shopItemId: string) => Promise<{ error: string | null }>;
  approveRedemption: (requestId: string, note: string) => Promise<{ error: string | null }>;
  rejectRedemption: (requestId: string, note: string) => Promise<{ error: string | null }>;

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

  // Children Management
  loadChildren: () => Promise<void>;
  createChildAccount: (email: string, password: string, displayName: string, avatar: string, initialBalance: number) => Promise<{ error: string | null; needsConfirmation?: boolean }>;
  setChildBalance: (childId: string, amount: number, mode: 'set' | 'add') => Promise<{ error: string | null }>;
  loadWithdrawalRequests: () => Promise<void>;
  approveWithdrawal: (requestId: string) => Promise<{ error: string | null }>;
  rejectWithdrawal: (requestId: string) => Promise<{ error: string | null }>;

  // Child Actions
  requestWithdrawal: (amount: number, reason: string) => Promise<{ error: string | null }>;

  // Trading
  executeBuy: (stockCode: string, stockName: string, quantity: number, price: number, industry?: string, reason?: string) => Promise<{ success: boolean; message: string }>;
  executeSell: (stockCode: string, quantity: number, price: number, reason?: string) => Promise<{ success: boolean; message: string }>;

  // Profile
  updateProfile: (displayName: string, avatarUrl: string) => Promise<{ error: string | null }>;
  uploadAvatar: (file: File) => Promise<{ url: string | null; error: string | null }>;
  updateBrokerSettings: (brokerFeeRate: number, brokerMinFee: number, brokerTaxRate: number) => Promise<{ error: string | null }>;

  // Admin Actions
  loadAllUsers: () => Promise<void>;
  adminSetUserTier: (userId: string, tier: 'free' | 'premium', expiresAt?: string) => Promise<{ error: string | null }>;
  adminDeleteUser: (userId: string) => Promise<{ error: string | null }>;
  adminSetUserBalance: (userId: string, amount: number) => Promise<{ error: string | null }>;
  adminSetUserRelation: (userId: string, role: 'parent' | 'child', parentId: string | null) => Promise<{ error: string | null }>;
  adminSetFeatureOverride: (userId: string, featureKey: string, enabled: boolean) => Promise<{ error: string | null }>;
  adminRemoveFeatureOverride: (userId: string, featureKey: string) => Promise<{ error: string | null }>;
  loadFeatureOverridesForUser: (userId: string) => Promise<FeatureOverride[]>;
  adminUpdateSetting: (key: keyof SystemSettings, value: number) => Promise<{ error: string | null }>;

  // Tier & Feature Helpers
  isPremiumUser: (targetUser?: UserAccount) => boolean;
  hasFeature: (featureKey: string) => boolean;
  getTodayTradeCount: () => number;

  // Getters
  getPortfolioSummary: () => PortfolioSummary;
}

// ── Learning / Reward 常數 ─────────────────────────────────

import type { RewardTriggerType as _RTT } from './types';

export const TRIGGER_LABELS: Record<_RTT, string> = {
  daily_complete: '每日完課',
  streak_7:       '連續 7 天',
  streak_30:      '連續 30 天',
  level_up:       '升小等級',
  stage_up:       '升大階段',
  badge:          '獲得徽章',
  pet_evolution:  '寵物進化',
  perfect_score:  '完美答題',
  custom:         '自訂',
};

export const REWARD_TEMPLATES = {
  light: {
    daily_complete: 3, streak_7: 10, streak_30: 50,
    level_up: 5, stage_up: 30, badge: 8, perfect_score: 5,
  },
  standard: {
    daily_complete: 5, streak_7: 20, streak_30: 100,
    level_up: 10, stage_up: 50, badge: 15, perfect_score: 10,
  },
  intensive: {
    daily_complete: 10, streak_7: 50, streak_30: 200,
    level_up: 20, stage_up: 100, badge: 30, perfect_score: 20,
  },
} as const satisfies Record<string, Partial<Record<_RTT, number>>>;

// DB Row → TypeScript
function rowToUser(row: Record<string, unknown>): UserAccount {
  return {
    id: row.id as string,
    email: row.email as string,
    displayName: row.display_name as string,
    avatar: row.avatar as string,
    role: row.role as 'parent' | 'child',
    tier: (row.tier as 'free' | 'premium') || 'free',
    isAdmin: Boolean(row.is_admin),
    subscriptionExpiresAt: (row.subscription_expires_at as string) || undefined,
    availableBalance: Number(row.available_balance),
    initialBalance: Number(row.initial_balance),
    brokerFeeRate: row.broker_fee_rate !== undefined ? Number(row.broker_fee_rate) : 0.001425,
    brokerMinFee: row.broker_min_fee !== undefined ? Number(row.broker_min_fee) : 20,
    brokerTaxRate: row.broker_tax_rate !== undefined ? Number(row.broker_tax_rate) : 0.003,
    parentId: (row.parent_id as string) || undefined,
  };
}

import type { RewardRule as _RR } from './types';

function rowToRewardRule(row: Record<string, unknown>): _RR {
  return {
    id:           row.id as string,
    parentId:     row.parent_id as string,
    childId:      (row.child_id as string) || null,
    triggerType:  row.trigger_type as _RTT,
    triggerLabel: (row.trigger_label as string) || null,
    amount:       Number(row.amount),
    isActive:     Boolean(row.is_active),
    createdAt:    row.created_at as string,
  };
}

import type { RewardShopItem as _RSI, RedemptionRequest as _RDQ } from './types';

function rowToShopItem(row: Record<string, unknown>): _RSI {
  return {
    id:          row.id as string,
    parentId:    row.parent_id as string,
    name:        row.name as string,
    description: (row.description as string) || null,
    icon:        (row.icon as string) || null,
    itemType:    row.item_type as _RSI['itemType'],
    costCoins:   Number(row.cost_coins),
    cashValue:   row.cash_value != null ? Number(row.cash_value) : null,
    isActive:    Boolean(row.is_active),
    sortOrder:   Number(row.sort_order),
    createdAt:   row.created_at as string,
  };
}

function rowToRedemption(row: Record<string, unknown>): _RDQ {
  return {
    id:           row.id as string,
    childId:      row.child_id as string,
    parentId:     row.parent_id as string,
    shopItemId:   row.shop_item_id as string,
    itemName:     row.item_name as string,
    costCoins:    Number(row.cost_coins),
    status:       row.status as _RDQ['status'],
    parentNote:   (row.parent_note as string) || null,
    requestedAt:  row.requested_at as string,
    resolvedAt:   (row.resolved_at as string) || null,
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
  featureOverrides: [],
  systemSettings: { free_max_child_accounts: 2, free_max_holdings: 5, free_max_daily_trades: 10 },
  allUsers: [],
  loading: false,
  authLoading: true,
  isRecoveryMode: false,

  // ─── Learning Module (Slice 1–3) ─────────
  learningProfile: null,
  learningWallet: null,
  learningWalletTxs: [],
  childrenTxLog: [],
  rewardRules: [],
  shopItems: [],
  redemptions: [],

  fetchLearningProfile: async () => {
    if (!supabase) return;
    const { user } = get();
    if (!user) return;

    const { data } = await supabase
      .from('learning_profiles')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();

    if (!data) {
      const { data: created } = await supabase
        .from('learning_profiles')
        .insert([{ user_id: user.id }])
        .select()
        .single();
      if (created) {
        set({
          learningProfile: {
            currentLevel: Number(created.current_level),
            currentStage: Number(created.current_stage),
            totalXp: Number(created.total_xp),
            streakDays: Number(created.streak_days),
            longestStreak: Number(created.longest_streak),
            lastLearnDate: (created.last_learn_date as string) || null,
            totalLessonsCompleted: Number(created.total_lessons_completed),
            totalQuestionsCorrect: Number(created.total_questions_correct),
            totalQuestionsAnswered: Number(created.total_questions_answered),
          },
        });
      }
      return;
    }

    set({
      learningProfile: {
        currentLevel: Number(data.current_level),
        currentStage: Number(data.current_stage),
        totalXp: Number(data.total_xp),
        streakDays: Number(data.streak_days),
        longestStreak: Number(data.longest_streak),
        lastLearnDate: (data.last_learn_date as string) || null,
        totalLessonsCompleted: Number(data.total_lessons_completed),
        totalQuestionsCorrect: Number(data.total_questions_correct),
        totalQuestionsAnswered: Number(data.total_questions_answered),
      },
    });
  },

  fetchLearningWallet: async () => {
    if (!supabase) return;
    const { user } = get();
    if (!user) return;

    const { data } = await supabase
      .from('learning_wallet')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();

    if (!data) {
      const { data: created } = await supabase
        .from('learning_wallet')
        .insert([{ user_id: user.id }])
        .select()
        .single();
      if (created) {
        set({
          learningWallet: {
            balance: Number(created.balance),
            frozen: Number(created.frozen),
            totalEarned: Number(created.total_earned),
            totalSpent: Number(created.total_spent),
          },
        });
      }
      return;
    }

    set({
      learningWallet: {
        balance: Number(data.balance),
        frozen: Number(data.frozen),
        totalEarned: Number(data.total_earned),
        totalSpent: Number(data.total_spent),
      },
    });
  },

  completeLesson: async (lessonId, result) => {
    if (!supabase) return { error: '資料庫未連線', xpEarned: 0, coinsEarned: 0, levelUp: false, newStreak: 0 };
    const { user, learningProfile } = get();
    if (!user || !learningProfile) return { error: '請先登入', xpEarned: 0, coinsEarned: 0, levelUp: false, newStreak: 0 };

    const today = new Date().toISOString().split('T')[0];
    const isFirstTodayLesson = learningProfile.lastLearnDate !== today;

    // XP：答題得分 + 首次每日 +20
    let xpEarned = result.xpFromQuestions;
    if (isFirstTodayLesson) xpEarned += 20;

    // 等級
    const newTotalXp = learningProfile.totalXp + xpEarned;
    const newLevel = Math.min(50, Math.floor(newTotalXp / 100) + 1);
    const newStage = Math.min(10, Math.floor((newLevel - 1) / 5) + 1);
    const levelUp = newLevel > learningProfile.currentLevel;
    const stageUp = newStage > learningProfile.currentStage;

    // 連續天數
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];
    let newStreak = learningProfile.streakDays;
    if (isFirstTodayLesson) {
      newStreak = learningProfile.lastLearnDate === yesterdayStr
        ? learningProfile.streakDays + 1
        : 1;
    }
    const newLongestStreak = Math.max(learningProfile.longestStreak, newStreak);

    // 寫入 lesson_progress
    await supabase.from('lesson_progress').insert([{
      user_id: user.id,
      lesson_id: lessonId,
      score: result.score,
      xp_earned: xpEarned,
      time_spent_seconds: result.timeSpentSeconds,
      questions_correct: result.questionsCorrect,
      questions_total: result.questionsTotal,
    }]);

    // 更新 learning_profiles
    const { error } = await supabase.from('learning_profiles').update({
      total_xp: newTotalXp,
      current_level: newLevel,
      current_stage: newStage,
      streak_days: newStreak,
      longest_streak: newLongestStreak,
      last_learn_date: today,
      total_lessons_completed: learningProfile.totalLessonsCompleted + 1,
      total_questions_correct: learningProfile.totalQuestionsCorrect + result.questionsCorrect,
      total_questions_answered: learningProfile.totalQuestionsAnswered + result.questionsTotal,
      updated_at: new Date().toISOString(),
    }).eq('user_id', user.id);

    if (error) return { error: error.message, xpEarned, coinsEarned: 0, levelUp, newStreak };

    set({
      learningProfile: {
        ...learningProfile,
        totalXp: newTotalXp,
        currentLevel: newLevel,
        currentStage: newStage,
        streakDays: newStreak,
        longestStreak: newLongestStreak,
        lastLearnDate: today,
        totalLessonsCompleted: learningProfile.totalLessonsCompleted + 1,
        totalQuestionsCorrect: learningProfile.totalQuestionsCorrect + result.questionsCorrect,
        totalQuestionsAnswered: learningProfile.totalQuestionsAnswered + result.questionsTotal,
      },
    });

    // ── 自動發幣：查詢父母的發幣規則 ─────────────
    let coinsEarned = 0;
    if (user.parentId) {
      const { data: rules } = await supabase
        .from('reward_rules')
        .select('*')
        .eq('parent_id', user.parentId)
        .eq('is_active', true)
        .or(`child_id.is.null,child_id.eq.${user.id}`);

      if (rules && rules.length > 0) {
        // 判斷哪些觸發條件成立
        const triggeredTypes: RewardTriggerType[] = [];
        if (isFirstTodayLesson) triggeredTypes.push('daily_complete');
        if (levelUp) triggeredTypes.push('level_up');
        if (stageUp) triggeredTypes.push('stage_up');
        if (result.score === 100) triggeredTypes.push('perfect_score');
        if (newStreak === 7) triggeredTypes.push('streak_7');
        if (newStreak === 30) triggeredTypes.push('streak_30');

        for (const rule of rules) {
          if (triggeredTypes.includes(rule.trigger_type as RewardTriggerType)) {
            const { error: rpcErr } = await supabase.rpc('grant_learning_coins', {
              p_user_id: user.id,
              p_amount: rule.amount,
              p_tx_type: 'earn',
              p_source: rule.id,
              p_description: TRIGGER_LABELS[rule.trigger_type as RewardTriggerType] ?? rule.trigger_label ?? rule.trigger_type,
            });
            if (!rpcErr) coinsEarned += rule.amount;
          }
        }

        // 重新拉最新錢包餘額
        if (coinsEarned > 0) await get().fetchLearningWallet();
      }
    }

    return { error: null, xpEarned, coinsEarned, levelUp, newStreak };
  },

  // ─── Reward Rules ─────────────────────────
  fetchRewardRules: async () => {
    if (!supabase) return;
    const { user } = get();
    if (!user || user.role !== 'parent') return;
    const { data } = await supabase
      .from('reward_rules')
      .select('*')
      .eq('parent_id', user.id)
      .order('created_at', { ascending: true });
    set({
      rewardRules: (data || []).map(rowToRewardRule),
    });
  },

  applyRewardTemplate: async (template) => {
    if (!supabase) return { error: '資料庫未連線' };
    const { user } = get();
    if (!user || user.role !== 'parent') return { error: '權限不足' };
    const amounts = REWARD_TEMPLATES[template];
    // 刪除現有非 custom 規則
    await supabase
      .from('reward_rules')
      .delete()
      .eq('parent_id', user.id)
      .neq('trigger_type', 'custom');
    // 批次新增
    const rows = (Object.entries(amounts) as [RewardTriggerType, number][]).map(([triggerType, amount]) => ({
      parent_id: user.id,
      trigger_type: triggerType,
      amount,
      is_active: true,
    }));
    const { error } = await supabase.from('reward_rules').insert(rows);
    if (error) return { error: error.message };
    await get().fetchRewardRules();
    return { error: null };
  },

  saveRewardRule: async (rule) => {
    if (!supabase) return { error: '資料庫未連線' };
    const { user } = get();
    if (!user || user.role !== 'parent') return { error: '權限不足' };
    const { error } = await supabase.from('reward_rules').insert([{
      parent_id: user.id,
      child_id: rule.childId ?? null,
      trigger_type: rule.triggerType,
      trigger_label: rule.triggerLabel ?? null,
      amount: rule.amount,
      is_active: rule.isActive,
    }]);
    if (error) return { error: error.message };
    await get().fetchRewardRules();
    return { error: null };
  },

  deleteRewardRule: async (ruleId) => {
    if (!supabase) return { error: '資料庫未連線' };
    const { error } = await supabase
      .from('reward_rules')
      .delete()
      .eq('id', ruleId);
    if (error) return { error: error.message };
    set(s => ({ rewardRules: s.rewardRules.filter(r => r.id !== ruleId) }));
    return { error: null };
  },

  grantCoinsManually: async (childId, amount, message) => {
    if (!supabase) return { error: '資料庫未連線' };
    const { user } = get();
    if (!user || user.role !== 'parent') return { error: '權限不足' };
    const { error } = await supabase.rpc('grant_learning_coins', {
      p_user_id: childId,
      p_amount: amount,
      p_tx_type: 'parent_grant',
      p_source: user.id,
      p_description: '父母手動發放',
      p_parent_message: message,
    });
    if (error) return { error: error.message };
    return { error: null };
  },

  fetchWalletTransactions: async () => {
    if (!supabase) return;
    const { user } = get();
    if (!user) return;
    const { data } = await supabase
      .from('wallet_transactions')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50);
    set({
      learningWalletTxs: (data || []).map(r => ({
        id: r.id as string,
        userId: r.user_id as string,
        amount: Number(r.amount),
        txType: r.tx_type as WalletTransaction['txType'],
        source: (r.source as string) || null,
        description: (r.description as string) || null,
        parentMessage: (r.parent_message as string) || null,
        createdAt: r.created_at as string,
      })),
    });
  },

  fetchChildrenTransactions: async () => {
    if (!supabase) return;
    const { user, children } = get();
    if (!user || user.role !== 'parent') return;
    const childIds = children.map(c => c.id);
    if (childIds.length === 0) return;
    const { data } = await supabase
      .from('wallet_transactions')
      .select('*')
      .in('user_id', childIds)
      .order('created_at', { ascending: false })
      .limit(200);
    set({
      childrenTxLog: (data || []).map(r => ({
        id: r.id as string,
        userId: r.user_id as string,
        amount: Number(r.amount),
        txType: r.tx_type as WalletTransaction['txType'],
        source: (r.source as string) || null,
        description: (r.description as string) || null,
        parentMessage: (r.parent_message as string) || null,
        createdAt: r.created_at as string,
      })),
    });
  },

  // ─── Shop Items ───────────────────────────
  fetchShopItems: async () => {
    if (!supabase) return;
    const { user } = get();
    if (!user) return;
    // parent fetches own items; child fetches parent's items
    const parentId = user.role === 'parent' ? user.id : user.parentId;
    if (!parentId) return;
    const { data } = await supabase
      .from('reward_shop_items')
      .select('*')
      .eq('parent_id', parentId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });
    set({ shopItems: (data || []).map(rowToShopItem) });
  },

  saveShopItem: async (item) => {
    if (!supabase) return { error: '資料庫未連線' };
    const { user } = get();
    if (!user || user.role !== 'parent') return { error: '權限不足' };
    const { shopItems } = get();
    const { error } = await supabase.from('reward_shop_items').insert([{
      parent_id:   user.id,
      name:        item.name,
      description: item.description ?? null,
      icon:        item.icon ?? null,
      item_type:   item.itemType,
      cost_coins:  item.costCoins,
      cash_value:  item.cashValue ?? null,
      is_active:   true,
      sort_order:  shopItems.length,
    }]);
    if (error) return { error: error.message };
    await get().fetchShopItems();
    return { error: null };
  },

  deleteShopItem: async (itemId) => {
    if (!supabase) return { error: '資料庫未連線' };
    const { error } = await supabase
      .from('reward_shop_items').delete().eq('id', itemId);
    if (error) return { error: error.message };
    set(s => ({ shopItems: s.shopItems.filter(i => i.id !== itemId) }));
    return { error: null };
  },

  toggleShopItem: async (itemId, isActive) => {
    if (!supabase) return { error: '資料庫未連線' };
    const { error } = await supabase
      .from('reward_shop_items')
      .update({ is_active: isActive })
      .eq('id', itemId);
    if (error) return { error: error.message };
    set(s => ({
      shopItems: s.shopItems.map(i => i.id === itemId ? { ...i, isActive } : i),
    }));
    return { error: null };
  },

  // ─── Redemptions ──────────────────────────
  fetchRedemptions: async () => {
    if (!supabase) return;
    const { user } = get();
    if (!user) return;
    const col = user.role === 'parent' ? 'parent_id' : 'child_id';
    const { data } = await supabase
      .from('redemption_requests')
      .select('*')
      .eq(col, user.id)
      .order('requested_at', { ascending: false })
      .limit(100);
    set({ redemptions: (data || []).map(rowToRedemption) });
  },

  requestRedemption: async (shopItemId) => {
    if (!supabase) return { error: '資料庫未連線' };
    const { user, shopItems } = get();
    if (!user || user.role !== 'child') return { error: '請用副帳號操作' };
    if (!user.parentId) return { error: '找不到主帳號' };

    const item = shopItems.find(i => i.id === shopItemId);
    if (!item) return { error: '找不到商品' };

    // 凍結幣
    const { error: freezeErr } = await supabase.rpc('freeze_coins', {
      p_user_id:    user.id,
      p_amount:     item.costCoins,
      p_source:     shopItemId,
      p_description: `申請兌換：${item.name}`,
    });
    if (freezeErr) return { error: freezeErr.message };

    // 建立申請
    const { error } = await supabase.from('redemption_requests').insert([{
      child_id:     user.id,
      parent_id:    user.parentId,
      shop_item_id: shopItemId,
      item_name:    item.name,
      cost_coins:   item.costCoins,
      status:       'pending',
    }]);
    if (error) return { error: error.message };

    // 更新本地錢包顯示
    await get().fetchLearningWallet();
    await get().fetchRedemptions();
    return { error: null };
  },

  approveRedemption: async (requestId, note) => {
    if (!supabase) return { error: '資料庫未連線' };
    const { error } = await supabase.rpc('approve_redemption', {
      p_request_id: requestId,
      p_parent_note: note || null,
    });
    if (error) return { error: error.message };
    set(s => ({
      redemptions: s.redemptions.map(r =>
        r.id === requestId
          ? { ...r, status: 'approved' as const, parentNote: note || null, resolvedAt: new Date().toISOString() }
          : r
      ),
    }));
    return { error: null };
  },

  rejectRedemption: async (requestId, note) => {
    if (!supabase) return { error: '資料庫未連線' };
    const { error } = await supabase.rpc('reject_redemption', {
      p_request_id: requestId,
      p_parent_note: note || null,
    });
    if (error) return { error: error.message };
    set(s => ({
      redemptions: s.redemptions.map(r =>
        r.id === requestId
          ? { ...r, status: 'rejected' as const, parentNote: note || null, resolvedAt: new Date().toISOString() }
          : r
      ),
    }));
    return { error: null };
  },

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
    set({ user: null, session: null, children: [], holdings: [], trades: [], withdrawalRequests: [], featureOverrides: [], allUsers: [], learningProfile: null, learningWallet: null, learningWalletTxs: [], childrenTxLog: [], rewardRules: [], shopItems: [], redemptions: [] });
  },

  // ─── Data Loading ──────────────────────────
  loadUserData: async (userId) => {
    if (!supabase) return;
    set({ loading: true });

    const { data: userData } = await supabase.from('users').select('*').eq('id', userId).single();
    if (!userData) { set({ loading: false }); return; }

    const currentUser = rowToUser(userData);
    set({ user: currentUser });

    // 取得基本資料後，平行查詢其餘資料以加速登入
    await Promise.all([
      (async () => {
        const { data: hData } = await supabase.from('holdings').select('*').eq('user_id', userId);
        const holdings: Holding[] = (hData || []).map(h => ({
          stockCode: h.stock_code, stockName: h.stock_name,
          totalShares: Number(h.total_shares), avgCost: Number(h.avg_cost),
          currentPrice: Number(h.current_price), industry: h.industry,
        }));
        set({ holdings });
      })(),
      (async () => {
        const { data: tData } = await supabase.from('trades').select('*').eq('user_id', userId).order('timestamp', { ascending: false });
        const trades: Trade[] = (tData || []).map(t => ({
          id: t.id, stockCode: t.stock_code, stockName: t.stock_name,
          tradeType: t.trade_type as 'buy' | 'sell',
          quantity: Number(t.quantity), price: Number(t.price),
          totalAmount: Number(t.total_amount), reason: t.reason as string | undefined, 
          profit: t.profit != null ? Number(t.profit) : undefined,
          timestamp: Number(t.timestamp),
        }));
        set({ trades });
      })(),
      currentUser.role === 'parent' ? get().loadChildren() : Promise.resolve(),
      get().loadWithdrawalRequests(),
      (async () => {
        const { data: foData } = await supabase.from('feature_overrides').select('*').eq('user_id', userId);
        const featureOverrides: FeatureOverride[] = (foData || []).map(f => ({
          userId: f.user_id, featureKey: f.feature_key, enabled: Boolean(f.enabled),
        }));
        set({ featureOverrides });
      })(),
      (async () => {
        const { data: stData } = await supabase.from('system_settings').select('*');
        if (stData) {
          const newSettings = { ...get().systemSettings };
          stData.forEach(row => {
            if (row.setting_key in newSettings) {
              (newSettings as any)[row.setting_key] = Number(row.setting_value);
            }
          });
          set({ systemSettings: newSettings });
        }
      })()
    ]);

    set({ loading: false });
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
    const { user, children, systemSettings } = get();
    if (!user || user.role !== 'parent') return { error: '只有主帳號可以建立副帳號' };
    
    if (!get().isPremiumUser() && children.length >= systemSettings.free_max_child_accounts) {
      return { error: `免費帳號最多只能建立 ${systemSettings.free_max_child_accounts} 個副帳號！\n升級 Premium 可解鎖無限副帳號 💎` };
    }

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
      
      if (!data.session) {
        return { error: null, needsConfirmation: true };
      }
      return { error: null, needsConfirmation: false };
    } catch (e) { return { error: String(e) }; }
  },

  // 主帳號可以直接設定或追加子帳號餘額（無上限限制）
  setChildBalance: async (childId, amount, mode) => {
    if (!supabase) return { error: '資料庫未連線' };
    const { user } = get();
    if (!user || user.role !== 'parent') return { error: '權限不足' };

    let diff = 0;
    let oldBal = 0;
    if (mode === 'set') {
      const { data: child } = await supabase.from('users').select('available_balance').eq('id', childId).single();
      if (!child) return { error: '找不到此副帳號' };
      oldBal = Number(child.available_balance);
      diff = amount - oldBal;
      // 直接設定餘額
      const { error } = await supabase.from('users').update({
        available_balance: amount,
      }).eq('id', childId);
      if (error) return { error: error.message };
    } else {
      diff = amount;
      const { data: child } = await supabase.from('users').select('available_balance').eq('id', childId).single();
      if (!child) return { error: '找不到此副帳號' };
      const { error } = await supabase.from('users').update({
        available_balance: Number(child.available_balance) + amount,
      }).eq('id', childId);
      if (error) return { error: error.message };
    }

    if (diff !== 0) {
       await supabase.from('trades').insert([{
         user_id: childId, stock_code: 'CASH', stock_name: diff > 0 ? '入金' : '扣款',
         trade_type: diff > 0 ? 'deposit' : 'withdraw', quantity: 1, price: Math.abs(diff),
         total_amount: Math.abs(diff), reason: mode === 'set' ? '家長調整餘額' : '家長加碼撥款', 
         timestamp: Date.now()
       }]);
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

    await supabase.from('trades').insert([{
      user_id: req.childId, stock_code: 'WD', stock_name: '提款出金',
      trade_type: 'withdraw', quantity: 1, price: req.amount,
      total_amount: req.amount, reason: '家長已核准提款',
      timestamp: Date.now()
    }]);

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
  executeBuy: async (stockCode, stockName, quantity, price, industry, reason) => {
    const { user, holdings } = get();
    if (!user || !supabase) return { success: false, message: '尚未登入' };
    
    // Fetch broker settings Context (use parent's if child)
    let feeRate = user.brokerFeeRate;
    let minFee = user.brokerMinFee;
    if (user.role === 'child' && user.parentId) {
      const { data: parentData } = await supabase.from('users').select('broker_fee_rate, broker_min_fee').eq('id', user.parentId).single();
      if (parentData) {
        feeRate = parentData.broker_fee_rate !== null ? Number(parentData.broker_fee_rate) : 0.001425;
        minFee = parentData.broker_min_fee !== null ? Number(parentData.broker_min_fee) : 20;
      }
    }

    const baseCost = quantity * price;
    const fee = Math.max(minFee, Math.round(baseCost * feeRate));
    const totalCost = baseCost + fee;

    if (totalCost > user.availableBalance) return { success: false, message: `餘額不足！需要更多零用錢才能買喔 💰\n(預估總金額含手續費: NT$ ${formatMoney(totalCost)})` };
    if (quantity <= 0) return { success: false, message: '至少要買 1 股喔！' };

    // ─ Paywall: 持股上限檢查 ─
    if (!get().isPremiumUser()) {
      const uniqueStocks = new Set(holdings.map(h => h.stockCode));
      if (!uniqueStocks.has(stockCode) && uniqueStocks.size >= get().systemSettings.free_max_holdings) {
        return { success: false, message: `🔒 免費帳號最多只能持有 ${get().systemSettings.free_max_holdings} 檔股票喔！\n升級 Premium 可解鎖無限持股 💎` };
      }
    }

    // ─ Paywall: 每日交易次數檢查 ─
    if (!get().isPremiumUser()) {
      const todayCount = get().getTodayTradeCount();
      if (todayCount >= get().systemSettings.free_max_daily_trades) {
        return { success: false, message: `🔒 免費帳號每日最多交易 ${get().systemSettings.free_max_daily_trades} 次！\n升級 Premium 可解鎖無限交易 💎` };
      }
    }

    await supabase.from('users').update({ available_balance: user.availableBalance - totalCost }).eq('id', user.id);
    await supabase.from('trades').insert([{
      user_id: user.id, stock_code: stockCode, stock_name: stockName,
      trade_type: 'buy', quantity, price, total_amount: totalCost, reason: reason || null, timestamp: Date.now(),
    }]);

    const existing = holdings.find(h => h.stockCode === stockCode);
    if (existing) {
      const newShares = existing.totalShares + quantity;
      // 加總總花費 / 總股數
      const newAvgCost = parseFloat(((existing.avgCost * existing.totalShares + totalCost) / newShares).toFixed(2));
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

  executeSell: async (stockCode, quantity, price, reason) => {
    const { user, holdings } = get();
    if (!user || !supabase) return { success: false, message: '尚未登入' };
    const holding = holdings.find(h => h.stockCode === stockCode);
    if (!holding) return { success: false, message: '你沒有持有這檔股票喔！' };
    if (quantity > holding.totalShares) return { success: false, message: `你只有 ${holding.totalShares} 股，不能賣超過喔！` };
    if (quantity <= 0) return { success: false, message: '至少要賣 1 股喔！' };

    // ─ Paywall: 每日交易次數檢查 ─
    if (!get().isPremiumUser()) {
      const todayCount = get().getTodayTradeCount();
      if (todayCount >= get().systemSettings.free_max_daily_trades) {
        return { success: false, message: `🔒 免費帳號每日最多交易 ${get().systemSettings.free_max_daily_trades} 次！\n升級 Premium 可解鎖無限交易 💎` };
      }
    }

    // Fetch broker settings Context (use parent's if child)
    let feeRate = user.brokerFeeRate;
    let minFee = user.brokerMinFee;
    let taxRate = user.brokerTaxRate;
    if (user.role === 'child' && user.parentId) {
      const { data: parentData } = await supabase.from('users').select('broker_fee_rate, broker_min_fee, broker_tax_rate').eq('id', user.parentId).single();
      if (parentData) {
        feeRate = parentData.broker_fee_rate !== null ? Number(parentData.broker_fee_rate) : 0.001425;
        minFee = parentData.broker_min_fee !== null ? Number(parentData.broker_min_fee) : 20;
        taxRate = parentData.broker_tax_rate !== null ? Number(parentData.broker_tax_rate) : 0.003;
      }
    }

    const baseValue = quantity * price;
    const fee = Math.max(minFee, Math.round(baseValue * feeRate));
    const tax = Math.round(baseValue * taxRate);
    const totalReceived = baseValue - fee - tax;
    
    // profit 計算: 實收金額 - (當初買這些股票的總成本)
    const profit = totalReceived - (holding.avgCost * quantity);
    
    await supabase.from('users').update({ available_balance: user.availableBalance + totalReceived }).eq('id', user.id);
    await supabase.from('trades').insert([{
      user_id: user.id, stock_code: stockCode, stock_name: holding.stockName,
      trade_type: 'sell', quantity, price, total_amount: totalReceived, 
      reason: reason || null, profit: profit, timestamp: Date.now(),
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

  updateBrokerSettings: async (brokerFeeRate, brokerMinFee, brokerTaxRate) => {
    if (!supabase) return { error: '資料庫未連線' };
    const { user } = get();
    if (!user || user.role !== 'parent') return { error: '只有主帳號可以修改手續費設定' };

    const { error } = await supabase.from('users').update({
      broker_fee_rate: brokerFeeRate,
      broker_min_fee: brokerMinFee,
      broker_tax_rate: brokerTaxRate,
    }).eq('id', user.id);

    if (error) return { error: error.message };
    set({ user: { ...user, brokerFeeRate, brokerMinFee, brokerTaxRate } });
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

  // ─── Admin Actions ─────────────────────────
  loadAllUsers: async () => {
    if (!supabase) return;
    const { user } = get();
    if (!user?.isAdmin) return;
    const { data } = await supabase.from('users').select('*').order('created_at', { ascending: false });
    set({ allUsers: (data || []).map(rowToUser) });
  },

  adminSetUserTier: async (userId, tier, expiresAt) => {
    if (!supabase) return { error: '資料庫未連線' };
    const { user } = get();
    if (!user?.isAdmin) return { error: '需要管理員權限' };
    const updateData: Record<string, unknown> = { tier };
    if (expiresAt) updateData.subscription_expires_at = expiresAt;
    else if (tier === 'free') updateData.subscription_expires_at = null;
    const { error } = await supabase.from('users').update(updateData).eq('id', userId);
    if (error) return { error: error.message };
    await get().loadAllUsers();
    return { error: null };
  },

  adminDeleteUser: async (userId) => {
    if (!supabase) return { error: '資料庫未連線' };
    const { user } = get();
    if (!user?.isAdmin) return { error: '需要管理員權限' };
    if (userId === user.id) return { error: '不能刪除自己的帳號' };
    // Delete from public.users (cascades to trades, holdings, etc.)
    const { error } = await supabase.from('users').delete().eq('id', userId);
    if (error) return { error: error.message };
    await get().loadAllUsers();
    return { error: null };
  },

  adminSetUserBalance: async (userId, amount) => {
    if (!supabase) return { error: '資料庫未連線' };
    const { user } = get();
    if (!user?.isAdmin) return { error: '需要管理員權限' };
    const { error } = await supabase.from('users').update({ available_balance: amount }).eq('id', userId);
    if (error) return { error: error.message };
    await get().loadAllUsers();
    return { error: null };
  },

  adminSetUserRelation: async (userId, role, parentId) => {
    if (!supabase) return { error: '資料庫未連線' };
    const { user } = get();
    if (!user?.isAdmin) return { error: '需要管理員權限' };
    const { error } = await supabase.from('users').update({ role, parent_id: parentId }).eq('id', userId);
    if (error) return { error: error.message };
    await get().loadAllUsers();
    return { error: null };
  },

  adminSetFeatureOverride: async (userId, featureKey, enabled) => {
    if (!supabase) return { error: '資料庫未連線' };
    const { user } = get();
    if (!user?.isAdmin) return { error: '需要管理員權限' };
    const { error } = await supabase.from('feature_overrides').upsert({
      user_id: userId, feature_key: featureKey, enabled, updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,feature_key' });
    if (error) return { error: error.message };
    return { error: null };
  },

  adminRemoveFeatureOverride: async (userId, featureKey) => {
    if (!supabase) return { error: '資料庫未連線' };
    const { user } = get();
    if (!user?.isAdmin) return { error: '需要管理員權限' };
    const { error } = await supabase.from('feature_overrides').delete()
      .eq('user_id', userId).eq('feature_key', featureKey);
    if (error) return { error: error.message };
    return { error: null };
  },

  loadFeatureOverridesForUser: async (userId) => {
    if (!supabase) return [];
    const { data } = await supabase.from('feature_overrides').select('*').eq('user_id', userId);
    return (data || []).map(f => ({
      userId: f.user_id, featureKey: f.feature_key, enabled: Boolean(f.enabled),
    }));
  },

  adminUpdateSetting: async (key, value) => {
    if (!supabase) return { error: '資料庫未連線' };
    const { user } = get();
    if (!user?.isAdmin) return { error: '需要管理員權限' };
    
    // 更新資料庫
    const { error } = await supabase.from('system_settings').upsert({
      setting_key: key, setting_value: value, updated_at: new Date().toISOString()
    }, { onConflict: 'setting_key' });
    
    if (error) return { error: error.message };
    
    // 更新本地狀態
    set(state => ({
      ...state,
      systemSettings: {
        ...state.systemSettings,
        [key]: value
      }
    }));
    
    return { error: null };
  },

  // ─── Tier & Feature Helpers ────────────────
  isPremiumUser: (targetUser) => {
    const { user, allUsers } = get();
    const u = targetUser || user;
    if (!u) return false;
    if (u.isAdmin) return true;

    // 先檢查訂閱到期日
    if (u.tier === 'premium') {
      if (u.subscriptionExpiresAt) {
        return new Date(u.subscriptionExpiresAt) > new Date();
      }
      return true; // 沒設到期日 = 永久 Premium (管理員手動升級)
    }

    // 家庭方案繼承：如果是 child，查看 parent 的 tier
    if (u.role === 'child' && u.parentId) {
      const parent = allUsers.find(au => au.id === u.parentId);
      if (parent?.tier === 'premium') {
        if (parent.subscriptionExpiresAt) {
          return new Date(parent.subscriptionExpiresAt) > new Date();
        }
        return true;
      }
    }

    return false;
  },

  hasFeature: (featureKey) => {
    const { user, featureOverrides } = get();
    if (!user) return false;
    if (user.isAdmin) return true;

    // 1. 先查 override
    const override = featureOverrides.find(f => f.featureKey === featureKey);
    if (override) return override.enabled;

    // 2. 按 tier 預設
    return get().isPremiumUser();
  },

  getTodayTradeCount: () => {
    const { trades } = get();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    return trades.filter(t => t.timestamp >= todayStart.getTime()).length;
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

