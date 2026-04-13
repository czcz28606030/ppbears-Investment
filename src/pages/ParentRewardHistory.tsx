import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import './ParentRewardHistory.css';

const TX_META: Record<string, { emoji: string; label: string }> = {
  earn_lesson:    { emoji: '📖', label: '課程完成' },
  earn_streak:    { emoji: '🔥', label: '連續學習' },
  earn_level_up:  { emoji: '⬆️', label: '升等獎勵' },
  earn_stage_up:  { emoji: '🏆', label: '升階獎勵' },
  earn_perfect:   { emoji: '💯', label: '完美作答' },
  earn_manual:    { emoji: '🎁', label: '手動發幣' },
  spend_redeem:   { emoji: '🛍️', label: '兌換商品' },
  freeze_redeem:  { emoji: '⏳', label: '凍結申請' },
  unfreeze:       { emoji: '↩️', label: '申請退回' },
};

export default function ParentRewardHistory() {
  const navigate = useNavigate();
  const { user, children, loadChildren, childrenTxLog, fetchChildrenTransactions } = useStore();

  useEffect(() => {
    if (!user || user.role !== 'parent') return;
    if (children.length === 0) loadChildren().then(() => fetchChildrenTransactions());
    else fetchChildrenTransactions();
  }, [user]);

  if (!user || user.role !== 'parent') return null;

  const childMap = Object.fromEntries(children.map(c => [c.id, c]));

  return (
    <div className="prh-page">
      <div className="page-header">
        <button className="page-header-back" onClick={() => navigate('/parent/rewards')}>←</button>
        <h1 className="page-title">📜 學習幣異動紀錄</h1>
      </div>

      {childrenTxLog.length === 0 ? (
        <div className="card prh-empty">
          <div style={{ fontSize: 48 }}>🪙</div>
          <div>還沒有任何學習幣異動</div>
        </div>
      ) : (
        <div className="card prh-list">
          {childrenTxLog.map(tx => {
            const child = childMap[tx.userId];
            const meta = TX_META[tx.source ?? ''] ?? { emoji: '🪙', label: tx.source ?? '異動' };
            const isEarn = tx.txType === 'earn';
            return (
              <div key={tx.id} className="prh-row">
                <div className="prh-emoji">{meta.emoji}</div>
                <div className="prh-info">
                  <div className="prh-label">{meta.label}</div>
                  {child && (
                    <div className="prh-child">
                      <span>{child.avatar}</span>
                      <span>{child.displayName}</span>
                    </div>
                  )}
                  {tx.description && <div className="prh-desc">{tx.description}</div>}
                  {tx.parentMessage && <div className="prh-msg">「{tx.parentMessage}」</div>}
                  <div className="prh-date">
                    {new Date(tx.createdAt).toLocaleDateString('zh-TW', {
                      month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
                    })}
                  </div>
                </div>
                <div className={`prh-amount ${isEarn ? 'earn' : 'spend'}`}>
                  {isEarn ? '+' : '-'}{Math.abs(tx.amount)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
