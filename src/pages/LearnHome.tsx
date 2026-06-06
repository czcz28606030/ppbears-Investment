import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import { getAllLessonIds, getLesson } from '../data/lessons';
import './LearnHome.css';

const XP_PER_LEVEL = 100;
const CALIBRATION_STORAGE_KEY = 'ppbears.learn.mapPositions.v2';

const STAGES = [
  { id: 1, name: '理財啟蒙', ageHint: '6+', theme: '種下第一顆投資種子' },
  { id: 2, name: '存錢與目標', ageHint: '7+', theme: '把願望變成計畫' },
  { id: 3, name: '股票入門', ageHint: '8+', theme: '認識公司與股東' },
  { id: 4, name: 'ETF 與分散', ageHint: '9+', theme: '用一籃子降低風險' },
  { id: 5, name: 'K 線與趨勢', ageHint: '10+', theme: '看懂價格留下的足跡' },
  { id: 6, name: '交易規則', ageHint: '11+', theme: '買賣前先想好規則' },
  { id: 7, name: '財報判讀', ageHint: '12+', theme: '從數字看公司體質' },
  { id: 8, name: '估值與安全邊際', ageHint: '13+', theme: '不要用太貴的價格買好公司' },
  { id: 9, name: '風險控管', ageHint: '14+', theme: '保護本金才能走得久' },
  { id: 10, name: '投資品格', ageHint: '15+', theme: '耐心、紀律與誠實' },
];

const SCENES = [
  { id: 'sakura-festival', title: '春天櫻花祭', subtitle: '第 1-10 關', image: '/learn-scenes/scene-01-atmosphere.png', icon: '🌸' },
  { id: 'summer-beach', title: '夏天沙灘', subtitle: '第 11-20 關', image: '/learn-scenes/scene-02-atmosphere.png', icon: '🐚' },
  { id: 'maple-festival', title: '秋天楓葉', subtitle: '第 21-30 關', image: '/learn-scenes/scene-03-atmosphere.png', icon: '🍁' },
  { id: 'snow-festival', title: '冬天雪祭', subtitle: '第 31-40 關', image: '/learn-scenes/scene-04-atmosphere.png', icon: '❄️' },
  { id: 'deep-sea', title: '深海海底', subtitle: '第 41-50 關', image: '/learn-scenes/scene-05-atmosphere.png', icon: '🐠' },
  { id: 'sky-castle', title: '天空城堡', subtitle: '第 51-60 關', image: '/learn-scenes/scene-06-atmosphere.png', icon: '☁️' },
  { id: 'crystal-cave', title: '地底洞穴', subtitle: '第 61-70 關', image: '/learn-scenes/scene-07-atmosphere.png', icon: '💎' },
  { id: 'lakeside', title: '湖邊美景', subtitle: '第 71-80 關', image: '/learn-scenes/scene-08-atmosphere.png', icon: '🪷' },
  { id: 'firefly-forest', title: '螢火蟲森林', subtitle: '第 81-90 關', image: '/learn-scenes/scene-09-atmosphere.png', icon: '✨' },
  { id: 'lava-castle', title: '火山熔岩城堡', subtitle: '第 91-100 關', image: '/learn-scenes/scene-10-atmosphere.png', icon: '🔥' },
];

type NodePosition = { x: number; y: number };

const SAKURA_NODE_POSITIONS = [
  { x: 49.1, y: 10.6 },
  { x: 31.6, y: 20.7 },
  { x: 57.6, y: 29.9 },
  { x: 33.1, y: 39.6 },
  { x: 63.9, y: 44.1 },
  { x: 40, y: 56 },
  { x: 70.4, y: 64.6 },
  { x: 40.9, y: 76.2 },
  { x: 73.7, y: 86.1 },
  { x: 37.4, y: 94.2 },
];

const ZIGZAG_NODE_POSITIONS = [
  { x: 50, y: 11 },
  { x: 32, y: 20 },
  { x: 68, y: 29 },
  { x: 32, y: 38 },
  { x: 68, y: 47 },
  { x: 32, y: 56 },
  { x: 68, y: 65 },
  { x: 32, y: 74 },
  { x: 68, y: 83 },
  { x: 50, y: 92 },
];

const SCENE_NODE_POSITIONS: Record<string, NodePosition[]> = {
  'sakura-festival': SAKURA_NODE_POSITIONS,
  'summer-beach': [
    { x: 52.9, y: 13.9 },
    { x: 66.6, y: 25.2 },
    { x: 29.8, y: 25.3 },
    { x: 53.7, y: 36.3 },
    { x: 35.1, y: 48.4 },
    { x: 63.7, y: 58.8 },
    { x: 90.2, y: 65.5 },
    { x: 47.6, y: 73.1 },
    { x: 88.4, y: 83.7 },
    { x: 64, y: 90.1 },
  ],
  'maple-festival': [
    { x: 51.2, y: 12.3 },
    { x: 31.6, y: 20.7 },
    { x: 68.1, y: 26.1 },
    { x: 50.6, y: 33.3 },
    { x: 30.2, y: 43.4 },
    { x: 60.4, y: 50.7 },
    { x: 76.6, y: 65.5 },
    { x: 44.5, y: 63.5 },
    { x: 29, y: 75 },
    { x: 60, y: 82.9 },
  ],
  'snow-festival': [
    { x: 49.1, y: 14.3 },
    { x: 62, y: 32.5 },
    { x: 32, y: 27.9 },
    { x: 13.9, y: 41.6 },
    { x: 45.4, y: 46.1 },
    { x: 68.3, y: 60.2 },
    { x: 17, y: 67.9 },
    { x: 43.9, y: 73.6 },
    { x: 84.1, y: 85.4 },
    { x: 58.1, y: 89.2 },
  ],
  'deep-sea': [
    { x: 36.1, y: 11.8 },
    { x: 56.8, y: 21.5 },
    { x: 41.2, y: 29 },
    { x: 62.2, y: 39.3 },
    { x: 42.5, y: 47.9 },
    { x: 87.4, y: 53.2 },
    { x: 65.8, y: 60.3 },
    { x: 42.2, y: 70.6 },
    { x: 81.5, y: 75 },
    { x: 59.7, y: 86.3 },
  ],
  'sky-castle': [
    { x: 60.7, y: 14.5 },
    { x: 39.5, y: 23.5 },
    { x: 63.9, y: 33.6 },
    { x: 33.6, y: 44 },
    { x: 62.8, y: 56.1 },
    { x: 15.3, y: 58.2 },
    { x: 29.3, y: 68.7 },
    { x: 85, y: 77.2 },
    { x: 60.7, y: 80.7 },
    { x: 37.4, y: 94.2 },
  ],
  'crystal-cave': [
    { x: 47.3, y: 11.6 },
    { x: 65.1, y: 22.4 },
    { x: 36.5, y: 22.4 },
    { x: 50.8, y: 31.8 },
    { x: 36.1, y: 43.5 },
    { x: 60.2, y: 52.3 },
    { x: 44.7, y: 63.6 },
    { x: 64.8, y: 75.3 },
    { x: 82.9, y: 88.5 },
    { x: 43.2, y: 87.6 },
  ],
  lakeside: [
    { x: 44.7, y: 14.7 },
    { x: 62.3, y: 24.4 },
    { x: 32.5, y: 25.8 },
    { x: 52.6, y: 35.3 },
    { x: 65.8, y: 45.7 },
    { x: 41.9, y: 48.7 },
    { x: 57.8, y: 60.4 },
    { x: 66.4, y: 72.6 },
    { x: 83.2, y: 88.6 },
    { x: 54.3, y: 86.2 },
  ],
  'firefly-forest': [
    { x: 49.1, y: 10.6 },
    { x: 73.7, y: 23.7 },
    { x: 36.3, y: 21.5 },
    { x: 59.4, y: 31.7 },
    { x: 31.7, y: 38 },
    { x: 62.9, y: 47.2 },
    { x: 37.7, y: 56.5 },
    { x: 73.6, y: 66.9 },
    { x: 41.5, y: 78.2 },
    { x: 79.8, y: 90.3 },
  ],
  'lava-castle': [
    { x: 44.8, y: 14.4 },
    { x: 28.7, y: 25.7 },
    { x: 67.2, y: 28.1 },
    { x: 44.5, y: 37 },
    { x: 62.3, y: 46.2 },
    { x: 25.8, y: 48.8 },
    { x: 46.8, y: 58.7 },
    { x: 60.8, y: 70.6 },
    { x: 36.1, y: 80.1 },
    { x: 69.2, y: 86.3 },
  ],
};

function defaultPositionsForScene(sceneId: string): NodePosition[] {
  return SCENE_NODE_POSITIONS[sceneId] ? ZIGZAG_NODE_POSITIONS : ZIGZAG_NODE_POSITIONS;
}

type LessonNodeStatus = 'done' | 'current' | 'locked';

interface LessonNode {
  id: string;
  number: number;
  title: string;
  summary: string;
  stage: number;
  level: number;
  status: LessonNodeStatus;
  side: 'left' | 'right';
}

function lessonNumber(lessonId: string) {
  return Number(lessonId.replace(/\D/g, '')) || 0;
}

function compactText(value: string | undefined, fallback: string) {
  const text = value?.replace(/\s+/g, ' ').trim();
  return text || fallback;
}

function statusLabel(status: LessonNodeStatus) {
  if (status === 'done') return '已完成';
  if (status === 'current') return '下一關';
  return '尚未解鎖';
}

function sceneForLesson(number: number) {
  const index = Math.min(SCENES.length - 1, Math.max(0, Math.ceil(number / 10) - 1));
  return SCENES[index];
}

function lessonIconPath(lessonId: string) {
  return `/learn-icons-svg/${lessonId}.svg`;
}

export default function LearnHome() {
  const navigate = useNavigate();
  const currentNodeRef = useRef<HTMLButtonElement | null>(null);
  const [selectedNode, setSelectedNode] = useState<LessonNode | null>(null);
  const [scenePositionOverrides, setScenePositionOverrides] = useState<Record<string, NodePosition[]>>({});
  const [calibrationSaved, setCalibrationSaved] = useState(false);
  const [calibrationCopied, setCalibrationCopied] = useState(false);
  const [calibrationEnabled, setCalibrationEnabled] = useState(() => (
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('calibrate')
  ));
  const canUseCalibration = useMemo(() => {
    if (typeof window === 'undefined') return false;
    const host = window.location.hostname;
    return host === '127.0.0.1' || host === 'localhost' || host === '::1' || new URLSearchParams(window.location.search).has('calibrate');
  }, []);
  const isCalibrating = canUseCalibration && calibrationEnabled;
  const {
    user,
    learningProfile,
    learningWallet,
    completedLessonIds,
    fetchLearningProfile,
    fetchLearningWallet,
    fetchCompletedLessonIds,
  } = useStore();

  useEffect(() => {
    if (!user) return;
    if (!learningProfile) fetchLearningProfile();
    if (!learningWallet) fetchLearningWallet();
    fetchCompletedLessonIds();
  }, [user, learningProfile, learningWallet, fetchLearningProfile, fetchLearningWallet, fetchCompletedLessonIds]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(CALIBRATION_STORAGE_KEY);
      if (!saved) return;
      const parsed = JSON.parse(saved) as Record<string, NodePosition[]>;
      setScenePositionOverrides(parsed);
    } catch {
      setScenePositionOverrides({});
    }
  }, []);

  const lessonNodes = useMemo<LessonNode[]>(() => {
    const lessonIds = getAllLessonIds();
    const nextIndex = lessonIds.findIndex(id => !completedLessonIds.includes(id));

    return lessonIds.map((id, index) => {
      const lesson = getLesson(id);
      const number = lessonNumber(id);
      const status: LessonNodeStatus = completedLessonIds.includes(id)
        ? 'done'
        : index === (nextIndex === -1 ? lessonIds.length - 1 : nextIndex)
          ? 'current'
          : 'locked';

      return {
        id,
        number,
        title: compactText(lesson?.title, `第 ${number} 關`),
        summary: compactText(lesson?.summary, '完成這堂課，解鎖下一個投資觀念。'),
        stage: lesson?.stage ?? Math.ceil(number / 10),
        level: lesson?.level ?? ((number - 1) % 10) + 1,
        status,
        side: index % 2 === 0 ? 'left' : 'right',
      };
    });
  }, [completedLessonIds]);

  const allLessonsCompleted = lessonNodes.length > 0 && completedLessonIds.length >= lessonNodes.length;
  const currentNode = lessonNodes.find(node => node.status === 'current') ?? lessonNodes[lessonNodes.length - 1];
  const currentStage = STAGES.find(stage => stage.id === (learningProfile?.currentStage ?? currentNode?.stage ?? 1)) ?? STAGES[0];
  const completedCount = completedLessonIds.length;
  const totalLessons = lessonNodes.length;
  const xpInLevel = (learningProfile?.totalXp ?? 0) % XP_PER_LEVEL;
  const xpPct = Math.min(100, (xpInLevel / XP_PER_LEVEL) * 100);

  const sceneSections = useMemo(() => {
    return SCENES.map(scene => ({
      scene,
      nodes: lessonNodes.filter(node => sceneForLesson(node.number).id === scene.id),
    })).filter(section => section.nodes.length > 0);
  }, [lessonNodes]);

  useEffect(() => {
    if (!currentNode?.id) return;
    const timer = window.setTimeout(() => {
      currentNodeRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [currentNode?.id]);

  function handleStartLesson() {
    if (!selectedNode || selectedNode.status !== 'current') return;
    navigate(`/learn/lesson/${selectedNode.id}`);
  }

  function updateCalibratedPosition(sceneId: string, index: number, x: number, y: number) {
    setScenePositionOverrides(prev => {
      const base = prev[sceneId] ?? defaultPositionsForScene(sceneId);
      const next = base.map(position => ({ ...position }));
      next[index] = {
        x: Number(Math.max(0, Math.min(100, x)).toFixed(1)),
        y: Number(Math.max(0, Math.min(100, y)).toFixed(1)),
      };
      return { ...prev, [sceneId]: next };
    });
    setCalibrationSaved(false);
    setCalibrationCopied(false);
  }

  function handleCalibrationPointerDown(event: ReactPointerEvent<HTMLButtonElement>, sceneId: string, index: number) {
    if (!isCalibrating) return;
    event.preventDefault();
    event.stopPropagation();

    const sceneElement = event.currentTarget.closest('.learn-scene-section');
    if (!(sceneElement instanceof HTMLElement)) return;

    const moveTo = (clientX: number, clientY: number) => {
      const rect = sceneElement.getBoundingClientRect();
      updateCalibratedPosition(
        sceneId,
        index,
        ((clientX - rect.left) / rect.width) * 100,
        ((clientY - rect.top) / rect.height) * 100
      );
    };

    moveTo(event.clientX, event.clientY);
    event.currentTarget.setPointerCapture?.(event.pointerId);

    const handleMove = (moveEvent: PointerEvent) => {
      moveTo(moveEvent.clientX, moveEvent.clientY);
    };
    const handleUp = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp, { once: true });
  }

  function saveCalibration() {
    window.localStorage.setItem(CALIBRATION_STORAGE_KEY, JSON.stringify(scenePositionOverrides));
    setCalibrationSaved(true);
    setCalibrationCopied(false);
  }

  function resetCalibration() {
    window.localStorage.removeItem(CALIBRATION_STORAGE_KEY);
    setScenePositionOverrides({});
    setCalibrationSaved(false);
    setCalibrationCopied(false);
  }

  async function copyCalibration() {
    const text = JSON.stringify(scenePositionOverrides, null, 2);
    await navigator.clipboard?.writeText(text);
    setCalibrationCopied(true);
    setCalibrationSaved(false);
  }

  return (
    <div className={`learn-home${isCalibrating ? ' learn-home-calibrating' : ''}`}>
      <div className="learn-top-bar">
        <button className="learn-top-chip" type="button" onClick={() => navigate('/learn')}>
          <span>連續</span>
          <b>{learningProfile?.streakDays ?? 0} 天</b>
        </button>
        <button className="learn-top-chip" type="button" onClick={() => navigate('/learn/wallet')}>
          <span>學習幣</span>
          <b>{learningWallet?.balance ?? 0}</b>
        </button>
        <button className="learn-top-chip" type="button" onClick={() => navigate('/learn/articles')}>
          <span>答對</span>
          <b>{learningProfile?.totalQuestionsCorrect ?? 0} 題</b>
        </button>
        <span className="learn-top-chip learn-role-chip">
          <span>身分</span>
          <b>{user?.role === 'parent' ? '家長' : '孩子'}</b>
        </span>
      </div>

      <section className="learn-hero">
        <div className="learn-hero-copy">
          <div className="learn-kicker">Stage {currentStage.id} / {currentStage.ageHint}</div>
          <h1>{allLessonsCompleted ? '100 關全部完成' : currentStage.name}</h1>
          <p>{allLessonsCompleted ? '你已經完成全部課程，可以複習文章或兌換獎勵。' : currentStage.theme}</p>
        </div>
        <div className="learn-hero-actions">
          {!allLessonsCompleted && currentNode && (
            <button className="learn-primary-action" type="button" onClick={() => setSelectedNode(currentNode)}>
              查看第 {currentNode.number} 關
            </button>
          )}
          <Link to="/learn/shop" className="learn-secondary-action">獎勵商店</Link>
        </div>
      </section>

      <div className="learn-progress-panel">
        <div>
          <span>目前進度</span>
          <strong>{completedCount} / {totalLessons}</strong>
        </div>
        <div className="learn-progress-track" aria-label={`已完成 ${completedCount} / ${totalLessons} 堂課`}>
          <span style={{ width: `${totalLessons ? (completedCount / totalLessons) * 100 : 0}%` }} />
        </div>
        <div>
          <span>目前等級</span>
          <strong>Lv.{learningProfile?.currentLevel ?? 1}</strong>
        </div>
        <div className="learn-progress-track learn-xp-track" aria-label={`${xpInLevel} / ${XP_PER_LEVEL} XP`}>
          <span style={{ width: `${xpPct}%` }} />
        </div>
      </div>

      <nav className="learn-shortcuts" aria-label="學習功能">
        <Link to="/learn/articles">
          <span className="learn-shortcut-icon" aria-hidden="true">🌱</span>
          <span>投資文章</span>
        </Link>
        <Link to="/learn/wallet">
          <span className="learn-shortcut-icon" aria-hidden="true">🪙</span>
          <span>學習錢包</span>
        </Link>
        <Link to="/learn/requests">
          <span className="learn-shortcut-icon" aria-hidden="true">🎟️</span>
          <span>兌換紀錄</span>
        </Link>
        {user?.role === 'parent' ? (
          <Link to="/parent/rewards">
            <span className="learn-shortcut-icon" aria-hidden="true">🎁</span>
            <span>家長獎勵</span>
          </Link>
        ) : (
          <Link to="/learn/shop">
            <span className="learn-shortcut-icon" aria-hidden="true">🍯</span>
            <span>獎勵商店</span>
          </Link>
        )}
      </nav>

      <section className="learn-road" aria-label="100 堂投資學習關卡">
        {sceneSections.map(({ scene, nodes }) => {
          const positions = scenePositionOverrides[scene.id] ?? defaultPositionsForScene(scene.id);
          return (
            <div
              key={scene.id}
              className={`learn-scene-section learn-scene-${scene.id}`}
              style={{ '--scene-image': `url(${scene.image})` } as CSSProperties}
            >
              <div className="learn-scene-shade" aria-hidden="true" />
              <div className="learn-scene-header">
                <strong>{scene.title}</strong>
                <span>{scene.subtitle}</span>
              </div>

              <svg className="learn-node-links" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                {nodes.slice(0, -1).map((node, index) => {
                  const from = positions[index] ?? positions[positions.length - 1];
                  const to = positions[index + 1] ?? positions[positions.length - 1];
                  const nextNode = nodes[index + 1];
                  const linkStatus = nextNode?.status === 'current'
                    ? 'current'
                    : node.status === 'done'
                      ? 'done'
                      : 'locked';
                  return (
                    <line
                      key={`${node.id}-${nextNode?.id ?? index}`}
                      className={`learn-node-link learn-node-link-${linkStatus}`}
                      x1={from.x}
                      y1={from.y}
                      x2={to.x}
                      y2={to.y}
                    />
                  );
                })}
              </svg>

              {nodes.map((node, index) => {
                const position = positions[index] ?? positions[positions.length - 1];
                return (
                <button
                  key={node.id}
                  ref={node.status === 'current' ? currentNodeRef : undefined}
                  type="button"
                  className={`learn-lesson-node learn-lesson-${node.status}`}
                  aria-label={`第 ${node.number} 關，${node.title}，${statusLabel(node.status)}`}
                  onClick={() => {
                    if (isCalibrating) return;
                    setSelectedNode(node);
                  }}
                  onPointerDown={event => handleCalibrationPointerDown(event, scene.id, index)}
                  style={{
                    '--node-x': `${position.x}%`,
                    '--node-y': `${position.y}%`,
                    animationDelay: `${index * 0.04}s`,
                  } as CSSProperties}
                >
                  <span className="learn-node-number">
                    <img className="learn-node-icon" src={lessonIconPath(node.id)} alt="" aria-hidden="true" loading="lazy" />
                    <span className="learn-node-number-text">{node.number}</span>
                  </span>
                  <span className="learn-node-status" aria-hidden="true">{node.status === 'done' ? '✓' : ''}</span>
                </button>
                );
              })}
            </div>
          );
        })}
      </section>

      {selectedNode && (
        <div className="learn-lesson-modal" role="dialog" aria-modal="true" aria-labelledby="learn-lesson-modal-title">
          <button className="learn-modal-backdrop" type="button" aria-label="關閉課程說明" onClick={() => setSelectedNode(null)} />
          <div className="learn-modal-card">
            <button className="learn-modal-close" type="button" onClick={() => setSelectedNode(null)} aria-label="關閉">
              ×
            </button>
            <div className={`learn-modal-badge learn-modal-badge-${selectedNode.status}`}>
              {statusLabel(selectedNode.status)}
            </div>
            <div className="learn-modal-kicker">{selectedNode.id} / Level {selectedNode.level}</div>
            <h2 id="learn-lesson-modal-title">第 {selectedNode.number} 關：{selectedNode.title}</h2>
            <p>{selectedNode.summary}</p>
            {selectedNode.status === 'locked' && (
              <div className="learn-modal-hint">請先完成前面的關卡，才能解鎖這一關。</div>
            )}
            {selectedNode.status === 'done' && (
              <div className="learn-modal-hint">這關已完成，不能重複刷題領學習幣。</div>
            )}
            {selectedNode.status === 'current' && (
              <button className="learn-modal-start" type="button" onClick={handleStartLesson}>
                開始學習
              </button>
            )}
          </div>
        </div>
      )}

      {canUseCalibration && !isCalibrating && (
        <button className="learn-calibration-toggle" type="button" onClick={() => setCalibrationEnabled(true)}>
          校準地圖
        </button>
      )}

      {isCalibrating && (
        <aside className="learn-calibration-panel" aria-label="地圖校準工具">
          <strong>地圖校準模式</strong>
          <span>拖曳數字到平台中心，調完按儲存。</span>
          <div className="learn-calibration-actions">
            <button type="button" onClick={saveCalibration}>儲存座標</button>
            <button type="button" onClick={copyCalibration}>複製座標</button>
            <button type="button" onClick={resetCalibration}>重設</button>
            <button type="button" onClick={() => setCalibrationEnabled(false)}>關閉</button>
          </div>
          {calibrationSaved && <em>已儲存在這台瀏覽器。</em>}
          {calibrationCopied && <em>已複製，可貼給我硬寫進程式。</em>}
        </aside>
      )}
    </div>
  );
}
