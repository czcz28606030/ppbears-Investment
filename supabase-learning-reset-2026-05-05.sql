-- PPBears Learning reset, 2026-05-05
-- Purpose:
--   1. Reset learning course progress for every account.
--   2. Preserve existing learning coins and wallet transaction history.
--   3. Prevent the same user from completing the same lesson more than once.
--
-- Run this in Supabase SQL Editor after deploying the app changes.

BEGIN;

-- Clear course completion records only. This does not touch learning_wallet or wallet_transactions.
DELETE FROM public.lesson_progress;

-- Reset profile progression. current_level starts at 1 because the table CHECK allows 1..50.
UPDATE public.learning_profiles
SET
  current_level = 1,
  current_stage = 1,
  total_xp = 0,
  streak_days = 0,
  longest_streak = 0,
  last_learn_date = NULL,
  total_lessons_completed = 0,
  total_questions_correct = 0,
  total_questions_answered = 0,
  updated_at = now();

-- Database guard against duplicate completion and duplicate coin grants per lesson.
CREATE UNIQUE INDEX IF NOT EXISTS lesson_progress_user_lesson_unique
  ON public.lesson_progress (user_id, lesson_id);

COMMIT;
