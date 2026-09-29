/**
 * Flashcard scheduling: successive relearning over fixed, expanding intervals.
 *
 * - New cards must be retrieved correctly twice in their first session before
 *   they graduate (retrieval to criterion; Rawson & Dunlosky, 2011).
 * - A failed review re-enters the current session and must be recalled before
 *   the session ends, then restarts at the shortest interval (relearning).
 * - Intervals expand 1 · 3 · 7 · 21 · 45 · 90 days (spacing effect; the optimal
 *   gap grows with the retention interval — Cepeda et al., 2008).
 * - Only the first grade of a day moves a card along the ladder, so same-day
 *   repetitions (massed practice) never inflate the interval.
 * See docs/adr/ADR-019-study-deck-scheduling.md.
 */
import type { Rng } from "./types";

export const INTERVAL_DAYS = [1, 3, 7, 21, 45, 90] as const;
export const MATURE_STEP = 3;

export type Grade = "again" | "hard" | "good" | "easy";

export type CardState = {
  /** Index into INTERVAL_DAYS; -1 while the card is still in first-session learning. */
  step: number;
  due: number;
  reps: number;
  lapses: number;
  lastReviewed: number;
  /** Correct retrievals so far in the first session (criterion is 2). */
  learningHits: number;
};

export const NEW_CARD_CRITERION = 2;

/** Local calendar day number, so "due today" follows the learner's midnight. */
export function dayNumber(date: Date = new Date()): number {
  return Math.floor((date.getTime() - date.getTimezoneOffset() * 60_000) / 86_400_000);
}

export type ScheduleResult = {
  next: CardState;
  /** The card must come back later in this session. */
  requeue: boolean;
};

export function schedule(
  current: CardState | undefined,
  grade: Grade,
  today: number,
): ScheduleResult {
  const base: CardState = current ?? {
    step: -1,
    due: today,
    reps: 0,
    lapses: 0,
    lastReviewed: today,
    learningHits: 0,
  };
  const reps = base.reps + 1;

  // First-session learning: retrieve to criterion before graduating.
  if (base.step < 0) {
    if (grade === "easy") {
      return {
        next: {
          ...base,
          step: 1,
          due: today + INTERVAL_DAYS[1],
          reps,
          lastReviewed: today,
          learningHits: NEW_CARD_CRITERION,
        },
        requeue: false,
      };
    }
    if (grade === "again" || grade === "hard") {
      return {
        next: { ...base, due: today, reps, lastReviewed: today, learningHits: 0 },
        requeue: true,
      };
    }
    const hits = base.learningHits + 1;
    if (hits >= NEW_CARD_CRITERION) {
      return {
        next: {
          ...base,
          step: 0,
          due: today + INTERVAL_DAYS[0],
          reps,
          lastReviewed: today,
          learningHits: hits,
        },
        requeue: false,
      };
    }
    return {
      next: { ...base, due: today, reps, lastReviewed: today, learningHits: hits },
      requeue: true,
    };
  }

  if (grade === "again") {
    return {
      next: {
        ...base,
        step: 0,
        due: today + INTERVAL_DAYS[0],
        reps,
        // Count one lapse per day, however many times the card is missed in-session.
        lapses: base.lastReviewed === today ? base.lapses : base.lapses + 1,
        lastReviewed: today,
      },
      requeue: true,
    };
  }

  // A repeat within the same day confirms recall but does not advance the card.
  if (base.lastReviewed === today) {
    return { next: { ...base, reps }, requeue: false };
  }

  const last = INTERVAL_DAYS.length - 1;
  const step =
    grade === "hard"
      ? Math.max(0, base.step)
      : grade === "good"
        ? Math.min(last, base.step + 1)
        : Math.min(last, base.step + 2);
  return {
    next: { ...base, step, due: today + (INTERVAL_DAYS[step] ?? 90), reps, lastReviewed: today },
    requeue: false,
  };
}

/** Human-readable preview of where each grade would send a card. */
export function previewIntervals(
  current: CardState | undefined,
  today: number,
): Record<Grade, string> {
  const label = (result: ScheduleResult) => {
    if (result.requeue) return "this session";
    const days = result.next.due - today;
    return days <= 0 ? "today" : days === 1 ? "1 day" : `${days} days`;
  };
  return {
    again: label(schedule(current, "again", today)),
    hard: label(schedule(current, "hard", today)),
    good: label(schedule(current, "good", today)),
    easy: label(schedule(current, "easy", today)),
  };
}

/**
 * Order a session so cards from the same chapter are not adjacent where it can
 * be avoided (interleaving), while keeping the most urgent cards early.
 */
export function interleave<T extends { chapterId: string }>(items: T[], rng: Rng): T[] {
  const remaining = [...items];
  const out: T[] = [];
  let previous: string | undefined;
  while (remaining.length > 0) {
    const window = remaining.slice(0, 6);
    const candidates = window.filter((item) => item.chapterId !== previous);
    const pool = candidates.length > 0 ? candidates : window;
    const choice = pool[Math.floor(rng() * Math.min(pool.length, 3))] ?? pool[0];
    if (!choice) break;
    remaining.splice(remaining.indexOf(choice), 1);
    out.push(choice);
    previous = choice.chapterId;
  }
  return out;
}
