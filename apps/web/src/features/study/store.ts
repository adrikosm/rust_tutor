/**
 * Local study state: flashcard schedules, test attempts, and per-item history.
 *
 * Stored in localStorage under one versioned key, validated with Zod on read so
 * a corrupt or future-version value degrades to an empty state instead of
 * breaking the page. Learners can export and import it as JSON from /study.
 */
import { useSyncExternalStore } from "react";
import { z } from "zod";
import type { Confidence, ItemHistory, TestMode, TestSummary } from "./engine";
import type { CardState } from "./scheduler";

const STORAGE_KEY = "rust-tutor:study:v1";
const CHANGE_EVENT = "rust-tutor:study-changed";
const MAX_ATTEMPTS = 300;
const MAX_REVIEW_LOG = 3000;

const cardStateSchema = z.object({
  step: z.number().int().min(-1).max(10),
  due: z.number().int(),
  reps: z.number().int().min(0),
  lapses: z.number().int().min(0),
  lastReviewed: z.number().int(),
  learningHits: z.number().int().min(0),
});

const derivedCardSchema = z.object({
  id: z.string().max(200),
  chapterId: z.string().max(64),
  front: z.string().max(4000),
  back: z.string().max(4000),
  code: z.string().max(8000).optional(),
  why: z.string().max(4000).optional(),
  createdAt: z.number(),
});

const attemptSchema = z.object({
  id: z.string(),
  segmentId: z.string(),
  mode: z.enum(["exam", "practice", "pretest"]),
  seed: z.number(),
  finishedAt: z.number(),
  correct: z.number().int(),
  total: z.number().int(),
  percent: z.number(),
  sourceIds: z.array(z.string()),
  byTopic: z.array(z.object({ topic: z.string(), correct: z.number(), total: z.number() })),
  calibration: z.array(
    z.object({
      confidence: z.union([z.literal(1), z.literal(2), z.literal(3)]),
      correct: z.number(),
      total: z.number(),
    }),
  ),
});

const studySchema = z.object({
  version: z.literal(1),
  itemHistory: z.record(
    z.string(),
    z.object({
      seen: z.number(),
      correct: z.number(),
      lastCorrect: z.boolean(),
      lastSeen: z.number(),
    }),
  ),
  attempts: z.array(attemptSchema),
  cards: z.record(z.string(), cardStateSchema),
  derivedCards: z.record(z.string(), derivedCardSchema),
  reviewLog: z.array(
    z.object({
      day: z.number().int(),
      cardId: z.string(),
      grade: z.enum(["again", "hard", "good", "easy"]),
    }),
  ),
  newCards: z.object({ day: z.number().int(), count: z.number().int() }),
  settings: z.object({
    newPerDay: z.number().int().min(0).max(50),
    sessionLimit: z.number().int().min(5).max(200),
    scope: z.enum(["started", "all"]),
    typeToRecall: z.boolean(),
  }),
});

export type StudyState = z.infer<typeof studySchema>;
export type AttemptRecord = z.infer<typeof attemptSchema>;
export type DerivedCard = z.infer<typeof derivedCardSchema>;

export function emptyStudyState(): StudyState {
  return {
    version: 1,
    itemHistory: {},
    attempts: [],
    cards: {},
    derivedCards: {},
    reviewLog: [],
    newCards: { day: 0, count: 0 },
    settings: { newPerDay: 10, sessionLimit: 25, scope: "started", typeToRecall: true },
  };
}

export function parseStudyState(raw: unknown): StudyState | null {
  const parsed = studySchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

let cachedRaw: string | null | undefined;
let cachedState: StudyState = emptyStudyState();

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function loadStudy(): StudyState {
  const raw = readRaw();
  if (raw === cachedRaw) return cachedState;
  cachedRaw = raw;
  if (!raw) {
    cachedState = emptyStudyState();
    return cachedState;
  }
  try {
    cachedState = parseStudyState(JSON.parse(raw)) ?? emptyStudyState();
  } catch {
    cachedState = emptyStudyState();
  }
  return cachedState;
}

export function saveStudy(state: StudyState): void {
  const trimmed: StudyState = {
    ...state,
    attempts: state.attempts.slice(-MAX_ATTEMPTS),
    reviewLog: state.reviewLog.slice(-MAX_REVIEW_LOG),
  };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // Storage full or unavailable: keep the in-memory state for this session.
    cachedRaw = undefined;
    cachedState = trimmed;
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function updateStudy(change: (state: StudyState) => StudyState): StudyState {
  const next = change(loadStudy());
  saveStudy(next);
  return next;
}

function subscribe(callback: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) callback();
  };
  window.addEventListener(CHANGE_EVENT, callback);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, callback);
    window.removeEventListener("storage", onStorage);
  };
}

/** React binding: re-renders whenever study state changes in this or another tab. */
export function useStudyState(): StudyState {
  return useSyncExternalStore(subscribe, loadStudy, emptyStudyState);
}

/* ---- pure state transitions (unit-tested) ---- */

export function recordAttempt(
  state: StudyState,
  input: {
    segmentId: string;
    mode: TestMode;
    seed: number;
    summary: TestSummary;
    items: { key: string; sourceId: string; correct: boolean; confidence?: Confidence }[];
    derived: DerivedCard[];
    now: number;
  },
): StudyState {
  const itemHistory: ItemHistory = { ...state.itemHistory };
  for (const item of input.items) {
    const previous = itemHistory[item.sourceId] ?? {
      seen: 0,
      correct: 0,
      lastCorrect: false,
      lastSeen: 0,
    };
    itemHistory[item.sourceId] = {
      seen: previous.seen + 1,
      correct: previous.correct + (item.correct ? 1 : 0),
      lastCorrect: item.correct,
      lastSeen: input.now,
    };
  }
  const derivedCards = { ...state.derivedCards };
  // Pretests intentionally invite errors; only scored tests feed the relearning deck.
  if (input.mode !== "pretest") {
    for (const card of input.derived) derivedCards[card.id] = card;
  }
  const attempt: AttemptRecord = {
    id: `${input.segmentId}:${input.now}`,
    segmentId: input.segmentId,
    mode: input.mode,
    seed: input.seed,
    finishedAt: input.now,
    correct: input.summary.correct,
    total: input.summary.total,
    percent: input.summary.percent,
    sourceIds: input.items.map((item) => item.sourceId),
    byTopic: input.summary.byTopic,
    calibration: input.summary.calibration,
  };
  return { ...state, itemHistory, derivedCards, attempts: [...state.attempts, attempt] };
}

export function applyReview(
  state: StudyState,
  input: {
    cardId: string;
    next: CardState;
    grade: "again" | "hard" | "good" | "easy";
    today: number;
    wasNew: boolean;
  },
): StudyState {
  const newCards = input.wasNew
    ? {
        day: input.today,
        count: (state.newCards.day === input.today ? state.newCards.count : 0) + 1,
      }
    : state.newCards;
  return {
    ...state,
    cards: { ...state.cards, [input.cardId]: input.next },
    reviewLog: [...state.reviewLog, { day: input.today, cardId: input.cardId, grade: input.grade }],
    newCards,
  };
}

export function segmentStats(state: StudyState, segmentId: string) {
  const attempts = state.attempts.filter(
    (attempt) => attempt.segmentId === segmentId && attempt.mode !== "pretest",
  );
  const best = attempts.reduce<number | null>(
    (max, attempt) => (max === null || attempt.percent > max ? attempt.percent : max),
    null,
  );
  return { attempts: attempts.length, best, last: attempts.at(-1) };
}

/** Retention over the last `days`: share of reviews of graduated cards not graded "again". */
export function retention(state: StudyState, today: number, days = 30): number | null {
  const recent = state.reviewLog.filter((entry) => entry.day > today - days);
  if (recent.length < 10) return null;
  const recalled = recent.filter((entry) => entry.grade !== "again").length;
  return recalled / recent.length;
}
