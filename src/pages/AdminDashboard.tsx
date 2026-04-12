import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore, formatMoney } from '../store';
import type { UserAccount, FeatureOverride } from '../types';
import './AdminDashboard.css';

const FEATURE_KEYS = [
  { key: 'ai_stock_picking', label: '🤖 AI 聰明選股', desc: '探索頁的 AI 推薦' },
  { key: 'ai_portfolio_advice', label: '📊 庫存 AI 建議', desc: 'Simons 量化買賣建議' },
];

export default function AdminDashboard() {
  const navigate = useNavigate();
  const { user, allUsers, loadAllUsers, adminSetUserTier, adminDeleteUser, adminSetUserBalance,
    adminSetFeatureOverride, adminRemoveFeatureOverride, loadFeatureOverridesForUser,
    systemSettings, adminUpdateSetting } = useStore();

  const [search, setSearch] = useState('');
  const [balanceModal, setBalanceModal] = useState<{ userId: string; name: string; current: number } | null>(null);
  const [balanceInput, setBalanceInput] = useState('');
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  const [userFeatures, setUserFeatures] = useState<Record<string, FeatureOverride[]>>({});
  const [tierModal, setTierModal] = useState<{ userId: string; name: string } | null>(null);
  const [tierDays, setTierDays] = useState('30');
  const [settingModal, setSettingModal] = useState<{ key: string; label: string; value: number } | null>(null);
  const [settingInput, setSettingInput] = useState('');

  useEffect(() => {
    if (user?.isAdmin) loadAllUsers();
  }, [user]);

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

  const filtered = allUsers.filter(u => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return u.email.toLowerCase().includes(q) || u.displayName.toLowerCase().includes(q);
  });

  const handleUpgrade = async (u: UserAccount) => {
    setTierModal({ userId: u.id, name: u.displayName });
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
        {filtered.map(u => (
          <div key={u.id} className="admin-user-card">
            <div className="admin-user-header">
              <div className="admin-user-avatar">
                {u.avatar.startsWith('http') || u.avatar.startsWith('data:') ?
                  <img src={u.avatar} alt="" style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover' }} /> : u.avatar}
              </div>
              <div className="admin-user-info">
                <div className="admin-user-name">{u.displayName}</div>
                <div className="admin-user-email">{u.email}</div>
                <div className="admin-user-balance">💰 NT$ {formatMoney(u.availableBalance)}</div>
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
              <button className="admin-btn admin-btn-feature" onClick={() => toggleFeaturePanel(u.id)}>🔧 功能開關</button>
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
                        <div style={{ fontSize: 11, color: '#999' }}>{feat.desc}</div>
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
        ))}
      </div>

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
      {/* 系統設定編輯彈窗 */}
      {settingModal && (
        <div className="admin-modal-overlay" onClick={() => setSettingModal(null)}>
          <div className="admin-modal" onClick={e => e.stopPropagation()}>
            <h3>✏️ 調整 {settingModal.label}</h3>
            <div style={{ fontSize: 13, color: '#888', marginBottom: 8 }}>免費帳號的{settingModal.label}</div>
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
