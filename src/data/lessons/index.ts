import type { LessonData } from '../../types';

// 靜態 import：新增課程時在此擴充
import L001 from './L001.json';

const LESSON_MAP: Record<string, LessonData> = {
  L001: L001 as LessonData,
};

export function getLesson(lessonId: string): LessonData | null {
  return LESSON_MAP[lessonId] ?? null;
}

export function getAllLessonIds(): string[] {
  return Object.keys(LESSON_MAP);
}
