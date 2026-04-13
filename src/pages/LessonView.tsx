import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import { getLesson } from '../data/lessons';
import type { LessonQuestion } from '../types';
import './LessonView.css';

// XP 計算
const XP_PER_CORRECT = 10;
const COMBO_MULTIPLIER = 1.5;
const TRUE_FALSE_TIME_LIMIT = 5; // 秒

type Phase = 'cards' | 'quiz' | 'results';

interface AnswerRecord {
  question: LessonQuestion;
  userAnswer: number | boolean | null; // null = 超時
  isCorrect: boolean;
  xpEarned: number;
}

// 從 preset_questions 隨機抽 2 題（choice + true_false_speed 各取一；不足就 random 取）
function pickQuestions(questions: LessonQuestion[]): LessonQuestion[] {
  const choices = questions.filter(q => q.question_type === 'choice');
  const tfs = questions.filter(q => q.question_type === 'true_false_speed');
  const picked: LessonQuestion[] = [];
  if (choices.length > 0) picked.push(choices[Math.floor(Math.random() * choices.length)]);
  if (tfs.length > 0) picked.push(tfs[Math.floor(Math.random() * tfs.length)]);
  // 不足 2 題時從剩餘隨機補
  if (picked.length < 2) {
    const rest = questions.filter(q => !picked.includes(q));
    rest.sort(() => Math.random() - 0.5);
    picked.push(...rest.slice(0, 2 - picked.length));
  }
  return picked.slice(0, 2);
}

export default function LessonView() {
  const { lessonId } = useParams<{ lessonId: string }>();
  const navigate = useNavigate();
  const { completeLesson, fetchLearningProfile } = useStore();

  const lesson = lessonId ? getLesson(lessonId) : null;

  const [phase, setPhase] = useState<Phase>('cards');
  const [cardIndex, setCardIndex] = useState(0);
  const [questions] = useState<LessonQuestion[]>(() =>
    lesson ? pickQuestions(lesson.preset_questions) : []
  );
  const [questionIndex, setQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<AnswerRecord[]>([]);
  const [selectedChoice, setSelectedChoice] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [combo, setCombo] = useState(0);
  const [tfTimeLeft, setTfTimeLeft] = useState(TRUE_FALSE_TIME_LIMIT);
  const [saving, setSaving] = useState(false);
  const [resultData, setResultData] = useState<{ xpEarned: number; coinsEarned: number; levelUp: boolean; newStreak: number } | null>(null);
  const startTimeRef = useRef(Date.now());
  const tfTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 404
  if (!lesson) {
    return (
      <div className="lesson-error">
        <div className="lesson-error-emoji">😕</div>
        <div className="lesson-error-msg">找不到課程 {lessonId}</div>
        <button className="btn-primary" onClick={() => navigate('/learn')}>回學習首頁</button>
      </div>
    );
  }

  const currentQuestion = questions[questionIndex];
  const isTrueFalse = currentQuestion?.question_type === 'true_false_speed';

  // TF 倒數計時
  const clearTfTimer = useCallback(() => {
    if (tfTimerRef.current) {
      clearInterval(tfTimerRef.current);
      tfTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (phase !== 'quiz' || !isTrueFalse || revealed) return;
    setTfTimeLeft(TRUE_FALSE_TIME_LIMIT);

    tfTimerRef.current = setInterval(() => {
      setTfTimeLeft(prev => {
        if (prev <= 1) {
          clearTfTimer();
          handleTfAnswer(null); // 超時
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return clearTfTimer;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, questionIndex, revealed]);

  // ── 答題邏輯 ──────────────────────────────

  function calcXp(isCorrect: boolean, currentCombo: number): number {
    if (!isCorrect) return 0;
    return currentCombo >= 1
      ? Math.round(XP_PER_CORRECT * COMBO_MULTIPLIER)
      : XP_PER_CORRECT;
  }

  function handleChoiceSelect(idx: number) {
    if (revealed) return;
    setSelectedChoice(idx);
  }

  function handleChoiceConfirm() {
    if (selectedChoice === null || revealed) return;
    const isCorrect = selectedChoice === (currentQuestion.correct_answer as number);
    const newCombo = isCorrect ? combo + 1 : 0;
    const xp = calcXp(isCorrect, combo);
    setCombo(newCombo);
    setRevealed(true);
    setAnswers(prev => [...prev, { question: currentQuestion, userAnswer: selectedChoice, isCorrect, xpEarned: xp }]);
  }

  function handleTfAnswer(answer: boolean | null) {
    if (revealed) return;
    clearTfTimer();
    const isCorrect = answer !== null && answer === (currentQuestion.correct_answer as boolean);
    const newCombo = isCorrect ? combo + 1 : 0;
    const xp = calcXp(isCorrect, combo);
    setCombo(newCombo);
    setRevealed(true);
    setAnswers(prev => [...prev, { question: currentQuestion, userAnswer: answer, isCorrect, xpEarned: xp }]);
  }

  async function handleNextQuestion() {
    setRevealed(false);
    setSelectedChoice(null);

    if (questionIndex + 1 < questions.length) {
      setQuestionIndex(q => q + 1);
    } else {
      // 全部答完 → 儲存結果
      setSaving(true);
      const allAnswers = answers; // 已是最新（handleChoiceConfirm/handleTfAnswer 已 push 最後一筆）
      const correct = allAnswers.filter(a => a.isCorrect).length;
      const totalXpFromQ = allAnswers.reduce((s, a) => s + a.xpEarned, 0);
      const elapsed = Math.round((Date.now() - startTimeRef.current) / 1000);
      const score = Math.round((correct / questions.length) * 100);

      const res = await completeLesson(lesson!.lesson_id, {
        questionsCorrect: correct,
        questionsTotal: questions.length,
        xpFromQuestions: totalXpFromQ,
        timeSpentSeconds: elapsed,
        score,
      });
      await fetchLearningProfile();
      setResultData({ xpEarned: res.xpEarned, coinsEarned: res.coinsEarned, levelUp: res.levelUp, newStreak: res.newStreak });
      setSaving(false);
      setPhase('results');
    }
  }

  // ── 渲染 ──────────────────────────────────

  if (phase === 'cards') {
    const card = lesson.cards[cardIndex];
    const isLast = cardIndex === lesson.cards.length - 1;
    return (
      <div className="lesson-view">
        {/* 進度列 */}
        <div className="lesson-progress-bar-wrap">
          <button className="lesson-back" onClick={() => navigate('/learn')}>✕</button>
          <div className="lesson-progress-bar">
            {lesson.cards.map((_, i) => (
              <div key={i} className={`lesson-progress-dot ${i <= cardIndex ? 'active' : ''}`} />
            ))}
          </div>
        </div>

        {/* 卡片 */}
        <div className="lesson-card-area">
          <div className="card lesson-card" key={cardIndex}>
            <div className="lesson-card-num">第 {cardIndex + 1} / {lesson.cards.length} 張</div>
            <h2 className="lesson-card-title">{card.title}</h2>
            <p className="lesson-card-body">{card.body}</p>
          </div>
        </div>

        {/* 導覽 */}
        <div className="lesson-nav">
          {cardIndex > 0 && (
            <button className="btn-ghost lesson-nav-prev" onClick={() => setCardIndex(i => i - 1)}>
              ← 上一張
            </button>
          )}
          <button
            className="btn-primary lesson-nav-next"
            onClick={() => {
              if (isLast) setPhase('quiz');
              else setCardIndex(i => i + 1);
            }}
          >
            {isLast ? '開始答題 🎯' : '下一張 →'}
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'quiz') {
    const q = currentQuestion;
    const lastAnswer = answers[answers.length - 1];

    return (
      <div className="lesson-view">
        {/* 進度列 */}
        <div className="lesson-progress-bar-wrap">
          <button className="lesson-back" onClick={() => navigate('/learn')}>✕</button>
          <div className="lesson-quiz-label">第 {questionIndex + 1} / {questions.length} 題</div>
          {combo >= 2 && <div className="lesson-combo">🔥 {combo} 連勝！</div>}
        </div>

        {/* 題目 */}
        <div className="lesson-question-box card">
          <div className="lesson-q-type-badge">
            {isTrueFalse ? '⚡ 是非急速題' : '📝 選擇題'}
          </div>
          <p className="lesson-q-text">{q.question_text}</p>
        </div>

        {/* 選擇題選項 */}
        {!isTrueFalse && q.options && (
          <div className="lesson-choices">
            {q.options.map((opt, i) => {
              let cls = 'lesson-choice';
              if (revealed) {
                if (i === (q.correct_answer as number)) cls += ' correct';
                else if (i === selectedChoice) cls += ' wrong';
              } else if (i === selectedChoice) {
                cls += ' selected';
              }
              return (
                <button key={i} className={cls} onClick={() => handleChoiceSelect(i)} disabled={revealed}>
                  <span className="lesson-choice-label">{String.fromCharCode(65 + i)}</span>
                  {opt}
                </button>
              );
            })}
          </div>
        )}

        {/* 選擇題確認按鈕 */}
        {!isTrueFalse && !revealed && (
          <button
            className="btn-primary"
            disabled={selectedChoice === null}
            onClick={handleChoiceConfirm}
          >
            確認答案
          </button>
        )}

        {/* 是非急速題 */}
        {isTrueFalse && !revealed && (
          <div className="lesson-tf-area">
            <div className="lesson-tf-timer">
              <div className="lesson-tf-timer-bar" style={{ width: `${(tfTimeLeft / TRUE_FALSE_TIME_LIMIT) * 100}%` }} />
              <span>{tfTimeLeft}</span>
            </div>
            <div className="lesson-tf-btns">
              <button className="lesson-tf-btn true" onClick={() => handleTfAnswer(true)}>⭕ 對</button>
              <button className="lesson-tf-btn false" onClick={() => handleTfAnswer(false)}>✕ 錯</button>
            </div>
          </div>
        )}

        {/* 答題回饋 */}
        {revealed && lastAnswer && (
          <div className={`lesson-feedback card ${lastAnswer.isCorrect ? 'correct' : 'wrong'}`}>
            <div className="lesson-feedback-icon">
              {lastAnswer.isCorrect ? '🎉' : lastAnswer.userAnswer === null ? '⏰' : '😅'}
            </div>
            <div className="lesson-feedback-main">
              {lastAnswer.isCorrect
                ? `答對了！+${lastAnswer.xpEarned} XP${lastAnswer.xpEarned > XP_PER_CORRECT ? ' 🔥連勝加成' : ''}`
                : lastAnswer.userAnswer === null ? '時間到！' : '答錯了～'}
            </div>
            <div className="lesson-feedback-explain">{q.explanation}</div>
            <button
              className="btn-primary lesson-feedback-next"
              onClick={handleNextQuestion}
              disabled={saving}
            >
              {saving ? '儲存中...' : questionIndex + 1 < questions.length ? '下一題 →' : '查看結果 🏆'}
            </button>
          </div>
        )}
      </div>
    );
  }

  // results
  const totalCorrect = answers.filter(a => a.isCorrect).length;
  const perfect = totalCorrect === questions.length;
  return (
    <div className="lesson-view lesson-results">
      <div className="lesson-results-hero">
        <div className="lesson-results-emoji">{perfect ? '🏆' : totalCorrect > 0 ? '⭐' : '💪'}</div>
        <h2 className="lesson-results-title">
          {perfect ? '完美通關！' : totalCorrect > 0 ? '做得不錯！' : '繼續加油！'}
        </h2>
        <div className="lesson-results-score">{totalCorrect} / {questions.length} 答對</div>
      </div>

      {resultData && (
        <div className="card lesson-xp-card">
          {resultData.levelUp && (
            <div className="lesson-levelup">🎊 升級了！</div>
          )}
          <div className="lesson-xp-earned">+{resultData.xpEarned} XP</div>
          {resultData.coinsEarned > 0 && (
            <div className="lesson-coins-earned">🪙 +{resultData.coinsEarned} 學習幣</div>
          )}
          <div className="lesson-xp-sub">
            含每日首學 +20 XP
            {resultData.newStreak > 1 ? `・連續 ${resultData.newStreak} 天 🔥` : ''}
            {resultData.coinsEarned === 0 && '・請主帳號設定發幣規則'}
          </div>
        </div>
      )}

      {/* 答題回顧 */}
      <div className="lesson-review">
        {answers.map((a, i) => (
          <div key={i} className={`card lesson-review-item ${a.isCorrect ? 'correct' : 'wrong'}`}>
            <div className="lesson-review-q">{a.question.question_text}</div>
            <div className="lesson-review-explain">{a.question.explanation}</div>
          </div>
        ))}
      </div>

      <button className="btn-primary lesson-done-btn" onClick={() => navigate('/learn')}>
        回學習首頁 🏠
      </button>
    </div>
  );
}
