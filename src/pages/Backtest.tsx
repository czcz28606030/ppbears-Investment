import { useStore } from '../store';
import './Backtest.css';

export default function Backtest() {
  const { user } = useStore();
  return (
    <div className="backtest-page">
      <div className="page-header backtest-header">
        <h1 className="page-title">📊 週榜趨勢歷史驗證</h1>
      </div>
      {!user?.isAdmin ? (
        <div className="backtest-premium-lock">
          <div className="backtest-premium-lock-icon">🔒</div>
          <h2>管理員專屬功能</h2>
          <p>此功能僅限管理員使用。</p>
        </div>
      ) : (
        <div className="backtest-config-panel">
          <h2 className="config-group-title">歷史資料持續收集中</h2>
          <p style={{ color: 'var(--text-secondary)', lineHeight: 1.8 }}>
            週榜趨勢規則已開始保存實際觀察到的週榜候選與官方日K。
            新策略回測需要各交易日當時已保存的候選資格、完整行情與成交模擬；目前尚未提供績效報告。
          </p>
          <p style={{ color: 'var(--text-secondary)', lineHeight: 1.8 }}>
            目前週榜不能用來回填過去的選股資格。舊版選股與訊號回測已停用，
            既有歷史資料與報告保留，屬於舊版來源，不能視為週榜趨勢策略的報酬。
          </p>
          <p style={{ color: 'var(--text-secondary)', lineHeight: 1.8 }}>
            個股頁可查看目前規則狀態，以及具備當時候選資格或真實交易紀錄的歷史事件。
          </p>
        </div>
      )}
    </div>
  );
}
