import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import './ProfileSettings.css';

export default function ProfileSettings() {
  const navigate = useNavigate();
  const { user, updateProfile, uploadAvatar, logout, updateBrokerSettings } = useStore();

  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [brokerFeeRate, setBrokerFeeRate] = useState(user?.brokerFeeRate?.toString() || '0.001425');
  const [brokerMinFee, setBrokerMinFee] = useState(user?.brokerMinFee?.toString() || '20');
  const [brokerTaxRate, setBrokerTaxRate] = useState(user?.brokerTaxRate?.toString() || '0.003');

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
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

  const handleLogout = async () => {
    if (window.confirm('確定要登出嗎？')) {
      await logout();
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
      {/* 券商設定 (僅主帳號) */}
      {user?.role === 'parent' && (
        <div className="settings-card">
          <div className="settings-section-title">券商交易手續費設定</div>
          <p style={{ fontSize: '13px', color: '#888', marginBottom: '12px' }}>
            這些設定會同步套用到您與所有副帳號的下單計算中，讓投資體驗更貼近真實。公定券商手續費為 0.1425%，證券交易稅為 0.3%。
          </p>
          <div className="settings-item">
            <label className="settings-label">📈 買賣手續費率</label>
            <input
              type="number"
              step="0.000001"
              className="settings-input"
              value={brokerFeeRate}
              onChange={(e) => setBrokerFeeRate(e.target.value)}
              placeholder="例如 0.001425 (千分之1.425)"
            />
          </div>
          <div className="settings-item">
            <label className="settings-label">💰 最低收費門檻 (即低消，NT$)</label>
            <input
              type="number"
              className="settings-input"
              value={brokerMinFee}
              onChange={(e) => setBrokerMinFee(e.target.value)}
              placeholder="例如 20"
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
              placeholder="例如 0.003 (千分之3)"
            />
          </div>
        </div>
      )}

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

      {/* 登出 */}
      <div className="settings-card danger-zone">
        <div className="settings-section-title">帳號操作</div>
        <button className="logout-btn" onClick={handleLogout}>
          🚪 登出帳號
        </button>
      </div>
    </div>
  );
}
