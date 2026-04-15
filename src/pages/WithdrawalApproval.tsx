import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore, formatMoney } from '../store';
import './WithdrawalApproval.css';

export default function WithdrawalApproval() {
  const navigate = useNavigate();
  const { withdrawalRequests, approveWithdrawal, rejectWithdrawal, user, requestWithdrawal, availableBalance: balance } = useStore();
  const isParent = user?.role === 'parent';

  // 申請出金表單狀態
  const [wAmount, setWAmount] = useState('');
  const [wReason, setWReason] = useState('');
  const [wError, setWError] = useState('');
  const [wLoading, setWLoading] = useState(false);

  const pending = withdrawalRequests.filter(r => r.status === 'pending');
  const reviewed = withdrawalRequests.filter(r => r.status !== 'pending');

  const handleApprove = async (id: string) => {
    const result = await approveWithdrawal(id);
    if (result.error) alert('無法同意：' + result.error);
  };

  const handleReject = async (id: string) => {
    const result = await rejectWithdrawal(id);
    if (result.error) alert('操作失敗：' + result.error);
  };

  const handleSubmitWithdrawal = async () => {
    setWError('');
    const amt = parseFloat(wAmount);
    if (!amt || amt <= 0) {
      setWError('請輸入正確的出金金額');
      return;
    }
    if ((user?.availableBalance ?? 0) < amt) {
      setWError('餘額不足');
      return;
    }
    setWLoading(true);
    const result = await requestWithdrawal(amt, wReason.trim());
    setWLoading(false);
    if (result.error) {
      setWError(result.error);
    } else {
      setWAmount('');
      setWReason('');
      alert('申請已送出，等待審核！');
    }
  };

  return (
    <div className="approval-page">
      <div className="page-header">
        <button className="page-header-back" onClick={() => navigate('/')}>←</button>
        <h1 className="page-title">{isParent ? '💸 出金審核' : '💸 出金紀錄'}</h1>
        {isParent && pending.length > 0 && (
          <span className="pending-badge">{pending.length}</span>
        )}
      </div>

      {/* 子帳號申請表單 */}
      {!isParent && (
        <section className="withdrawal-form-section">
          <h2 className="form-title">✨ 申請出金</h2>
          <div className="withdrawal-form-card">
            <div className="form-balance-note">
              可用餘額：NT$ {formatMoney(user?.availableBalance ?? 0)}
            </div>

            <div className="form-group">
              <label className="form-label">申請金額（元）</label>
              <input
                type="number"
                className="form-input"
                placeholder="輸入想領取的金額"
                value={wAmount}
                onChange={(e) => setWAmount(e.target.value)}
                disabled={wLoading}
              />
            </div>

            <div className="form-group">
              <label className="form-label">申請原因（選填）</label>
              <textarea
                className="form-input form-textarea"
                placeholder="例如：買玩具、存零用錢"
                value={wReason}
                onChange={(e) => setWReason(e.target.value)}
                disabled={wLoading}
                rows={3}
              />
            </div>

            {wError && <div className="form-error">{wError}</div>}

            <button
              className="btn-withdrawal-submit"
              onClick={handleSubmitWithdrawal}
              disabled={wLoading || !wAmount}
            >
              {wLoading ? '送出中...' : '📤 送出申請'}
            </button>
          </div>
        </section>
      )}

  const pending = withdrawalRequests.filter(r => r.status === 'pending');
  const reviewed = withdrawalRequests.filter(r => r.status !== 'pending');

  const handleApprove = async (id: string) => {
    const result = await approveWithdrawal(id);
    if (result.error) alert('無法同意：' + result.error);
  };

  const handleReject = async (id: string) => {
    const result = await rejectWithdrawal(id);
    if (result.error) alert('操作失敗：' + result.error);
  };

  return (
    <div className="approval-page">
      <div className="page-header">
        <button className="page-header-back" onClick={() => navigate('/')}>←</button>
        <h1 className="page-title">{isParent ? '💸 出金審核' : '💸 出金紀錄'}</h1>
        {isParent && pending.length > 0 && (
          <span className="pending-badge">{pending.length}</span>
        )}
      </div>

      {/* 待審核 */}
      <section className="approval-section">
        <h2 className="section-title">⏳ 待審核 ({pending.length})</h2>
        {pending.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">{isParent ? '✅' : '🐻'}</div>
            <div className="empty-state-title">目前沒有待審核的申請</div>
          </div>
        ) : (
          <div className="request-list">
            {pending.map(req => (
              <div key={req.id} className="request-card pending">
                <div className="request-header">
                  {isParent && (
                    <span className="request-avatar" style={{ padding: (req.childAvatar?.startsWith('data:') || req.childAvatar?.startsWith('http')) ? 0 : undefined, overflow: 'hidden', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                      {(req.childAvatar?.startsWith('data:') || req.childAvatar?.startsWith('http'))
                        ? <img src={req.childAvatar} alt="avatar" style={{ width: '40px', height: '40px', objectFit: 'cover' }} />
                        : (req.childAvatar || '🐻')}
                    </span>
                  )}
                  <div className="request-info">
                    {isParent && <div className="request-name">{req.childName || '未知副帳號'}</div>}
                    <div className="request-date">
                      {new Date(req.createdAt).toLocaleDateString('zh-TW')} {' '}
                      {new Date(req.createdAt).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                  <div className="request-amount">
                    NT$ {formatMoney(req.amount)}
                  </div>
                </div>
                {req.reason && (
                  <div className="request-reason">💬 {req.reason}</div>
                )}
                {isParent ? (
                  <div className="request-actions">
                    <button className="btn-reject" onClick={() => handleReject(req.id)}>
                      ❌ 拒絕
                    </button>
                    <button className="btn-approve" onClick={() => handleApprove(req.id)}>
                      ✅ 同意出金
                    </button>
                  </div>
                ) : (
                  <div className="request-actions" style={{ justifyContent: 'flex-start', color: '#ffb95e', fontWeight: 'bold', fontSize: 14 }}>
                    ⏳ 等待大人審核中...
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 已審核紀錄 */}
      {reviewed.length > 0 && (
        <section className="approval-section">
          <h2 className="section-title">📋 審核紀錄</h2>
          <div className="request-list">
            {reviewed.map(req => (
              <div key={req.id} className={`request-card ${req.status}`}>
                <div className="request-header">
                  {isParent && (
                    <span className="request-avatar" style={{ padding: (req.childAvatar?.startsWith('data:') || req.childAvatar?.startsWith('http')) ? 0 : undefined, overflow: 'hidden', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                      {(req.childAvatar?.startsWith('data:') || req.childAvatar?.startsWith('http'))
                        ? <img src={req.childAvatar} alt="avatar" style={{ width: '40px', height: '40px', objectFit: 'cover' }} />
                        : (req.childAvatar || '🐻')}
                    </span>
                  )}
                  <div className="request-info">
                    {isParent && <div className="request-name">{req.childName || '未知副帳號'}</div>}
                    <div className="request-date">
                      {new Date(req.createdAt).toLocaleDateString('zh-TW')}
                    </div>
                  </div>
                  <div className="request-amount">
                    NT$ {formatMoney(req.amount)}
                  </div>
                </div>
                {req.reason && <div className="request-reason">💬 {req.reason}</div>}
                <div className={`status-badge status-${req.status}`}>
                  {req.status === 'approved' ? '✅ 已同意' : '❌ 已拒絕'}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
