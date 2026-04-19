import { useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import { getAllLessonIds, getLesson } from '../data/lessons';
import './LearnHome.css';

const STAGES: { id: number; emoji: string; name: string; ageHint: string }[] = [
  { id: 1, emoji: '🌱', name: '小種子', ageHint: '6+' },
  { id: 2, emoji: '🌿', name: '小芽苗', ageHint: '7+' },
  { id: 3, emoji: '🌳', name: '小樹苗', ageHint: '8+' },
  { id: 4, emoji: '🧭', name: '探險家', ageHint: '9+' },
  { id: 5, emoji: '💎', name: '尋寶者', ageHint: '10+' },
  { id: 6, emoji: '♟️', name: '策略師', ageHint: '11+' },
  { id: 7, emoji: '📊', name: '分析師', ageHint: '12+' },
  { id: 8, emoji: '🎯', name: '操盤手', ageHint: '13+' },
  { id: 9, emoji: '🏆', name: '投資達人', ageHint: '14+' },
  { id: 10, emoji: '👑', name: '大師', ageHint: '15+' },
];

const XP_PER_LEVEL = 100;

export default function LearnHome() {
  const navigate = useNavigate();
  const { user, learningProfile, learningWallet, completedLessonIds, fetchLearningProfile, fetchLearningWallet, fetchCompletedLessonIds } = useStore();

  useEffect(() => {
    if (!user) return;
    if (!learningProfile) fetchLearningProfile();
    if (!learningWallet) fetchLearningWallet();
    fetchCompletedLessonIds();
  }, [user, learningProfile, learningWallet, fetchLearningProfile, fetchLearningWallet, fetchCompletedLessonIds]);

  // 找出下一堂未完成的課程
  const nextLesson = useMemo(() => {
    const allIds = getAllLessonIds(); // L001, L002, ...
    const nextId = allIds.find(id => !completedLessonIds.includes(id)) ?? allIds[allIds.length - 1];
    const lesson = getLesson(nextId);
    return { id: nextId, title: lesson?.title ?? nextId };
  }, [completedLessonIds]);

  const stage = useMemo(
    () => STAGES.find(s => s.id === (learningProfile?.currentStage ?? 1)) ?? STAGES[0],
    [learningProfile?.currentStage]
  );

  const levelInStage = ((learningProfile?.currentLevel ?? 1) - 1) % 5 + 1;
  const xpInLevel = (learningProfile?.totalXp ?? 0) % XP_PER_LEVEL;
  const xpPct = Math.min(100, (xpInLevel / XP_PER_LEVEL) * 100);

  return (
    <div className="learn-home">
      {/* 問候卡 */}
      <div className="card learn-greet">
        <div className="learn-greet-bear">🐻</div>
        <div>
          <div className="learn-greet-title">嗨 {user?.displayName ?? '小朋友'}！</div>
          <div className="learn-greet-sub">今天也來學一點投資小知識吧 ✨</div>
        </div>
      </div>

      {/* 等級卡 */}
      <div className="card learn-level-card">
        <div className="learn-level-head">
          <div className="learn-stage-badge" data-stage={stage.id}>
            <span className="learn-stage-emoji">{stage.emoji}</span>
            <div>
              <div className="learn-stage-name">{stage.name}</div>
              <div className="learn-stage-sub">Stage {stage.id} · {stage.ageHint}</div>
            </div>
          </div>
          <div className="learn-level-num">Lv.{learningProfile?.currentLevel ?? 1}</div>
        </div>
        <div className="learn-xp-row">
          <span>小等級 {levelInStage} / 5</span>
          <span>{xpInLevel} / {XP_PER_LEVEL} XP</span>
        </div>
        <div className="learn-xp-bar">
          <div className="learn-xp-fill" style={{ width: `${xpPct}%` }} />
        </div>
      </div>

      {/* 今日課程入口 */}
      <Link to={`/learn/lesson/${nextLesson.id}`} className="card learn-today-cta">
        <div className="learn-today-emoji">📚</div>
        <div className="learn-today-body">
          <div className="learn-today-title">今日課程</div>
          <div className="learn-today-desc">{nextLesson.id} · {nextLesson.title}</div>
        </div>
        <div className="learn-today-arrow">▶</div>
      </Link>

      {/* 錢包 / 連續 / 徽章 摘要 */}
      <div className="learn-stats">
        <div className="card learn-stat" style={{ cursor: 'pointer' }} onClick={() => navigate('/learn/wallet')}>
          <div className="learn-stat-emoji">🪙</div>
          <div className="learn-stat-num">{learningWallet?.balance ?? 0}</div>
          <div className="learn-stat-label">學習幣</div>
        </div>
        <div className="card learn-stat">
          <div className="learn-stat-emoji">🔥</div>
          <div className="learn-stat-num">{learningProfile?.streakDays ?? 0}</div>
          <div className="learn-stat-label">連續天數</div>
        </div>
        <div className="card learn-stat">
          <div className="learn-stat-emoji">🎯</div>
          <div className="learn-stat-num">{learningProfile?.totalQuestionsCorrect ?? 0}</div>
          <div className="learn-stat-label">答對題數</div>
        </div>
      </div>

      {/* 知識專欄（舊 Learn 頁） */}
      <Link to="/learn/articles" className="card learn-articles-link">
        <span style={{ fontSize: 28 }}>📖</span>
        <div>
          <div className="learn-articles-title">知識專欄</div>
          <div className="learn-articles-desc">閱讀式小教室：股票、股利、ETF…</div>
        </div>
        <span className="learn-today-arrow">▶</span>
      </Link>
    </div>
  );
}
