import { useStore } from '../store';

export default function AdBanner() {
  const { isPremiumUser } = useStore();
  
  if (isPremiumUser()) return null;

  return (
    <div style={{
      background: 'linear-gradient(135deg, #7B2CBF 0%, #9C27B0 50%, #E040FB 100%)',
      borderRadius: 16, padding: '14px 20px', margin: '16px 0',
      display: 'flex', alignItems: 'center', gap: 12,
      boxShadow: '0 4px 16px rgba(123,44,191,0.25)',
    }}>
      <span style={{ fontSize: 28 }}>💎</span>
      <div style={{ flex: 1 }}>
        <div style={{ color: '#fff', fontWeight: 800, fontSize: 14 }}>升級 Premium 會員</div>
        <div style={{ color: 'rgba(255,255,255,0.85)', fontSize: 12, marginTop: 2 }}>解鎖無限持股、無限交易、AI 智慧選股</div>
      </div>
      <div style={{
        background: '#FFD700', color: '#5D4037', padding: '6px 14px',
        borderRadius: 20, fontWeight: 800, fontSize: 12, whiteSpace: 'nowrap',
      }}>
        了解更多
      </div>
    </div>
  );
}
