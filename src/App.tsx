import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import Explore from './pages/Explore';
import Portfolio from './pages/Portfolio';
import StockDetail from './pages/StockDetail';
import Learn from './pages/Learn';
import './App.css';

function App() {
  return (
    <BrowserRouter>
      <div className="app-layout">
        <main className="app-content">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/explore" element={<Explore />} />
            <Route path="/portfolio" element={<Portfolio />} />
            <Route path="/stock/:code" element={<StockDetail />} />
            <Route path="/learn" element={<Learn />} />
          </Routes>
        </main>
        <nav className="bottom-nav">
          <div className="bottom-nav-inner">
            <NavLink to="/" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} end>
              <span className="nav-icon">🏠</span>
              <span className="nav-label">首頁</span>
            </NavLink>
            <NavLink to="/explore" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              <span className="nav-icon">🔍</span>
              <span className="nav-label">探索</span>
            </NavLink>
            <NavLink to="/portfolio" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              <span className="nav-icon">💼</span>
              <span className="nav-label">庫存</span>
            </NavLink>
            <NavLink to="/learn" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              <span className="nav-icon">📚</span>
              <span className="nav-label">學習</span>
            </NavLink>
          </div>
        </nav>
      </div>
    </BrowserRouter>
  );
}

export default App;
