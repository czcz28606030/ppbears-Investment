import { create } from 'zustand';
import { supabase } from './supabase';
import type { Session } from '@supabase/supabase-js';
import type { UserAccount, Trade, Holding, WithdrawalRequest, FeatureOverride, SystemSettings, LessonResult, RewardRule, RewardTriggerType, WalletTransaction, RewardShopItem, RedemptionRequest, WatchlistItem, WatchlistSignal, WatchlistWarning, DividendPayment, StockData } from './types';
import { fetchStockData, fetchOfficialPriceMap } from './api';
import type { OfficialPriceMap } from './api';

// ─── 股價刷新快取控制 ─────────────────────────────────────────────────────────
let lastPriceRefreshAt: number | null = null;

// ─── 閒置自動登出控制 ─────────────────────────────────────────────────────────
let idleTimer: ReturnType<typeof setTimeout> | null = null;
const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 分鐘無操作自動登出（縮短以確保重開後資料新鮮）

/** 帶 timeout 的 Promise wrapper（逾時回傳 fallback） */
function withTimeout<T>(promise: PromiseLike<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    Promise.resolve(promise),
    new Promise<T>(resolve => setTimeout(() => resolve(fallback), ms)),
  ]);
}

/** DB 寫入 timeout wrapper（逾時拋出錯誤，讓 catch 捕捉） */
function withWriteTimeout<T>(promise: PromiseLike<T>, ms = 20000): Promise<T> {
  return Promise.race([
    Promise.resolve(promise),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('資料庫操作逾時，請檢查網路後再試')), ms)
    ),
  ]);
}

async function withRetry<T>(fn: () => Promise<T>, retries = 1): Promise<T> {
  let lastErr: unknown = null;
  for (let i = 0; i <= retries; i += 1) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

/** 判斷現在是否台股盤中（平日 09:00–13:30 台灣時間） */
function isMarketOpen(): boolean {
  const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const day = now.getUTCDay(); // 0=日, 6=六
  if (day === 0 || day === 6) return false;
  const minutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  return minutes >= 9 * 60 && minutes < 13 * 60 + 30;
}

const DAILY_LESSON_LIMIT = 3;

function getTaipeiDateString(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function getTaipeiDayRangeIso(date = new Date()): { startIso: string; endIso: string } {
  const taipeiDate = getTaipeiDateString(date);
  const startUtcMs = Date.parse(`${taipeiDate}T00:00:00+08:00`);
  return {
    startIso: new Date(startUtcMs).toISOString(),
    endIso: new Date(startUtcMs + 24 * 60 * 60 * 1000).toISOString(),
  };
}

// ==========================================
// 輔助函式
// ==========================================
export function formatMoney(amount: number): string {
  // 移除「萬」的概數格式，一律顯示精確數字，避免計算上產生混淆（例如 79423 顯示為 7.9萬）
  return amount.toLocaleString('zh-TW', { maximumFractionDigits: 0 });
}

export function formatPrice(price: number): string {
  // 不強制補小數點，最多保留小數點後兩位，除非有小數否則不顯示 .0
  return price.toLocaleString('zh-TW', { maximumFractionDigits: 2 });
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
  dividendPayments: DividendPayment[];
  withdrawalRequests: WithdrawalRequest[];
  featureOverrides: FeatureOverride[];
  systemSettings: SystemSettings;
  allUsers: UserAccount[];
  loading: boolean;
  authLoading: boolean;
  dataReady: boolean; // true = loadUserData 已完成，可以安全下單

  // Learning module (Slice 1–3)
  learningProfile: LearningProfile | null;
  learningWallet: LearningWallet | null;
  learningWalletTxs: WalletTransaction[];
  childrenTxLog: WalletTransaction[];
  rewardRules: RewardRule[];
  completedLessonIds: string[];
  todayCompletedLessonCount: number;
  fetchLearningProfile: () => Promise<void>;
  fetchLearningWallet: () => Promise<void>;
  fetchCompletedLessonIds: () => Promise<void>;
  fetchTodayCompletedLessonCount: () => Promise<number>;
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
  fetchDividendPayments: () => Promise<void>;

  // Children Management
  loadChildren: () => Promise<void>;
  createChildAccount: (email: string, password: string, displayName: string, avatar: string, initialBalance: number) => Promise<{ error: string | null; needsConfirmation?: boolean }>;
  updateChildProfile: (childId: string, displayName: string, avatar: string) => Promise<{ error: string | null }>;
  deleteChildAccount: (childId: string) => Promise<{ error: string | null }>;
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
  updateBrokerSettings: (brokerFeeRate: number, brokerMinFee: number, brokerTaxRate: number, stopLossAlertPct: number) => Promise<{ error: string | null }>;
  updateNewsletterStrategy: (strategy: string | null) => Promise<{ error: string | null }>;

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

  // Price Refresh
  refreshHoldingPrices: (options?: { force?: boolean }) => Promise<{ checkedCount: number; priceFoundCount: number; updatedCount: number }>;

  // Trade Note
  updateTradeNote: (tradeId: string, note: string) => Promise<{ error: string | null }>;

  // Watchlist
  watchlist: WatchlistItem[];
  watchlistSignals: WatchlistSignal[];
  watchlistWarnings: WatchlistWarning[];
  watchlistSignalsLoading: boolean;
  fetchWatchlist: () => Promise<void>;
  addToWatchlist: (stockCode: string, stockName: string, currentPrice: number, note?: string) => Promise<{ error: string | null }>;
  removeFromWatchlist: (stockCode: string) => Promise<{ error: string | null }>;
  isInWatchlist: (stockCode: string) => boolean;
  checkWatchlistSignals: (stockDataMap?: Record<string, StockData | null>) => Promise<void>;

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
    stopLossAlertPct: row.stop_loss_alert_pct !== undefined ? Number(row.stop_loss_alert_pct) : 20,
    parentId: (row.parent_id as string) || undefined,
    newsletterStrategy: (row.newsletter_strategy as string) || undefined,
  };
}

function rowToDividendPayment(row: Record<string, unknown>): DividendPayment {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    stockCode: row.stock_code as string,
    stockName: row.stock_name as string,
    exDate: row.ex_date as string,
    lastBuyDate: row.last_buy_date as string,
    payDate: row.pay_date as string,
    cashDividend: Number(row.cash_dividend),
    eligibleShares: Number(row.eligible_shares),
    amount: Number(row.amount),
    status: row.status as DividendPayment['status'],
    paidAt: (row.paid_at as string) || undefined,
    source: (row.source as string) || 'yahoo',
    createdAt: row.created_at as string,
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
  dividendPayments: [],
  withdrawalRequests: [],
  featureOverrides: [],
  systemSettings: { free_max_child_accounts: 2, free_max_holdings: 5, free_max_daily_trades: 10, newsletter_send_hour: 8 },
  allUsers: [],
  loading: false,
  authLoading: true,
  dataReady: false, // 初始為 false，loadUserData 完成後才設為 true
  isRecoveryMode: false,

  // ─── Learning Module (Slice 1–3) ─────────
  learningProfile: null,
  learningWallet: null,
  learningWalletTxs: [],
  childrenTxLog: [],
  completedLessonIds: [],
  todayCompletedLessonCount: 0,
  rewardRules: [],
  shopItems: [],
  redemptions: [],

  // ─── Watchlist ──────────────────────────────
  watchlist: [],
  watchlistSignals: [],
  watchlistWarnings: [],
  watchlistSignalsLoading: false,

  fetchLearningProfile: async () => {
    if (!supabase) return;
    const { user } = get();
    if (!user) return;

    const profileRes = await withTimeout(
      Promise.resolve(
        supabase
          .from('learning_profiles')
          .select('*')
          .eq('user_id', user.id)
          .maybeSingle()
      ),
      12000,
      { data: null, error: { message: 'fetchLearningProfile timeout' } } as any
    );

    if (profileRes.error) {
      console.error('fetchLearningProfile select failed:', profileRes.error.message);
      return;
    }

    const { data } = profileRes;

    if (!data) {
      const createRes = await withTimeout(
        Promise.resolve(
          supabase
            .from('learning_profiles')
            .insert([{ user_id: user.id }])
            .select()
            .single()
        ),
        12000,
        { data: null, error: { message: 'create learning_profiles timeout' } } as any
      );
      if (createRes.error) {
        console.error('fetchLearningProfile create failed:', createRes.error.message);
        return;
      }
      const created = createRes.data;
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

    const res = await withTimeout(
      supabase.from('learning_wallet').select('*').eq('user_id', user.id).maybeSingle(),
      10000,
      { data: null, error: null } as any
    );
    const data = res.data;

    if (!data) {
      const createRes = await withTimeout(
        supabase.from('learning_wallet').insert([{ user_id: user.id }]).select().single(),
        10000,
        { data: null, error: { message: 'timeout' } } as any
      );
      if (createRes.data) {
        const created = createRes.data;
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
    const sb = supabase;
    const { user, learningProfile } = get();
    if (user && learningProfile && (result.score !== 100 || result.questionsCorrect !== result.questionsTotal)) {
      return { error: 'perfect score required', xpEarned: 0, coinsEarned: 0, levelUp: false, newStreak: learningProfile.streakDays };
    }
    if (!user || !learningProfile) return { error: '請先登入', xpEarned: 0, coinsEarned: 0, levelUp: false, newStreak: 0 };

    if (get().completedLessonIds.includes(lessonId)) {
      return { error: 'lesson already completed', xpEarned: 0, coinsEarned: 0, levelUp: false, newStreak: learningProfile.streakDays };
    }

    const existingProgress = await withTimeout(
      sb.from('lesson_progress').select('id').eq('user_id', user.id).eq('lesson_id', lessonId).maybeSingle(),
      10000,
      { data: null, error: null } as any
    );

    if (existingProgress.data) {
      set({
        completedLessonIds: get().completedLessonIds.includes(lessonId)
          ? get().completedLessonIds
          : [...get().completedLessonIds, lessonId],
      });
      return { error: 'lesson already completed', xpEarned: 0, coinsEarned: 0, levelUp: false, newStreak: learningProfile.streakDays };
    }

    const todayCount = await get().fetchTodayCompletedLessonCount();
    if (todayCount >= DAILY_LESSON_LIMIT) {
      return { error: 'daily lesson limit reached', xpEarned: 0, coinsEarned: 0, levelUp: false, newStreak: learningProfile.streakDays };
    }

    const today = getTaipeiDateString();
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

    const progressPayload = {
      user_id: user.id,
      lesson_id: lessonId,
      score: result.score,
      xp_earned: xpEarned,
      time_spent_seconds: result.timeSpentSeconds,
      questions_correct: result.questionsCorrect,
      questions_total: result.questionsTotal,
    };

    const insertResult = await withTimeout(
      Promise.resolve(
        sb
          .from('lesson_progress')
          .insert([progressPayload])
          .select('id')
          .single()
      ),
      18000,
      { data: null, error: { message: 'lesson_progress insert timeout' } } as any
    );
    if (insertResult.error) {
      console.error('lesson_progress insert failed:', insertResult.error.message);

      const verifyResult = await withTimeout(
        Promise.resolve(
          sb
            .from('lesson_progress')
            .select('id')
            .eq('user_id', user.id)
            .eq('lesson_id', lessonId)
            .maybeSingle()
        ),
        12000,
        { data: null, error: { message: 'lesson_progress verify timeout' } } as any
      );

      if (!verifyResult.data) {
        const isDuplicate = insertResult.error.message.includes('duplicate') || insertResult.error.message.includes('unique');
        return {
          error: isDuplicate ? '這堂課已經完成過了，請回到學習地圖確認進度。' : '課程進度儲存較慢或失敗，請檢查網路後重新挑戰。',
          xpEarned: 0,
          coinsEarned: 0,
          levelUp: false,
          newStreak: learningProfile.streakDays,
        };
      }
    }

    // 更新 learning_profiles (5s timeout)
    const updateResult = await withRetry(() => withTimeout(
      Promise.resolve(sb.from('learning_profiles').update({
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
      }).eq('user_id', user.id)),
      12000,
      { error: { message: 'learning_profiles update timeout' } } as any
    ));

    if (updateResult.error) {
      console.error('learning_profiles update failed:', updateResult.error.message);
      // 即使 DB 寫入失敗，仍更新本地狀態讓 UI 繼續運作
    }

    // 更新本地狀態（無論 DB 成功與否都更新 UI）
    const newCompletedIds = get().completedLessonIds.includes(lessonId)
      ? get().completedLessonIds
      : [...get().completedLessonIds, lessonId];

    set({
      completedLessonIds: newCompletedIds,
      todayCompletedLessonCount: Math.min(DAILY_LESSON_LIMIT, get().todayCompletedLessonCount + 1),
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

    // ── 自動發幣：查詢發幣規則 ─────────────────────────────────────
    // child 帳號：查詢父母的規則；parent 帳號：查詢自己設定的規則
    let coinsEarned = 0;
    let coinGrantError: string | null = null;
    try {
      // 決定要查誰的規則
      const parentLookupId = user.parentId ?? (user.role === 'parent' ? user.id : null);

      if (parentLookupId) {
        const rulesResult = await withRetry(() => withTimeout(
          Promise.resolve(
            sb
              .from('reward_rules')
              .select('*')
              .eq('parent_id', parentLookupId)
              .eq('is_active', true)
              .or(`child_id.is.null,child_id.eq.${user.id}`)
          ),
          12000,
          { data: [] } as any
        ));
        if (rulesResult.error) {
          throw new Error(rulesResult.error.message ?? 'reward_rules query failed');
        }

        const rules: RewardRule[] = (rulesResult.data ?? []).map((r: Record<string, unknown>) => rowToRewardRule(r));

        if (rules.length > 0) {
          const triggeredTypes: RewardTriggerType[] = [];
          if (isFirstTodayLesson) triggeredTypes.push('daily_complete');
          if (levelUp) triggeredTypes.push('level_up');
          if (stageUp) triggeredTypes.push('stage_up');
          if (result.score === 100) triggeredTypes.push('perfect_score');
          if (newStreak === 7) triggeredTypes.push('streak_7');
          if (newStreak === 30) triggeredTypes.push('streak_30');

          console.log('[completeLesson] triggered types:', triggeredTypes, '/ rules:', rules.length);

          const matchedRules = rules.filter(rule => triggeredTypes.includes(rule.triggerType));
          const perfectRuleActive = rules.some(rule => rule.triggerType === 'perfect_score');
          if (result.score === 100 && !perfectRuleActive) {
            console.warn('[completeLesson] perfect score completed but no active perfect_score rule was found.');
          }

          for (const rule of matchedRules) {
            const { error: rpcErr } = await withRetry(() => withTimeout(
              Promise.resolve(sb.rpc('grant_learning_coins', {
                p_user_id: user.id,
                p_amount: rule.amount,
                p_tx_type: 'earn',
                p_source: rule.id,
                p_description: (TRIGGER_LABELS as Record<string, string>)[rule.triggerType] ?? rule.triggerLabel ?? rule.triggerType,
              })),
              12000,
              { error: { message: 'grant_learning_coins timeout' } } as any
            ));
            if (rpcErr) {
              console.error('[completeLesson] grant_learning_coins failed:', rpcErr);
              coinGrantError = rpcErr.message ?? '學習幣發放失敗';
            } else {
              coinsEarned += rule.amount;
            }
          }

          if (coinsEarned > 0) {
            await get().fetchLearningWallet();
            void get().fetchWalletTransactions().catch(err => {
              console.error('[completeLesson] fetchWalletTransactions failed after coin grant:', err);
            });
          } else if (result.score === 100 && perfectRuleActive) {
            coinGrantError = coinGrantError ?? '完美答題學習幣未成功發放，請查看錢包異動紀錄或稍後重整。';
          }
        } else {
          console.log('[completeLesson] no active reward rules found for parentId:', parentLookupId);
        }
      } else {
        console.log('[completeLesson] no parentId and not parent role, skipping coin grant');
      }
    } catch (e) {
      console.error('[completeLesson] reward coin granting failed:', e);
      coinGrantError = e instanceof Error ? e.message : '學習幣發放失敗';
    }

    return { error: coinGrantError, xpEarned, coinsEarned, levelUp, newStreak };
  },

  fetchTodayCompletedLessonCount: async () => {
    if (!supabase) return 0;
    const { user } = get();
    if (!user) return 0;
    const { startIso, endIso } = getTaipeiDayRangeIso();
    const res = await withTimeout(
      supabase
        .from('lesson_progress')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .gte('completed_at', startIso)
        .lt('completed_at', endIso),
      10000,
      { count: get().todayCompletedLessonCount, error: null } as any
    );
    const count = Number(res.count ?? 0);
    set({ todayCompletedLessonCount: count });
    return count;
  },


  // ─── Reward Rules ─────────────────────────
  fetchRewardRules: async () => {
    if (!supabase) return;
    const { user } = get();
    if (!user || user.role !== 'parent') return;
    const res = await withTimeout(
      supabase.from('reward_rules').select('*').eq('parent_id', user.id).order('created_at', { ascending: true }),
      10000,
      { data: null, error: null } as any
    );
    if (res.data) set({ rewardRules: res.data.map(rowToRewardRule) });
  },

  applyRewardTemplate: async (template) => {
    if (!supabase) return { error: '資料庫未連線' };
    const { user } = get();
    if (!user || user.role !== 'parent') return { error: '權限不足' };
    const amounts = REWARD_TEMPLATES[template];
    try {
      // 刪除現有非 custom 規則
      await withWriteTimeout(
        supabase.from('reward_rules').delete().eq('parent_id', user.id).neq('trigger_type', 'custom'),
        10000
      );
      // 批次新增
      const rows = (Object.entries(amounts) as [RewardTriggerType, number][]).map(([triggerType, amount]) => ({
        parent_id: user.id,
        trigger_type: triggerType,
        amount,
        is_active: true,
      }));
      const { error } = await withWriteTimeout(
        supabase.from('reward_rules').insert(rows),
        10000
      );
      if (error) return { error: (error as { message: string }).message };
      // 樂觀更新本地狀態
      const optimistic = rows.map((r, i) => ({
        id: `tmp-${i}`,
        parentId: user.id,
        childId: null,
        triggerType: r.trigger_type as RewardTriggerType,
        triggerLabel: null,
        amount: r.amount,
        isActive: true,
        createdAt: new Date().toISOString(),
      }));
      set(s => ({ rewardRules: [
        ...s.rewardRules.filter(r => r.triggerType === 'custom'),
        ...optimistic,
      ]}));
      // 背景静默刷新（不 await）
      get().fetchRewardRules().catch(() => {});
      return { error: null };
    } catch (e: unknown) {
      return { error: e instanceof Error ? e.message : '套用失敗，請稍後再試' };
    }
  },

  saveRewardRule: async (rule) => {
    if (!supabase) return { error: '資料庫未連線' };
    const { user } = get();
    if (!user || user.role !== 'parent') return { error: '權限不足' };
    try {
      const { data, error } = await withWriteTimeout(
        supabase.from('reward_rules').insert([{
          parent_id: user.id,
          child_id: rule.childId ?? null,
          trigger_type: rule.triggerType,
          trigger_label: rule.triggerLabel ?? null,
          amount: rule.amount,
          is_active: rule.isActive,
        }]).select().single(),
        10000
      );
      if (error) return { error: (error as { message: string }).message };
      if (data) set(s => ({ rewardRules: [...s.rewardRules, rowToRewardRule(data as Record<string, unknown>)] }));
      get().fetchRewardRules().catch(() => {});
      return { error: null };
    } catch (e: unknown) {
      return { error: e instanceof Error ? e.message : '儲存失敗' };
    }
  },

  deleteRewardRule: async (ruleId) => {
    if (!supabase) return { error: '資料庫未連線' };
    // 樂觀更新：先從本地移除
    set(s => ({ rewardRules: s.rewardRules.filter(r => r.id !== ruleId) }));
    try {
      await withWriteTimeout(
        supabase.from('reward_rules').delete().eq('id', ruleId),
        10000
      );
    } catch {}
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

  fetchCompletedLessonIds: async () => {
    if (!supabase) return;
    const { user } = get();
    if (!user) return;
    const res = await withTimeout(
      supabase.from('lesson_progress').select('lesson_id').eq('user_id', user.id),
      10000,
      { data: null, error: null } as any
    );
    if (res.data) {
      const ids: string[] = Array.from(new Set(res.data.map((r: { lesson_id: string }) => r.lesson_id as string)));
      set({ completedLessonIds: ids });
    }
  },

  fetchWalletTransactions: async () => {
    if (!supabase) return;
    const { user } = get();
    if (!user) return;
    const res = await withTimeout(
      supabase.from('wallet_transactions').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(50),
      10000,
      { data: null, error: null } as any
    );
    if (res.data) {
      set({
        learningWalletTxs: res.data.map((r: Record<string, unknown>) => ({
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
    }
  },

  fetchChildrenTransactions: async () => {
    if (!supabase) return;
    const { user, children } = get();
    if (!user || user.role !== 'parent') return;
    const childIds = children.map(c => c.id);
    if (childIds.length === 0) return;
    const res = await withTimeout(
      supabase.from('wallet_transactions').select('*').in('user_id', childIds).order('created_at', { ascending: false }).limit(200),
      10000,
      { data: null, error: null } as any
    );
    if (res.data) {
      set({
        childrenTxLog: res.data.map((r: Record<string, unknown>) => ({
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
    }
  },

  // ─── Shop Items ───────────────────────────
  fetchShopItems: async () => {
    if (!supabase) return;
    const { user } = get();
    if (!user) return;
    // parent fetches own items; child fetches parent's items
    const parentId = user.role === 'parent' ? user.id : user.parentId;
    if (!parentId) return;
    const res = await withTimeout(
      supabase
        .from('reward_shop_items')
        .select('*')
        .eq('parent_id', parentId)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true }),
      10000,
      { data: null, error: null } as any
    );
    if (res.data) set({ shopItems: res.data.map(rowToShopItem) });
  },

  saveShopItem: async (item) => {
    if (!supabase) return { error: '資料庫未連線' };
    const { user } = get();
    if (!user || user.role !== 'parent') return { error: '權限不足' };
    const { shopItems } = get();
    try {
      const { data, error } = await withWriteTimeout(
        supabase.from('reward_shop_items').insert([{
          parent_id:   user.id,
          name:        item.name,
          description: item.description ?? null,
          icon:        item.icon ?? null,
          item_type:   item.itemType,
          cost_coins:  item.costCoins,
          cash_value:  item.cashValue ?? null,
          is_active:   true,
          sort_order:  shopItems.length,
        }]).select().single(),
        12000
      );
      if (error) return { error: error.message };
      // 樂觀更新本地狀態，不阻塞 UI
      if (data) set(s => ({ shopItems: [...s.shopItems, rowToShopItem(data)] }));
      // 背景静默刷新（不 await）
      get().fetchShopItems().catch(() => {});
      return { error: null };
    } catch (e: unknown) {
      return { error: e instanceof Error ? e.message : '儲存失敗，請稍後再試' };
    }
  },

  deleteShopItem: async (itemId) => {
    if (!supabase) return { error: '資料庫未連線' };
    // 樂觀更新：先從本地移除
    set(s => ({ shopItems: s.shopItems.filter(i => i.id !== itemId) }));
    try {
      await withWriteTimeout(
        supabase.from('reward_shop_items').delete().eq('id', itemId),
        10000
      );
    } catch (e: unknown) {
      // DB 失敗就背景刷新，確保資料一致
      get().fetchShopItems().catch(() => {});
      return { error: e instanceof Error ? e.message : '刪除失敗' };
    }
    return { error: null };
  },

  toggleShopItem: async (itemId, isActive) => {
    if (!supabase) return { error: '資料庫未連線' };
    // 樂觀更新：先更新本地
    set(s => ({
      shopItems: s.shopItems.map(i => i.id === itemId ? { ...i, isActive } : i),
    }));
    try {
      await withWriteTimeout(
        supabase.from('reward_shop_items').update({ is_active: isActive }).eq('id', itemId),
        10000
      );
    } catch (e: unknown) {
      // 回滾
      set(s => ({
        shopItems: s.shopItems.map(i => i.id === itemId ? { ...i, isActive: !isActive } : i),
      }));
      return { error: e instanceof Error ? e.message : '更新失敗' };
    }
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
    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) return { error: sessionError.message };
      const token = sessionData.session?.access_token;
      if (!token) return { error: '登入狀態已失效，請重新登入' };

      const response = await fetch('/api/withdrawal-request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ type: 'redemption', requestId, action: 'approve', note }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) return { error: result.error || '核可兌換失敗' };
      await get().fetchRedemptions();
      await get().loadChildren();
      await get().fetchLearningWallet();
      return { error: null };
    } catch (e) {
      return { error: e instanceof Error ? e.message : '核可兌換失敗' };
    }
  },

  rejectRedemption: async (requestId, note) => {
    if (!supabase) return { error: '資料庫未連線' };
    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) return { error: sessionError.message };
      const token = sessionData.session?.access_token;
      if (!token) return { error: '登入狀態已失效，請重新登入' };

      const response = await fetch('/api/withdrawal-request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ type: 'redemption', requestId, action: 'reject', note }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) return { error: result.error || '駁回兌換失敗' };
      await get().fetchRedemptions();
      await get().fetchLearningWallet();
      return { error: null };
    } catch (e) {
      return { error: e instanceof Error ? e.message : '駁回兌換失敗' };
    }
  },

  // ─── Auth ─────────────────────────────────
  initAuth: async () => {
    if (!supabase) { set({ authLoading: false }); return; }

    // ── Step 1：getSession() 讀 localStorage（~50ms，無網路請求）──────────
    // 立即判斷登入狀態，解除 authLoading，讓頁面馬上顯示
    const { data: { session } } = await supabase.auth.getSession();
    set({ session, authLoading: false });
    if (session?.user) {
      get().loadUserData(session.user.id); // 背景載入，不 await
    }

    // ── Step 2：onAuthStateChange 處理後續 token 刷新 / 登入 / 登出 ────────
    supabase.auth.onAuthStateChange(async (event, newSession) => {
      // INITIAL_SESSION 已在 getSession() 處理，跳過避免重複載入
      if (event === 'INITIAL_SESSION') return;

      set({ session: newSession });

      if (event === 'PASSWORD_RECOVERY') {
        set({ isRecoveryMode: true });
        return;
      }

      if (newSession?.user) {
        await get().loadUserData(newSession.user.id);
      } else {
        set({ user: null, children: [], holdings: [], trades: [], dividendPayments: [], withdrawalRequests: [] });
      }
    });

    // ── 切回 Tab 時自動刷新資料 ─────────────────────────────────────────────
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        const { user } = get();
        if (user) get().loadUserData(user.id);
      }
    });

    // ── 閒置 120 分鐘自動登出 ────────────────────────────────────────────────
    const doIdleLogout = () => {
      if (get().user) get().logout();
    };
    const resetIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(doIdleLogout, IDLE_TIMEOUT_MS);
    };
    const idleEvents: (keyof DocumentEventMap)[] = [
      'mousedown', 'mousemove', 'keydown', 'touchstart', 'scroll', 'click',
    ];
    idleEvents.forEach(e =>
      document.addEventListener(e, resetIdle, { passive: true } as EventListenerOptions)
    );
    resetIdle(); // 啟動計時器
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
      const result = await withTimeout(
        supabase.auth.signInWithPassword({ email, password }),
        12000,
        { data: { user: null, session: null }, error: { message: 'login timeout' } } as Awaited<ReturnType<typeof supabase.auth.signInWithPassword>>
      );
      const { error } = result;
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
    // 先立即清除本地狀態（UI 立即回應），signOut 網路請求在背景執行不阻塞
    set({ user: null, session: null, children: [], holdings: [], trades: [], dividendPayments: [], withdrawalRequests: [], featureOverrides: [], allUsers: [], learningProfile: null, learningWallet: null, learningWalletTxs: [], childrenTxLog: [], completedLessonIds: [], todayCompletedLessonCount: 0, rewardRules: [], shopItems: [], redemptions: [], watchlist: [], watchlistSignals: [], watchlistWarnings: [] });
    if (supabase) supabase.auth.signOut({ scope: 'local' }).catch(() => {}); // 清除本機 session，失敗不影響 UI
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  },

  // ─── Data Loading ──────────────────────────
  loadUserData: async (userId) => {
    if (!supabase) return;
    const previousUser = get().user;
    const isInitialLoad = previousUser?.id !== userId;
    set({ loading: true, dataReady: isInitialLoad ? false : get().dataReady });

    try {
      // maybeSingle() 避免找不到資料時回傳 406 錯誤；加 timeout 避免下單區永久卡在同步中。
      const userRes = await withTimeout(
        supabase.from('users').select('*').eq('id', userId).maybeSingle(),
        isInitialLoad ? 8000 : 8000,
        { data: null, error: { message: 'load user timeout' } } as any
      );
      if (userRes.error) console.warn('loadUserData user failed:', userRes.error.message);
      if (!userRes.data) {
        set({ loading: false, dataReady: !isInitialLoad && Boolean(previousUser) });
        return;
      }

      const currentUser = rowToUser(userRes.data);
      set({ user: currentUser });

      // 取得基本資料後，平行查詢其餘資料以加速登入；每段獨立保護，避免單一慢查詢鎖死下單。
      await Promise.allSettled([
        (async () => {
          const res = await withTimeout(
            supabase.from('holdings').select('*').eq('user_id', userId),
            10000,
            { data: null, error: { message: 'holdings timeout' } } as any
          );
          if (res.error) { console.warn('loadUserData holdings failed:', res.error.message); return; }
          const rows = (res.data || []) as Record<string, any>[];
          const holdings: Holding[] = rows.map(h => ({
            stockCode: h.stock_code, stockName: h.stock_name,
            totalShares: Number(h.total_shares), avgCost: Number(h.avg_cost),
            currentPrice: Number(h.current_price), industry: h.industry,
          }));
          set({ holdings });
        })(),
        (async () => {
          const res = await withTimeout(
            supabase.from('trades').select('*').eq('user_id', userId).order('timestamp', { ascending: false }),
            10000,
            { data: null, error: { message: 'trades timeout' } } as any
          );
          if (res.error) { console.warn('loadUserData trades failed:', res.error.message); return; }
          const rows = (res.data || []) as Record<string, any>[];
          const trades: Trade[] = rows.map(t => ({
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
        get().fetchDividendPayments(),
        (async () => {
          const res = await withTimeout(
            supabase.from('feature_overrides').select('*').eq('user_id', userId),
            8000,
            { data: null, error: { message: 'feature overrides timeout' } } as any
          );
          if (res.error) { console.warn('loadUserData feature overrides failed:', res.error.message); return; }
          const rows = (res.data || []) as Record<string, any>[];
          const featureOverrides: FeatureOverride[] = rows.map(f => ({
            userId: f.user_id, featureKey: f.feature_key, enabled: Boolean(f.enabled),
          }));
          set({ featureOverrides });
        })(),
        (async () => {
          const res = await withTimeout(
            supabase.from('system_settings').select('*'),
            8000,
            { data: null, error: { message: 'system settings timeout' } } as any
          );
          if (res.error) { console.warn('loadUserData settings failed:', res.error.message); return; }
          if (res.data) {
            const newSettings = { ...get().systemSettings };
            (res.data as Record<string, any>[]).forEach(row => {
              if (row.setting_key in newSettings) {
                (newSettings as any)[row.setting_key] = Number(row.setting_value);
              }
            });
            set({ systemSettings: newSettings });
          }
        })(),
        get().fetchWatchlist(),
      ]);

      set({ loading: false, dataReady: true }); // 所有關鍵資料已嘗試同步，開放下單
    } catch (err) {
      console.error('loadUserData error:', err);
      set({ loading: false, dataReady: !isInitialLoad && Boolean(previousUser) });
    }
  },

  // ─── Parent Actions ────────────────────────
  fetchDividendPayments: async () => {
    if (!supabase) return;
    const { user } = get();
    if (!user) return;
    try {
      const { data, error } = await supabase
        .from('dividend_payments')
        .select('*')
        .order('pay_date', { ascending: false })
        .order('created_at', { ascending: false });
      if (error) {
        console.warn('fetchDividendPayments failed:', error.message);
        return;
      }
      set({ dividendPayments: (data || []).map(rowToDividendPayment) });
    } catch (err) {
      console.warn('fetchDividendPayments error:', err);
    }
  },

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
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) return { error: sessionError.message };
      const token = sessionData.session?.access_token;
      if (!token) return { error: '登入狀態已失效，請重新登入' };

      const response = await fetch('/api/create-child-account', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ email, password, displayName, avatar, initialBalance }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) return { error: result.error || '建立副帳號失敗' };
      await get().loadChildren();
      return { error: null, needsConfirmation: false };
    } catch (e) { return { error: String(e) }; }
  },

  updateChildProfile: async (childId, displayName, avatar) => {
    if (!supabase) return { error: '資料庫未連線' };
    const { user, children } = get();
    if (!user || user.role !== 'parent') return { error: '權限不足' };
    if (!children.find(c => c.id === childId)) return { error: '找不到此副帳號' };
    const { error } = await supabase.from('users')
      .update({ display_name: displayName, avatar })
      .eq('id', childId).eq('parent_id', user.id);
    if (error) return { error: error.message };
    set(s => ({ children: s.children.map(c => c.id === childId ? { ...c, displayName, avatar } : c) }));
    return { error: null };
  },

  deleteChildAccount: async (childId) => {
    if (!supabase) return { error: '資料庫未連線' };
    const { user, children } = get();
    if (!user || user.role !== 'parent') return { error: '權限不足' };
    if (!children.find(c => c.id === childId)) return { error: '找不到此副帳號' };
    try {
      await Promise.all([
        supabase.from('holdings').delete().eq('user_id', childId),
        supabase.from('trades').delete().eq('user_id', childId),
        supabase.from('lesson_progress').delete().eq('user_id', childId),
        supabase.from('wallet_transactions').delete().eq('user_id', childId),
        supabase.from('withdrawal_requests').delete().eq('child_id', childId),
      ]);
      const { error } = await supabase.from('users').delete().eq('id', childId).eq('parent_id', user.id);
      if (error) return { error: error.message };
      set(s => ({ children: s.children.filter(c => c.id !== childId) }));
      return { error: null };
    } catch (e) { return { error: e instanceof Error ? e.message : '刪除失敗' }; }
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
    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) return { error: sessionError.message };
      const token = sessionData.session?.access_token;
      if (!token) return { error: '登入狀態已失效，請重新登入' };

      const response = await fetch('/api/withdrawal-request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ requestId, action: 'approve' }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) return { error: result.error || '同意出金失敗' };

      await get().loadWithdrawalRequests();
      await get().loadChildren();
      return { error: null };
    } catch (e) {
      return { error: e instanceof Error ? e.message : '同意出金失敗' };
    }
  },

  rejectWithdrawal: async (requestId) => {
    if (!supabase) return { error: '資料庫未連線' };
    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) return { error: sessionError.message };
      const token = sessionData.session?.access_token;
      if (!token) return { error: '登入狀態已失效，請重新登入' };

      const response = await fetch('/api/withdrawal-request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ requestId, action: 'reject' }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) return { error: result.error || '拒絕出金失敗' };

      await get().loadWithdrawalRequests();
      return { error: null };
    } catch (e) {
      return { error: e instanceof Error ? e.message : '拒絕出金失敗' };
    }
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

  // ─── Price Refresh ──────────────────────────
  refreshHoldingPrices: async (options = {}) => {
    const { user, holdings } = get();
    if (!supabase || !user || holdings.length === 0) {
      return { checkedCount: 0, priceFoundCount: 0, updatedCount: 0 };
    }

    // ── 快取判斷：盤中 5 分鐘、盤後/假日 24 小時 ──────────────────────────
    const now = Date.now();
    const ttl = isMarketOpen() ? 5 * 60 * 1000 : 24 * 60 * 60 * 1000;
    if (!options.force && lastPriceRefreshAt !== null && now - lastPriceRefreshAt < ttl) {
      return { checkedCount: holdings.length, priceFoundCount: 0, updatedCount: 0 };
    }
    lastPriceRefreshAt = now;

    // 1. 同時取雲端官方價格 map、逐檔官方價與 ifalgo。
    //    雲端 map 可避開本機逐檔 proxy 502 時整批無法更新的問題。
    //    比較兩者日期，使用較新的那筆 → 解決官方 API 盤後延遲問題
    const [officialPriceMap, stockDatas] = await Promise.all([
      fetchOfficialPriceMap().catch((): OfficialPriceMap => ({})),
      Promise.all(holdings.map(h => fetchStockData(h.stockCode))),
    ]);

    // 2. 找出有新價格且與現有不同的持股
    const updates: { stockCode: string; newPrice: number }[] = [];
    let priceFoundCount = 0;
    const updatedHoldings = holdings.map((h, i) => {
      const officialFromMap = officialPriceMap[h.stockCode];
      const official = officialFromMap
        ? {
            price: Number(officialFromMap.close),
            name: officialFromMap.name,
            date: officialFromMap.date,
          }
        : null;
      const stockRes = stockDatas[i];

      // ifalgo 最新收盤
      let ifalgoPrice = 0;
      let ifalgoDate = '';
      if (stockRes && stockRes.prices && stockRes.prices.length > 0) {
        const lp = stockRes.prices[stockRes.prices.length - 1];
        ifalgoPrice = parseFloat(lp.close_d) || 0;
        ifalgoDate = (lp.mdate || '').replace(/-/g, '').replace(/\//g, '');
      }

      // 比較日期，選最新
      let newPrice = 0;
      if (official && official.price > 0) {
        const officialDate = (official.date || '').replace(/-/g, '');
        if (ifalgoPrice > 0 && ifalgoDate.length === 8 && officialDate.length === 8 && ifalgoDate > officialDate) {
          newPrice = ifalgoPrice; // ifalgo 有更新的當日資料
        } else {
          newPrice = official.price;
        }
      } else if (ifalgoPrice > 0) {
        newPrice = ifalgoPrice;
      }

      if (!isNaN(newPrice) && newPrice > 0) {
        priceFoundCount++;
      }

      if (!isNaN(newPrice) && newPrice > 0 && newPrice !== h.currentPrice) {
        updates.push({ stockCode: h.stockCode, newPrice });
        return { ...h, currentPrice: newPrice };
      }
      return h;
    });

    // 3. 批次寫回 Supabase（只更新有變化的持股）
    if (updates.length > 0) {
      await Promise.all(
        updates.map(u =>
          supabase!.from('holdings')
            .update({ current_price: u.newPrice, updated_at: new Date().toISOString() })
            .eq('user_id', user.id)
            .eq('stock_code', u.stockCode)
        )
      );
      // 4. 同步更新 store，觸發所有頁面 re-render
      set({ holdings: updatedHoldings });
    }
    return {
      checkedCount: holdings.length,
      priceFoundCount,
      updatedCount: updates.length,
    };
  },

  // ─── Trade Note ────────────────────────────
  updateTradeNote: async (tradeId, note) => {
    const { user } = get();
    if (!user || !supabase) return { error: '尚未登入' };
    const { error } = await supabase
      .from('trades')
      .update({ reason: note })
      .eq('id', tradeId)
      .eq('user_id', user.id);
    if (error) return { error: error.message };
    // 同步更新 store
    set(state => ({
      trades: state.trades.map(t => t.id === tradeId ? { ...t, reason: note } : t),
    }));
    return { error: null };
  },

  // ─── Trading ───────────────────────────────
  executeBuy: async (stockCode, stockName, quantity, price, industry, reason) => {
    const { user, holdings, trades, watchlist } = get();
    if (!user || !supabase) return { success: false, message: '尚未登入' };
    if (quantity <= 0) return { success: false, message: '至少要買 1 股喔！' };

    // ─ Paywall: 持股上限檢查（本地判斷，不打 DB）─
    if (!get().isPremiumUser()) {
      const uniqueStocks = new Set(holdings.map(h => h.stockCode));
      if (!uniqueStocks.has(stockCode) && uniqueStocks.size >= get().systemSettings.free_max_holdings) {
        return { success: false, message: `🔒 免費帳號最多只能持有 ${get().systemSettings.free_max_holdings} 檔股票喔！\n升級 Premium 可解鎖無限持股 💎` };
      }
      const todayCount = get().getTodayTradeCount();
      if (todayCount >= get().systemSettings.free_max_daily_trades) {
        return { success: false, message: `🔒 免費帳號每日最多交易 ${get().systemSettings.free_max_daily_trades} 次！\n升級 Premium 可解鎖無限交易 💎` };
      }
    }

    try {
      // 超時提升到 35s：Supabase 免費方案 cold start 可長達 10~25s
      // 不加重試：若前一次已成功但前端逾時，重試會造成重複下單！
      const { data, error } = await withWriteTimeout(
        supabase.rpc('execute_buy_trade', {
          p_stock_code: stockCode, p_stock_name: stockName,
          p_quantity: quantity, p_price: price,
          p_industry: industry || '', p_reason: reason || null,
        }),
        35000
      );
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) throw new Error('RPC 未回傳資料');
      const newBalance = Number(row.new_balance);
      const newTrade: Trade = {
        id: row.trade_id, stockCode, stockName, tradeType: 'buy',
        quantity, price, totalAmount: Number(row.total_cost),
        reason: reason || undefined, timestamp: Number(row.trade_timestamp),
      };
      const newSharesNum = Number(row.new_shares);
      const newAvgCostNum = Number(row.new_avg_cost);
      const existingIdx = holdings.findIndex(h => h.stockCode === stockCode);
      const newHoldings: Holding[] = existingIdx >= 0
        ? holdings.map((h, i) => i === existingIdx
            ? { ...h, totalShares: newSharesNum, avgCost: newAvgCostNum, currentPrice: price } : h)
        : [...holdings, { stockCode, stockName, totalShares: newSharesNum, avgCost: newAvgCostNum, currentPrice: price, industry: industry || '' }];
      const isWatched = watchlist.some(w => w.stockCode === stockCode);
      set({
        user: { ...user, availableBalance: newBalance },
        trades: [newTrade, ...trades],
        holdings: newHoldings,
        watchlist: isWatched ? watchlist.filter(w => w.stockCode !== stockCode) : watchlist,
      });

      if (isWatched) {
        withWriteTimeout(
          supabase
            .from('watchlist')
            .delete()
            .eq('user_id', user.id)
            .eq('stock_code', stockCode),
          10000
        ).catch(err => {
          console.warn('remove watchlist after buy failed:', err);
        });
      }

      return { success: true, message: `成功買入 ${stockName} ${quantity} 股 🎉` };
    } catch (err) {
      console.error('executeBuy error:', err);
      const raw = err instanceof Error ? err.message : String(err);
      if (raw.includes('insufficient_balance')) return { success: false, message: '餘額不足！需要更多零用錢才能買喔 💰' };
      if (raw.includes('not_authenticated')) return { success: false, message: '登入逾期，請重新登入' };
      if (raw.includes('function') && raw.includes('execute_buy_trade')) return { success: false, message: '⚠️ 交易服務尚未部署，請管理員執行 supabase-trade-rpc.sql' };
      // 逾時情境：DB 可能已成功執行，不確定結果，禁止重試
      if (raw.includes('逾時')) {
        setTimeout(() => { get().loadUserData(user.id).catch(() => {}); }, 2000);
        return { success: false, message: '⚠️ 網路回應較慢，交易可能已處理。\n請到「交易紀錄」確認，不要重複下單！' };
      }
      return { success: false, message: `⚠️ 買入失敗：${raw || '請檢查網路後再試。'}` };
    }
  },

  executeSell: async (stockCode, quantity, price, reason) => {
    const { user, holdings, trades } = get();
    if (!user || !supabase) return { success: false, message: '尚未登入' };
    const holding = holdings.find(h => h.stockCode === stockCode);
    if (!holding) return { success: false, message: '你沒有持有這檔股票喔！' };
    if (quantity > holding.totalShares) return { success: false, message: `你只有 ${holding.totalShares} 股，不能賣超過喔！` };
    if (quantity <= 0) return { success: false, message: '至少要賣 1 股喔！' };

    // ─ Paywall: 每日交易次數檢查（本地判斷）─
    if (!get().isPremiumUser()) {
      const todayCount = get().getTodayTradeCount();
      if (todayCount >= get().systemSettings.free_max_daily_trades) {
        return { success: false, message: `🔒 免費帳號每日最多交易 ${get().systemSettings.free_max_daily_trades} 次！\n升級 Premium 可解鎖無限交易 💎` };
      }
    }

    try {
      const { data, error } = await withWriteTimeout(
        supabase.rpc('execute_sell_trade', {
          p_stock_code: stockCode,
          p_quantity: quantity,
          p_price: price,
          p_reason: reason || null,
        }),
        15000
      );
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) throw new Error('RPC 未回傳資料');

      const newBalance = Number(row.new_balance);
      const profit = Number(row.profit);
      const totalReceived = Number(row.total_received);
      const remaining = Number(row.remaining_shares);

      const newTrade: Trade = {
        id: row.trade_id,
        stockCode, stockName: holding.stockName,
        tradeType: 'sell',
        quantity, price,
        totalAmount: totalReceived,
        reason: reason || undefined,
        profit,
        timestamp: Number(row.trade_timestamp),
      };

      const newHoldings: Holding[] = remaining <= 0
        ? holdings.filter(h => h.stockCode !== stockCode)
        : holdings.map(h => h.stockCode === stockCode
            ? { ...h, totalShares: remaining, currentPrice: price }
            : h);

      set({
        user: { ...user, availableBalance: newBalance },
        trades: [newTrade, ...trades],
        holdings: newHoldings,
      });

      let watchlistReturnMessage = '';
      if (remaining <= 0) {
        const autoWatchNote = '已結束持倉，等待下一波訊號';
        const result = await get().addToWatchlist(stockCode, holding.stockName, price, autoWatchNote);
        if (!result.error || result.error.includes('已在觀察名單')) {
          watchlistReturnMessage = '\n已自動放回觀察名單，等待下一波 AI 訊號。';
        } else {
          console.warn('auto add watchlist after full sell failed:', result.error);
          watchlistReturnMessage = '\n賣出已完成，但自動放回觀察名單失敗，稍後可手動加入。';
        }
      }

      const emoji = profit >= 0 ? '📈' : '📉';
      return {
        success: true,
        message: `成功賣出 ${holding.stockName} ${quantity} 股 ${emoji}\n${profit >= 0 ? '賺了' : '虧了'} NT$${Math.abs(profit).toFixed(0)}${watchlistReturnMessage}`,
      };
    } catch (err) {
      console.error('executeSell error:', err);
      const raw = err instanceof Error ? err.message : String(err);
      if (raw.includes('insufficient_shares')) {
        return { success: false, message: '持股不足，可能資料已變動，請重新整理頁面' };
      }
      if (raw.includes('no_holding')) {
        return { success: false, message: '你沒有持有這檔股票喔！' };
      }
      if (raw.includes('not_authenticated')) {
        return { success: false, message: '登入逾期，請重新登入' };
      }
      if (raw.includes('function') && raw.includes('execute_sell_trade')) {
        return { success: false, message: '⚠️ 交易服務尚未部署，請管理員執行 supabase-trade-rpc.sql' };
      }
      return { success: false, message: `⚠️ 賣出失敗：${raw || '請檢查網路後再試。'}` };
    }
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

  updateNewsletterStrategy: async (strategy: string | null) => {
    if (!supabase) return { error: '資料庫未連線' };
    const { user } = get();
    if (!user) return { error: '尚未登入' };
    const { error } = await supabase.from('users').update({
      newsletter_strategy: strategy,
    }).eq('id', user.id);
    if (error) return { error: error.message };
    set({ user: { ...user, newsletterStrategy: strategy ?? undefined } });
    return { error: null };
  },

  updateBrokerSettings: async (brokerFeeRate, brokerMinFee, brokerTaxRate, stopLossAlertPct) => {
    if (!supabase) return { error: '資料庫未連線' };
    const { user, children } = get();
    if (!user || user.role !== 'parent') return { error: '只有主帳號可以修改手續費設定' };

    const settingsPatch = {
      broker_fee_rate: brokerFeeRate,
      broker_min_fee: brokerMinFee,
      broker_tax_rate: brokerTaxRate,
      stop_loss_alert_pct: stopLossAlertPct,
    };

    const { error } = await supabase
      .from('users')
      .update(settingsPatch)
      .or(`id.eq.${user.id},parent_id.eq.${user.id}`);

    if (error) return { error: error.message };
    set({
      user: { ...user, brokerFeeRate, brokerMinFee, brokerTaxRate, stopLossAlertPct },
      children: children.map(child => ({
        ...child,
        brokerFeeRate,
        brokerMinFee,
        brokerTaxRate,
        stopLossAlertPct,
      })),
    });
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

  // ─── Watchlist ──────────────────────────────
  fetchWatchlist: async () => {
    if (!supabase) return;
    const { user } = get();
    if (!user) return;
    const { data } = await supabase
      .from('watchlist')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    const watchlist: WatchlistItem[] = (data || []).map(r => ({
      id: r.id as string,
      stockCode: r.stock_code as string,
      stockName: r.stock_name as string,
      addedPrice: Number(r.added_price) || 0,
      note: (r.note as string) || undefined,
      createdAt: r.created_at as string,
    }));
    set({ watchlist });
  },

  addToWatchlist: async (stockCode, stockName, currentPrice, note) => {
    if (!supabase) return { error: '資料庫未連線' };
    const { user, watchlist, holdings } = get();
    if (!user) return { error: '尚未登入' };
    if (holdings.some(h => h.stockCode === stockCode && h.totalShares > 0)) {
      return { error: '這檔股票已經在庫存中，不需要再加入觀察名單' };
    }
    // 防止重複加入
    if (watchlist.some(w => w.stockCode === stockCode)) {
      return { error: '這檔股票已在觀察名單中' };
    }
    // 樂觀更新：立即加入本地 state，UI 瞬間反應
    const optimisticItem = {
      id: `temp-${Date.now()}`,
      stockCode,
      stockName,
      addedPrice: currentPrice,
      note: note || undefined,
      createdAt: new Date().toISOString(),
    };
    set(s => ({ watchlist: [optimisticItem, ...s.watchlist] }));

    const { error } = await supabase.from('watchlist').insert([{
      user_id: user.id,
      stock_code: stockCode,
      stock_name: stockName,
      added_price: currentPrice,
      note: note || null,
    }]);
    if (error) {
      // 回滾樂觀更新
      set(s => ({ watchlist: s.watchlist.filter(w => w.id !== optimisticItem.id) }));
      if (error.message.includes('duplicate') || error.message.includes('unique')) {
        return { error: '這檔股票已在觀察名單中' };
      }
      return { error: error.message };
    }
    // 背景同步真正的 DB id（不阻塞 UI）
    get().fetchWatchlist();
    fetch(`/api/app-cache?type=stock-quant-snapshot&coid=${encodeURIComponent(stockCode)}&stockName=${encodeURIComponent(stockName)}`, {
      cache: 'no-store',
      headers: {
        accept: 'application/json',
        ...(get().session?.access_token ? { Authorization: `Bearer ${get().session!.access_token}` } : {}),
      },
    }).catch(err => {
      console.warn('watchlist quant snapshot warmup failed:', err);
    });
    return { error: null };
  },

  removeFromWatchlist: async (stockCode) => {
    if (!supabase) return { error: '資料庫未連線' };
    const { user } = get();
    if (!user) return { error: '尚未登入' };
    const { error } = await supabase
      .from('watchlist')
      .delete()
      .eq('user_id', user.id)
      .eq('stock_code', stockCode);
    if (error) return { error: error.message };
    set(s => ({ watchlist: s.watchlist.filter(w => w.stockCode !== stockCode) }));
    return { error: null };
  },

  isInWatchlist: (stockCode) => {
    return get().watchlist.some(w => w.stockCode === stockCode);
  },

  checkWatchlistSignals: async (stockDataMap) => {
    const { watchlist } = get();
    if (watchlist.length === 0) {
      set({ watchlistSignals: [], watchlistSignalsLoading: false });
      return;
    }
    set({ watchlistSignalsLoading: true });

    const signals: WatchlistSignal[] = [];

    // 優先使用觀察名單頁已抓好的 K 線資料，避免同一次進頁重複打 API。
    const stockDatas = stockDataMap
      ? watchlist.map(w => stockDataMap[w.stockCode] ?? null)
      : await Promise.all(
          watchlist.map(w => fetchStockData(w.stockCode).catch(() => null))
        );

    for (let i = 0; i < watchlist.length; i++) {
      const w = watchlist[i];
      const stockRes = stockDatas[i];
      if (!stockRes || !stockRes.prices || stockRes.prices.length < 6) continue;

      const prices = stockRes.prices;
      const closes = prices.map(p => parseFloat(p.close_d)).filter(c => !isNaN(c) && c > 0);
      const volumes = prices.map(p => p.volume).filter(v => v > 0);
      if (closes.length < 6 || volumes.length < 6) continue;

      // 計算 MA5（最近 5 日收盤價平均）
      const recent5 = closes.slice(-5);
      const ma5 = recent5.reduce((s, c) => s + c, 0) / 5;
      const currentPrice = closes[closes.length - 1];
      const prevClose = closes[closes.length - 2];

      // === 訊號 1：MA5 支撐確認 ===
      // 前一日收盤接近或跌破 MA5，今日站回上方
      const prevMa5Closes = closes.slice(-6, -1);
      const prevMa5 = prevMa5Closes.reduce((s, c) => s + c, 0) / 5;
      const prevNearMa5 = prevClose <= prevMa5 * 1.01; // 前日接近或低於 MA5
      const nowAboveMa5 = currentPrice > ma5;           // 今日站回上方
      const ma5Support = prevNearMa5 && nowAboveMa5;

      // === 訊號 2：縮量回檔 ===
      // 最近 3 日平均量 < 前 5 日平均量的 70%，且最近 3 日跌幅 < 3%
      const recent3Vol = volumes.slice(-3);
      const prev5Vol = volumes.slice(-8, -3);
      const avgRecent3Vol = recent3Vol.reduce((s, v) => s + v, 0) / recent3Vol.length;
      const avgPrev5Vol = prev5Vol.length > 0
        ? prev5Vol.reduce((s, v) => s + v, 0) / prev5Vol.length
        : avgRecent3Vol;
      const volChangeRatio = avgPrev5Vol > 0 ? ((avgRecent3Vol - avgPrev5Vol) / avgPrev5Vol) * 100 : 0;
      const volShrink = volChangeRatio < -30; // 量縮超過 30%

      const close3DaysAgo = closes[closes.length - 4] || closes[closes.length - 3];
      const recentDropPct = close3DaysAgo > 0
        ? ((currentPrice - close3DaysAgo) / close3DaysAgo) * 100
        : 0;
      const smallDrop = recentDropPct > -3; // 跌幅 < 3%（跌少）
      const volumeShrinkSignal = volShrink && smallDrop;

      // 組合訊號
      if (ma5Support && volumeShrinkSignal) {
        signals.push({
          stockCode: w.stockCode,
          signalType: 'both',
          currentPrice,
          ma5: Math.round(ma5 * 100) / 100,
          volumeChange: Math.round(volChangeRatio * 10) / 10,
          message: `🔥 雙重確認！股價回測 MA5（${ma5.toFixed(1)}）後站穩，且成交量縮${Math.abs(volChangeRatio).toFixed(0)}%，是理想的進場時機！`,
        });
      } else if (ma5Support) {
        signals.push({
          stockCode: w.stockCode,
          signalType: 'ma5_support',
          currentPrice,
          ma5: Math.round(ma5 * 100) / 100,
          volumeChange: Math.round(volChangeRatio * 10) / 10,
          message: `🟢 MA5 支撐確認！股價回測 MA5（${ma5.toFixed(1)}）後站穩，可考慮分批進場。`,
        });
      } else if (volumeShrinkSignal) {
        signals.push({
          stockCode: w.stockCode,
          signalType: 'volume_shrink',
          currentPrice,
          ma5: Math.round(ma5 * 100) / 100,
          volumeChange: Math.round(volChangeRatio * 10) / 10,
          message: `🔵 縮量回檔中！成交量縮${Math.abs(volChangeRatio).toFixed(0)}%且跌幅小，等待支撐確認後可進場。`,
        });
      }
    }

    // === 警告標記：建議移除 / 注意 / 提醒 ===
    const warnings: WatchlistWarning[] = [];
    const { holdings } = get();
    const now = Date.now();

    for (const w of watchlist) {
      const quote = stockDatas[watchlist.indexOf(w)];
      const currentPrice = quote?.prices?.length
        ? parseFloat(quote.prices[quote.prices.length - 1].close_d)
        : 0;
      const addedAt = new Date(w.createdAt).getTime();
      const daysSinceAdded = (now - addedAt) / (1000 * 60 * 60 * 24);

      // 🔴 已買入持有中 → 建議移除
      if (holdings.some(h => h.stockCode === w.stockCode)) {
        warnings.push({
          stockCode: w.stockCode,
          level: 'remove',
          icon: '✅',
          title: '已買入持有中',
          message: `你已經持有這檔股票，可以從觀察名單移除。`,
        });
        continue;
      }

      // 🔴 從加入價跌超過 -15%
      if (w.addedPrice > 0 && currentPrice > 0) {
        const dropPct = ((currentPrice - w.addedPrice) / w.addedPrice) * 100;
        if (dropPct < -15) {
          warnings.push({
            stockCode: w.stockCode,
            level: 'remove',
            icon: '🚨',
            title: `已跌 ${Math.abs(dropPct).toFixed(1)}%`,
            message: `從加入價 ${w.addedPrice.toFixed(1)} 跌至 ${currentPrice.toFixed(1)}，趨勢已破壞，建議移除。`,
          });
          continue;
        }
      }

      // 🟡 觀察超過 30 天
      if (daysSinceAdded > 30) {
        warnings.push({
          stockCode: w.stockCode,
          level: 'caution',
          icon: '⏰',
          title: `已觀察 ${Math.floor(daysSinceAdded)} 天`,
          message: `觀察超過 30 天未進場，機會可能已過，考慮移除或重新評估。`,
        });
        continue;
      }

      // 🟡 觀察超過 14 天
      if (daysSinceAdded > 14) {
        warnings.push({
          stockCode: w.stockCode,
          level: 'info',
          icon: '💡',
          title: `已觀察 ${Math.floor(daysSinceAdded)} 天`,
          message: `已觀察超過 2 週，是否該做決定？`,
        });
      }
    }

    set({ watchlistSignals: signals, watchlistWarnings: warnings, watchlistSignalsLoading: false });
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
