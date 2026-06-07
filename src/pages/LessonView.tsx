import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import { getLesson } from '../data/lessons';
import LessonVisual from '../components/LessonVisual';
import type { LessonData, LessonQuestion } from '../types';
import './LessonView.css';

const XP_PER_CORRECT = 10;
const COMBO_MULTIPLIER = 1.5;
const TRUE_FALSE_TIME_LIMIT = 5;
const SAVE_WAIT_HINT_MS = 8000;
const DAILY_LESSON_LIMIT = 3;

type Phase = 'cards' | 'quiz' | 'results';

interface AnswerRecord {
  question: LessonQuestion;
  userAnswer: number | boolean | null;
  isCorrect: boolean;
  xpEarned: number;
}

function shuffleChoiceOptions(question: LessonQuestion): LessonQuestion {
  if (question.question_type !== 'choice' || !question.options || typeof question.correct_answer !== 'number') {
    return question;
  }

  const correctOption = question.options[question.correct_answer];
  const shuffledOptions = [...question.options].sort(() => Math.random() - 0.5);

  return {
    ...question,
    options: shuffledOptions,
    correct_answer: shuffledOptions.indexOf(correctOption),
  };
}

function buildDynamicQuestionPool(lesson: LessonData): LessonQuestion[] {
  return lesson.preset_questions;
}

function pickQuestions(lesson: LessonData): LessonQuestion[] {
  const target = 5;
  const shuffled = [...buildDynamicQuestionPool(lesson)].sort(() => Math.random() - 0.5);
  const choices = shuffled.filter(q => q.question_type === 'choice');
  const tfs = shuffled.filter(q => q.question_type === 'true_false_speed');

  const picked: LessonQuestion[] = [];
  const wantChoice = Math.max(2, Math.ceil(target / 2));
  const wantTf = target - wantChoice;

  picked.push(...choices.slice(0, wantChoice));
  picked.push(...tfs.slice(0, wantTf));

  if (picked.length < target) {
    const used = new Set(picked);
    const rest = shuffled.filter(q => !used.has(q));
    picked.push(...rest.slice(0, target - picked.length));
  }

  return picked
    .slice(0, target)
    .sort(() => Math.random() - 0.5)
    .map(shuffleChoiceOptions);
}

export default function LessonView() {
  const { lessonId } = useParams<{ lessonId: string }>();
  const navigate = useNavigate();
  const {
    user,
    completedLessonIds,
    todayCompletedLessonCount,
    completeLesson,
    fetchCompletedLessonIds,
    fetchTodayCompletedLessonCount,
    fetchLearningProfile,
  } = useStore();

  const lesson = lessonId ? getLesson(lessonId) : null;
  const [phase, setPhase] = useState<Phase>('cards');
  const [cardIndex, setCardIndex] = useState(0);
  const [questions, setQuestions] = useState<LessonQuestion[]>(() =>
    lesson ? pickQuestions(lesson) : []
  );
  const [questionIndex, setQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<AnswerRecord[]>([]);
  const [selectedChoice, setSelectedChoice] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [combo, setCombo] = useState(0);
  const [tfTimeLeft, setTfTimeLeft] = useState(TRUE_FALSE_TIME_LIMIT);
  const [saving, setSaving] = useState(false);
  const [saveSlowHint, setSaveSlowHint] = useState(false);
  const [resultData, setResultData] = useState<{
    xpEarned: number;
    coinsEarned: number;
    levelUp: boolean;
    newStreak: number;
    error?: string | null;
  } | null>(null);

  const startTimeRef = useRef(Date.now());
  const tfTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const saveHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const answersRef = useRef<AnswerRecord[]>([]);
  const answerLockedRef = useRef(false);

  const alreadyCompleted = Boolean(lessonId && completedLessonIds.includes(lessonId));
  const shouldShowAlreadyCompleted = alreadyCompleted && phase === 'cards' && answers.length === 0 && !resultData;
  const dailyLimitReached = !alreadyCompleted && todayCompletedLessonCount >= DAILY_LESSON_LIMIT;

  const clearTfTimer = useCallback(() => {
    if (tfTimerRef.current) {
      clearInterval(tfTimerRef.current);
      tfTimerRef.current = null;
    }
  }, []);

  const resetAttempt = useCallback(() => {
    clearTfTimer();
    if (lesson) {
      setQuestions(pickQuestions(lesson));
    }
    answersRef.current = [];
    answerLockedRef.current = false;
    startTimeRef.current = Date.now();
    setAnswers([]);
    setCardIndex(0);
    setQuestionIndex(0);
    setSelectedChoice(null);
    setRevealed(false);
    setCombo(0);
    setTfTimeLeft(TRUE_FALSE_TIME_LIMIT);
    setSaving(false);
    setSaveSlowHint(false);
    setResultData(null);
    setPhase('cards');
  }, [clearTfTimer, lesson]);

  useEffect(() => {
    if (user) {
      void fetchCompletedLessonIds();
      void fetchTodayCompletedLessonCount();
    }
  }, [user, fetchCompletedLessonIds, fetchTodayCompletedLessonCount]);

  useEffect(() => {
    if (phase !== 'quiz' || !questions[questionIndex] || questions[questionIndex].question_type !== 'true_false_speed' || revealed) return;
    setTfTimeLeft(TRUE_FALSE_TIME_LIMIT);

    tfTimerRef.current = setInterval(() => {
      setTfTimeLeft(prev => {
        if (prev <= 1) {
          clearTfTimer();
          handleTfAnswer(null);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return clearTfTimer;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, questionIndex, revealed, questions]);

  useEffect(() => {
    return () => {
      clearTfTimer();
      if (saveHintTimerRef.current) {
        clearTimeout(saveHintTimerRef.current);
        saveHintTimerRef.current = null;
      }
    };
  }, [clearTfTimer]);

  if (!lesson) {
    return (
      <div className="lesson-error">
        <div className="lesson-error-emoji">?</div>
        <div className="lesson-error-msg">找不到課程 {lessonId}</div>
        <button className="btn-primary" onClick={() => navigate('/learn')}>回到學習地圖</button>
      </div>
    );
  }

  if (shouldShowAlreadyCompleted) {
    return (
      <div className="lesson-view lesson-results">
        <div className="lesson-results-hero">
          <div className="lesson-results-emoji">?</div>
          <h2 className="lesson-results-title">這堂課已經完成了</h2>
          <div className="lesson-results-score">已領過這關的學習幣，完成過的課程不能重複刷題。</div>
        </div>
        <button className="btn-primary lesson-done-btn" onClick={() => navigate('/learn')}>
          回到學習地圖
        </button>
      </div>
    );
  }

  if (dailyLimitReached) {
    return (
      <div className="lesson-view lesson-results">
        <div className="lesson-results-hero">
          <div className="lesson-results-emoji">⏳</div>
          <h2 className="lesson-results-title">今天先休息一下</h2>
          <div className="lesson-results-score">每日最多完成 {DAILY_LESSON_LIMIT} 個學習單元，避免一次刷題。明天再繼續下一關。</div>
        </div>
        <button className="btn-primary lesson-done-btn" onClick={() => navigate('/learn')}>
          回到學習地圖
        </button>
      </div>
    );
  }

  const currentQuestion = questions[questionIndex];
  const isTrueFalse = currentQuestion?.question_type === 'true_false_speed';

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

  function recordAnswer(record: AnswerRecord) {
    if (answerLockedRef.current || answersRef.current.length > questionIndex) return false;
    answerLockedRef.current = true;
    answersRef.current = [...answersRef.current, record].slice(0, questions.length);
    setAnswers(answersRef.current);
    return true;
  }

  function handleChoiceConfirm() {
    if (!currentQuestion || selectedChoice === null || revealed) return;
    const isCorrect = selectedChoice === (currentQuestion.correct_answer as number);
    const newCombo = isCorrect ? combo + 1 : 0;
    const xp = calcXp(isCorrect, combo);
    const newRecord: AnswerRecord = { question: currentQuestion, userAnswer: selectedChoice, isCorrect, xpEarned: xp };
    if (!recordAnswer(newRecord)) return;
    setCombo(newCombo);
    setRevealed(true);
  }

  function handleTfAnswer(answer: boolean | null) {
    if (!currentQuestion || revealed) return;
    clearTfTimer();
    const isCorrect = answer !== null && answer === (currentQuestion.correct_answer as boolean);
    const newCombo = isCorrect ? combo + 1 : 0;
    const xp = calcXp(isCorrect, combo);
    const newRecord: AnswerRecord = { question: currentQuestion, userAnswer: answer, isCorrect, xpEarned: xp };
    if (!recordAnswer(newRecord)) return;
    setCombo(newCombo);
    setRevealed(true);
  }

  async function handleNextQuestion() {
    if (saving) return;

    setRevealed(false);
    setSelectedChoice(null);

    if (questionIndex + 1 < questions.length) {
      answerLockedRef.current = false;
      setQuestionIndex(q => q + 1);
      return;
    }

    const allAnswers = answersRef.current.slice(0, questions.length);
    const correct = allAnswers.filter(a => a.isCorrect).length;
    const perfect = correct === questions.length;
    const totalXpFromQ = allAnswers.reduce((s, a) => s + a.xpEarned, 0);
    const elapsed = Math.round((Date.now() - startTimeRef.current) / 1000);
    const score = Math.round((correct / questions.length) * 100);

    if (!perfect) {
      setResultData({ xpEarned: 0, coinsEarned: 0, levelUp: false, newStreak: 0 });
      setPhase('results');
      return;
    }

    setSaving(true);
    setSaveSlowHint(false);
    setResultData({ xpEarned: totalXpFromQ, coinsEarned: 0, levelUp: false, newStreak: 0 });
    saveHintTimerRef.current = setTimeout(() => {
      setSaveSlowHint(true);
    }, SAVE_WAIT_HINT_MS);

    try {
      const res = await completeLesson(lesson!.lesson_id, {
        questionsCorrect: correct,
        questionsTotal: questions.length,
        xpFromQuestions: totalXpFromQ,
        timeSpentSeconds: elapsed,
        score,
      });
      void fetchLearningProfile().catch(err => {
        console.error('fetchLearningProfile failed after completeLesson:', err);
      });
      void fetchCompletedLessonIds().catch(err => {
        console.error('fetchCompletedLessonIds failed after completeLesson:', err);
      });
      void fetchTodayCompletedLessonCount().catch(err => {
        console.error('fetchTodayCompletedLessonCount failed after completeLesson:', err);
      });
      setResultData({
        xpEarned: res.xpEarned,
        coinsEarned: res.coinsEarned,
        levelUp: res.levelUp,
        newStreak: res.newStreak,
        error: res.error,
      });
    } catch (err) {
      console.error('completeLesson failed:', err);
      setResultData({ xpEarned: 0, coinsEarned: 0, levelUp: false, newStreak: 0, error: '儲存失敗，請再試一次。' });
    } finally {
      if (saveHintTimerRef.current) {
        clearTimeout(saveHintTimerRef.current);
        saveHintTimerRef.current = null;
      }
      setSaving(false);
      setSaveSlowHint(false);
      setPhase('results');
    }
  }

  if (phase === 'cards') {
    const card = lesson.cards[cardIndex];
    const isLast = cardIndex === lesson.cards.length - 1;
    return (
      <div className="lesson-view">
        <div className="lesson-progress-bar-wrap">
          <button className="lesson-back" onClick={() => navigate('/learn')}>←</button>
          <div className="lesson-progress-bar">
            {lesson.cards.map((_, i) => (
              <div key={i} className={`lesson-progress-dot ${i <= cardIndex ? 'active' : ''}`} />
            ))}
          </div>
        </div>

        <div className="lesson-card-area">
          <div className="card lesson-card" key={cardIndex}>
            <div className="lesson-card-num">第 {cardIndex + 1} / {lesson.cards.length} 張卡</div>
            {card.image_key && <LessonVisual imageKey={card.image_key} title={card.title} />}
            <h2 className="lesson-card-title">{card.title}</h2>
            <p className="lesson-card-body">{card.body}</p>
          </div>
        </div>

        <div className="lesson-nav">
          {cardIndex > 0 && (
            <button className="btn-ghost lesson-nav-prev" onClick={() => setCardIndex(i => i - 1)}>
              上一張
            </button>
          )}
          <button
            className="btn-primary lesson-nav-next"
            onClick={() => {
              if (isLast) setPhase('quiz');
              else setCardIndex(i => i + 1);
            }}
          >
            {isLast ? '開始答題' : '下一張'}
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
        <div className="lesson-progress-bar-wrap">
          <button className="lesson-back" onClick={() => navigate('/learn')}>←</button>
          <div className="lesson-quiz-label">第 {questionIndex + 1} / {questions.length} 題</div>
          {combo >= 2 && <div className="lesson-combo">連對 {combo}</div>}
        </div>

        <div className="lesson-question-box card">
          <div className="lesson-q-type-badge">
            {isTrueFalse ? '限時是非題' : '選擇題'}
          </div>
          {q.image_key && <LessonVisual imageKey={q.image_key} title={q.question_text} />}
          <p className="lesson-q-text">{q.question_text}</p>
        </div>

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

        {!isTrueFalse && !revealed && (
          <button
            className="btn-primary"
            disabled={selectedChoice === null}
            onClick={handleChoiceConfirm}
          >
            確認答案
          </button>
        )}

        {isTrueFalse && !revealed && (
          <div className="lesson-tf-area">
            <div className="lesson-tf-timer">
              <div className="lesson-tf-timer-bar" style={{ width: `${(tfTimeLeft / TRUE_FALSE_TIME_LIMIT) * 100}%` }} />
              <span>{tfTimeLeft}</span>
            </div>
            <div className="lesson-tf-btns">
              <button className="lesson-tf-btn true" onClick={() => handleTfAnswer(true)}>對</button>
              <button className="lesson-tf-btn false" onClick={() => handleTfAnswer(false)}>錯</button>
            </div>
          </div>
        )}

        {revealed && lastAnswer && (
          <div className={`lesson-feedback card ${lastAnswer.isCorrect ? 'correct' : 'wrong'}`}>
            <div className="lesson-feedback-icon">
              {lastAnswer.isCorrect ? '✓' : lastAnswer.userAnswer === null ? '⏱' : '✕'}
            </div>
            <div className="lesson-feedback-main">
              {lastAnswer.isCorrect
                ? `答對了，+${lastAnswer.xpEarned} XP`
                : lastAnswer.userAnswer === null ? '時間到，再練一次' : '答錯了，再練一次'}
            </div>
            <div className="lesson-feedback-explain">{q.explanation}</div>
            <button
              className="btn-primary lesson-feedback-next"
              onClick={() => {
                if (saving && saveSlowHint) {
                  setPhase('results');
                  return;
                }
                void handleNextQuestion();
              }}
              disabled={saving && !saveSlowHint}
            >
              {saving
                ? (saveSlowHint ? '先看結果' : '儲存中...')
                : questionIndex + 1 < questions.length
                  ? '下一題'
                  : '看結果'}
            </button>
            {saving && saveSlowHint && (
              <div className="lesson-saving-hint">
                儲存比較久，畫面會先顯示結果；進度同步完成後會更新。
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  const resultAnswers = answers.slice(0, questions.length);
  const totalCorrect = Math.min(
    questions.length,
    resultAnswers.filter(a => a.isCorrect).length
  );
  const perfect = totalCorrect === questions.length;
  const canGoBack = perfect && Boolean(resultData?.xpEarned);

  return (
    <div className="lesson-view lesson-results">
      <div className="lesson-results-hero">
        <div className="lesson-results-emoji">{perfect ? '✓' : '↻'}</div>
        <h2 className="lesson-results-title">
          {perfect ? '全部答對，課程完成' : '還差一點，再挑戰一次'}
        </h2>
        <div className="lesson-results-score">{totalCorrect} / {questions.length} 題答對</div>
      </div>

      {resultData && (
        <div className={`card lesson-xp-card ${perfect ? '' : 'lesson-retry-card'}`}>
          {saving && (
            <div className="lesson-result-syncing">正在儲存學習進度...</div>
          )}
          {resultData.error && (
            <div className="lesson-result-error">{resultData.error}</div>
          )}
          {perfect && resultData.levelUp && (
            <div className="lesson-levelup">升級了</div>
          )}
          <div className="lesson-xp-earned">+{resultData.xpEarned} XP</div>
          {perfect && (
            <div className="lesson-coins-earned">
              本次獲得 +{resultData.coinsEarned} 學習幣
            </div>
          )}
          <div className="lesson-xp-sub">
            {perfect
              ? '課程已完成，學習幣會依照家長設定的規則發放。'
              : '答錯不會完成課程，也不會發放學習幣。請重新挑戰到全對。'}
          </div>
        </div>
      )}

      <div className="lesson-review">
        {resultAnswers.map((a, i) => (
          <div key={i} className={`card lesson-review-item ${a.isCorrect ? 'correct' : 'wrong'}`}>
            <div className="lesson-review-q">{a.question.question_text}</div>
            <div className="lesson-review-explain">{a.question.explanation}</div>
          </div>
        ))}
      </div>

      {canGoBack ? (
        <button className="btn-primary lesson-done-btn" onClick={() => navigate('/learn')}>
          回到學習地圖
        </button>
      ) : (
        <button className="btn-primary lesson-done-btn" onClick={resetAttempt}>
          重新挑戰
        </button>
      )}
    </div>
  );
}
