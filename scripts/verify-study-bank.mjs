// Compiler-verifies the study question bank (apps/web/src/features/study/bank).
//
// Every question whose code contains `fn main` is compiled with the real rustc:
//   - output questions must run and print exactly their answer;
//   - choice questions with expectStdout must print exactly that;
//   - compiles questions must compile (or fail, with the declared error code);
//   - any other code must compile unless it declares codeError.
// Each generator is sampled with fixed seeds and its variants are checked the
// same way, so parameterised questions cannot drift from what Rust does.
//
// Usage: node scripts/verify-study-bank.mjs [--samples N] [--jobs N] [--filter id-prefix]
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { register } from "node:module";
import { availableParallelism, tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// The web app uses extensionless TypeScript imports (resolved by Vite). Teach
// Node's loader the same rule so this script can import the bank directly.
register(
  `data:text/javascript,${encodeURIComponent(`
    export async function resolve(specifier, context, next) {
      try {
        return await next(specifier, context);
      } catch (error) {
        if (specifier.startsWith(".") && !/\\.[cm]?[jt]sx?$/.test(specifier)) {
          return next(specifier + ".ts", context);
        }
        throw error;
      }
    }
  `)}`,
  pathToFileURL("./"),
);

const argument = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const samples = Number(argument("--samples", "6"));
const jobs = Number(argument("--jobs", String(Math.max(2, availableParallelism()))));
const filter = argument("--filter", "");

const { allBanks } = await import(
  pathToFileURL(join(import.meta.dirname, "../apps/web/src/features/study/bank/index.ts")).href
);
const { seededRng } = await import(
  pathToFileURL(join(import.meta.dirname, "../apps/web/src/features/study/rng.ts")).href
);
const { validateBankStructure } = await import(
  pathToFileURL(join(import.meta.dirname, "../apps/web/src/features/study/bank-rules.ts")).href
);

const structural = validateBankStructure(allBanks);
if (structural.length > 0) {
  console.error(`study bank structure failed (${structural.length}):`);
  for (const message of structural) console.error(`- ${message}`);
  process.exit(1);
}

/** @type {{label:string, question:any}[]} */
const cases = [];
for (const bank of allBanks) {
  for (const question of bank.questions) cases.push({ label: question.id, question });
  for (const generator of bank.generators) {
    for (let sample = 0; sample < samples; sample += 1) {
      const seed = 0x5eed + sample * 7919;
      const question = { id: generator.id, ...generator.make(seededRng(seed)) };
      cases.push({ label: `${generator.id}~${seed}`, question });
    }
  }
}
const selected = cases.filter(
  ({ label, question }) => label.startsWith(filter) && /fn main/.test(question.code ?? ""),
);

const workdir = await mkdtemp(join(tmpdir(), "rust-tutor-study-bank-"));

function run(command, args, cwd, timeoutMs) {
  return new Promise((resolveRun) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (status) => {
      clearTimeout(timer);
      resolveRun({ status, stdout, stderr });
    });
  });
}

const normalize = (text) =>
  text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .join("\n")
    .trim();

async function verify({ label, question }, index) {
  const dir = join(workdir, String(index));
  const source = join(dir, "main.rs");
  const binary = join(dir, "main");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(dir, { recursive: true }));
  await writeFile(source, question.code);
  const compiled = await run(
    "rustc",
    ["--edition", "2024", "-A", "warnings", "-o", binary, source],
    dir,
    60_000,
  );
  const expectFailure =
    (question.kind === "compiles" && question.compiles === false) || Boolean(question.codeError);
  if (expectFailure) {
    if (compiled.status === 0) return `${label}: expected a compile error but it compiled`;
    if (question.codeError && !compiled.stderr.includes(`error[${question.codeError}]`)) {
      const seen = [...compiled.stderr.matchAll(/error\[(E\d{4})\]/g)].map((m) => m[1]);
      return `${label}: expected ${question.codeError}, rustc reported ${seen.join(", ") || "no error code"}\n${compiled.stderr.split("\n").slice(0, 6).join("\n")}`;
    }
    return null;
  }
  if (compiled.status !== 0)
    return `${label}: expected to compile\n${compiled.stderr.split("\n").slice(0, 12).join("\n")}`;
  const expected =
    question.kind === "output"
      ? question.answer
      : question.kind === "choice" && question.expectStdout !== undefined
        ? question.expectStdout
        : null;
  const executed = await run(binary, [], dir, 10_000);
  if (question.panics) {
    return executed.status !== 0 && /panicked/.test(executed.stderr)
      ? null
      : `${label}: expected the program to panic`;
  }
  if (expected === null) {
    return executed.status === 0 ? null : `${label}: program exited with ${executed.status}`;
  }
  if (executed.status !== 0)
    return `${label}: program exited with ${executed.status}\n${executed.stderr}`;
  if (normalize(executed.stdout) !== normalize(expected))
    return `${label}: stdout mismatch\n  expected: ${JSON.stringify(normalize(expected))}\n  actual:   ${JSON.stringify(normalize(executed.stdout))}`;
  return null;
}

const failures = [];
let cursor = 0;
await Promise.all(
  Array.from({ length: jobs }, async () => {
    while (cursor < selected.length) {
      const index = cursor;
      cursor += 1;
      const failure = await verify(selected[index], index);
      if (failure) failures.push(failure);
    }
  }),
);
await rm(workdir, { recursive: true, force: true });

const questionCount = allBanks.reduce((sum, bank) => sum + bank.questions.length, 0);
const generatorCount = allBanks.reduce((sum, bank) => sum + bank.generators.length, 0);
const cardCount = allBanks.reduce((sum, bank) => sum + bank.cards.length, 0);
if (failures.length > 0) {
  console.error(`study bank verification failed (${failures.length} of ${selected.length}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(
  `study bank verified: ${allBanks.length} segments, ${questionCount} questions, ${generatorCount} generators (${samples} samples each), ${cardCount} flashcards; ${selected.length} programs compiled with rustc`,
);
