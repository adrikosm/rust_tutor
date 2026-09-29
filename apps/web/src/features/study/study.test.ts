import { describe, expect, it } from "vitest";
import { chapters } from "../learning/course";
import { allBanks, bankByChapter } from "./bank";
import { validateBankStructure } from "./bank-rules";
import { cardFromMissedItem, planSession, unlockedChapters } from "./deck";
import {
  assembleTest,
  isCorrect,
  listSegments,
  normalizeRecall,
  segmentById,
  shuffleOptions,
  summarize,
} from "./engine";
import { seededRng } from "./rng";
import { INTERVAL_DAYS, interleave, schedule } from "./scheduler";
import { applyReview, emptyStudyState, parseStudyState, recordAttempt, retention } from "./store";
import type { Question } from "./types";

const chapterSegment = (id: string) => {
  const segment = segmentById(id);
  if (!segment) throw new Error(`missing segment ${id}`);
  return segment;
};

describe("question bank", () => {
  it("has a valid bank for every course chapter", () => {
    expect(validateBankStructure(allBanks)).toEqual([]);
    for (const chapter of chapters) expect(bankByChapter.has(chapter.id), chapter.id).toBe(true);
  });

  it("offers chapter, strand, and mixed segments", () => {
    const segments = listSegments();
    expect(segments.filter((segment) => segment.kind === "chapter")).toHaveLength(chapters.length);
    expect(segments.filter((segment) => segment.kind === "strand").length).toBeGreaterThanOrEqual(
      5,
    );
    expect(segments.filter((segment) => segment.kind === "mixed")).toHaveLength(1);
  });
});

describe("test assembly", () => {
  const segment = chapterSegment("ownership");

  it("rebuilds the identical form from the same seed", () => {
    const a = assembleTest({ segment, seed: 42, mode: "exam" });
    const b = assembleTest({ segment, seed: 42, mode: "exam" });
    expect(b).toEqual(a);
  });

  it("draws a different form for almost every seed", () => {
    const forms = new Set<string>();
    for (let seed = 1; seed <= 60; seed += 1) {
      const form = assembleTest({ segment, seed, mode: "exam" });
      forms.add(form.items.map((item) => `${item.key}:${JSON.stringify(item.question)}`).join("|"));
    }
    expect(forms.size).toBe(60);
  });

  it("fills the form with unique items stratified across topics, including generated variants", () => {
    const form = assembleTest({ segment, seed: 7, mode: "exam" });
    expect(form.items).toHaveLength(segment.length);
    expect(new Set(form.items.map((item) => item.key)).size).toBe(form.items.length);
    const topics = new Set(form.items.map((item) => item.topic));
    const bankTopics = new Set(bankByChapter.get("ownership")?.questions.map((q) => q.topic));
    expect(topics.size).toBe(bankTopics.size);
    expect(form.items.some((item) => item.generated)).toBe(true);
  });

  it("avoids repeating the previous form when the pool allows it", () => {
    const first = assembleTest({ segment, seed: 3, mode: "exam" });
    const previous = first.items.filter((item) => !item.generated).map((item) => item.sourceId);
    const second = assembleTest({
      segment,
      seed: 4,
      mode: "exam",
      previousSourceIds: previous,
    });
    const repeated = second.items.filter((item) => previous.includes(item.sourceId));
    expect(repeated.length).toBeLessThanOrEqual(1);
  });

  it("prefers items the learner previously missed", () => {
    const bank = bankByChapter.get("ownership");
    const missedId = bank?.questions[0]?.id ?? "";
    const history = { [missedId]: { seen: 1, correct: 0, lastCorrect: false, lastSeen: 1 } };
    let included = 0;
    for (let seed = 1; seed <= 20; seed += 1) {
      const form = assembleTest({ segment, seed, mode: "exam", history });
      if (form.items.some((item) => item.sourceId === missedId)) included += 1;
    }
    expect(included).toBeGreaterThanOrEqual(15);
  });

  it("interleaves chapters in strand tests and keeps pretests short and gentle", () => {
    const strand = listSegments().find((entry) => entry.kind === "strand");
    if (!strand) throw new Error("no strand");
    const form = assembleTest({ segment: strand, seed: 11, mode: "exam" });
    expect(new Set(form.items.map((item) => item.chapterId)).size).toBe(strand.chapterIds.length);
    const pretest = assembleTest({ segment, seed: 11, mode: "pretest" });
    expect(pretest.items).toHaveLength(4);
    expect(pretest.items.every((item) => item.difficulty < 3)).toBe(true);
  });

  it("covers weak chapters first in mixed review", () => {
    const mixed = listSegments().find((entry) => entry.kind === "mixed");
    if (!mixed) throw new Error("no mixed segment");
    const weakness = Object.fromEntries(chapters.map((chapter) => [chapter.id, 0]));
    weakness["errors"] = 1;
    weakness["borrowing"] = 1;
    const form = assembleTest({ segment: mixed, seed: 5, mode: "exam", weakness });
    const covered = new Set(form.items.map((item) => item.chapterId));
    expect(covered.has("errors")).toBe(true);
    expect(covered.has("borrowing")).toBe(true);
    expect(covered.size).toBeGreaterThanOrEqual(12);
  });

  it("shuffles options while keeping the key and feedback aligned", () => {
    const question: Question = {
      id: "q",
      kind: "choice",
      topic: "t",
      difficulty: 1,
      prompt: "Pick the right one",
      options: ["right", "wrong a", "wrong b", "wrong c"],
      answer: 0,
      feedback: [null, "why a", "why b", "why c"],
      explain: "Because it is the right one.",
    };
    for (let seed = 1; seed < 20; seed += 1) {
      const shuffled = shuffleOptions(question, seededRng(seed));
      if (shuffled.kind !== "choice") throw new Error("kind changed");
      expect(shuffled.options[shuffled.answer]).toBe("right");
      const wrongIndex = shuffled.options.indexOf("wrong b");
      expect(shuffled.feedback?.[wrongIndex]).toBe("why b");
    }
  });
});

describe("grading and summaries", () => {
  const base = {
    id: "x",
    topic: "t",
    difficulty: 1 as const,
    prompt: "Prompt text",
    explain: "An explanation here.",
  };

  it("grades every question kind", () => {
    expect(
      isCorrect({ ...base, kind: "choice", options: ["a", "b"], answer: 1 }, { choice: 1 }),
    ).toBe(true);
    expect(
      isCorrect(
        { ...base, kind: "multi", options: ["a", "b", "c"], answers: [0, 2] },
        { choices: [2, 0] },
      ),
    ).toBe(true);
    expect(
      isCorrect(
        { ...base, kind: "multi", options: ["a", "b", "c"], answers: [0, 2] },
        { choices: [0] },
      ),
    ).toBe(false);
    const compiles = { ...base, kind: "compiles" as const, code: "fn main() {}", compiles: false };
    expect(isCorrect(compiles, { choice: 1 })).toBe(true);
    expect(isCorrect(compiles, { choice: 0 })).toBe(false);
    const output = { ...base, kind: "output" as const, code: "fn main() {}", answer: "a\nb" };
    expect(isCorrect(output, { text: "a  \r\nb\n" })).toBe(true);
    expect(isCorrect(output, { text: "a b" })).toBe(false);
    const recall = { ...base, kind: "recall" as const, accept: ["cargo check"] };
    expect(isCorrect(recall, { text: "  `Cargo   Check`; " })).toBe(true);
    expect(isCorrect(recall, { text: "" })).toBe(false);
    expect(normalizeRecall("Rc::downgrade.")).toBe("rc::downgrade");
  });

  it("reports calibration and confident misses", () => {
    const form = assembleTest({ segment: chapterSegment("variables"), seed: 9, mode: "exam" });
    const responses = Object.fromEntries(
      form.items.map((item, index) => [
        item.key,
        { confidence: 3 as const, choice: index === 0 ? -1 : undefined },
      ]),
    );
    const summary = summarize(form, responses);
    expect(summary.total).toBe(form.items.length);
    expect(summary.confidentMisses.length).toBe(summary.missed.length);
    expect(summary.calibration.find((band) => band.confidence === 3)?.total).toBe(
      form.items.length,
    );
    expect(summary.passed).toBe(false);
  });
});

describe("flashcard scheduler", () => {
  const today = 20_000;

  it("requires two correct first-session retrievals before a new card graduates", () => {
    const first = schedule(undefined, "good", today);
    expect(first.requeue).toBe(true);
    expect(first.next.step).toBe(-1);
    const second = schedule(first.next, "good", today);
    expect(second.requeue).toBe(false);
    expect(second.next.step).toBe(0);
    expect(second.next.due).toBe(today + INTERVAL_DAYS[0]);
  });

  it("lets an easy new card skip ahead and resets learning on a miss", () => {
    expect(schedule(undefined, "easy", today).next.due).toBe(today + INTERVAL_DAYS[1]);
    const missed = schedule(schedule(undefined, "good", today).next, "again", today);
    expect(missed.requeue).toBe(true);
    expect(missed.next.learningHits).toBe(0);
  });

  it("expands intervals on success and relearns on failure", () => {
    let state = schedule(schedule(undefined, "good", today).next, "good", today).next;
    let day = state.due;
    const intervals: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const next = schedule(state, "good", day).next;
      intervals.push(next.due - day);
      state = next;
      day = next.due;
    }
    expect(intervals).toEqual([3, 7, 21, 45, 90]);
    const lapse = schedule(state, "again", day);
    expect(lapse.requeue).toBe(true);
    expect(lapse.next.step).toBe(0);
    expect(lapse.next.lapses).toBe(1);
    // A second miss the same day is not a second lapse, and relearning does not advance today.
    const again = schedule(lapse.next, "again", day);
    expect(again.next.lapses).toBe(1);
    expect(schedule(again.next, "good", day).next.due).toBe(day + INTERVAL_DAYS[0]);
  });

  it("interleaves chapters when it can", () => {
    const items = [
      { id: 1, chapterId: "a" },
      { id: 2, chapterId: "a" },
      { id: 3, chapterId: "b" },
      { id: 4, chapterId: "b" },
    ];
    const ordered = interleave(items, seededRng(1));
    expect(ordered).toHaveLength(4);
    for (let i = 1; i < ordered.length; i += 1) {
      expect(ordered[i]?.chapterId).not.toBe(ordered[i - 1]?.chapterId);
    }
  });
});

describe("study state", () => {
  it("records attempts, item history, and relearning cards (not for pretests)", () => {
    const form = assembleTest({ segment: chapterSegment("types"), seed: 2, mode: "exam" });
    const summary = summarize(form, {});
    const item = form.items[0];
    if (!item) throw new Error("empty form");
    const derived = [cardFromMissedItem(item, 5)];
    const items = form.items.map((entry) => ({
      key: entry.key,
      sourceId: entry.sourceId,
      correct: false,
    }));
    const state = recordAttempt(emptyStudyState(), {
      segmentId: "types",
      mode: "exam",
      seed: 2,
      summary,
      items,
      derived,
      now: 5,
    });
    expect(state.attempts).toHaveLength(1);
    expect(state.itemHistory[item.sourceId]?.lastCorrect).toBe(false);
    expect(Object.keys(state.derivedCards)).toEqual([`missed:${item.key}`]);
    const pretest = recordAttempt(emptyStudyState(), {
      segmentId: "types",
      mode: "pretest",
      seed: 2,
      summary,
      items,
      derived,
      now: 5,
    });
    expect(Object.keys(pretest.derivedCards)).toHaveLength(0);
  });

  it("rejects malformed imports and counts new cards per day", () => {
    expect(parseStudyState({ version: 2 })).toBeNull();
    expect(parseStudyState(emptyStudyState())).not.toBeNull();
    const next = schedule(undefined, "easy", 10).next;
    let state = applyReview(emptyStudyState(), {
      cardId: "c1",
      next,
      grade: "easy",
      today: 10,
      wasNew: true,
    });
    state = applyReview(state, { cardId: "c2", next, grade: "easy", today: 10, wasNew: true });
    expect(state.newCards).toEqual({ day: 10, count: 2 });
    expect(retention(state, 10)).toBeNull();
  });

  it("plans sessions from reached chapters within the daily new-card budget", () => {
    const state = emptyStudyState();
    expect(unlockedChapters(state, [])).toEqual([chapters[0]?.id]);
    expect(unlockedChapters(state, ["types"])).toEqual(chapters.slice(0, 3).map((c) => c.id));
    const plan = planSession({ state, today: 100, startedChapterIds: ["types"], seed: 1 });
    expect(plan.newCount).toBe(state.settings.newPerDay);
    expect(plan.queue.every((card) => plan.unlockedChapterIds.includes(card.chapterId))).toBe(true);
    const focused = planSession({
      state,
      today: 100,
      startedChapterIds: [],
      chapterFilter: "errors",
      seed: 1,
    });
    expect(focused.queue.every((card) => card.chapterId === "errors")).toBe(true);
  });
});
