import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import type { RewardShopItem } from '../types';
import './ShopView.css';

const ITEM_TYPE_LABEL: Record<RewardShopItem['itemType'], string> = {
  cash:         '💵 現金',
  product:      '🎁 商品',
  experience:   '🎡 體驗',
  invest_bonus: '📈 投資加碼',
};

export default function ShopView() {
  const navigate = useNavigate();
  const {
    user, learningWallet, shopItems,
    fetchShopItems, fetchLearningWallet,
    requestRedemption, fetchRedemptions, redemptions,
  } = useStore();

  const [selected,   setSelected]   = useState<RewardShopItem | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy,       setBusy]       = useState(false);
  const [toast,      setToast]      = useState('');

  useEffect(() => {
    if (!user) return;
    fetchShopItems();
    fetchLearningWallet();
    fetchRedemptions();
  }, [user]);

  if (!user) return null;

  const balance    = learningWallet?.balance ?? 0;
  const activeItems = shopItems.filter(i => i.isActive);

  // 已有 pending 申請的 itemId set
  const pendingItemIds = new Set(
    redemptions.filter(r => r.status === 'pending').map(r => r.shopItemId)
  );

  async function handleRedeem() {
    if (!selected) return;
    setBusy(true);
    const { error } = await requestRedemption(selected.id);
    setBusy(false);
    setConfirming(false);
    setSelected(null);
    if (error) {
      showToast(`申請失敗：${error}`);
    } else {
      showToast('申請已送出，等待主帳號審核 🎉');
    }
  }

  function showToast(msg: string) {
    setToast(msg); setTimeout(() => setToast(''), 3500);
  }

  return (
    <div className="shop-view">
      {toast && <div className="shop-toast">{toast}</div>}

      {/* 餘額條 */}
      <div className="card shop-balance-bar">
        <span>🪙 可用學習幣</span>
        <span className="shop-balance-num">{balance}</span>
        <button className="shop-wallet-link" onClick={() => navigate('/learn/wallet')}>查看錢包</button>
      </div>

      {activeItems.length === 0 ? (
        <div className="card shop-empty">
          <div style={{ fontSize: 52, marginBottom: 8 }}>🏪</div>
          <div>主帳號還沒有設定商城商品</div>
          <div style={{ fontSize: 'var(--font-size-xs)', marginTop: 8, color: 'var(--text-light)' }}>
            請請爸媽到「管理副帳號 → 學習獎勵管理 → 商城管理」新增商品
          </div>
        </div>
      ) : (
        <div className="shop-grid">
          {activeItems.map(item => {
            const canAfford = balance >= item.costCoins;
            const isPending = pendingItemIds.has(item.id);
            return (
              <div
                key={item.id}
                className={`card shop-item ${!canAfford ? 'unaffordable' : ''} ${isPending ? 'pending' : ''}`}
                onClick={() => { if (!isPending) { setSelected(item); setConfirming(true); } }}
              >
                <div className="shop-item-icon">{item.icon ?? '🎁'}</div>
                <div className="shop-item-name">{item.name}</div>
                {item.description && <div className="shop-item-desc">{item.description}</div>}
                <div className="shop-item-foot">
                  <span className="shop-type-badge">{ITEM_TYPE_LABEL[item.itemType]}</span>
                  <span className={`shop-item-cost ${!canAfford ? 'short' : ''}`}>
                    🪙 {item.costCoins}
                  </span>
                </div>
                {isPending && <div className="shop-pending-badge">申請中</div>}
                {!canAfford && !isPending && <div className="shop-short-badge">學習幣不足</div>}
              </div>
            );
          })}
        </div>
      )}

      {/* 我的申請快捷 */}
      {redemptions.length > 0 && (
        <div className="card shop-my-requests" onClick={() => navigate('/learn/requests')}>
          <span>📋 我的兌換申請</span>
          {pendingItemIds.size > 0 && <span className="shop-pending-count">{pendingItemIds.size} 筆待審核</span>}
          <span style={{ color: 'var(--text-light)' }}>▶</span>
        </div>
      )}

      {/* 確認 Modal */}
      {confirming && selected && (
        <div className="shop-overlay" onClick={() => setConfirming(false)}>
          <div className="card shop-modal" onClick={e => e.stopPropagation()}>
            <div className="shop-modal-icon">{selected.icon ?? '🎁'}</div>
            <div className="shop-modal-name">{selected.name}</div>
            <div className="shop-modal-rows">
              <div className="shop-modal-row">
                <span>兌換所需</span>
                <span className="shop-modal-cost">🪙 {selected.costCoins}</span>
              </div>
              <div className="shop-modal-row">
                <span>兌換後餘額</span>
                <span>{balance - selected.costCoins} 幣</span>
              </div>
            </div>
            <div className="shop-modal-note">申請送出後需等待主帳號審核</div>
            <div className="shop-modal-btns">
              <button className="btn-ghost" onClick={() => setConfirming(false)}>取消</button>
              <button className="btn-primary" disabled={busy} onClick={handleRedeem}>
                {busy ? '送出中...' : '確認申請'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
