import { chapters } from "../learning/course";
import { allBanks } from "./bank";
import { correctAnswerText, type PreparedItem } from "./engine";
import { seededRng } from "./rng";
import { interleave } from "./scheduler";
import type { DerivedCard, StudyState } from "./store";

export type DeckCard = {
  id: string;
  chapterId: string;
  front: string;
  back: string;
  code?: string;
  why?: string;
  /** "missed" cards come from test items the learner got wrong. */
  origin: "authored" | "missed";
};

export function authoredCards(): DeckCard[] {
  return allBanks.flatMap((bank) =>
    bank.cards.map((card) => ({ ...card, chapterId: bank.chapterId, origin: "authored" as const })),
  );
}

export function deckCards(state: StudyState): DeckCard[] {
  const derived = Object.values(state.derivedCards).map((card) => ({
    id: card.id,
    chapterId: card.chapterId,
    front: card.front,
    back: card.back,
    code: card.code,
    why: card.why,
    origin: "missed" as const,
  }));
  return [...derived, ...authoredCards()];
}

/** Turn a missed test item into a relearning card (retrieval of the exact gap). */
export function cardFromMissedItem(item: PreparedItem, now: number): DerivedCard {
  const question = item.question;
  const front =
    question.kind === "compiles"
      ? `${question.prompt} — and why?`
      : question.kind === "output"
        ? "Predict the exact output of this program."
        : question.prompt;
  return {
    id: `missed:${item.key}`,
    chapterId: item.chapterId,
    front,
    back: correctAnswerText(question),
    code: question.code,
    why: question.explain,
    createdAt: now,
  };
}

export type SessionPlan = {
  queue: DeckCard[];
  dueCount: number;
  newCount: number;
  newAvailable: number;
  unlockedChapterIds: string[];
};

/**
 * Chapters whose cards may be introduced: any chapter the learner has started
 * (a stop cleared, code run, or a test taken) plus everything before it, since
 * the course is sequential. With `scope: "all"`, every chapter is open.
 */
export function unlockedChapters(state: StudyState, startedChapterIds: string[]): string[] {
  if (state.settings.scope === "all") return chapters.map((chapter) => chapter.id);
  const started = new Set([
    ...startedChapterIds,
    ...state.attempts.map((attempt) => attempt.segmentId),
  ]);
  let furthest = 0;
  chapters.forEach((chapter, index) => {
    if (started.has(chapter.id)) furthest = Math.max(furthest, index);
  });
  return chapters.slice(0, furthest + 1).map((chapter) => chapter.id);
}

export function planSession(input: {
  state: StudyState;
  today: number;
  startedChapterIds: string[];
  chapterFilter?: string;
  seed: number;
}): SessionPlan {
  const { state, today } = input;
  const unlocked = unlockedChapters(state, input.startedChapterIds);
  const inScope = (card: DeckCard) =>
    input.chapterFilter
      ? card.chapterId === input.chapterFilter
      : unlocked.includes(card.chapterId);
  const cards = deckCards(state).filter(inScope);
  const chapterOrder = new Map(chapters.map((chapter, index) => [chapter.id, index]));

  const due = cards
    .filter((card) => {
      const schedule = state.cards[card.id];
      return schedule !== undefined && schedule.due <= today;
    })
    .sort((a, b) => (state.cards[a.id]?.due ?? 0) - (state.cards[b.id]?.due ?? 0));

  const introducedToday = state.newCards.day === today ? state.newCards.count : 0;
  const newBudget = input.chapterFilter
    ? state.settings.newPerDay
    : Math.max(0, state.settings.newPerDay - introducedToday);
  const fresh = cards
    .filter((card) => state.cards[card.id] === undefined)
    .sort((a, b) => {
      // Missed-item cards first, then course order.
      if (a.origin !== b.origin) return a.origin === "missed" ? -1 : 1;
      return (chapterOrder.get(a.chapterId) ?? 0) - (chapterOrder.get(b.chapterId) ?? 0);
    });
  const room = Math.max(0, state.settings.sessionLimit - due.length);
  const newCards = fresh.slice(0, Math.min(newBudget, room));
  const queue = interleave(
    [...due.slice(0, state.settings.sessionLimit), ...newCards],
    seededRng(input.seed),
  );
  return {
    queue,
    dueCount: due.length,
    newCount: newCards.length,
    newAvailable: fresh.length,
    unlockedChapterIds: unlocked,
  };
}
