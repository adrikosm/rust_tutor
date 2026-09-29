/**
 * Randomised segment tests.
 *
 * A test form is a pure function of (segment, seed, item history): the same
 * seed always rebuilds the same form, and a fresh seed draws a different one.
 * Forms are stratified across topics (chapter tests) or chapters (strand and
 * mixed tests, which interleave), prefer items the learner has not seen or has
 * missed, avoid repeating the previous form, include freshly parameterised
 * generator variants, and shuffle option order.
 */
import { chapters } from "../learning/course";
import { bankByChapter } from "./bank";
import { PASS_PERCENT_MARK } from "./constants";
import { seededRng, shuffle } from "./rng";
import type { Question, Rng } from "./types";

export type TestMode = "exam" | "practice" | "pretest";

export type Segment = {
  id: string;
  kind: "chapter" | "strand" | "mixed";
  title: string;
  chapterIds: string[];
  length: number;
};

export const PASS_PERCENT = PASS_PERCENT_MARK;

export function strandSlug(strand: string): string {
  return strand
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function listSegments(): Segment[] {
  const chapterSegments: Segment[] = chapters
    .filter((chapter) => bankByChapter.has(chapter.id))
    .map((chapter) => ({
      id: chapter.id,
      kind: "chapter",
      title: `${chapter.number}. ${chapter.title}`,
      chapterIds: [chapter.id],
      length: 10,
    }));
  const strands = [...new Set(chapters.map((chapter) => chapter.strand))];
  const strandSegments: Segment[] = strands.map((strand) => ({
    id: `strand-${strandSlug(strand)}`,
    kind: "strand",
    title: strand,
    chapterIds: chapters
      .filter((chapter) => chapter.strand === strand)
      .map((chapter) => chapter.id),
    length: 15,
  }));
  const mixed: Segment = {
    id: "mixed",
    kind: "mixed",
    title: "Mixed review — every chapter",
    chapterIds: chapters.map((chapter) => chapter.id),
    length: 20,
  };
  return [...chapterSegments, ...strandSegments, mixed];
}

export function segmentById(id: string): Segment | undefined {
  return listSegments().find((segment) => segment.id === id);
}

export type ItemHistory = Record<
  string,
  { seen: number; correct: number; lastCorrect: boolean; lastSeen: number }
>;

export type PreparedItem = {
  /** Unique within the form: question id, or generator id + variant seed. */
  key: string;
  /** Stable identity for history: question id or generator id. */
  sourceId: string;
  chapterId: string;
  topic: string;
  difficulty: 1 | 2 | 3;
  generated: boolean;
  question: Question;
};

export type TestForm = {
  segmentId: string;
  mode: TestMode;
  seed: number;
  items: PreparedItem[];
};

type Candidate = { chapterId: string; question: Question };

/** Shuffle choice options (keeping answer keys aligned) unless order is meaningful. */
export function shuffleOptions(question: Question, rng: Rng): Question {
  if (question.kind === "choice" && !question.fixedOrder) {
    const order = shuffle(
      rng,
      question.options.map((_, index) => index),
    );
    return {
      ...question,
      options: order.map((index) => question.options[index] as string),
      feedback: question.feedback
        ? order.map((index) => question.feedback?.[index] ?? null)
        : undefined,
      answer: order.indexOf(question.answer),
    };
  }
  if (question.kind === "multi") {
    const order = shuffle(
      rng,
      question.options.map((_, index) => index),
    );
    return {
      ...question,
      options: order.map((index) => question.options[index] as string),
      answers: question.answers.map((answer) => order.indexOf(answer)).sort((a, b) => a - b),
    };
  }
  return question;
}

function priority(sourceId: string, history: ItemHistory, lastForm: Set<string>, rng: Rng): number {
  const record = history[sourceId];
  let score = rng();
  if (!record) score += 0.6;
  else {
    if (!record.lastCorrect) score += 0.9;
    if (record.correct >= 2 && record.lastCorrect) score -= 0.4;
  }
  if (lastForm.has(sourceId)) score -= 1.5;
  return score;
}

export function assembleTest(input: {
  segment: Segment;
  seed: number;
  mode: TestMode;
  history?: ItemHistory;
  /** Source IDs used by this segment's previous form, to avoid repeats. */
  previousSourceIds?: string[];
  /** Chapter weights for mixed review (higher = more items). */
  weakness?: Record<string, number>;
}): TestForm {
  const { segment, seed, mode } = input;
  const history = input.history ?? {};
  const lastForm = new Set(input.previousSourceIds ?? []);
  const rng = seededRng(seed);
  const banks = segment.chapterIds.flatMap((id) => {
    const bank = bankByChapter.get(id);
    return bank ? [bank] : [];
  });
  const length = mode === "pretest" ? 4 : segment.length;

  // Generated variants: roughly a third of the form, from distinct generators.
  const generatorPool = shuffle(
    rng,
    banks.flatMap((bank) => bank.generators.map((generator) => ({ bank, generator }))),
  ).filter(({ generator }) => mode !== "pretest" || generator.difficulty < 3);
  const generatedTarget = Math.min(
    mode === "pretest" ? 1 : Math.round(length * 0.3),
    generatorPool.length,
  );
  const generatorsByChapter = new Map<string, typeof generatorPool>();
  for (const entry of generatorPool) {
    const list = generatorsByChapter.get(entry.bank.chapterId) ?? [];
    list.push(entry);
    generatorsByChapter.set(entry.bank.chapterId, list);
  }
  const chosenGenerators: typeof generatorPool = [];
  while (chosenGenerators.length < generatedTarget) {
    let progressed = false;
    for (const list of shuffle(rng, [...generatorsByChapter.values()])) {
      const next = list.shift();
      if (next && chosenGenerators.length < generatedTarget) {
        chosenGenerators.push(next);
        progressed = true;
      }
    }
    if (!progressed) break;
  }
  const generated: PreparedItem[] = chosenGenerators.map(({ bank, generator }) => {
    const variantSeed = Math.floor(rng() * 0xffffffff) >>> 0;
    const made = generator.make(seededRng(variantSeed));
    const question = {
      ...made,
      id: `${generator.id}~${variantSeed.toString(36)}`,
      topic: generator.topic,
      difficulty: generator.difficulty,
    } as Question;
    return {
      key: question.id,
      sourceId: generator.id,
      chapterId: bank.chapterId,
      topic: generator.topic,
      difficulty: generator.difficulty,
      generated: true,
      question,
    };
  });

  // Static items, stratified. Chapter tests stratify by topic; wider tests by chapter.
  const staticTarget = length - generated.length;
  const candidates: Candidate[] = banks.flatMap((bank) =>
    bank.questions
      .filter((question) => mode !== "pretest" || question.difficulty < 3)
      .map((question) => ({ chapterId: bank.chapterId, question })),
  );
  const stratumOf = (candidate: Candidate) =>
    segment.kind === "chapter" ? candidate.question.topic : candidate.chapterId;
  const strata = new Map<string, { candidate: Candidate; score: number }[]>();
  for (const candidate of candidates) {
    const key = stratumOf(candidate);
    const weight = segment.kind === "mixed" ? (input.weakness?.[candidate.chapterId] ?? 0) : 0;
    const list = strata.get(key) ?? [];
    list.push({
      candidate,
      score: priority(candidate.question.id, history, lastForm, rng) + weight,
    });
    strata.set(key, list);
  }
  for (const list of strata.values()) list.sort((a, b) => b.score - a.score);
  // Mixed review visits weaker chapters first so they win the scarce slots.
  const stratumOrder = shuffle(rng, [...strata.keys()]).sort((a, b) =>
    segment.kind === "mixed" ? (input.weakness?.[b] ?? 0) - (input.weakness?.[a] ?? 0) : 0,
  );
  const picked: Candidate[] = [];
  // Round-robin across strata. The first pass takes only items absent from the
  // previous form; the second fills any remaining slots from whatever is left.
  for (const allowRepeats of [false, true]) {
    while (picked.length < staticTarget) {
      let progressed = false;
      for (const key of stratumOrder) {
        const list = strata.get(key) ?? [];
        const index = list.findIndex(
          (entry) => allowRepeats || !lastForm.has(entry.candidate.question.id),
        );
        if (index >= 0 && picked.length < staticTarget) {
          const [next] = list.splice(index, 1);
          if (next) picked.push(next.candidate);
          progressed = true;
        }
      }
      if (!progressed) break;
    }
  }
  const statics: PreparedItem[] = picked.map(({ chapterId, question }) => ({
    key: question.id,
    sourceId: question.id,
    chapterId,
    topic: question.topic,
    difficulty: question.difficulty,
    generated: false,
    question,
  }));

  // A gentle difficulty ramp with jitter, so forms start accessible but vary.
  const ordered = [...statics, ...generated]
    .map((item) => ({ item, key: item.difficulty + rng() * 1.6 }))
    .sort((a, b) => a.key - b.key)
    .map(({ item }) => ({ ...item, question: shuffleOptions(item.question, rng) }));
  return { segmentId: segment.id, mode, seed, items: ordered };
}

/* ---- grading ---- */

export type Confidence = 1 | 2 | 3;

export type ItemResponse = {
  choice?: number;
  choices?: number[];
  text?: string;
  confidence?: Confidence;
};

export function normalizeOutput(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .join("\n")
    .trim();
}

export function normalizeRecall(text: string): string {
  return text
    .toLowerCase()
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .replace(/[\s;.]+$/, "")
    .trim();
}

export function isCorrect(question: Question, response: ItemResponse): boolean {
  switch (question.kind) {
    case "choice":
      return response.choice === question.answer;
    case "multi": {
      const chosen = [...new Set(response.choices ?? [])].sort((a, b) => a - b);
      return (
        chosen.length === question.answers.length &&
        chosen.every((value, index) => value === question.answers[index])
      );
    }
    case "compiles":
      return response.choice === (question.compiles ? 0 : 1);
    case "output":
      return normalizeOutput(response.text ?? "") === normalizeOutput(question.answer);
    case "recall": {
      const given = normalizeRecall(response.text ?? "");
      return (
        given.length > 0 && question.accept.some((accepted) => normalizeRecall(accepted) === given)
      );
    }
  }
}

/** The key, phrased for display after answering. */
export function correctAnswerText(question: Question): string {
  switch (question.kind) {
    case "choice":
      return question.options[question.answer] ?? "";
    case "multi":
      return question.answers.map((index) => question.options[index]).join(" · ");
    case "compiles":
      return question.compiles
        ? "It compiles."
        : `It does not compile${question.codeError ? ` (${question.codeError})` : ""}.`;
    case "output":
      return question.answer;
    case "recall":
      return question.accept[0] ?? "";
  }
}

export function answered(question: Question, response: ItemResponse | undefined): boolean {
  if (!response) return false;
  switch (question.kind) {
    case "choice":
    case "compiles":
      return response.choice !== undefined;
    case "multi":
      return (response.choices ?? []).length > 0;
    case "output":
    case "recall":
      return (response.text ?? "").trim().length > 0;
  }
}

export type TestSummary = {
  correct: number;
  total: number;
  percent: number;
  passed: boolean;
  byTopic: { topic: string; correct: number; total: number }[];
  calibration: { confidence: Confidence; correct: number; total: number }[];
  /** High-confidence errors: the items most worth reviewing (hypercorrection). */
  confidentMisses: string[];
  missed: string[];
};

export function summarize(form: TestForm, responses: Record<string, ItemResponse>): TestSummary {
  let correct = 0;
  const topics = new Map<string, { correct: number; total: number }>();
  const calibration = new Map<Confidence, { correct: number; total: number }>([
    [1, { correct: 0, total: 0 }],
    [2, { correct: 0, total: 0 }],
    [3, { correct: 0, total: 0 }],
  ]);
  const confidentMisses: string[] = [];
  const missed: string[] = [];
  for (const item of form.items) {
    const response = responses[item.key] ?? {};
    const ok = isCorrect(item.question, response);
    if (ok) correct += 1;
    else missed.push(item.key);
    const topic = topics.get(item.topic) ?? { correct: 0, total: 0 };
    topic.total += 1;
    if (ok) topic.correct += 1;
    topics.set(item.topic, topic);
    if (response.confidence) {
      const band = calibration.get(response.confidence);
      if (band) {
        band.total += 1;
        if (ok) band.correct += 1;
      }
      if (response.confidence === 3 && !ok) confidentMisses.push(item.key);
    }
  }
  const total = form.items.length;
  const percent = total === 0 ? 0 : Math.round((correct / total) * 100);
  return {
    correct,
    total,
    percent,
    passed: percent >= PASS_PERCENT,
    byTopic: [...topics.entries()]
      .map(([topic, value]) => ({ topic, ...value }))
      .sort((a, b) => a.correct / a.total - b.correct / b.total),
    calibration: [...calibration.entries()].map(([confidence, value]) => ({
      confidence,
      ...value,
    })),
    confidentMisses,
    missed,
  };
}
