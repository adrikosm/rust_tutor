import { seededRng } from "./rng";
import type { Question, SegmentBank } from "./types";

/** Minimums that make a randomised segment test meaningfully different each time. */
export const BANK_MINIMUMS = {
  questionsPerSegment: 14,
  topicsPerSegment: 3,
  generatorsPerSegment: 2,
  cardsPerSegment: 8,
} as const;

function questionProblems(question: Question): string[] {
  const problems: string[] = [];
  const at = question.id;
  if (question.prompt.trim().length < 8) problems.push(`${at}: prompt is too short`);
  if (question.explain.trim().length < 20) problems.push(`${at}: explanation is too short`);
  switch (question.kind) {
    case "choice": {
      if (question.options.length < 2) problems.push(`${at}: needs at least two options`);
      if (new Set(question.options).size !== question.options.length)
        problems.push(`${at}: duplicate options`);
      if (!Number.isInteger(question.answer) || question.answer < 0)
        problems.push(`${at}: answer index is invalid`);
      if (question.answer >= question.options.length) problems.push(`${at}: answer out of range`);
      if (question.feedback && question.feedback.length !== question.options.length)
        problems.push(`${at}: feedback must align with options`);
      if (question.options.some((option) => /all of the above|none of the above/i.test(option)))
        problems.push(`${at}: avoid all/none-of-the-above options`);
      break;
    }
    case "multi": {
      if (question.options.length < 3) problems.push(`${at}: multi-select needs three+ options`);
      if (question.answers.length === 0) problems.push(`${at}: needs at least one correct option`);
      if (question.answers.length === question.options.length)
        problems.push(`${at}: every option correct defeats the item`);
      if (question.answers.some((answer) => answer < 0 || answer >= question.options.length))
        problems.push(`${at}: answer out of range`);
      break;
    }
    case "output":
      if (!/fn main/.test(question.code)) problems.push(`${at}: output code needs fn main`);
      if (question.answer.trim().length === 0) problems.push(`${at}: empty expected output`);
      break;
    case "compiles":
      if (!/fn main/.test(question.code)) problems.push(`${at}: compile code needs fn main`);
      if (question.compiles && question.codeError)
        problems.push(`${at}: compiling code cannot declare an error`);
      break;
    case "recall":
      if (question.accept.length === 0 || question.accept.some((value) => !value.trim()))
        problems.push(`${at}: recall needs accepted answers`);
      break;
  }
  return problems;
}

/** Structural rules shared by the unit tests and the rustc verifier. */
export function validateBankStructure(banks: SegmentBank[]): string[] {
  const problems: string[] = [];
  const questionIds = new Set<string>();
  const cardIds = new Set<string>();
  const chapterIds = new Set<string>();
  for (const bank of banks) {
    if (chapterIds.has(bank.chapterId)) problems.push(`duplicate bank for ${bank.chapterId}`);
    chapterIds.add(bank.chapterId);
    if (bank.questions.length < BANK_MINIMUMS.questionsPerSegment)
      problems.push(`${bank.chapterId}: only ${bank.questions.length} questions`);
    const topics = new Set(bank.questions.map((question) => question.topic));
    if (topics.size < BANK_MINIMUMS.topicsPerSegment)
      problems.push(`${bank.chapterId}: only ${topics.size} topics`);
    if (bank.generators.length < BANK_MINIMUMS.generatorsPerSegment)
      problems.push(`${bank.chapterId}: only ${bank.generators.length} generators`);
    if (bank.cards.length < BANK_MINIMUMS.cardsPerSegment)
      problems.push(`${bank.chapterId}: only ${bank.cards.length} flashcards`);
    const prompts = new Set<string>();
    for (const question of bank.questions) {
      if (questionIds.has(question.id)) problems.push(`duplicate question id ${question.id}`);
      questionIds.add(question.id);
      const identity = `${question.prompt}\n${question.code ?? ""}`;
      if (prompts.has(identity)) problems.push(`${question.id}: duplicates another item`);
      prompts.add(identity);
      problems.push(...questionProblems(question));
    }
    for (const generator of bank.generators) {
      if (questionIds.has(generator.id)) problems.push(`duplicate generator id ${generator.id}`);
      questionIds.add(generator.id);
      const variants = new Set<string>();
      for (let seed = 1; seed <= 12; seed += 1) {
        const made = {
          ...generator.make(seededRng(seed)),
          id: generator.id,
          topic: generator.topic,
          difficulty: generator.difficulty,
        } as Question;
        problems.push(...questionProblems(made).map((problem) => `${problem} (seed ${seed})`));
        variants.add(`${made.prompt}\n${made.code ?? ""}`);
      }
      if (variants.size < 4)
        problems.push(`${generator.id}: produces only ${variants.size} distinct variants`);
    }
    for (const card of bank.cards) {
      if (cardIds.has(card.id)) problems.push(`duplicate card id ${card.id}`);
      cardIds.add(card.id);
      if (!card.front.trim() || !card.back.trim()) problems.push(`${card.id}: empty side`);
    }
  }
  return problems;
}
