import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore, TRIGGER_LABELS, REWARD_TEMPLATES } from '../store';
import type { RewardTriggerType } from '../types';
import './ParentRewardsSetup.css';

const TEMPLATE_INFO = {
  light: {
    emoji: '🌱', name: '輕鬆型',
    desc: '低壓力入門方案，適合剛開始建立習慣',
    monthly: 'NT$ 150–250 / 月',
  },
  standard: {
    emoji: '⚡', name: '標準型（推薦）',
    desc: '均衡激勵，維持學習動力的最佳選擇',
    monthly: 'NT$ 300–500 / 月',
  },
  intensive: {
    emoji: '🔥', name: '激勵型',
    desc: '高獎勵推動短期衝刺，適合目標導向的孩子',
    monthly: 'NT$ 600–1,000 / 月',
  },
} as const;

type TemplateKey = keyof typeof TEMPLATE_INFO;

const TRIGGER_DISPLAY_ORDER: RewardTriggerType[] = [
  'daily_complete', 'level_up', 'stage_up',
  'streak_7', 'streak_30', 'perfect_score', 'badge',
];

export default function ParentRewardsSetup() {
  const navigate = useNavigate();
  const { user, rewardRules, fetchRewardRules, applyRewardTemplate, deleteRewardRule } = useStore();
  const [applying, setApplying] = useState<TemplateKey | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [toast, setToast] = useState('');

  useEffect(() => {
    if (user?.role === 'parent') fetchRewardRules();
  }, [user, fetchRewardRules]);

  if (!user || user.role !== 'parent') {
    return (
      <div className="parent-rewards-setup">
        <div className="card" style={{ textAlign: 'center', padding: 'var(--space-xl)' }}>
          此頁面僅供主帳號使用
        </div>
      </div>
    );
  }

  async function handleApplyTemplate(tpl: TemplateKey) {
    setApplying(tpl);
    const { error } = await applyRewardTemplate(tpl);
    setApplying(null);
    if (error) {
      showToast(`套用失敗：${error}`);
    } else {
      showToast(`已套用「${TEMPLATE_INFO[tpl].name}」方案 ✅`);
    }
  }

  async function handleDelete(ruleId: string) {
    setDeleting(ruleId);
    await deleteRewardRule(ruleId);
    setDeleting(null);
  }

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  }

  // 依觸發類型分組現有規則（非 custom）
  const activeMap = Object.fromEntries(
    rewardRules
      .filter(r => r.triggerType !== 'custom' && r.isActive)
      .map(r => [r.triggerType, r])
  );
  const customRules = rewardRules.filter(r => r.triggerType === 'custom');
  const hasAnyRule = rewardRules.length > 0;

  return (
    <div className="parent-rewards-setup">
      {toast && <div className="prs-toast">{toast}</div>}

      {/* 說明 */}
      <div className="card prs-intro">
        <div className="prs-intro-emoji">🎁</div>
        <div>
          <div className="prs-intro-title">獎勵規則設定</div>
          <div className="prs-intro-desc">
            設定孩子完成學習時的自動發幣規則。<br />
            學習幣與台幣 1:1，可兌換你在商城設定的獎勵。
          </div>
        </div>
      </div>

      {/* 現況 */}
      {hasAnyRule && (
        <div className="card prs-current">
          <div className="prs-section-title">目前啟用的規則</div>
          <div className="prs-rule-list">
            {TRIGGER_DISPLAY_ORDER.filter(t => activeMap[t]).map(t => {
              const rule = activeMap[t];
              return (
                <div key={t} className="prs-rule-row">
                  <span className="prs-rule-label">{TRIGGER_LABELS[t]}</span>
                  <span className="prs-rule-amount">+{rule.amount} 幣</span>
                  <button
                    className="prs-rule-del"
                    disabled={deleting === rule.id}
                    onClick={() => handleDelete(rule.id)}
                  >
                    ✕
                  </button>
                </div>
              );
            })}
            {customRules.map(r => (
              <div key={r.id} className="prs-rule-row custom">
                <span className="prs-rule-label">🔧 {r.triggerLabel ?? '自訂'}</span>
                <span className="prs-rule-amount">+{r.amount} 幣</span>
                <button
                  className="prs-rule-del"
                  disabled={deleting === r.id}
                  onClick={() => handleDelete(r.id)}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 快速套用模板 */}
      <div className="prs-section-title">
        {hasAnyRule ? '換個方案（會取代現有非自訂規則）' : '選擇發幣方案'}
      </div>

      {(Object.entries(TEMPLATE_INFO) as [TemplateKey, typeof TEMPLATE_INFO[TemplateKey]][]).map(([key, info]) => {
        const amounts = REWARD_TEMPLATES[key];
        return (
          <div key={key} className="card prs-template">
            <div className="prs-tpl-head">
              <span className="prs-tpl-emoji">{info.emoji}</span>
              <div className="prs-tpl-info">
                <div className="prs-tpl-name">{info.name}</div>
                <div className="prs-tpl-desc">{info.desc}</div>
                <div className="prs-tpl-monthly">{info.monthly}</div>
              </div>
            </div>

            <div className="prs-tpl-amounts">
              {(Object.entries(amounts) as [RewardTriggerType, number][]).map(([t, amt]) => (
                <div key={t} className="prs-tpl-row">
                  <span>{TRIGGER_LABELS[t]}</span>
                  <span className="prs-tpl-amt">+{amt} 幣</span>
                </div>
              ))}
            </div>

            <button
              className="btn-primary prs-apply-btn"
              disabled={applying !== null}
              onClick={() => handleApplyTemplate(key)}
            >
              {applying === key ? '套用中...' : `套用「${info.name}」`}
            </button>
          </div>
        );
      })}

      {/* 提示：自訂規則在 Slice 4 完整父母端 */}
      <div className="card prs-hint">
        <span style={{ fontSize: 20 }}>💡</span>
        <span>
          完整父母端（手動發幣、商城管理、兌換審核）
          即將在下一版本開放。
        </span>
      </div>

      <button className="btn-ghost" onClick={() => navigate(-1)}>← 返回</button>
    </div>
  );
}
