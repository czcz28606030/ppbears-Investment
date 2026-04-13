import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import type { ShopItemType } from '../types';
import './ParentRewardShopManager.css';

const ITEM_TYPE_LABELS: Record<ShopItemType, string> = {
  cash:         '💵 現金零用錢',
  product:      '🎁 實體商品',
  experience:   '🎡 體驗活動',
  invest_bonus: '📈 模擬投資加碼',
};

const PRESET_ITEMS = [
  { icon: '🧋', name: '手搖飲料一杯',   itemType: 'product'  as ShopItemType, costCoins: 50,   cashValue: null, description: '' },
  { icon: '🎮', name: '遊戲時間 30 分鐘', itemType: 'experience' as ShopItemType, costCoins: 100,  cashValue: null, description: '' },
  { icon: '💵', name: '零用錢 NT$50',    itemType: 'cash'     as ShopItemType, costCoins: 50,   cashValue: 50,  description: '' },
  { icon: '🍕', name: '家庭披薩之夜',    itemType: 'experience' as ShopItemType, costCoins: 300,  cashValue: null, description: '' },
  { icon: '📚', name: '自選一本書',       itemType: 'product'  as ShopItemType, costCoins: 200,  cashValue: null, description: '' },
];

const EMPTY_FORM = { icon: '🎁', name: '', description: '', itemType: 'product' as ShopItemType, costCoins: 100, cashValue: null as number | null };

export default function ParentRewardShopManager() {
  const navigate = useNavigate();
  const { user, shopItems, fetchShopItems, saveShopItem, deleteShopItem, toggleShopItem } = useStore();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm]         = useState({ ...EMPTY_FORM });
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState('');
  const [toast, setToast]       = useState('');

  useEffect(() => {
    if (user?.role === 'parent') fetchShopItems();
  }, [user]);

  if (!user || user.role !== 'parent') return null;

  async function handleSave() {
    if (!form.name.trim()) { setError('請輸入商品名稱'); return; }
    if (form.costCoins <= 0) { setError('學習幣數量需大於 0'); return; }
    setSaving(true); setError('');
    const { error: e } = await saveShopItem(form);
    setSaving(false);
    if (e) { setError(e); return; }
    setForm({ ...EMPTY_FORM });
    setShowForm(false);
    showToast('商品已新增 ✅');
  }

  async function handlePreset(p: typeof PRESET_ITEMS[0]) {
    setSaving(true);
    await saveShopItem(p);
    setSaving(false);
    showToast(`已新增「${p.name}」✅`);
  }

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  }

  return (
    <div className="prsm-page">
      {toast && <div className="prsm-toast">{toast}</div>}

      <div className="page-header">
        <button className="page-header-back" onClick={() => navigate('/parent/rewards')}>←</button>
        <h1 className="page-title">🛍️ 商城管理</h1>
      </div>

      {/* 現有商品 */}
      {shopItems.length > 0 && (
        <div className="prsm-section">
          <div className="prsm-section-title">目前商品（{shopItems.length} 件）</div>
          <div className="prsm-list">
            {shopItems.map(item => (
              <div key={item.id} className={`card prsm-item ${!item.isActive ? 'inactive' : ''}`}>
                <span className="prsm-item-icon">{item.icon ?? '🎁'}</span>
                <div className="prsm-item-body">
                  <div className="prsm-item-name">{item.name}</div>
                  <div className="prsm-item-meta">
                    <span className="prsm-type-badge">{ITEM_TYPE_LABELS[item.itemType]}</span>
                    <span className="prsm-cost">🪙 {item.costCoins}</span>
                    {item.cashValue != null && <span className="prsm-cash">= NT${item.cashValue}</span>}
                  </div>
                </div>
                <div className="prsm-item-actions">
                  <button
                    className={`prsm-toggle ${item.isActive ? 'active' : ''}`}
                    onClick={() => toggleShopItem(item.id, !item.isActive)}
                    title={item.isActive ? '停用' : '啟用'}
                  >
                    {item.isActive ? '✓' : '○'}
                  </button>
                  <button className="prsm-del" onClick={() => deleteShopItem(item.id)}>✕</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 快速新增預設 */}
      {shopItems.length === 0 && (
        <div className="prsm-section">
          <div className="prsm-section-title">快速新增推薦商品</div>
          <div className="prsm-presets">
            {PRESET_ITEMS.map((p, i) => (
              <button key={i} className="card prsm-preset" disabled={saving} onClick={() => handlePreset(p)}>
                <span style={{ fontSize: 28 }}>{p.icon}</span>
                <div className="prsm-preset-name">{p.name}</div>
                <div className="prsm-preset-cost">🪙 {p.costCoins}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 新增表單 */}
      {showForm ? (
        <div className="card prsm-form">
          <div className="prsm-section-title">新增商品</div>

          <div className="prsm-field">
            <label>圖示（emoji）</label>
            <input value={form.icon} maxLength={4}
              onChange={e => setForm(f => ({ ...f, icon: e.target.value }))} />
          </div>
          <div className="prsm-field">
            <label>商品名稱 <span className="required">*</span></label>
            <input placeholder="例：手搖飲料一杯"
              value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </div>
          <div className="prsm-field">
            <label>說明（選填）</label>
            <input placeholder="補充說明"
              value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          </div>
          <div className="prsm-field">
            <label>類型</label>
            <select value={form.itemType} onChange={e => setForm(f => ({ ...f, itemType: e.target.value as ShopItemType }))}>
              {(Object.entries(ITEM_TYPE_LABELS) as [ShopItemType, string][]).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </div>
          <div className="prsm-field">
            <label>兌換所需學習幣 <span className="required">*</span></label>
            <input type="number" min={1} value={form.costCoins}
              onChange={e => setForm(f => ({ ...f, costCoins: Number(e.target.value) }))} />
          </div>
          {(form.itemType === 'cash' || form.itemType === 'invest_bonus') && (
            <div className="prsm-field">
              <label>對應台幣金額（NT$）</label>
              <input type="number" min={1} placeholder="例：50"
                value={form.cashValue ?? ''} onChange={e => setForm(f => ({ ...f, cashValue: e.target.value ? Number(e.target.value) : null }))} />
            </div>
          )}
          {error && <div className="prsm-error">{error}</div>}
          <div className="prsm-form-btns">
            <button className="btn-ghost" onClick={() => { setShowForm(false); setError(''); }}>取消</button>
            <button className="btn-primary" disabled={saving} onClick={handleSave}>
              {saving ? '儲存中...' : '確認新增'}
            </button>
          </div>
        </div>
      ) : (
        <button className="btn-primary prsm-add-btn" onClick={() => setShowForm(true)}>＋ 新增商品</button>
      )}
    </div>
  );
}
