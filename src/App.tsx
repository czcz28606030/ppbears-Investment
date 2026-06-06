import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom';
import { useStore } from './store';

import Dashboard from './pages/Dashboard';
import Explore from './pages/Explore';
import Portfolio from './pages/Portfolio';
import StockDetail from './pages/StockDetail';
import LearnHome from './pages/LearnHome';
import LearnArticles from './pages/LearnArticles';
import LessonView from './pages/LessonView';
import WalletView from './pages/WalletView';
import Backtest from './pages/Backtest';
import ParentRewardsSetup from './pages/ParentRewardsSetup';
import ParentRewardDashboard from './pages/ParentRewardDashboard';
import ParentRewardShopManager from './pages/ParentRewardShopManager';
import ParentRewardReview from './pages/ParentRewardReview';
import ParentRewardGrant from './pages/ParentRewardGrant';
import ShopView from './pages/ShopView';
import ChildRequestsView from './pages/ChildRequestsView';
import ParentRewardHistory from './pages/ParentRewardHistory';
import TradeHistory from './pages/TradeHistory';
import DividendHistory from './pages/DividendHistory';
import Login from './pages/Login';
import Register from './pages/Register';
import ManageChildren from './pages/ManageChildren';
import WithdrawalApproval from './pages/WithdrawalApproval';
import ProfileSettings from './pages/ProfileSettings';
import AdminDashboard from './pages/AdminDashboard';
import ForgotPassword from './pages/ForgotPassword';
import UpdatePassword from './pages/UpdatePassword';
import Watchlist from './pages/Watchlist';

import './App.css';

const AUTH_ROUTES = ['/login', '/register', '/forgot-password'];

function AppContent() {
  const { session, user, authLoading, initAuth, withdrawalRequests, isRecoveryMode } = useStore();
  const location = useLocation();
  const [profileWaitExpired, setProfileWaitExpired] = useState(false);

  useEffect(() => {
    initAuth();
  }, [initAuth]);

  useEffect(() => {
    if (!session || user) {
      setProfileWaitExpired(false);
      return;
    }

    const timerId = window.setTimeout(() => {
      setProfileWaitExpired(true);
    }, 12000);
    return () => window.clearTimeout(timerId);
  }, [session, user]);

  // 全頁載入中
  if (authLoading) {
    return (
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-primary)' }}>
        <img src="/ppbear.png" alt="PPBear" style={{ width: 72, marginBottom: 16, animation: 'pulse 1.5s ease-in-out infinite' }} />
        <div style={{ color: 'var(--text-secondary)', fontSize: 15 }}>連線到雲端中... 🐻☁️</div>
      </div>
    );
  }

  const isAuthRoute = AUTH_ROUTES.includes(location.pathname);
  const pendingCount = withdrawalRequests.filter(r => r.status === 'pending').length;

  // 密碼恢復模式優先導向
  if (isRecoveryMode && location.pathname !== '/update-password') {
    return <Navigate to="/update-password" replace />;
  }

  // 重新整理深層頁面時，Supabase session 會先回來，user profile 會稍晚載入。
  // 這段時間保持在原頁等待，避免 /stock/:code 先被導到 login，再被送回首頁。
  if (session && !user && !isAuthRoute && location.pathname !== '/update-password') {
    if (profileWaitExpired) {
      return (
        <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, background: 'var(--bg-primary)', padding: 24, textAlign: 'center' }}>
          <img src="/ppbear.png" alt="PPBear" style={{ width: 72, marginBottom: 4 }} />
          <div style={{ color: 'var(--text-primary)', fontSize: 18, fontWeight: 900 }}>帳號資料載入逾時</div>
          <div style={{ color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.6, maxWidth: 320 }}>
            系統有登入紀錄，但雲端帳號資料沒有成功回來。請重新整理或回登入頁重新登入。
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
            <button className="btn-secondary" type="button" onClick={() => window.location.reload()}>重新整理</button>
            <button className="btn-primary" type="button" onClick={() => useStore.getState().logout()}>回登入頁</button>
          </div>
        </div>
      );
    }

    return (
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-primary)' }}>
        <img src="/ppbear.png" alt="PPBear" style={{ width: 72, marginBottom: 16, animation: 'pulse 1.5s ease-in-out infinite' }} />
        <div style={{ color: 'var(--text-secondary)', fontSize: 15 }}>正在帶你回到原本頁面...</div>
      </div>
    );
  }

  // 未登入 → 導向 login
  if (!user && !isAuthRoute && location.pathname !== '/update-password') return <Navigate to="/login" replace />;
  // 已登入 → 不要再去 login/register
  if (user && isAuthRoute) return <Navigate to="/" replace />;

  return (
    <div className="app-layout">
      <main className="app-content">
        <Routes>
          {/* Auth Routes */}
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/update-password" element={<UpdatePassword />} />

          {/* Main App Routes */}
          <Route path="/" element={<Dashboard />} />
          <Route path="/explore" element={<Explore />} />
          <Route path="/watchlist" element={<Watchlist />} />
          <Route path="/portfolio" element={<Portfolio />} />
          <Route path="/stock/:code" element={<StockDetail />} />
          <Route path="/learn" element={<LearnHome />} />
          <Route path="/learn/articles" element={<LearnArticles />} />
          <Route path="/learn/lesson/:lessonId" element={<LessonView />} />
          <Route path="/learn/wallet" element={<WalletView />} />
          <Route path="/history" element={<TradeHistory />} />
          <Route path="/dividends" element={<DividendHistory />} />
          <Route path="/backtest" element={<Backtest />} />

          {/* Parent-only Routes */}
          <Route path="/manage-children" element={<ManageChildren />} />
          <Route path="/parent/rewards" element={<ParentRewardDashboard />} />
          <Route path="/parent/rewards/rules" element={<ParentRewardsSetup />} />
          <Route path="/parent/rewards/shop" element={<ParentRewardShopManager />} />
          <Route path="/parent/rewards/review" element={<ParentRewardReview />} />
          <Route path="/parent/rewards/grant" element={<ParentRewardGrant />} />
          <Route path="/learn/shop" element={<ShopView />} />
          <Route path="/learn/requests" element={<ChildRequestsView />} />
          <Route path="/parent/rewards/history" element={<ParentRewardHistory />} />
          <Route path="/withdrawal-approval" element={<WithdrawalApproval />} />

          {/* Profile Settings */}
          <Route path="/settings" element={<ProfileSettings />} />

          {/* Admin */}
          <Route path="/admin" element={<AdminDashboard />} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      {/* 底部導覽列（只在登入後顯示） */}
      {user && !isAuthRoute && location.pathname !== '/update-password' && (
        <nav className="bottom-nav">
          <div className="bottom-nav-inner">
            <NavLink to="/" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} end>
              <span className="nav-icon-wrap"><span className="nav-icon">🏠</span></span>
              <span className="nav-label">首頁</span>
            </NavLink>
            <NavLink to="/explore" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              <span className="nav-icon-wrap"><span className="nav-icon">🔍</span></span>
              <span className="nav-label">找股票</span>
            </NavLink>
            <NavLink to="/watchlist" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              <span className="nav-icon-wrap"><span className="nav-icon">👁️</span></span>
              <span className="nav-label">觀察</span>
            </NavLink>
            <NavLink to="/portfolio" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              <span className="nav-icon-wrap"><span className="nav-icon">💼</span></span>
              <span className="nav-label">看庫存</span>
            </NavLink>

            <NavLink to="/withdrawal-approval" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              <span className="nav-icon-wrap" style={{ position: 'relative' }}>
                <span className="nav-icon">💸</span>
                {user.role === 'parent' && pendingCount > 0 && (
                  <span style={{
                    position: 'absolute', top: 2, right: 2,
                    background: '#FF595E', color: '#fff',
                    borderRadius: 10, fontSize: 9, fontWeight: 900,
                    minWidth: 15, height: 15, display: 'flex',
                    alignItems: 'center', justifyContent: 'center', padding: '0 3px',
                    border: '2px solid white',
                  }}>{pendingCount}</span>
                )}
              </span>
              <span className="nav-label">申請出金</span>
            </NavLink>

            <NavLink to="/learn" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              <span className="nav-icon-wrap"><span className="nav-icon">📚</span></span>
              <span className="nav-label">學習</span>
            </NavLink>
          </div>
        </nav>
      )}
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  );
}

export default App;
