import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import './ChildRequestsView.css';

const STATUS_LABEL: Record<string, string> = {
  pending:   '申請中',
  approved:  '已核准',
  rejected:  '已拒絕',
  cancelled: '已取消',
};

export default function ChildRequestsView() {
  const navigate = useNavigate();
  const { user, redemptions, fetchRedemptions, shopItems, fetchShopItems } = useStore();

  useEffect(() => {
    if (!user) return;
    fetchRedemptions();
    fetchShopItems();
  }, [user]);

  if (!user) return null;

  const sorted = [...redemptions].sort(
    (a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime()
  );

  return (
    <div className="crv-page">
      <div className="page-header">
        <button className="page-header-back" onClick={() => navigate('/learn/shop')}>←</button>
        <h1 className="page-title">📋 我的兌換申請</h1>
      </div>

      {sorted.length === 0 ? (
        <div className="card crv-empty">
          <div style={{ fontSize: 48 }}>🛍️</div>
          <div>還沒有兌換申請</div>
          <button className="btn-primary" style={{ marginTop: 8 }} onClick={() => navigate('/learn/shop')}>
            去商城逛逛
          </button>
        </div>
      ) : (
        <div className="crv-list">
          {sorted.map(r => {
            const item = shopItems.find(s => s.id === r.shopItemId);
            return (
              <div key={r.id} className={`card crv-card crv-${r.status}`}>
                <div className="crv-card-head">
                  <div className="crv-icon">{item?.icon ?? '🎁'}</div>
                  <div className="crv-info">
                    <div className="crv-item-name">{r.itemName}</div>
                    <div className="crv-date">
                      {new Date(r.requestedAt).toLocaleDateString('zh-TW')}
                    </div>
                  </div>
                  <div className="crv-right">
                    <div className="crv-cost">🪙 {r.costCoins}</div>
                    <div className={`crv-status crv-status-${r.status}`}>{STATUS_LABEL[r.status] ?? r.status}</div>
                  </div>
                </div>
                {r.parentNote && (
                  <div className="crv-note">主帳號留言：{r.parentNote}</div>
                )}
                {r.resolvedAt && (
                  <div className="crv-resolved">
                    審核時間：{new Date(r.resolvedAt).toLocaleDateString('zh-TW')}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
