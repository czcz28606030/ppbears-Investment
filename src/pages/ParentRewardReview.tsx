import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import './ParentRewardReview.css';

function fmtDate(iso: string) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

const STATUS_LABEL = {
  pending:  { text: '待審核', cls: 'pending' },
  approved: { text: '已核可', cls: 'approved' },
  rejected: { text: '已駁回', cls: 'rejected' },
  cancelled:{ text: '已取消', cls: 'cancelled' },
};

export default function ParentRewardReview() {
  const navigate = useNavigate();
  const { user, children, redemptions, fetchRedemptions, approveRedemption, rejectRedemption, loadChildren } = useStore();
  const [noteModal, setNoteModal] = useState<{ id: string; action: 'approve' | 'reject' } | null>(null);
  const [note, setNote]   = useState('');
  const [busy, setBusy]   = useState(false);
  const [toast, setToast] = useState('');

  useEffect(() => {
    if (!user || user.role !== 'parent') return;
    fetchRedemptions();
    if (children.length === 0) loadChildren();
  }, [user]);

  if (!user || user.role !== 'parent') return null;

  const childMap = Object.fromEntries(children.map(c => [c.id, c]));
  const pending  = redemptions.filter(r => r.status === 'pending');
  const resolved = redemptions.filter(r => r.status !== 'pending');

  async function handleConfirm() {
    if (!noteModal) return;
    setBusy(true);
    const fn = noteModal.action === 'approve' ? approveRedemption : rejectRedemption;
    const { error } = await fn(noteModal.id, note);
    setBusy(false);
    setNoteModal(null);
    setNote('');
    showToast(error ? `操作失敗：${error}` : noteModal.action === 'approve' ? '已核可 ✅' : '已駁回');
  }

  function showToast(msg: string) {
    setToast(msg); setTimeout(() => setToast(''), 3000);
  }

  const RedemptionCard = ({ r }: { r: typeof redemptions[0] }) => {
    const child  = childMap[r.childId];
    const status = STATUS_LABEL[r.status];
    return (
      <div className={`card prr-card ${r.status}`}>
        <div className="prr-card-head">
          <span className="prr-child-avatar">{child?.avatar ?? '🐻'}</span>
          <div className="prr-card-info">
            <div className="prr-child-name">{child?.displayName ?? '副帳號'}</div>
            <div className="prr-item-name">{r.itemName}</div>
          </div>
          <div className="prr-right">
            <div className="prr-cost">🪙 {r.costCoins}</div>
            <div className={`prr-status ${status.cls}`}>{status.text}</div>
          </div>
        </div>
        <div className="prr-date">{fmtDate(r.requestedAt)}</div>
        {r.parentNote && <div className="prr-note">💬 {r.parentNote}</div>}
        {r.status === 'pending' && (
          <div className="prr-actions">
            <button className="prr-btn reject" onClick={() => { setNoteModal({ id: r.id, action: 'reject' }); setNote(''); }}>
              ✕ 駁回
            </button>
            <button className="prr-btn approve" onClick={() => { setNoteModal({ id: r.id, action: 'approve' }); setNote(''); }}>
              ✓ 核可
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="prr-page">
      {toast && <div className="prr-toast">{toast}</div>}

      <div className="page-header">
        <button className="page-header-back" onClick={() => navigate('/parent/rewards')}>←</button>
        <h1 className="page-title">✅ 兌換審核</h1>
      </div>

      {/* 待審核 */}
      {pending.length > 0 ? (
        <div className="prr-section">
          <div className="prr-section-title">待審核（{pending.length} 筆）</div>
          {pending.map(r => <RedemptionCard key={r.id} r={r} />)}
        </div>
      ) : (
        <div className="card prr-empty">
          <div style={{ fontSize: 48 }}>🎉</div>
          <div>目前沒有待審核的兌換申請</div>
        </div>
      )}

      {/* 已處理 */}
      {resolved.length > 0 && (
        <div className="prr-section">
          <div className="prr-section-title">最近紀錄</div>
          {resolved.slice(0, 20).map(r => <RedemptionCard key={r.id} r={r} />)}
        </div>
      )}

      {/* 留言 Modal */}
      {noteModal && (
        <div className="prr-overlay" onClick={() => setNoteModal(null)}>
          <div className="card prr-modal" onClick={e => e.stopPropagation()}>
            <div className="prr-modal-title">
              {noteModal.action === 'approve' ? '✓ 確認核可' : '✕ 確認駁回'}
            </div>
            <textarea
              className="prr-note-input"
              rows={3}
              placeholder="留言給孩子（選填）"
              value={note}
              onChange={e => setNote(e.target.value)}
            />
            <div className="prr-modal-btns">
              <button className="btn-ghost" onClick={() => setNoteModal(null)}>取消</button>
              <button
                className={`btn-primary ${noteModal.action === 'reject' ? 'danger' : ''}`}
                disabled={busy}
                onClick={handleConfirm}
              >
                {busy ? '處理中...' : noteModal.action === 'approve' ? '確認核可' : '確認駁回'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
