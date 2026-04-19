import { useEffect, useState } from 'react';
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
  const {
    user,
    children,
    redemptions,
    fetchRedemptions,
    shopItems,
    fetchShopItems,
    loadChildren,
    approveRedemption,
    rejectRedemption,
  } = useStore();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState('');

  useEffect(() => {
    if (!user) return;
    fetchRedemptions();
    fetchShopItems();
    if (user.role === 'parent' && children.length === 0) {
      loadChildren();
    }
  }, [user]);

  if (!user) return null;

  const isParent = user.role === 'parent';
  const childMap = Object.fromEntries(children.map(child => [child.id, child]));

  const sorted = [...redemptions].sort(
    (a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime()
  );

  async function handleDecision(requestId: string, action: 'approve' | 'reject') {
    const confirmed = window.confirm(action === 'approve' ? '確定要核可這筆兌換申請嗎？' : '確定要拒絕這筆兌換申請嗎？');
    if (!confirmed) return;

    setBusyId(requestId);
    const result = action === 'approve'
      ? await approveRedemption(requestId, '')
      : await rejectRedemption(requestId, '');
    setBusyId(null);

    const message = result.error
      ? `操作失敗：${result.error}`
      : action === 'approve'
        ? '已核可兌換申請'
        : '已拒絕兌換申請';
    setToast(message);
    setTimeout(() => setToast(''), 3000);
  }

  return (
    <div className="crv-page">
      {toast && <div className="crv-toast">{toast}</div>}

      <div className="page-header">
        <button className="page-header-back" onClick={() => navigate('/learn/shop')}>←</button>
        <h1 className="page-title">📋 {isParent ? '待審兌換申請' : '我的兌換申請'}</h1>
      </div>

      {sorted.length === 0 ? (
        <div className="card crv-empty">
          <div style={{ fontSize: 48 }}>{isParent ? '✅' : '🛍️'}</div>
          <div>{isParent ? '目前沒有待審核的兌換申請' : '還沒有兌換申請'}</div>
          <button className="btn-primary" style={{ marginTop: 8 }} onClick={() => navigate('/learn/shop')}>
            {isParent ? '返回獎勵商城' : '去商城逛逛'}
          </button>
        </div>
      ) : (
        <div className="crv-list">
          {sorted.map(r => {
            const item = shopItems.find(s => s.id === r.shopItemId);
            const child = childMap[r.childId];
            return (
              <div key={r.id} className={`card crv-card crv-${r.status}`}>
                <div className="crv-card-head">
                  <div className="crv-icon">{item?.icon ?? '🎁'}</div>
                  <div className="crv-info">
                    {isParent && <div className="crv-child-name">{child?.displayName ?? '副帳號'}</div>}
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
                {isParent && r.status === 'pending' && (
                  <div className="crv-actions">
                    <button
                      className="crv-btn crv-btn-reject"
                      disabled={busyId === r.id}
                      onClick={() => void handleDecision(r.id, 'reject')}
                    >
                      {busyId === r.id ? '處理中...' : '拒絕'}
                    </button>
                    <button
                      className="crv-btn crv-btn-approve"
                      disabled={busyId === r.id}
                      onClick={() => void handleDecision(r.id, 'approve')}
                    >
                      {busyId === r.id ? '處理中...' : '同意'}
                    </button>
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
