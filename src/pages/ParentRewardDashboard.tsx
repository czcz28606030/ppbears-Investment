import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import './ParentRewardDashboard.css';

export default function ParentRewardDashboard() {
  const navigate = useNavigate();
  const { user, children, rewardRules, redemptions, fetchRewardRules, fetchRedemptions, loadChildren } = useStore();

  useEffect(() => {
    if (!user || user.role !== 'parent') return;
    fetchRewardRules();
    fetchRedemptions();
    if (children.length === 0) loadChildren();
  }, [user]);

  if (!user || user.role !== 'parent') {
    return <div className="prd-page"><div className="card" style={{ textAlign: 'center', padding: 32 }}>此頁面僅供主帳號使用</div></div>;
  }

  const pendingCount   = redemptions.filter(r => r.status === 'pending').length;
  const activeRules    = rewardRules.filter(r => r.isActive).length;

  const MENU = [
    {
      emoji: '📋', title: '發幣規則', desc: `${activeRules} 條規則啟用中`,
      path: '/parent/rewards/rules', badge: 0,
    },
    {
      emoji: '🛍️', title: '獎勵商城管理', desc: '新增/編輯可兌換商品',
      path: '/parent/rewards/shop', badge: 0,
    },
    {
      emoji: '✅', title: '兌換審核', desc: pendingCount > 0 ? `${pendingCount} 筆待審核` : '目前無待審核',
      path: '/parent/rewards/review', badge: pendingCount,
    },
    {
      emoji: '🎁', title: '手動發幣', desc: '一鍵發學習幣給孩子',
      path: '/parent/rewards/grant', badge: 0,
    },
    {
      emoji: '📜', title: '異動紀錄', desc: '查看所有學習幣收支',
      path: '/parent/rewards/history', badge: 0,
    },
  ];

  return (
    <div className="prd-page">
      <div className="page-header">
        <button className="page-header-back" onClick={() => navigate('/manage-children')}>←</button>
        <h1 className="page-title">🎁 獎勵管理</h1>
      </div>

      {/* 摘要統計 */}
      <div className="prd-stats">
        <div className="card prd-stat">
          <div className="prd-stat-num">{children.length}</div>
          <div className="prd-stat-label">副帳號</div>
        </div>
        <div className="card prd-stat">
          <div className="prd-stat-num">{activeRules}</div>
          <div className="prd-stat-label">發幣規則</div>
        </div>
        <div className="card prd-stat prd-stat-pending" onClick={() => pendingCount > 0 && navigate('/parent/rewards/review')}>
          <div className="prd-stat-num" style={{ color: pendingCount > 0 ? 'var(--action)' : undefined }}>{pendingCount}</div>
          <div className="prd-stat-label">待審核</div>
        </div>
      </div>

      {/* 快捷選單 */}
      <div className="prd-menu">
        {MENU.map(item => (
          <div key={item.path} className="card prd-menu-item" onClick={() => navigate(item.path)}>
            <span className="prd-menu-emoji">{item.emoji}</span>
            <div className="prd-menu-body">
              <div className="prd-menu-title">{item.title}</div>
              <div className="prd-menu-desc">{item.desc}</div>
            </div>
            {item.badge > 0 && <span className="prd-badge">{item.badge}</span>}
            <span className="prd-menu-arrow">▶</span>
          </div>
        ))}
      </div>
    </div>
  );
}
