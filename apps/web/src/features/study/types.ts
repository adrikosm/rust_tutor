/**
 * Question-bank and flashcard types for the study system.
 *
 * Prompts, options, and explanations use the course mini-markup rendered by
 * RichText: `code`, **emphasis**, and [[GRAPH-ID|wiki links]]. Any `code`
 * field that contains `fn main` is compiled by scripts/verify-study-bank.mjs;
 * output questions are also run and their stdout compared with the key.
 */

export type Difficulty = 1 | 2 | 3;

type QuestionBase = {
  id: string;
  /** Sub-topic inside the segment; tests stratify across topics. */
  topic: string;
  difficulty: Difficulty;
  prompt: string;
  /** Optional Rust source shown with the prompt. */
  code?: string;
  /** Elaborative feedback shown after answering: why the key is right. */
  explain: string;
  /**
   * For a code item that is meant not to compile, the rustc error code the
   * verifier must observe (e.g. "E0382"). Omit for code that compiles.
   */
  codeError?: string;
  /** The code compiles but must panic when run (verified). */
  panics?: boolean;
};

export type ChoiceQuestion = QuestionBase & {
  kind: "choice";
  options: string[];
  answer: number;
  /** Misconception-specific feedback per option (index-aligned, optional). */
  feedback?: (string | null)[];
  /** Keep authored option order (e.g. numeric ranges); otherwise shuffled. */
  fixedOrder?: boolean;
  /** When set, the verifier runs `code` and requires exactly this stdout. */
  expectStdout?: string;
};

export type MultiQuestion = QuestionBase & {
  kind: "multi";
  options: string[];
  answers: number[];
};

/** Predict the exact stdout of a complete program; typed free recall. */
export type OutputQuestion = QuestionBase & {
  kind: "output";
  code: string;
  answer: string;
};

/** Does this program compile? Verified against rustc. */
export type CompilesQuestion = QuestionBase & {
  kind: "compiles";
  code: string;
  compiles: boolean;
};

/** Short typed answer (cued recall); any accepted form scores. */
export type RecallQuestion = QuestionBase & {
  kind: "recall";
  accept: string[];
};

export type Question =
  | ChoiceQuestion
  | MultiQuestion
  | OutputQuestion
  | CompilesQuestion
  | RecallQuestion;

export type Rng = () => number;

/** `Omit` that distributes over a union instead of collapsing it. */
export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export type GeneratedQuestion = DistributiveOmit<Question, "id" | "topic" | "difficulty">;

/** Produces a fresh parameterised variant for each seed. */
export type QuestionGenerator = {
  id: string;
  topic: string;
  difficulty: Difficulty;
  make: (rng: Rng) => GeneratedQuestion;
};

export type Flashcard = {
  id: string;
  /** A retrieval cue that asks for production, not recognition. */
  front: string;
  back: string;
  code?: string;
  /** Elaboration: why the answer holds, shown after reveal. */
  why?: string;
};

export type SegmentBank = {
  chapterId: string;
  questions: Question[];
  generators: QuestionGenerator[];
  cards: Flashcard[];
};
