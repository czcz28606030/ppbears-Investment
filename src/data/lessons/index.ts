import type { LessonData } from '../../types';

// 靜態 import：新增課程時在此擴充
import L001 from './L001.json';
import L002 from './L002.json';
import L003 from './L003.json';
import L004 from './L004.json';
import L005 from './L005.json';
import L006 from './L006.json';
import L007 from './L007.json';
import L008 from './L008.json';
import L009 from './L009.json';
import L010 from './L010.json';
import L011 from './L011.json';
import L012 from './L012.json';
import L013 from './L013.json';
import L014 from './L014.json';
import L015 from './L015.json';
import L016 from './L016.json';
import L017 from './L017.json';
import L018 from './L018.json';
import L019 from './L019.json';
import L020 from './L020.json';
import L021 from './L021.json';
import L022 from './L022.json';
import L023 from './L023.json';
import L024 from './L024.json';
import L025 from './L025.json';
import L026 from './L026.json';
import L027 from './L027.json';
import L028 from './L028.json';
import L029 from './L029.json';
import L030 from './L030.json';
import L031 from './L031.json';
import L032 from './L032.json';
import L033 from './L033.json';
import L034 from './L034.json';
import L035 from './L035.json';
import L036 from './L036.json';
import L037 from './L037.json';
import L038 from './L038.json';
import L039 from './L039.json';
import L040 from './L040.json';
import L041 from './L041.json';
import L042 from './L042.json';
import L043 from './L043.json';
import L044 from './L044.json';
import L045 from './L045.json';
import L046 from './L046.json';
import L047 from './L047.json';
import L048 from './L048.json';
import L049 from './L049.json';
import L050 from './L050.json';

const LESSON_MAP: Record<string, LessonData> = {
  L001: L001 as LessonData,
  L002: L002 as LessonData,
  L003: L003 as LessonData,
  L004: L004 as LessonData,
  L005: L005 as LessonData,
  L006: L006 as LessonData,
  L007: L007 as LessonData,
  L008: L008 as LessonData,
  L009: L009 as LessonData,
  L010: L010 as LessonData,
  L011: L011 as LessonData,
  L012: L012 as LessonData,
  L013: L013 as LessonData,
  L014: L014 as LessonData,
  L015: L015 as LessonData,
  L016: L016 as LessonData,
  L017: L017 as LessonData,
  L018: L018 as LessonData,
  L019: L019 as LessonData,
  L020: L020 as LessonData,
  L021: L021 as LessonData,
  L022: L022 as LessonData,
  L023: L023 as LessonData,
  L024: L024 as LessonData,
  L025: L025 as LessonData,
  L026: L026 as LessonData,
  L027: L027 as LessonData,
  L028: L028 as LessonData,
  L029: L029 as LessonData,
  L030: L030 as LessonData,
  L031: L031 as LessonData,
  L032: L032 as LessonData,
  L033: L033 as LessonData,
  L034: L034 as LessonData,
  L035: L035 as LessonData,
  L036: L036 as LessonData,
  L037: L037 as LessonData,
  L038: L038 as LessonData,
  L039: L039 as LessonData,
  L040: L040 as LessonData,
  L041: L041 as LessonData,
  L042: L042 as LessonData,
  L043: L043 as LessonData,
  L044: L044 as LessonData,
  L045: L045 as LessonData,
  L046: L046 as LessonData,
  L047: L047 as LessonData,
  L048: L048 as LessonData,
  L049: L049 as LessonData,
  L050: L050 as LessonData,
};

export function getLesson(lessonId: string): LessonData | null {
  return LESSON_MAP[lessonId] ?? null;
}

export function getAllLessonIds(): string[] {
  return Object.keys(LESSON_MAP);
}
