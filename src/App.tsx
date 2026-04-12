import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom';
import { useStore } from './store';

import Dashboard from './pages/Dashboard';
import Explore from './pages/Explore';
import Portfolio from './pages/Portfolio';
import StockDetail from './pages/StockDetail';
import Learn from './pages/Learn';
import TradeHistory from './pages/TradeHistory';
import Login from './pages/Login';
import Register from './pages/Register';
import ManageChildren from './pages/ManageChildren';
import WithdrawalApproval from './pages/WithdrawalApproval';
import ProfileSettings from './pages/ProfileSettings';
import ForgotPassword from './pages/ForgotPassword';
import UpdatePassword from './pages/UpdatePassword';

import './App.css';

const AUTH_ROUTES = ['/login', '/register', '/forgot-password'];

function AppContent() {
  const { user, authLoading, initAuth, withdrawalRequests, isRecoveryMode } = useStore();
  const location = useLocation();

  useEffect(() => {
    initAuth();
  }, [initAuth]);

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
          <Route path="/portfolio" element={<Portfolio />} />
          <Route path="/stock/:code" element={<StockDetail />} />
          <Route path="/learn" element={<Learn />} />
          <Route path="/history" element={<TradeHistory />} />

          {/* Parent-only Routes */}
          <Route path="/manage-children" element={<ManageChildren />} />
          <Route path="/withdrawal-approval" element={<WithdrawalApproval />} />

          {/* Profile Settings */}
          <Route path="/settings" element={<ProfileSettings />} />

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
              <span className="nav-label">探索</span>
            </NavLink>
            <NavLink to="/portfolio" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              <span className="nav-icon-wrap"><span className="nav-icon">💼</span></span>
              <span className="nav-label">庫存</span>
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
              <span className="nav-label">出金</span>
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
