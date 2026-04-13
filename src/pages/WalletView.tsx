import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import type { WalletTransaction } from '../types';
import './WalletView.css';

const TX_META: Record<WalletTransaction['txType'], { emoji: string; label: string; sign: 1 | -1 }> = {
  earn:         { emoji: '⭐', label: '學習獎勵',   sign:  1 },
  parent_grant: { emoji: '🎁', label: '父母發放',   sign:  1 },
  refund:       { emoji: '↩️', label: '退款',        sign:  1 },
  unfreeze:     { emoji: '🔓', label: '解凍',        sign:  1 },
  redeem:       { emoji: '🛍️', label: '兌換商品',   sign: -1 },
  freeze:       { emoji: '🔒', label: '凍結中',      sign: -1 },
};

function formatDate(iso: string) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function WalletView() {
  const navigate = useNavigate();
  const { user, learningWallet, learningWalletTxs, fetchLearningWallet, fetchWalletTransactions } = useStore();

  useEffect(() => {
    if (!user) return;
    fetchLearningWallet();
    fetchWalletTransactions();
  }, [user, fetchLearningWallet, fetchWalletTransactions]);

  const balance = learningWallet?.balance ?? 0;
  const frozen  = learningWallet?.frozen  ?? 0;

  return (
    <div className="wallet-view">
      {/* 餘額卡 */}
      <div className="card wallet-balance-card">
        <div className="wallet-coin-icon">🪙</div>
        <div className="wallet-balance-label">學習幣餘額</div>
        <div className="wallet-balance-num">{balance.toLocaleString()}</div>
        {frozen > 0 && (
          <div className="wallet-frozen-row">
            <span>🔒 凍結中</span>
            <span className="wallet-frozen-num">−{frozen}</span>
          </div>
        )}
        <div className="wallet-rate-note">1 學習幣 ＝ NT$1（由主帳號設定兌換規則）</div>
      </div>

      {/* 統計小格 */}
      <div className="wallet-stats">
        <div className="card wallet-stat">
          <div className="wallet-stat-val">{learningWallet?.totalEarned ?? 0}</div>
          <div className="wallet-stat-label">累計獲得</div>
        </div>
        <div className="card wallet-stat">
          <div className="wallet-stat-val">{learningWallet?.totalSpent ?? 0}</div>
          <div className="wallet-stat-label">累計兌換</div>
        </div>
      </div>

      {/* 前往商城 */}
      <button className="btn-primary wallet-shop-btn" onClick={() => navigate('/learn/shop')}>
        🛍️ 逛獎勵商城
      </button>

      {/* 異動紀錄 */}
      <div className="wallet-history-title">異動紀錄</div>
      {learningWalletTxs.length === 0 ? (
        <div className="card wallet-empty">
          <div style={{ fontSize: 48, marginBottom: 8 }}>📭</div>
          <div>還沒有紀錄，快去完成今日課程賺幣吧！</div>
          <button className="btn-primary" style={{ marginTop: 16 }} onClick={() => navigate('/learn')}>
            去學習
          </button>
        </div>
      ) : (
        <div className="wallet-tx-list">
          {learningWalletTxs.map(tx => {
            const meta = TX_META[tx.txType];
            const isPositive = meta.sign === 1;
            return (
              <div key={tx.id} className="card wallet-tx-item">
                <div className="wallet-tx-emoji">{meta.emoji}</div>
                <div className="wallet-tx-body">
                  <div className="wallet-tx-desc">{tx.description ?? meta.label}</div>
                  {tx.parentMessage && (
                    <div className="wallet-tx-msg">💬 {tx.parentMessage}</div>
                  )}
                  <div className="wallet-tx-date">{formatDate(tx.createdAt)}</div>
                </div>
                <div className={`wallet-tx-amount ${isPositive ? 'earn' : 'spend'}`}>
                  {isPositive ? '+' : ''}{tx.amount}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
