import { shuffle } from "../rng";
import type { ChoiceQuestion, DistributiveOmit, Rng } from "../types";

/**
 * A choice item whose distractors are plausible wrong values. Duplicates are
 * removed so a coincidence never produces two identical options.
 */
export function valueChoice(
  rng: Rng,
  input: {
    prompt: string;
    code?: string;
    correct: string;
    distractors: string[];
    explain: string;
    expectStdout?: string;
  },
): DistributiveOmit<ChoiceQuestion, "id" | "topic" | "difficulty"> {
  const wrong = [...new Set(input.distractors)].filter((value) => value !== input.correct);
  const options = shuffle(rng, [input.correct, ...wrong.slice(0, 3)]);
  return {
    kind: "choice",
    prompt: input.prompt,
    code: input.code,
    options,
    answer: options.indexOf(input.correct),
    explain: input.explain,
    expectStdout: input.expectStdout,
  };
}

/** Wrap statements in a `fn main` so generated snippets are complete programs. */
export function program(body: string, prelude = ""): string {
  const indented = body
    .split("\n")
    .map((line) => (line ? `    ${line}` : line))
    .join("\n");
  return `${prelude}${prelude ? "\n\n" : ""}fn main() {\n${indented}\n}`;
}
