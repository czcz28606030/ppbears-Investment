import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import './ProfileSettings.css';

const STRATEGY_OPTIONS = [
  { id: 'A', label: '🏢 穩穩大公司', desc: '成交量大、PSR 評分高的穩健股' },
  { id: 'B', label: '🚀 最近變強公司', desc: '週漲 + 月漲雙確認，動能強勁' },
  { id: 'C', label: '👀 市場有注意公司', desc: '法人籌碼強度高，外資積極布局' },
  { id: 'D', label: '👴 價值潛力公司', desc: 'PSR 高品質，股價低於外資持股成本' },
  { id: 'E', label: '💰 配息安心公司', desc: '金融、電信、公用事業，月趨勢穩定' },
  { id: 'F', label: '🏷️ 便宜好公司', desc: '低於外資 + 投信持股成本，雙重折價' },
];

export default function ProfileSettings() {
  const navigate = useNavigate();
  const { user, updateProfile, uploadAvatar, logout, updateBrokerSettings, updateNewsletterStrategy, hasFeature } = useStore();
  const hasAiFeature = hasFeature('ai_stock_picking');

  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [brokerFeeRate, setBrokerFeeRate] = useState(user?.brokerFeeRate?.toString() || '0.001425');
  const [brokerMinFee, setBrokerMinFee] = useState(user?.brokerMinFee?.toString() || '20');
  const [brokerTaxRate, setBrokerTaxRate] = useState(user?.brokerTaxRate?.toString() || '0.003');

  const [newsletterStrategy, setNewsletterStrategy] = useState<string>(user?.newsletterStrategy || 'A');
  const [strategySaving, setStrategySaving] = useState(false);
  const [strategyMsg, setStrategyMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const currentAvatar = user?.avatar || '🐻';
  const isImageUrl = currentAvatar.startsWith('data:') || currentAvatar.startsWith('http');

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setMessage({ text: '請上傳圖片格式的檔案', type: 'error' });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setMessage({ text: '圖片大小不能超過 5MB', type: 'error' });
      return;
    }
    setSelectedFile(file);
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    setMessage(null);
  };

  const handleSave = async () => {
    if (!displayName.trim()) {
      setMessage({ text: '暱稱不能空白', type: 'error' });
      return;
    }
    setIsSaving(true);
    setMessage(null);

    let avatarUrl = currentAvatar;

    // 有新圖片才上傳
    if (selectedFile) {
      const result = await uploadAvatar(selectedFile);
      if (result.error || !result.url) {
        setMessage({ text: result.error || '上傳失敗', type: 'error' });
        setIsSaving(false);
        return;
      }
      avatarUrl = result.url;
    }

    const result = await updateProfile(displayName.trim(), avatarUrl);
    
    let brokerError = null;
    if (user?.role === 'parent') {
      const bfr = parseFloat(brokerFeeRate) || 0;
      const bmf = parseFloat(brokerMinFee) || 0;
      const btr = parseFloat(brokerTaxRate) || 0;
      const bResult = await updateBrokerSettings(bfr, bmf, btr);
      if (bResult.error) brokerError = bResult.error;
    }

    setIsSaving(false);

    if (result.error || brokerError) {
      setMessage({ text: result.error || brokerError || '儲存失敗', type: 'error' });
    } else {
      setMessage({ text: '✅ 設定已儲存！', type: 'success' });
      setSelectedFile(null);
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
        setPreviewUrl(null);
      }
    }
  };

  const handleStrategySave = async () => {
    setStrategySaving(true);
    setStrategyMsg(null);
    const result = await updateNewsletterStrategy(newsletterStrategy);
    setStrategySaving(false);
    if (result.error) {
      setStrategyMsg({ text: result.error, type: 'error' });
    } else {
      setStrategyMsg({ text: '✅ 電子報策略已儲存！', type: 'success' });
    }
  };

  const handleLogout = async () => {
    if (isLoggingOut) return;
    if (window.confirm('確定要登出嗎？')) {
      setIsLoggingOut(true);
      try {
        await logout();
      } finally {
        setIsLoggingOut(false);
      }
    }
  };

  return (
    <div className="settings-page">
      <div className="page-header">
        <button className="page-header-back" onClick={() => navigate('/')}>←</button>
        <h1 className="page-title">⚙️ 帳號設定</h1>
      </div>

      {/* 頭像編輯區 */}
      <div className="avatar-section">
        <div className="avatar-preview-wrap">
          {(previewUrl || isImageUrl) ? (
            <img
              src={previewUrl || currentAvatar}
              alt="頭像"
              className="avatar-preview-img"
            />
          ) : (
            <div className="avatar-preview-emoji">{currentAvatar}</div>
          )}
          <button className="avatar-edit-badge" onClick={() => fileInputRef.current?.click()}>
            📷
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp"
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />
        <button className="upload-btn" onClick={() => fileInputRef.current?.click()}>
          上傳個人照片
        </button>
        <p className="upload-hint">支援 JPG、PNG、GIF、WebP，最大 5MB</p>
      </div>

      {/* 暱稱設定 */}
      <div className="settings-card">
        <div className="settings-section-title">個人資料</div>
        <div className="settings-item">
          <label className="settings-label">😊 暱稱</label>
          <input
            type="text"
            className="settings-input"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="你的暱稱"
            maxLength={15}
          />
        </div>
        <div className="settings-item readonly">
          <label className="settings-label">📧 電子信箱</label>
          <div className="settings-value">{user?.email}</div>
        </div>
        <div className="settings-item readonly">
          <label className="settings-label">👤 帳號類型</label>
          <div className="settings-value role-badge">
            {user?.role === 'parent' ? '👨‍👩‍👧 主帳號' : '🎒 副帳號'}
          </div>
        </div>
      </div>
      {/* 券商設定 (全角色可見，副帳號唯讀) */}
      <div className="settings-card">
        <div className="settings-section-title">券商交易手續費設定</div>
        {user?.role === 'parent' ? (
          <p style={{ fontSize: '13px', color: '#888', marginBottom: '12px', padding: '0 20px' }}>
            這些設定會同步套用到您與所有副帳號的下單計算中，讓投資體驗更貼近真實。公定券商手續費為 0.1425%，證券交易稅為 0.3%。
          </p>
        ) : (
          <p style={{ fontSize: '13px', color: '#888', marginBottom: '12px', padding: '0 20px' }}>
            以下為目前主帳號設定的手續費率，讓您的投資體驗更貼近真實市場（僅供檢視）。
          </p>
        )}
        <div className="settings-item">
          <label className="settings-label">📈 買賣手續費率</label>
          <input
            type="number"
            step="0.000001"
            className="settings-input"
            value={brokerFeeRate}
            onChange={(e) => setBrokerFeeRate(e.target.value)}
            placeholder="例如 0.001425"
            disabled={user?.role !== 'parent'}
          />
        </div>
        <div className="settings-item">
          <label className="settings-label">💰 最低收費門檻</label>
          <input
            type="number"
            className="settings-input"
            value={brokerMinFee}
            onChange={(e) => setBrokerMinFee(e.target.value)}
            placeholder="例如 20"
            disabled={user?.role !== 'parent'}
          />
        </div>
        <div className="settings-item">
          <label className="settings-label">📉 賣出證交稅率</label>
          <input
            type="number"
            step="0.0001"
            className="settings-input"
            value={brokerTaxRate}
            onChange={(e) => setBrokerTaxRate(e.target.value)}
            placeholder="例如 0.003"
            disabled={user?.role !== 'parent'}
          />
        </div>
      </div>

      {/* 訊息提示 */}
      {message && (
        <div className={`settings-msg ${message.type}`}>{message.text}</div>
      )}

      {/* 儲存按鈕 */}
      <div className="settings-actions">
        <button className="save-btn" onClick={handleSave} disabled={isSaving}>
          {isSaving ? '儲存中...' : '💾 儲存設定'}
        </button>
      </div>

      {/* 電子報策略設定（只有 Premium 且無 AI 聰明選股的用戶才顯示） */}
      {user?.tier === 'premium' && !hasAiFeature && (
        <div className="settings-card">
          <div className="settings-section-title">📧 電子報策略選擇</div>
          <p style={{ fontSize: 13, color: '#888', margin: '0 0 16px', padding: '0 20px' }}>
            選擇你想收到的選股策略，每日電子報將依此策略推薦股票給你。
          </p>
          <div style={{ padding: '0 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {STRATEGY_OPTIONS.map(opt => (
              <label
                key={opt.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px',
                  borderRadius: 10, cursor: 'pointer',
                  border: newsletterStrategy === opt.id ? '2px solid var(--primary)' : '1.5px solid #eee',
                  background: newsletterStrategy === opt.id ? 'rgba(255,89,94,0.04)' : '#fafafa',
                  transition: 'all 0.15s',
                }}
              >
                <input
                  type="radio"
                  name="newsletter_strategy"
                  value={opt.id}
                  checked={newsletterStrategy === opt.id}
                  onChange={() => setNewsletterStrategy(opt.id)}
                  style={{ accentColor: 'var(--primary)', width: 16, height: 16, flexShrink: 0 }}
                />
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{opt.label}</div>
                  <div style={{ fontSize: 12, color: '#999', marginTop: 2 }}>{opt.desc}</div>
                </div>
              </label>
            ))}
          </div>
          {strategyMsg && (
            <div className={`settings-msg ${strategyMsg.type}`} style={{ margin: '12px 20px 0' }}>
              {strategyMsg.text}
            </div>
          )}
          <div style={{ padding: '16px 20px 4px' }}>
            <button className="save-btn" onClick={handleStrategySave} disabled={strategySaving}>
              {strategySaving ? '儲存中...' : '💾 儲存策略'}
            </button>
          </div>
        </div>
      )}

      {/* 登出 */}
      <div className="settings-card danger-zone">
        <div className="settings-section-title">帳號操作</div>
        <button className="logout-btn" onClick={handleLogout} disabled={isLoggingOut}>
          {isLoggingOut ? '登出中...' : '🚪 登出帳號'}
        </button>
      </div>
    </div>
  );
}
