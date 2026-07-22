import { useEffect, useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore, formatMoney, formatPrice } from '../store';
import { supabase } from '../supabase';
import { fetchTWSEAllStocks, type TWSTEStockQuote } from '../api';
import type { UserAccount, FeatureOverride, Trade, TradeAttachment } from '../types';
import { calculateRealizedTradeStats, type RealizedTradeInput, type RealizedTradeStats } from '../utils/tradeRealizedStats';
import './AdminDashboard.css';

const FEATURE_KEYS = [
  { key: 'ai_stock_picking', label: '🤖 AI 聰明選股 + Simons 量化模型', desc: '找股票 AI 分頁、個股 AI 推薦等級、累積報酬、籌碼穩定度' },
  { key: 'ai_portfolio_advice', label: '📊 庫存 AI 建議', desc: '' },
  { key: 'daily_newsletter', label: '📧 每日電子報', desc: '控制此帳號是否列入每日自動電子報寄送名單' },
];

const TRADE_ATTACHMENT_BUCKET = 'trade-attachments';

type AttachmentStorageRow = {
  id: string;
  kind: 'auto_snapshot' | 'manual';
  storage_path: string;
  mime_type: string;
  file_size: number;
  created_at: string;
};

type AttachmentStorageSummary = {
  rows: AttachmentStorageRow[];
  expiredRows: AttachmentStorageRow[];
  totalCount: number;
  totalBytes: number;
  autoCount: number;
  autoBytes: number;
  manualCount: number;
  manualBytes: number;
  expiredBytes: number;
  oldestCreatedAt: string | null;
};
type AdminTradeStatRow = RealizedTradeInput & {
  userId: string;
};

const ADMIN_TRADE_STATS_PAGE_SIZE = 1000;
const EMPTY_REALIZED_TRADE_STATS = calculateRealizedTradeStats([]);

function getAttachmentCutoff(retentionMonths: number): Date | null {
  if (!Number.isFinite(retentionMonths) || retentionMonths <= 0) return null;
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - retentionMonths);
  return cutoff;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function chunkList<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

async function fetchAllAdminTradeStatRows(): Promise<AdminTradeStatRow[]> {
  if (!supabase) throw new Error('Supabase client unavailable');
  const rows: AdminTradeStatRow[] = [];

  for (let from = 0; ; from += ADMIN_TRADE_STATS_PAGE_SIZE) {
    const { data, error } = await supabase
      .from('trades')
      .select('id, user_id, stock_code, trade_type, total_amount, profit')
      .order('id', { ascending: true })
      .range(from, from + ADMIN_TRADE_STATS_PAGE_SIZE - 1);
    if (error) throw error;

    const page = data || [];
    rows.push(...page.map(row => ({
      userId: String(row.user_id || ''),
      tradeType: String(row.trade_type || ''),
      stockCode: String(row.stock_code || ''),
      totalAmount: row.total_amount,
      profit: row.profit,
    })));
    if (page.length < ADMIN_TRADE_STATS_PAGE_SIZE) break;
  }

  return rows.filter(row => row.userId);
}

function formatTradePercent(value: number | null, signed = false): string {
  if (value === null || !Number.isFinite(value)) return '--';
  const prefix = signed && value > 0 ? '+' : '';
  return `${prefix}${value.toFixed(1)}%`;
}

function getProfitTextClass(value: number): string {
  if (value > 0) return 'text-profit';
  if (value < 0) return 'text-loss';
  return '';
}
export default function AdminDashboard() {
  const navigate = useNavigate();
  const { user, allUsers, loadAllUsers, adminSetUserTier, adminDeleteUser, adminSetUserBalance,
    adminSetFeatureOverride, adminRemoveFeatureOverride, loadFeatureOverridesForUser,
    systemSettings, adminUpdateSetting, adminSetUserRelation } = useStore();

  const [allHoldings, setAllHoldings] = useState<any[]>([]);
  const [liveQuotes, setLiveQuotes] = useState<Record<string, TWSTEStockQuote>>({});
  const [adminLoading, setAdminLoading] = useState(true);
  const [allTradeStatsRows, setAllTradeStatsRows] = useState<AdminTradeStatRow[]>([]);
  const [tradeStatsStatus, setTradeStatsStatus] = useState<'loading' | 'success' | 'error'>('loading');

  const [search, setSearch] = useState('');
  const [balanceModal, setBalanceModal] = useState<{ userId: string; name: string; current: number } | null>(null);
  const [balanceInput, setBalanceInput] = useState('');
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  const [userFeatures, setUserFeatures] = useState<Record<string, FeatureOverride[]>>({});
  const [tierModal, setTierModal] = useState<{ userId: string; name: string } | null>(null);
  const [tierDays, setTierDays] = useState('30');
  const [settingModal, setSettingModal] = useState<{ key: string; label: string; value: number } | null>(null);
  const [settingInput, setSettingInput] = useState('');

  const [tradesModal, setTradesModal] = useState<{ userId: string; name: string } | null>(null);
  const [userTrades, setUserTrades] = useState<Trade[]>([]);
  const [tradesLoading, setTradesLoading] = useState(false);
  const [holdingsModal, setHoldingsModal] = useState<{ userId: string; name: string } | null>(null);

  const [relationModal, setRelationModal] = useState<{ userId: string; name: string; role: 'parent' | 'child'; parentId: string | null } | null>(null);
  const [newsletterTarget, setNewsletterTarget] = useState<{ userId: string; name: string; email: string } | null>(null);
  const [newsletterSending, setNewsletterSending] = useState(false);
  const [newsletterResult, setNewsletterResult] = useState<{ success: boolean; message: string } | null>(null);

  const [pricesLoading, setPricesLoading] = useState(false);
  const [attachmentSummary, setAttachmentSummary] = useState<AttachmentStorageSummary | null>(null);
  const [attachmentSummaryLoading, setAttachmentSummaryLoading] = useState(false);
  const [attachmentCleanupLoading, setAttachmentCleanupLoading] = useState(false);
  const [attachmentCleanupMessage, setAttachmentCleanupMessage] = useState('');

  const attachmentRetentionMonths = systemSettings.trade_attachment_retention_months ?? 24;

  const buildAttachmentSummary = useCallback((rows: AttachmentStorageRow[]): AttachmentStorageSummary => {
    const cutoff = getAttachmentCutoff(attachmentRetentionMonths);
    const expiredRows = cutoff
      ? rows.filter(row => new Date(row.created_at).getTime() < cutoff.getTime())
      : [];
    return rows.reduce<AttachmentStorageSummary>((summary, row) => {
      const fileSize = Number(row.file_size) || 0;
      summary.totalCount += 1;
      summary.totalBytes += fileSize;
      if (row.kind === 'auto_snapshot') {
        summary.autoCount += 1;
        summary.autoBytes += fileSize;
      } else {
        summary.manualCount += 1;
        summary.manualBytes += fileSize;
      }
      if (!summary.oldestCreatedAt || new Date(row.created_at) < new Date(summary.oldestCreatedAt)) {
        summary.oldestCreatedAt = row.created_at;
      }
      return summary;
    }, {
      rows,
      expiredRows,
      totalCount: 0,
      totalBytes: 0,
      autoCount: 0,
      autoBytes: 0,
      manualCount: 0,
      manualBytes: 0,
      expiredBytes: expiredRows.reduce((sum, row) => sum + (Number(row.file_size) || 0), 0),
      oldestCreatedAt: null,
    });
  }, [attachmentRetentionMonths]);

  const loadAttachmentStorageSummary = useCallback(async () => {
    if (!user?.isAdmin || !supabase) return;
    setAttachmentSummaryLoading(true);
    try {
      const { data, error } = await supabase
        .from('trade_attachments')
        .select('id, kind, storage_path, mime_type, file_size, created_at')
        .order('created_at', { ascending: true });
      if (error) throw error;
      const rows: AttachmentStorageRow[] = (data || []).map((row: any) => ({
        id: row.id,
        kind: row.kind,
        storage_path: row.storage_path,
        mime_type: row.mime_type,
        file_size: Number(row.file_size) || 0,
        created_at: row.created_at,
      }));
      setAttachmentSummary(buildAttachmentSummary(rows));
    } catch (err) {
      console.warn('load trade attachment storage summary failed:', err);
      setAttachmentCleanupMessage(`附件容量讀取失敗：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setAttachmentSummaryLoading(false);
    }
  }, [buildAttachmentSummary, user?.isAdmin]);

  const handleCleanupExpiredAttachments = useCallback(async () => {
    if (!supabase || !attachmentSummary) return;
    if (attachmentRetentionMonths <= 0) {
      setAttachmentCleanupMessage('目前設定為永久保留，沒有過期附件需要清理。');
      return;
    }
    const expiredRows = attachmentSummary.expiredRows;
    if (expiredRows.length === 0) {
      setAttachmentCleanupMessage('目前沒有超過保留期限的附件。');
      return;
    }
    if (!confirm(`確定清理 ${expiredRows.length} 個超過 ${attachmentRetentionMonths} 個月的附件嗎？交易紀錄與文字筆記會保留。`)) return;

    setAttachmentCleanupLoading(true);
    setAttachmentCleanupMessage('正在清理過期附件...');
    try {
      const storagePaths = expiredRows.map(row => row.storage_path).filter(Boolean);
      for (const paths of chunkList(storagePaths, 100)) {
        const { error } = await supabase.storage.from(TRADE_ATTACHMENT_BUCKET).remove(paths);
        if (error) throw error;
      }
      for (const ids of chunkList(expiredRows.map(row => row.id), 100)) {
        const { error } = await supabase.from('trade_attachments').delete().in('id', ids);
        if (error) throw error;
      }
      setAttachmentCleanupMessage(`已清理 ${expiredRows.length} 個附件，釋放約 ${formatBytes(attachmentSummary.expiredBytes)}。`);
      await loadAttachmentStorageSummary();
    } catch (err) {
      setAttachmentCleanupMessage(`清理失敗：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setAttachmentCleanupLoading(false);
    }
  }, [attachmentRetentionMonths, attachmentSummary, loadAttachmentStorageSummary]);

  useEffect(() => {
    if (!user?.isAdmin) return;

    // ── 第一階段：立即載入用戶列表（最快，幾乎無延遲）──
    setAdminLoading(true);
    (async () => {
      await loadAllUsers();
      if (supabase) {
        const { data } = await supabase.from('feature_overrides').select('*');
        const grouped: Record<string, FeatureOverride[]> = {};
        (data || []).forEach((f: any) => {
          const userId = f.user_id as string;
          grouped[userId] = grouped[userId] || [];
          grouped[userId].push({
            userId,
            featureKey: f.feature_key,
            enabled: Boolean(f.enabled),
          });
        });
        setUserFeatures(grouped);
      }
    })().finally(() => setAdminLoading(false));

    // ── 第二階段：背景載入持倉 + 即時行情（慢，不阻塞用戶列表）──
    setPricesLoading(true);
    Promise.all([
      supabase
        ? supabase.from('holdings').select('*').then(({ data }) => data || [])
        : Promise.resolve([]),
      fetchTWSEAllStocks(),
    ])
      .then(([holdingsData, twseData]) => {
        setAllHoldings(holdingsData);
        const quotesMap: Record<string, TWSTEStockQuote> = {};
        twseData.forEach(t => quotesMap[t.Code] = t);
        setLiveQuotes(quotesMap);
      })
      .catch(err => console.error('Failed to load admin prices:', err))
      .finally(() => setPricesLoading(false));

    setTradeStatsStatus('loading');
    void fetchAllAdminTradeStatRows()
      .then(rows => {
        setAllTradeStatsRows(rows);
        setTradeStatsStatus('success');
      })
      .catch(err => {
        console.error('Failed to load admin realized trade stats:', err);
        setAllTradeStatsRows([]);
        setTradeStatsStatus('error');
      });
  }, [user]);

  useEffect(() => {
    void loadAttachmentStorageSummary();
  }, [loadAttachmentStorageSummary]);

  // 用 useMemo 快取每個用戶的未平倉損益計算結果，避免每次渲染都重新計算
  const pnlMap = useMemo(() => {
    const map: Record<string, number> = {};
    allHoldings.forEach(h => {
      if (!map[h.user_id]) {
        map[h.user_id] = 0;
      }
      const q = liveQuotes[h.stock_code];
      const currentPrice = q ? parseFloat(q.ClosingPrice) : Number(h.current_price);
      map[h.user_id] += (currentPrice - Number(h.avg_cost)) * Number(h.total_shares);
    });
    return map;
  }, [allHoldings, liveQuotes]);

  const realizedStatsByUser = useMemo(() => {
    const grouped: Record<string, AdminTradeStatRow[]> = {};
    allTradeStatsRows.forEach(row => {
      grouped[row.userId] = grouped[row.userId] || [];
      grouped[row.userId].push(row);
    });
    return Object.entries(grouped).reduce<Record<string, RealizedTradeStats>>((map, [userId, rows]) => {
      map[userId] = calculateRealizedTradeStats(rows);
      return map;
    }, {});
  }, [allTradeStatsRows]);

  const calculateUnrealizedPnL = useCallback((userId: string) => {
    return pnlMap[userId] || 0;
  }, [pnlMap]);

  const holdingsByUser = useMemo(() => {
    const map: Record<string, any[]> = {};
    allHoldings.forEach(h => {
      map[h.user_id] = map[h.user_id] || [];
      map[h.user_id].push(h);
    });
    return map;
  }, [allHoldings]);

  const getUserHoldings = useCallback((userId: string) => holdingsByUser[userId] || [], [holdingsByUser]);

  const getHoldingPrice = useCallback((h: any) => {
    const q = liveQuotes[h.stock_code];
    return q ? parseFloat(q.ClosingPrice) : Number(h.current_price);
  }, [liveQuotes]);

  const getHoldingSummary = useCallback((userId: string) => {
    const rows = getUserHoldings(userId);
    return rows.reduce((sum, h) => {
      const currentPrice = getHoldingPrice(h);
      const shares = Number(h.total_shares);
      const cost = Number(h.avg_cost) * shares;
      const value = currentPrice * shares;
      return {
        count: sum.count + 1,
        shares: sum.shares + shares,
        value: sum.value + value,
        pnl: sum.pnl + value - cost,
      };
    }, { count: 0, shares: 0, value: 0, pnl: 0 });
  }, [getHoldingPrice, getUserHoldings]);

  if (!user?.isAdmin) {
    return (
      <div className="admin-page">
        <div className="empty-state">
          <div className="empty-state-icon">🔒</div>
          <div className="empty-state-title">需要管理員權限</div>
          <button className="btn btn-primary" onClick={() => navigate('/')}>回首頁</button>
        </div>
      </div>
    );
  }

  const stats = {
    total: allUsers.length,
    free: allUsers.filter(u => u.tier === 'free' && !u.isAdmin).length,
    premium: allUsers.filter(u => u.tier === 'premium').length,
    parents: allUsers.filter(u => u.role === 'parent').length,
    children: allUsers.filter(u => u.role === 'child').length,
  };

  const displayedUsers = useMemo(() => {
    const parents = allUsers.filter(u => !u.parentId);
    const result: UserAccount[] = [];
    
    parents.forEach(p => {
      const children = allUsers.filter(c => c.parentId === p.id);
      const pMatch = !search.trim() || p.email.toLowerCase().includes(search.trim().toLowerCase()) || p.displayName.toLowerCase().includes(search.trim().toLowerCase());
      const cMatch = children.some(c => !search.trim() || c.email.toLowerCase().includes(search.trim().toLowerCase()) || c.displayName.toLowerCase().includes(search.trim().toLowerCase()));
      
      if (pMatch || cMatch) {
         result.push(p);
         children.forEach(c => result.push(c));
      }
    });

    const orphans = allUsers.filter(u => u.parentId && !allUsers.some(p => p.id === u.parentId));
    orphans.forEach(o => {
      if (!search.trim() || o.email.toLowerCase().includes(search.trim().toLowerCase()) || o.displayName.toLowerCase().includes(search.trim().toLowerCase())) {
        result.push(o);
      }
    });
    
    return result;
  }, [allUsers, search]);

  const handleUpgrade = async (u: UserAccount) => {
    setTierModal({ userId: u.id, name: u.displayName });
  };

  const handleViewTrades = async (u: UserAccount) => {
    setTradesModal({ userId: u.id, name: u.displayName });
    setTradesLoading(true);
    setUserTrades([]);
    
    if (!supabase) {
      setTradesLoading(false);
      return;
    }

    const { data } = await supabase.from('trades').select('*').eq('user_id', u.id).order('timestamp', { ascending: false });
    if (data) {
      const tradeIds = data.map((t: any) => t.id).filter(Boolean);
      let attachmentsByTrade: Record<string, TradeAttachment[]> = {};
      if (tradeIds.length > 0) {
        const { data: attachmentRows, error: attachmentError } = await supabase
          .from('trade_attachments')
          .select('*')
          .in('trade_id', tradeIds)
          .order('created_at', { ascending: true });
        if (!attachmentError && attachmentRows) {
          const signedAttachments = await Promise.all(attachmentRows.map(async (row: any) => {
            const { data: signed } = await supabase!.storage.from('trade-attachments').createSignedUrl(row.storage_path, 60 * 60);
            return {
              id: row.id,
              tradeId: row.trade_id,
              userId: row.user_id,
              stockCode: row.stock_code,
              kind: row.kind,
              storagePath: row.storage_path,
              fileName: row.file_name,
              mimeType: row.mime_type,
              fileSize: Number(row.file_size) || 0,
              snapshotMeta: row.snapshot_meta || undefined,
              createdAt: row.created_at,
              signedUrl: signed?.signedUrl,
            } as TradeAttachment;
          }));
          attachmentsByTrade = signedAttachments.reduce<Record<string, TradeAttachment[]>>((acc, attachment) => {
            acc[attachment.tradeId] = acc[attachment.tradeId] || [];
            acc[attachment.tradeId].push(attachment);
            return acc;
          }, {});
        }
      }
      const formattedTrades: Trade[] = data.map(t => ({
        id: t.id, stockCode: t.stock_code, stockName: t.stock_name,
        tradeType: t.trade_type as any, quantity: Number(t.quantity),
        price: Number(t.price), totalAmount: Number(t.total_amount),
        profit: t.profit != null ? Number(t.profit) : undefined,
        timestamp: Number(t.timestamp),
        reason: t.reason,
        attachments: attachmentsByTrade[t.id] || [],
      }));
      setUserTrades(formattedTrades);
    }
    setTradesLoading(false);
  };

  const confirmUpgrade = async () => {
    if (!tierModal) return;
    const days = parseInt(tierDays);
    const expiresAt = days > 0 ? new Date(Date.now() + days * 86400000).toISOString() : undefined;
    await adminSetUserTier(tierModal.userId, 'premium', expiresAt);
    setTierModal(null);
  };

  const handleDowngrade = async (u: UserAccount) => {
    if (!confirm(`確定將 ${u.displayName} 降級為免費用戶嗎？`)) return;
    await adminSetUserTier(u.id, 'free');
  };

  const handleDelete = async (u: UserAccount) => {
    if (!confirm(`⚠️ 確定刪除 ${u.displayName} 的帳號嗎？此操作無法復原！`)) return;
    await adminDeleteUser(u.id);
  };

  const handleBalanceSave = async () => {
    if (!balanceModal) return;
    const amount = parseFloat(balanceInput);
    if (isNaN(amount) || amount < 0) return;
    await adminSetUserBalance(balanceModal.userId, amount);
    setBalanceModal(null);
  };

  const toggleFeaturePanel = async (userId: string) => {
    if (expandedUser === userId) {
      setExpandedUser(null);
      return;
    }
    setExpandedUser(userId);
    if (!userFeatures[userId]) {
      const overrides = await loadFeatureOverridesForUser(userId);
      setUserFeatures(prev => ({ ...prev, [userId]: overrides }));
    }
  };

  const handleFeatureToggle = async (userId: string, featureKey: string, currentlyEnabled: boolean, userTier: string) => {
    const newState = !currentlyEnabled;
    const defaultState = userTier === 'premium';
    
    // 如果新狀態跟預設狀態一樣，就移除 override
    if (newState === defaultState) {
      await adminRemoveFeatureOverride(userId, featureKey);
      setUserFeatures(prev => ({
        ...prev,
        [userId]: (prev[userId] || []).filter(f => f.featureKey !== featureKey),
      }));
    } else {
      // 如果新狀態跟預設狀態不同，就新增/更新 override
      await adminSetFeatureOverride(userId, featureKey, newState);
      setUserFeatures(prev => ({
        ...prev,
        [userId]: [...(prev[userId] || []).filter(f => f.featureKey !== featureKey),
          { userId, featureKey, enabled: newState }],
      }));
    }
  };

  const isFeatureEnabled = (userId: string, featureKey: string, userTier: string) => {
    const overrides = userFeatures[userId] || [];
    const override = overrides.find(f => f.featureKey === featureKey);
    if (override) return override.enabled;
    return userTier === 'premium';
  };

  const handleSendNewsletter = async () => {
    if (!newsletterTarget) return;
    setNewsletterSending(true);
    setNewsletterResult(null);
    try {
      const { data: { session } } = await supabase!.auth.getSession();
      const token = session?.access_token || '';
      const res = await fetch(`/api/send-newsletter-single?userId=${newsletterTarget.userId}`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      // 先讀取原始文字，避免 Vercel 超時/崩潰時回傳非 JSON 造成 SyntaxError
      const text = await res.text();
      let data: any;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`伺服器錯誤 (HTTP ${res.status})，請稍後再試或聯絡技術支援`);
      }
      if (data.success) {
        setNewsletterResult({ success: true, message: `✅ 電子報已成功發送至 ${newsletterTarget.email}` });
      } else {
        setNewsletterResult({ success: false, message: `❌ 發送失敗：${data.error || '未知錯誤'}` });
      }
    } catch (e) {
      setNewsletterResult({ success: false, message: `❌ 請求失敗：${String(e)}` });
    }
    setNewsletterSending(false);
  };

  const handleSettingSave = async () => {
    if (!settingModal) return;
    const val = parseInt(settingInput);
    if (isNaN(val) || val < 0) return;
    await adminUpdateSetting(settingModal.key as any, val);
    setSettingModal(null);
  };

  return (
    <div className="admin-page">
      <div className="page-header" style={{ justifyContent: 'space-between' }}>
        <button className="page-header-back" onClick={() => navigate(-1)}>←</button>
        <h1 className="page-title">🔧 管理後台</h1>
        <div style={{ width: 40 }}></div>
      </div>

      {/* 用戶列表載入中 */}
      {adminLoading && (
        <div style={{
          padding: '16px', background: 'rgba(33, 150, 243, 0.08)',
          border: '1px solid #2196F3', borderRadius: '12px',
          color: '#1976D2', marginBottom: '16px', fontSize: '14px', textAlign: 'center'
        }}>
          ⏳ 正在載入用戶列表...
        </div>
      )}
      {/* 行情背景更新（非阻塞，細小提示） */}
      {!adminLoading && pricesLoading && (
        <div style={{
          padding: '8px 14px', background: 'rgba(255,160,0,0.08)',
          border: '1px solid rgba(255,160,0,0.3)', borderRadius: '8px',
          color: '#E65100', marginBottom: '12px', fontSize: '12px',
          display: 'flex', alignItems: 'center', gap: 6
        }}>
          <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>🔄</span>
          正在背景更新即時行情與持倉損益...
        </div>
      )}


      {/* 統計卡片 */}
      <div className="admin-stats">
        <div className="admin-stat-card">
          <div className="admin-stat-value">{stats.total}</div>
          <div className="admin-stat-label">總用戶</div>
        </div>
        <div className="admin-stat-card">
          <div className="admin-stat-value" style={{ color: '#616161' }}>{stats.free}</div>
          <div className="admin-stat-label">免費</div>
        </div>
        <div className="admin-stat-card">
          <div className="admin-stat-value" style={{ color: '#FFA000' }}>{stats.premium}</div>
          <div className="admin-stat-label">Premium</div>
        </div>
      </div>

      {/* 交易附件容量 */}
      <div className="admin-user-card admin-attachment-storage-card">
        <div className="admin-attachment-storage-head">
          <div>
            <div className="admin-attachment-storage-title">📦 交易附件容量</div>
            <div className="admin-attachment-storage-subtitle">
              交易紀錄與文字筆記永久保留；這裡只管理 WEBP 快照與手動附件檔案。
            </div>
          </div>
          <button className="admin-btn admin-btn-feature" onClick={loadAttachmentStorageSummary} disabled={attachmentSummaryLoading}>
            {attachmentSummaryLoading ? '讀取中...' : '重新整理'}
          </button>
        </div>

        <div className="admin-attachment-storage-grid">
          <div>
            <span>目前總容量</span>
            <strong>{attachmentSummaryLoading && !attachmentSummary ? '讀取中...' : formatBytes(attachmentSummary?.totalBytes || 0)}</strong>
            <small>{attachmentSummary?.totalCount || 0} 個附件</small>
          </div>
          <div>
            <span>自動快照</span>
            <strong>{formatBytes(attachmentSummary?.autoBytes || 0)}</strong>
            <small>{attachmentSummary?.autoCount || 0} 個 WEBP</small>
          </div>
          <div>
            <span>手動附件</span>
            <strong>{formatBytes(attachmentSummary?.manualBytes || 0)}</strong>
            <small>{attachmentSummary?.manualCount || 0} 個 JPG/PNG/PDF</small>
          </div>
          <div>
            <span>可清理容量</span>
            <strong>{formatBytes(attachmentSummary?.expiredBytes || 0)}</strong>
            <small>{attachmentRetentionMonths <= 0 ? '永久保留' : `${attachmentSummary?.expiredRows.length || 0} 個超過 ${attachmentRetentionMonths} 個月`}</small>
          </div>
        </div>

        <div className="admin-attachment-storage-footer">
          <div>
            <span>保留期限</span>
            <strong>{attachmentRetentionMonths <= 0 ? '永久保留' : `${attachmentRetentionMonths} 個月`}</strong>
            <small>最舊附件：{attachmentSummary?.oldestCreatedAt ? new Date(attachmentSummary.oldestCreatedAt).toLocaleDateString('zh-TW') : '--'}</small>
          </div>
          <div className="admin-attachment-storage-actions">
            <button className="admin-btn admin-btn-balance" onClick={() => { setSettingModal({ key: 'trade_attachment_retention_months', label: '交易附件保留期限', value: attachmentRetentionMonths }); setSettingInput(String(attachmentRetentionMonths)); }}>
              ✏️ 調整月份
            </button>
            <button className="admin-btn admin-btn-delete" onClick={handleCleanupExpiredAttachments} disabled={attachmentCleanupLoading || attachmentRetentionMonths <= 0 || !attachmentSummary?.expiredRows.length}>
              {attachmentCleanupLoading ? '清理中...' : '清理過期附件'}
            </button>
          </div>
        </div>
        {attachmentCleanupMessage && <div className="admin-attachment-storage-message">{attachmentCleanupMessage}</div>}
      </div>

      {/* 功能對照表 */}
      <div className="admin-user-card" style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 12 }}>📋 免費 vs Premium 功能對照</div>
        <div style={{ fontSize: 11, color: '#888', marginBottom: 12 }}>點擊 ✏️ 可調整免費會員的限制額度</div>
        <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #eee' }}>
              <th style={{ textAlign: 'left', padding: '6px 4px', color: '#888' }}>功能</th>
              <th style={{ textAlign: 'center', padding: '6px 4px', color: '#616161' }}>🆓 Free</th>
              <th style={{ textAlign: 'center', padding: '6px 4px', color: '#FFA000' }}>💎 Premium</th>
            </tr>
          </thead>
          <tbody>
            <tr style={{ borderBottom: '1px solid #f5f5f5' }}>
              <td style={{ padding: '8px 4px', fontWeight: 600 }}>副帳號數量</td>
              <td style={{ textAlign: 'center', padding: '8px 4px' }}>
                ≤ {systemSettings.free_max_child_accounts} 個 
                <span style={{ cursor: 'pointer', marginLeft: 6 }} onClick={() => { setSettingModal({ key: 'free_max_child_accounts', label: '副帳號數量限制', value: systemSettings.free_max_child_accounts }); setSettingInput(String(systemSettings.free_max_child_accounts)); }}>✏️</span>
              </td>
              <td style={{ textAlign: 'center', padding: '8px 4px' }}>無限制</td>
            </tr>
            <tr style={{ borderBottom: '1px solid #f5f5f5' }}>
              <td style={{ padding: '8px 4px', fontWeight: 600 }}>持股檔數</td>
              <td style={{ textAlign: 'center', padding: '8px 4px' }}>
                ≤ {systemSettings.free_max_holdings} 檔 
                <span style={{ cursor: 'pointer', marginLeft: 6 }} onClick={() => { setSettingModal({ key: 'free_max_holdings', label: '持股檔數限制', value: systemSettings.free_max_holdings }); setSettingInput(String(systemSettings.free_max_holdings)); }}>✏️</span>
              </td>
              <td style={{ textAlign: 'center', padding: '8px 4px' }}>無限制</td>
            </tr>
            <tr style={{ borderBottom: '1px solid #f5f5f5' }}>
              <td style={{ padding: '8px 4px', fontWeight: 600 }}>每日交易次數</td>
              <td style={{ textAlign: 'center', padding: '8px 4px' }}>
                ≤ {systemSettings.free_max_daily_trades} 次 
                <span style={{ cursor: 'pointer', marginLeft: 6 }} onClick={() => { setSettingModal({ key: 'free_max_daily_trades', label: '每日交易次數限制', value: systemSettings.free_max_daily_trades }); setSettingInput(String(systemSettings.free_max_daily_trades)); }}>✏️</span>
              </td>
              <td style={{ textAlign: 'center', padding: '8px 4px' }}>無限制</td>
            </tr>
            <tr style={{ borderBottom: '1px solid #f5f5f5' }}>
              <td style={{ padding: '8px 4px', fontWeight: 600 }}>AI 聰明選股</td>
              <td style={{ textAlign: 'center', padding: '8px 4px' }}>❌ 鎖定</td>
              <td style={{ textAlign: 'center', padding: '8px 4px' }}>✅ 開放</td>
            </tr>
            <tr style={{ borderBottom: '1px solid #f5f5f5' }}>
              <td style={{ padding: '8px 4px', fontWeight: 600 }}>庫存 AI 建議</td>
              <td style={{ textAlign: 'center', padding: '8px 4px' }}>❌ 鎖定</td>
              <td style={{ textAlign: 'center', padding: '8px 4px' }}>✅ 開放</td>
            </tr>
            <tr style={{ borderBottom: '1px solid #f5f5f5' }}>
              <td style={{ padding: '8px 4px', fontWeight: 600 }}>📧 每日電子報</td>
              <td style={{ textAlign: 'center', padding: '8px 4px' }}>❌ 鎖定</td>
              <td style={{ textAlign: 'center', padding: '8px 4px' }}>
                每天 08:00 更新資料，08:30 發送
              </td>
            </tr>
            <tr style={{ borderBottom: '1px solid #f5f5f5' }}>
              <td style={{ padding: '8px 4px', fontWeight: 600 }}>廣告顯示</td>
              <td style={{ textAlign: 'center', padding: '8px 4px' }}>有廣告</td>
              <td style={{ textAlign: 'center', padding: '8px 4px' }}>無廣告</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* 搜尋 */}
      <div className="admin-search">
        <span>🔎</span>
        <input type="text" placeholder="搜尋 Email 或名稱..." value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {/* 用戶列表 */}
      <div className="admin-user-list">
        {displayedUsers.map(u => {
          const isChild = !!u.parentId;
          const parent = isChild ? allUsers.find(p => p.id === u.parentId) : null;
          const newsletterEnabled = isFeatureEnabled(u.id, 'daily_newsletter', u.tier);
          const holdingSummary = getHoldingSummary(u.id);
          const realizedStats = realizedStatsByUser[u.id] || EMPTY_REALIZED_TRADE_STATS;
          
          return (
          <div key={u.id} className="admin-user-card" style={{ marginLeft: isChild ? 32 : 0, borderLeft: isChild ? '4px solid #FFA000' : 'none' }}>
            <div className="admin-user-header">
              <div className="admin-user-avatar">
                {u.avatar.startsWith('http') || u.avatar.startsWith('data:') ?
                  <img src={u.avatar} alt="" style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover' }} /> : u.avatar}
              </div>
              <div className="admin-user-info">
                <div className="admin-user-name" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {u.displayName}
                  {isChild && parent && (
                    <span style={{ fontSize: 11, padding: '2px 6px', background: 'rgba(0,0,0,0.06)', color: '#666', borderRadius: 4, fontWeight: 600 }}>
                      ↳ 屬主帳號: {parent.displayName}
                    </span>
                  )}
                </div>
                <div className="admin-user-email">{u.email}</div>
                <div className="admin-user-balance">
                  💰 NT$ {formatMoney(u.availableBalance)}
                  <span style={{ marginLeft: 8, fontSize: 13, color: calculateUnrealizedPnL(u.id) >= 0 ? 'var(--profit-color)' : 'var(--loss-color)' }}>
                    (未平倉: {calculateUnrealizedPnL(u.id) > 0 ? '+' : ''}{formatMoney(calculateUnrealizedPnL(u.id))})
                  </span>
                </div>
                <div className="admin-user-balance">
                  📦 庫存 {holdingSummary.count} 檔・市值 NT$ {formatMoney(holdingSummary.value)}
                  <span style={{ marginLeft: 8, color: holdingSummary.pnl >= 0 ? 'var(--profit-color)' : 'var(--loss-color)' }}>
                    {holdingSummary.pnl >= 0 ? '+' : ''}{formatMoney(holdingSummary.pnl)}
                  </span>
                </div>
                {tradeStatsStatus === 'loading' && (
                  <div className="admin-user-realized-status">📈 已實現統計讀取中...</div>
                )}
                {tradeStatsStatus === 'error' && (
                  <div className="admin-user-realized-status error">⚠️ 已實現統計暫時無法讀取</div>
                )}
                {tradeStatsStatus === 'success' && (
                  <>
                    <div className="admin-user-realized">
                      <span>📈 已實現：</span>
                      <strong className={`admin-user-realized-value ${getProfitTextClass(realizedStats.realizedProfit)}`}>
                        {realizedStats.realizedProfit > 0 ? '+' : ''}NT$ {formatMoney(realizedStats.realizedProfit)}
                        <span className="admin-user-realized-return">（{formatTradePercent(realizedStats.realizedReturnPct, true)}）</span>
                      </strong>
                    </div>
                    <div className="admin-user-realized-detail">
                      <span>🏆 勝 <strong className={realizedStats.winCount > 0 ? 'text-profit' : ''}>{realizedStats.winCount}</strong></span>
                      <span>敗 <strong className={realizedStats.lossCount > 0 ? 'text-loss' : ''}>{realizedStats.lossCount}</strong></span>
                      <span>勝率 <strong>{formatTradePercent(realizedStats.winRatePct)}</strong></span>
                      <span>{realizedStats.stockCount} 檔／{realizedStats.tradeCount} 筆</span>
                    </div>
                  </>
                )}
                <div className="admin-user-badges">
                  <span className={`admin-badge ${u.role === 'parent' ? 'badge-parent' : 'badge-child'}`}>
                    {u.role === 'parent' ? '👨‍👩‍👧主帳號' : '👶副帳號'}
                  </span>
                  <span className={`admin-badge ${u.tier === 'premium' ? 'badge-premium' : 'badge-free'}`}>
                    {u.tier === 'premium' ? '💎 Premium' : '🆓 Free'}
                  </span>
                  {u.isAdmin && <span className="admin-badge badge-admin">👑 Admin</span>}
                  {u.subscriptionExpiresAt && (
                    <span className="admin-badge" style={{ background: '#FFF3E0', color: '#E65100', fontSize: 10 }}>
                      到期: {new Date(u.subscriptionExpiresAt).toLocaleDateString('zh-TW')}
                    </span>
                  )}
                  <span className="admin-badge" style={{ background: newsletterEnabled ? '#E8F5E9' : '#F5F5F5', color: newsletterEnabled ? '#2E7D32' : '#777' }}>
                    {newsletterEnabled ? '📧 電子報開啟' : '📭 電子報關閉'}
                  </span>
                </div>
              </div>
            </div>

            {/* 操作按鈕：所有帳號都可管理 */}
            <div className="admin-actions">
              {u.tier === 'free' ? (
                <button className="admin-btn admin-btn-premium" onClick={() => handleUpgrade(u)}>💎 升級 Premium</button>
              ) : (
                <button className="admin-btn admin-btn-downgrade" onClick={() => handleDowngrade(u)}>⬇️ 降級 Free</button>
              )}
              <button className="admin-btn admin-btn-balance" onClick={() => {
                setBalanceModal({ userId: u.id, name: u.displayName, current: u.availableBalance });
                setBalanceInput(String(u.availableBalance));
              }}>💰 調餘額</button>
              <button className="admin-btn admin-btn-feature" onClick={() => handleViewTrades(u)}>📄 交易紀錄</button>
              <button className="admin-btn admin-btn-feature" onClick={() => setHoldingsModal({ userId: u.id, name: u.displayName })}>📦 庫存股票</button>
              <button className="admin-btn admin-btn-feature" onClick={() => {
                 setRelationModal({ userId: u.id, name: u.displayName, role: u.role, parentId: u.parentId || null });
              }}>🔗 變更歸屬</button>
              <button className="admin-btn admin-btn-feature" onClick={() => toggleFeaturePanel(u.id)}>🔧 功能開關</button>
              {newsletterEnabled && (
                <button className="admin-btn" style={{ background: '#e8f5e9', color: '#2e7d32', border: '1px solid #a5d6a7' }}
                  onClick={() => { setNewsletterTarget({ userId: u.id, name: u.displayName, email: u.email }); setNewsletterResult(null); }}>
                  📧 發電子報
                </button>
              )}
              {u.id !== user.id && (
                <button className="admin-btn admin-btn-delete" onClick={() => handleDelete(u)}>🗑️ 刪除</button>
              )}
            </div>

            {/* 功能開關面板 */}
            {expandedUser === u.id && (
              <div className="admin-feature-section">
                {FEATURE_KEYS.map(feat => {
                  const enabled = isFeatureEnabled(u.id, feat.key, u.tier);
                  return (
                    <div key={feat.key} className="admin-feature-row">
                      <div>
                        <div className="admin-feature-label">{feat.label}</div>
                        {feat.desc && <div style={{ fontSize: 11, color: '#999' }}>{feat.desc}</div>}
                      </div>
                      <div
                        className={`toggle-switch ${enabled ? 'active' : ''}`}
                        onClick={() => handleFeatureToggle(u.id, feat.key, enabled, u.tier)}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )})}
      </div>

      {/* 交易紀錄彈窗 */}
      {tradesModal && (
        <div className="admin-modal-overlay" onClick={() => setTradesModal(null)}>
          <div className="admin-modal" style={{ maxWidth: 600, width: '90%', maxHeight: '80vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
            <h3 style={{ marginBottom: 16 }}>📄 {tradesModal.name} 的交易紀錄</h3>
            {tradesLoading ? (
               <div style={{ textAlign: 'center', padding: 20 }}>載入中...</div>
            ) : userTrades.length === 0 ? (
               <div style={{ textAlign: 'center', padding: 20, color: '#888' }}>目前沒有任何交易紀錄</div>
            ) : (
               <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                 {userTrades.map(trade => (
                   <div key={trade.id} style={{ display: 'flex', justifyContent: 'space-between', padding: 12, background: '#f9f9f9', borderRadius: 8 }}>
                     <div>
                        <div style={{ fontWeight: 800, marginBottom: 4 }}>
                          <span style={{ color: trade.tradeType === 'buy' ? 'var(--loss-color)' : trade.tradeType === 'sell' ? 'var(--profit-color)' : trade.tradeType === 'deposit' ? '#1976D2' : '#E65100', marginRight: 8 }}>
                            {trade.tradeType === 'buy' && '買入'}
                            {trade.tradeType === 'sell' && '賣出'}
                            {trade.tradeType === 'deposit' && '入金'}
                            {trade.tradeType === 'withdraw' && '出金'}
                          </span>
                          {trade.stockName} <span style={{ opacity: 0.5, fontSize: 12 }}>({trade.stockCode})</span>
                        </div>
                        {(trade.tradeType === 'buy' || trade.tradeType === 'sell') && (
                          <div style={{ fontSize: 12, color: '#666' }}>
                            數量: {trade.quantity} 股 | 價格: NT$ {formatPrice(trade.price)}
                          </div>
                        )}
                       <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>
                         {new Date(trade.timestamp).toLocaleString('zh-TW')}
                       </div>
                       {trade.reason && (
                         <div style={{ fontSize: 12, color: '#555', marginTop: 8, lineHeight: 1.5, background: '#fff', borderRadius: 8, padding: 8 }}>
                           🐻 投資筆記：{trade.reason}
                         </div>
                       )}
                       {(trade.attachments || []).length > 0 && (
                         <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                           {(trade.attachments || []).map(att => (
                             <a
                               key={att.id}
                               href={att.signedUrl}
                               target="_blank"
                               rel="noreferrer"
                               style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 8px', borderRadius: 8, background: att.kind === 'auto_snapshot' ? 'rgba(123,44,191,0.1)' : 'rgba(255,170,0,0.12)', color: att.kind === 'auto_snapshot' ? '#6d28d9' : '#b45309', fontSize: 12, fontWeight: 800, textDecoration: 'none' }}
                             >
                               {att.kind === 'auto_snapshot' ? '快照' : att.mimeType === 'application/pdf' ? 'PDF' : '附件'}
                               <span style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{att.fileName}</span>
                             </a>
                           ))}
                         </div>
                       )}
                     </div>
                     <div style={{ textAlign: 'right', fontWeight: 700 }}>
                       <div style={{ color: '#333' }}>NT$ {formatMoney(trade.totalAmount)}</div>
                       {trade.tradeType === 'sell' && trade.profit !== undefined && (
                         <div style={{ fontSize: 12, marginTop: 4, color: trade.profit >= 0 ? 'var(--profit-color)' : 'var(--loss-color)' }}>
                           損益: {trade.profit > 0 ? '+' : ''}NT$ {formatMoney(trade.profit)}
                         </div>
                       )}
                     </div>
                   </div>
                 ))}
               </div>
            )}
            <div className="admin-modal-btns" style={{ marginTop: 24 }}>
              <button className="btn-confirm" onClick={() => setTradesModal(null)} style={{ width: '100%' }}>關閉頁面</button>
            </div>
          </div>
        </div>
      )}

      {/* 庫存股票彈窗 */}
      {holdingsModal && (
        <div className="admin-modal-overlay" onClick={() => setHoldingsModal(null)}>
          <div className="admin-modal" style={{ maxWidth: 640, width: '92%', maxHeight: '82vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
            <h3 style={{ marginBottom: 16 }}>📦 {holdingsModal.name} 的庫存股票</h3>
            {getUserHoldings(holdingsModal.userId).length === 0 ? (
              <div style={{ textAlign: 'center', padding: 24, color: '#888' }}>目前沒有庫存股票</div>
            ) : (
              <>
                <div className="admin-holdings-summary">
                  {(() => {
                    const summary = getHoldingSummary(holdingsModal.userId);
                    return (
                      <>
                        <div>
                          <span>持股檔數</span>
                          <strong>{summary.count}</strong>
                        </div>
                        <div>
                          <span>總市值</span>
                          <strong>NT$ {formatMoney(summary.value)}</strong>
                        </div>
                        <div>
                          <span>未實現損益</span>
                          <strong style={{ color: summary.pnl >= 0 ? 'var(--profit-color)' : 'var(--loss-color)' }}>
                            {summary.pnl >= 0 ? '+' : ''}NT$ {formatMoney(summary.pnl)}
                          </strong>
                        </div>
                      </>
                    );
                  })()}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {getUserHoldings(holdingsModal.userId).map(h => {
                    const currentPrice = getHoldingPrice(h);
                    const shares = Number(h.total_shares);
                    const avgCost = Number(h.avg_cost);
                    const value = currentPrice * shares;
                    const pnl = (currentPrice - avgCost) * shares;
                    const pnlPct = avgCost > 0 ? ((currentPrice - avgCost) / avgCost) * 100 : 0;
                    return (
                      <div key={h.stock_code} className="admin-holding-row">
                        <div>
                          <div className="admin-holding-title">{h.stock_code} {h.stock_name}</div>
                          <div className="admin-holding-meta">
                            {shares.toLocaleString('zh-TW')} 股・均價 NT$ {formatPrice(avgCost)}・現價 NT$ {formatPrice(currentPrice)}
                          </div>
                        </div>
                        <div className="admin-holding-value">
                          <div>NT$ {formatMoney(value)}</div>
                          <span style={{ color: pnl >= 0 ? 'var(--profit-color)' : 'var(--loss-color)' }}>
                            {pnl >= 0 ? '+' : ''}NT$ {formatMoney(pnl)} ({pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%)
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
            <div className="admin-modal-btns" style={{ marginTop: 24 }}>
              <button className="btn-confirm" onClick={() => setHoldingsModal(null)} style={{ width: '100%' }}>關閉頁面</button>
            </div>
          </div>
        </div>
      )}

      {/* 帳號歸屬設定彈窗 */}
      {relationModal && (
        <div className="admin-modal-overlay" onClick={() => setRelationModal(null)}>
          <div className="admin-modal" onClick={e => e.stopPropagation()}>
            <h3 style={{ marginBottom: 16 }}>🔗 變更 {relationModal.name} 的帳號歸屬</h3>
            
            <div style={{ marginBottom: 16 }}>
              <div style={{ marginBottom: 8, fontWeight: 600 }}>選擇帳號模式：</div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, cursor: 'pointer' }}>
                <input 
                  type="radio" 
                  name="role" 
                  checked={relationModal.role === 'parent'} 
                  onChange={() => setRelationModal({ ...relationModal, role: 'parent', parentId: null })}
                />
                🚹 獨立主帳號
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input 
                  type="radio" 
                  name="role" 
                  checked={relationModal.role === 'child'} 
                  onChange={() => setRelationModal({ ...relationModal, role: 'child' })}
                />
                👶 附屬副帳號
              </label>
            </div>

            {relationModal.role === 'child' && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ marginBottom: 8, fontWeight: 600 }}>請選擇所屬主帳號：</div>
                <select 
                  style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }}
                  value={relationModal.parentId || ''}
                  onChange={(e) => setRelationModal({ ...relationModal, parentId: e.target.value })}
                >
                  <option value="" disabled>-- 點此選擇主帳號 --</option>
                  {allUsers
                    .filter(u => (!u.parentId && u.role === 'parent') && u.id !== relationModal.userId)
                    .map(u => (
                      <option key={u.id} value={u.id}>{u.displayName} ({u.email})</option>
                  ))}
                </select>
              </div>
            )}

            <div className="admin-modal-btns">
              <button className="btn-cancel" onClick={() => setRelationModal(null)}>取消</button>
              <button className="btn-confirm" onClick={async () => {
                 if (relationModal.role === 'child' && !relationModal.parentId) {
                   alert('請選擇主帳號！');
                   return;
                 }
                 const targetParentId = relationModal.role === 'parent' ? null : relationModal.parentId;
                 const { error } = await adminSetUserRelation(relationModal.userId, relationModal.role, targetParentId);
                 if (error) {
                   alert('更新失敗: ' + error);
                 } else {
                   setRelationModal(null);
                 }
              }}>確認儲存</button>
            </div>
          </div>
        </div>
      )}

      {/* 餘額調整彈窗 */}
      {balanceModal && (
        <div className="admin-modal-overlay" onClick={() => setBalanceModal(null)}>
          <div className="admin-modal" onClick={e => e.stopPropagation()}>
            <h3>💰 調整 {balanceModal.name} 的餘額</h3>
            <div style={{ fontSize: 13, color: '#888', marginBottom: 8 }}>目前餘額: NT$ {formatMoney(balanceModal.current)}</div>
            <input type="number" value={balanceInput} onChange={e => setBalanceInput(e.target.value)} placeholder="輸入新餘額" />
            <div className="admin-modal-btns">
              <button className="btn-cancel" onClick={() => setBalanceModal(null)}>取消</button>
              <button className="btn-confirm" onClick={handleBalanceSave}>確認</button>
            </div>
          </div>
        </div>
      )}

      {/* Premium 升級彈窗 */}
      {tierModal && (
        <div className="admin-modal-overlay" onClick={() => setTierModal(null)}>
          <div className="admin-modal" onClick={e => e.stopPropagation()}>
            <h3>💎 升級 {tierModal.name} 為 Premium</h3>
            <div style={{ fontSize: 13, color: '#888', marginBottom: 12 }}>請選擇訂閱天數 (0 = 永久)</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              {['30', '90', '365', '0'].map(d => (
                <button key={d} onClick={() => setTierDays(d)}
                  style={{
                    flex: 1, padding: '8px 4px', borderRadius: 10, border: tierDays === d ? '2px solid var(--primary)' : '1px solid #ddd',
                    background: tierDays === d ? 'var(--primary)' : '#fff', color: tierDays === d ? '#fff' : '#333',
                    fontWeight: 700, fontSize: 13, cursor: 'pointer',
                  }}>
                  {d === '0' ? '永久' : `${d}天`}
                </button>
              ))}
            </div>
            <div className="admin-modal-btns">
              <button className="btn-cancel" onClick={() => setTierModal(null)}>取消</button>
              <button className="btn-confirm" onClick={confirmUpgrade}>確認升級</button>
            </div>
          </div>
        </div>
      )}
      {/* 發電子報確認彈窗 */}
      {newsletterTarget && (
        <div className="admin-modal-overlay" onClick={() => { setNewsletterTarget(null); setNewsletterResult(null); }}>
          <div className="admin-modal" onClick={e => e.stopPropagation()}>
            <h3>📧 發送電子報</h3>
            <p style={{ fontSize: 14, color: '#555', margin: '8px 0 16px' }}>
              確定立即發送當日電子報給 <strong>{newsletterTarget.name}</strong>？<br />
              <span style={{ fontSize: 12, color: '#999' }}>{newsletterTarget.email}</span>
            </p>
            {newsletterResult && (
              <div style={{
                padding: '10px 14px', borderRadius: 8, marginBottom: 16,
                background: newsletterResult.success ? '#e8f5e9' : '#fdecea',
                color: newsletterResult.success ? '#2e7d32' : '#c62828',
                fontSize: 13, fontWeight: 600,
              }}>
                {newsletterResult.message}
              </div>
            )}
            <div className="admin-modal-btns">
              <button className="btn-cancel" onClick={() => { setNewsletterTarget(null); setNewsletterResult(null); }}>關閉</button>
              {!newsletterResult?.success && (
                <button className="btn-confirm" onClick={handleSendNewsletter} disabled={newsletterSending}>
                  {newsletterSending ? '發送中...' : '確認發送'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 系統設定編輯彈窗 */}
      {settingModal && (
        <div className="admin-modal-overlay" onClick={() => setSettingModal(null)}>
          <div className="admin-modal" onClick={e => e.stopPropagation()}>
            <h3>✏️ 調整 {settingModal.label}</h3>
            <div style={{ fontSize: 13, color: '#888', marginBottom: 8 }}>
              {settingModal.key === 'trade_attachment_retention_months' ? '0 = 永久保留；大於 0 會清理超過指定月份的附件檔案。' : '免費帳號的' + settingModal.label}
            </div>
            <input type="number" value={settingInput} onChange={e => setSettingInput(e.target.value)} placeholder="輸入新數值" />
            <div className="admin-modal-btns">
              <button className="btn-cancel" onClick={() => setSettingModal(null)}>取消</button>
              <button className="btn-confirm" onClick={handleSettingSave}>儲存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
