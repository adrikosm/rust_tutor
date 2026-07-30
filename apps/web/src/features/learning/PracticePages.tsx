import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { lazy, type ReactNode, Suspense, useEffect, useMemo, useState } from "react";
import {
  cancelEvaluation,
  evaluateRust,
  evaluateRustStreaming,
  getBootstrap,
  getCatalog,
  getDashboardSnapshot,
  getErrors,
  getJournal,
  getPracticeCatalog,
  getPracticeItem,
  getQuestionBank,
  getTutorContent,
  getWorkbenchProgress,
  revealPracticeItem,
  type PublicQuestion,
  type QuestionResponse,
  recordAttempt,
  submitQuestion,
} from "../../lib/service-client";

import { ContextStrip, PageHero, statusLabel } from "./LearningShared";

const MonacoSourceEditor = lazy(() =>
  import("../workbench/MonacoSourceEditor").then((module) => ({
    default: module.MonacoSourceEditor,
  })),
);

const DRAFT_TTL = 7 * 24 * 60 * 60 * 1_000;

function QuestionWorkbench() {
  const bank = useQuery({ queryKey: ["question-bank"], queryFn: getQuestionBank });
  const [activeIndex, setActiveIndex] = useState(0);
  const question = bank.data?.questions[activeIndex];
  if (bank.isPending) return <p role="status">Loading the deterministic check bank…</p>;
  if (bank.isError) return <p role="alert">Question bank unavailable: {bank.error.message}</p>;
  if (!question) return <p>No published checks are available.</p>;
  return (
    <section className="question-workbench" aria-labelledby="question-workbench-title">
      <p className="eyebrow">Ten-type check engine</p>
      <h2 id="question-workbench-title">Commit first. Reveal evidence second.</h2>
      <label htmlFor="question-picker">Question type</label>
      <select
        id="question-picker"
        value={activeIndex}
        onChange={(event) => setActiveIndex(Number(event.target.value))}
      >
        {bank.data.questions.map((item, index) => (
          <option value={index} key={item.id}>
            {index + 1}. {statusLabel(item.kind)}
          </option>
        ))}
      </select>
      <QuestionCard key={question.id} question={question} />
    </section>
  );
}

function formatRevealedAnswer(
  revealed: { type: string; value?: unknown },
  question: PublicQuestion,
): string {
  const value = revealed.value;
  if (typeof value === "number" && question.options[value] !== undefined) {
    return question.options[value];
  }
  if (Array.isArray(value)) {
    const asOptions = value
      .map((entry) =>
        typeof entry === "number" && question.options[entry] !== undefined
          ? question.options[entry]
          : String(entry),
      )
      .join(" · ");
    return asOptions || "see rubric";
  }
  if (typeof value === "boolean") return value ? "True" : "False";
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "graded against the rubric checklist";
  return JSON.stringify(value);
}

export function QuestionCard({ question }: { question: PublicQuestion }) {
  const queryClient = useQueryClient();
  const bootstrap = useQuery({
    queryKey: ["bootstrap"],
    queryFn: ({ signal }) => getBootstrap(signal),
  });
  const [index, setIndex] = useState(-1);
  const [indices, setIndices] = useState<number[]>([]);
  const [boolean, setBoolean] = useState<boolean | null>(null);
  const [text, setText] = useState(
    question.kind === "fill_missing_code" ? (question.starter ?? "") : "",
  );
  const [order, setOrder] = useState(question.options);
  const [checked, setChecked] = useState<string[]>([]);
  const [secondary, setSecondary] = useState("");
  const [reasoning, setReasoning] = useState("");
  const [confidence, setConfidence] = useState(3);
  const [support, setSupport] = useState("none");
  const [confirming, setConfirming] = useState(false);
  const evaluation = useMutation({
    mutationFn: () => {
      const contentHash = bootstrap.data?.content.checksum;
      if (!contentHash) throw new Error("The reviewed content checksum is not ready.");
      return evaluateRust({
        runId: `RUN-${crypto.randomUUID()}`,
        exerciseId: question.id,
        action: "check",
        source: text,
        contentHash,
      });
    },
  });
  const predictionRun = useMutation({
    mutationFn: () => {
      const contentHash = bootstrap.data?.content.checksum;
      if (!contentHash) throw new Error("The reviewed content checksum is not ready.");
      return evaluateRust({
        runId: `RUN-${crypto.randomUUID()}`,
        exerciseId: question.id,
        action: "run",
        source: question.starter ?? "fn main() {}",
        contentHash,
      });
    },
  });
  function response(): QuestionResponse {
    switch (question.kind) {
      case "multiple_choice":
        return { type: "index", value: index };
      case "multiple_select":
        return { type: "indices", values: indices };
      case "true_false":
        return { type: "boolean", value: boolean ?? false };
      case "identify_compiler_error":
        return { type: "compiler_code", value: text };
      case "fill_missing_code":
        return { type: "evaluator", passed: evaluation.data?.status === "ACCEPTED" };
      case "ordering":
        return { type: "order", values: order };
      case "short_response":
        return { type: "checklist", checked, response: text };
      case "complexity_analysis":
        return { type: "complexity", time: text, space: secondary, reasoning, checked };
      case "debugging_decision":
        return { type: "debugging", hypothesis: text, action: secondary, checked };
      default:
        return { type: "text", value: text };
    }
  }
  const submission = useMutation({
    mutationFn: () =>
      submitQuestion(question.id, {
        idempotencyKey: `QUIZ-${crypto.randomUUID()}`,
        confirmed: true,
        response: response(),
        support: { type: support, provenance: "learner_reported" },
        confidence,
        evaluatorEvidence:
          question.kind === "fill_missing_code" && evaluation.data
            ? { runId: evaluation.data.runId }
            : undefined,
      }),
    onSuccess: () => {
      setConfirming(false);
      // Grading persists review/mastery evidence; refresh the surfaces built on it.
      for (const key of ["dashboard-snapshot", "review-queue", "confidence-calibration"]) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
  });
  function toggleCheck(value: string) {
    setChecked((current) =>
      current.includes(value) ? current.filter((item) => item !== value) : [...current, value],
    );
  }
  function move(position: number, delta: -1 | 1) {
    const target = position + delta;
    if (target < 0 || target >= order.length) return;
    setOrder((current) => {
      const next = [...current];
      const currentItem = next[position];
      const targetItem = next[target];
      if (currentItem === undefined || targetItem === undefined) return current;
      next[position] = targetItem;
      next[target] = currentItem;
      return next;
    });
  }
  const selfReview = ["short_response", "complexity_analysis", "debugging_decision"].includes(
    question.kind,
  );
  const responseMissing = (() => {
    switch (question.kind) {
      case "multiple_choice":
        return index < 0;
      case "multiple_select":
        return indices.length === 0;
      case "true_false":
        return boolean === null;
      case "predict_output":
      case "identify_compiler_error":
        return text.trim().length === 0;
      case "fill_missing_code":
        return text.trim().length === 0 || !evaluation.data;
      case "ordering":
        return order.length === 0;
      case "short_response":
        return text.trim().length === 0;
      case "complexity_analysis":
        return !text.trim() || !secondary.trim() || !reasoning.trim();
      case "debugging_decision":
        return !text.trim() || !secondary.trim();
    }
  })();
  return (
    <article className="question-card">
      <header>
        <p>
          {question.id} · version {question.version} · {question.lessonId}
        </p>
        <h3>{question.prompt}</h3>
        <p>{question.partialCreditPolicy}</p>
      </header>
      <fieldset disabled={submission.isPending}>
        <legend>Your committed response</legend>
        {question.kind === "multiple_choice" &&
          question.options.map((option, optionIndex) => (
            <label key={option}>
              <input
                type="radio"
                name={`${question.id}-choice`}
                checked={index === optionIndex}
                onChange={() => setIndex(optionIndex)}
              />
              {option}
            </label>
          ))}
        {question.kind === "multiple_select" &&
          question.options.map((option, optionIndex) => (
            <label key={option}>
              <input
                type="checkbox"
                checked={indices.includes(optionIndex)}
                onChange={() =>
                  setIndices((current) =>
                    current.includes(optionIndex)
                      ? current.filter((value) => value !== optionIndex)
                      : [...current, optionIndex],
                  )
                }
              />
              {option}
            </label>
          ))}
        {question.kind === "true_false" && (
          <select
            aria-label="True or false response"
            value={boolean === null ? "" : String(boolean)}
            onChange={(event) =>
              setBoolean(event.target.value === "" ? null : event.target.value === "true")
            }
          >
            <option value="">Choose an answer</option>
            <option value="false">False</option>
            <option value="true">True</option>
          </select>
        )}
        {[
          "predict_output",
          "identify_compiler_error",
          "fill_missing_code",
          "short_response",
        ].includes(question.kind) && (
          <>
            <label htmlFor={`${question.id}-text`}>
              {question.kind === "fill_missing_code" ? "Complete source" : "Response"}
            </label>
            <textarea
              id={`${question.id}-text`}
              rows={question.kind === "fill_missing_code" ? 8 : 4}
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
            {question.kind === "fill_missing_code" && (
              <button
                type="button"
                onClick={() => evaluation.mutate()}
                disabled={!bootstrap.data?.content.checksum || evaluation.isPending}
              >
                {evaluation.isPending ? "Running cargo check…" : "Run real evaluator"}
              </button>
            )}
            {evaluation.data && <output>Evaluator result: {evaluation.data.status}</output>}
          </>
        )}
        {question.kind === "ordering" && (
          <ol aria-label="Current order">
            {order.map((item, position) => (
              <li key={item}>
                {item}{" "}
                <button type="button" onClick={() => move(position, -1)} disabled={position === 0}>
                  Move up
                </button>
                <button
                  type="button"
                  onClick={() => move(position, 1)}
                  disabled={position === order.length - 1}
                >
                  Move down
                </button>
              </li>
            ))}
          </ol>
        )}
        {question.kind === "complexity_analysis" && (
          <>
            <label htmlFor={`${question.id}-time`}>Time complexity</label>
            <input
              id={`${question.id}-time`}
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
            <label htmlFor={`${question.id}-space`}>Space complexity</label>
            <input
              id={`${question.id}-space`}
              value={secondary}
              onChange={(event) => setSecondary(event.target.value)}
            />
            <label htmlFor={`${question.id}-reasoning`}>Reasoning</label>
            <textarea
              id={`${question.id}-reasoning`}
              value={reasoning}
              onChange={(event) => setReasoning(event.target.value)}
            />
          </>
        )}
        {question.kind === "debugging_decision" && (
          <>
            <label htmlFor={`${question.id}-hypothesis`}>Causal hypothesis</label>
            <textarea
              id={`${question.id}-hypothesis`}
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
            <label htmlFor={`${question.id}-action`}>Bounded next action</label>
            <textarea
              id={`${question.id}-action`}
              value={secondary}
              onChange={(event) => setSecondary(event.target.value)}
            />
          </>
        )}
        {selfReview && (
          <fieldset>
            <legend>Deterministic self-review checklist</legend>
            {question.rubric.map((check) => (
              <label key={check}>
                <input
                  type="checkbox"
                  checked={checked.includes(check)}
                  onChange={() => toggleCheck(check)}
                />
                {check}
              </label>
            ))}
            <p>No semantic AI grader is used.</p>
          </fieldset>
        )}
        <label htmlFor={`${question.id}-support`}>Support used</label>
        <select
          id={`${question.id}-support`}
          value={support}
          onChange={(event) => setSupport(event.target.value)}
        >
          <option value="none">None</option>
          <option value="compiler">Compiler</option>
          <option value="official_docs">Official docs</option>
          <option value="hint">Hint</option>
        </select>
        <label htmlFor={`${question.id}-confidence`}>Confidence: {confidence}/5</label>
        <input
          id={`${question.id}-confidence`}
          type="range"
          min="1"
          max="5"
          value={confidence}
          onChange={(event) => setConfidence(Number(event.target.value))}
        />
      </fieldset>
      {!confirming && !submission.data && (
        <button type="button" disabled={responseMissing} onClick={() => setConfirming(true)}>
          Review submission
        </button>
      )}
      {confirming && (
        <aside className="confirmation-panel" aria-label="Confirm question submission">
          <p>Grading will reveal the answer and freeze this attempt. You may retry afterward.</p>
          <button type="button" onClick={() => submission.mutate()} disabled={submission.isPending}>
            Confirm and grade
          </button>
          <button type="button" onClick={() => setConfirming(false)}>
            Cancel and edit
          </button>
        </aside>
      )}
      {submission.isError && <p role="alert">Submission failed: {submission.error.message}</p>}
      {submission.data && (
        <section className="question-result" aria-live="polite">
          <h4>{submission.data.result.correct ? "Correct" : "Review recommended"}</h4>
          <p>
            Item {submission.data.result.score}/1 · best {submission.data.history.bestResult.score}
            /1 · attempt {submission.data.history.attemptCount}
          </p>
          <p>{submission.data.result.explanation}</p>
          <p>
            <strong>Answer:</strong>{" "}
            {formatRevealedAnswer(submission.data.result.revealedAnswer, question)}
          </p>
          <p>
            Lesson {submission.data.lessonId} · outcomes{" "}
            {submission.data.conceptMappings.join(", ")}
          </p>
          {submission.data.selfAssessed && (
            <p>
              This is an unverified self-assessment: it is recorded in your quiz history but never
              awards mastery or schedules review credit.
            </p>
          )}
          <p>
            Review additions: {submission.data.reviewRecommendation.added.join(", ") || "none"}
            {submission.data.reviewRecommendation.persisted
              ? " (scheduled in your review queue)"
              : " (not scheduled: self-assessed)"}
          </p>
          {question.kind === "predict_output" && (
            <>
              <button
                type="button"
                disabled={!bootstrap.data?.content.checksum || predictionRun.isPending}
                onClick={() => predictionRun.mutate()}
              >
                Run fixture after commitment
              </button>
              {predictionRun.data && (
                <output>
                  Real output: <code>{predictionRun.data.stdout}</code>
                </output>
              )}
            </>
          )}
          <button type="button" onClick={() => submission.reset()}>
            Retry editable question
          </button>
        </section>
      )}
    </article>
  );
}

export type PracticeView = "next" | "rust" | "interview" | "questions";

export function PracticePage({
  exerciseId,
  view = "next",
  difficulty,
  page = 1,
}: {
  exerciseId?: string;
  view?: PracticeView;
  difficulty?: string;
  page?: number;
}) {
  return exerciseId ? (
    // Key by exercise so exercise-to-exercise navigation remounts the bench
    // with fresh draft/evaluation state instead of leaking the prior run.
    <PracticeWorkbench key={exerciseId} exerciseId={exerciseId} />
  ) : (
    <PracticeCatalogPage view={view} difficulty={difficulty} page={page} />
  );
}

function workbenchLink(itemId: string) {
  return itemId.startsWith("EXE-ALG")
    ? { to: "/practice/algorithms/$problemId" as const, params: { problemId: itemId } }
    : { to: "/practice/rust/$exerciseId" as const, params: { exerciseId: itemId } };
}

// Inline markup for exercise prompts: **bold** and `code`. Plain prompts (no
// markup) pass straight through, so legacy exercises render unchanged.
function renderInline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const pattern = /\*\*([^*]+)\*\*|`([^`]+)`/g;
  let cursor = 0;
  let key = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > cursor) parts.push(text.slice(cursor, match.index));
    if (match[1]) parts.push(<strong key={key++}>{match[1]}</strong>);
    else if (match[2]) parts.push(<code key={key++}>{match[2]}</code>);
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

// Structured prompt renderer: honors the blank-line, **Section** label, and
// "- " bullet structure the interview prompts now carry, and degrades to a
// single paragraph for plain legacy prompts.
function PromptBody({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div className="practice-prompt">
      {lines.map((raw, index) => {
        const line = raw.trimEnd();
        if (line.trim() === "")
          // biome-ignore lint/suspicious/noArrayIndexKey: static prompt lines
          return <div key={index} className="practice-prompt__gap" aria-hidden="true" />;
        if (/^\*\*[^*]+\*\*$/.test(line.trim())) {
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: static prompt lines
            <p key={index} className="practice-prompt__label">
              {line.replace(/\*\*/g, "")}
            </p>
          );
        }
        const bullet = line.trimStart().startsWith("- ");
        return (
          <p
            // biome-ignore lint/suspicious/noArrayIndexKey: static prompt lines
            key={index}
            className={bullet ? "practice-prompt__item" : undefined}
          >
            {renderInline(bullet ? line.trimStart().slice(2) : line)}
          </p>
        );
      })}
    </div>
  );
}

/** Dumb line classifier for cargo output; no ANSI parsing by design. */
export function consoleLineTone(line: string): "ok" | "bad" | "warn" | undefined {
  const trimmed = line.trim();
  if (
    trimmed.includes("... FAILED") ||
    trimmed.startsWith("test result: FAILED") ||
    trimmed.startsWith("error") ||
    trimmed.includes("panicked at")
  ) {
    return "bad";
  }
  if (
    trimmed.endsWith("... ok") ||
    trimmed.startsWith("test result: ok") ||
    (trimmed.includes("passed;") && trimmed.includes("0 failed"))
  ) {
    return "ok";
  }
  if (trimmed.startsWith("warning")) return "warn";
  return undefined;
}

export function ConsoleOutput({ text }: { text: string }) {
  return (
    <pre>
      <code>
        {text.split("\n").map((line, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static cargo output lines
          <span key={index} data-tone={consoleLineTone(line)}>
            {`${line}\n`}
          </span>
        ))}
      </code>
    </pre>
  );
}

/** Full catalog order (all pages) so the workbench can link neighbors. */
async function getPracticeOrder() {
  const items: Array<{ id: string; title: string }> = [];
  let page = 1;
  let totalPages = 1;
  do {
    const result = await getPracticeCatalog({ page, pageSize: 25 });
    items.push(...result.items.map(({ id, title }) => ({ id, title })));
    totalPages = result.totalPages;
    page += 1;
  } while (page <= totalPages);
  return items;
}

function PracticeCatalogPage({
  view,
  difficulty,
  page,
}: {
  view: PracticeView;
  difficulty?: string;
  page: number;
}) {
  const v2 = useQuery({
    queryKey: ["practice-v2", view, difficulty, page],
    queryFn: () =>
      getPracticeCatalog({
        family: view === "rust" ? "mainmatter" : view === "interview" ? "interview" : undefined,
        difficulty,
        page,
        pageSize: 25,
      }),
    enabled: view !== "questions",
    retry: false,
  });
  const content = useQuery({
    queryKey: ["tutor-content", "ownership"],
    queryFn: ({ signal }) => getTutorContent(signal),
  });
  const algorithmCatalog = useQuery({
    queryKey: ["catalog", "algorithm-exercises"],
    queryFn: () => getCatalog("exercise", "EXE-ALG", 60),
  });
  const progress = useQuery({ queryKey: ["workbench-progress"], queryFn: getWorkbenchProgress });
  const snapshot = useQuery({ queryKey: ["dashboard-snapshot"], queryFn: getDashboardSnapshot });
  const cleared = new Set(progress.data?.completions.map((completion) => completion.itemId));
  const lastRun = snapshot.data?.recentCompilerActivity[0];
  const dueReviews = snapshot.data?.counts.dueReviews ?? 0;
  const isEmpty =
    content.data?.exercises.length === 0 && algorithmCatalog.data?.records.length === 0;
  const rowState = (itemId: string) =>
    cleared.has(itemId) ? "cleared" : lastRun?.itemId === itemId ? "in progress" : "open";
  return (
    <>
      <PageHero
        eyebrow="Workbench · real rustc, local sandbox"
        title="Practice"
        lede="The error message is the teacher. Open an exercise, state your plan, and let the local compiler check it."
        numeral=".rs"
      />
      <ContextStrip
        meta={
          dueReviews > 0 ? (
            <Link to="/review">{dueReviews} due reviews outrank practice →</Link>
          ) : (
            "sorted by what you are learning now"
          )
        }
      >
        <nav className="chip-row" aria-label="Practice views">
          {(
            [
              ["next", "Next up"],
              ["rust", "Rust exercises"],
              ["interview", "Interview patterns"],
              ["questions", "Question bank"],
            ] as const
          ).map(([id, label]) => (
            <a
              key={id}
              className="chip"
              href={`/practice?view=${id}`}
              aria-current={view === id ? "page" : undefined}
            >
              {label}
            </a>
          ))}
        </nav>
      </ContextStrip>

      {view === "questions" ? (
        <QuestionWorkbench />
      ) : (
        <div className="practice-layout">
          <div>
            {v2.isPending && <p role="status">Loading the curriculum practice release…</p>}
            {v2.data && (
              <section className="practice-rows" aria-labelledby="practice-v2-title">
                <h2 id="practice-v2-title" className="sr-only">
                  {v2.data.total} practice items
                </h2>
                <ol>
                  {v2.data.items.map((item) => (
                    <li key={item.id}>
                      <Link {...workbenchLink(item.id)}>
                        <span className="practice-rows__kind" aria-hidden="true">
                          {item.family === "interview" ? "alg" : ".rs"}
                        </span>
                        <span className="practice-rows__body">
                          <strong>{item.title}</strong>
                          <small>
                            {item.difficulty} · {item.estimateMinutes} min · {item.whyNow}
                          </small>
                        </span>
                        <span className="practice-rows__state" data-state={rowState(item.id)}>
                          {rowState(item.id)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ol>
                {v2.data.totalPages > 1 && (
                  <nav className="pagination" aria-label="Practice pages">
                    {page > 1 && (
                      <a
                        href={`/practice?view=${view}&page=${page - 1}${difficulty ? `&difficulty=${difficulty}` : ""}`}
                      >
                        Previous
                      </a>
                    )}
                    <span>
                      Page {page} of {v2.data.totalPages}
                    </span>
                    {page < v2.data.totalPages && (
                      <a
                        href={`/practice?view=${view}&page=${page + 1}${difficulty ? `&difficulty=${difficulty}` : ""}`}
                      >
                        Next
                      </a>
                    )}
                  </nav>
                )}
              </section>
            )}

            {v2.isError && (
              <p role="status">
                The curriculum-v2 catalog is unavailable; showing the compatible local catalog.
              </p>
            )}
            {v2.isError && (content.isPending || algorithmCatalog.isPending) && (
              <p role="status">Loading reviewed practice tasks…</p>
            )}
            {v2.isError && (content.isError || algorithmCatalog.isError) && (
              <p role="alert">
                Practice tasks are partially unavailable:{" "}
                {content.error?.message ?? algorithmCatalog.error?.message}
              </p>
            )}
            {v2.isError && isEmpty && (
              <section className="empty-surface">
                <h2>No reviewed practice tasks are available.</h2>
                <p>Return to the curriculum while the local release is checked.</p>
                <Link to="/curriculum">Open curriculum</Link>
              </section>
            )}
            {v2.isError && (
              <section className="practice-rows" aria-label="Local practice catalog">
                <ol>
                  {(content.data?.exercises ?? []).map((exercise) => (
                    <li key={exercise.id}>
                      <Link to="/practice/rust/$exerciseId" params={{ exerciseId: exercise.id }}>
                        <span className="practice-rows__kind" aria-hidden="true">
                          .rs
                        </span>
                        <span className="practice-rows__body">
                          <strong>{exercise.title}</strong>
                          <small>{exercise.prompt}</small>
                        </span>
                        <span className="practice-rows__state" data-state={rowState(exercise.id)}>
                          {rowState(exercise.id)}
                        </span>
                      </Link>
                    </li>
                  ))}
                  {(algorithmCatalog.data?.records ?? [])
                    .filter((problem) => problem.runnable)
                    .map((problem) => (
                      <li key={problem.id}>
                        <Link
                          to="/practice/algorithms/$problemId"
                          params={{ problemId: problem.id }}
                        >
                          <span className="practice-rows__kind" aria-hidden="true">
                            alg
                          </span>
                          <span className="practice-rows__body">
                            <strong>{problem.title}</strong>
                            <small>{problem.summary}</small>
                          </span>
                          <span className="practice-rows__state" data-state={rowState(problem.id)}>
                            {rowState(problem.id)}
                          </span>
                        </Link>
                      </li>
                    ))}
                </ol>
              </section>
            )}
          </div>
          <aside className="practice-rail" aria-label="Practice context">
            {lastRun && (
              <div className="practice-resume">
                <p className="eyebrow">Resume where the compiler left off</p>
                <p className="practice-resume__item">
                  <code>{lastRun.itemId}</code>
                </p>
                <p className="practice-resume__status">last run: {statusLabel(lastRun.status)}</p>
                <Link className="button" {...workbenchLink(lastRun.itemId)}>
                  Open →
                </Link>
              </div>
            )}
            <p className="eyebrow">How the bench grades</p>
            <ul className="practice-legend">
              <li>
                <strong>compiles</strong> — rustc accepts it, warnings noted
              </li>
              <li>
                <strong>passes</strong> — the acceptance tests agree
              </li>
              <li>
                <strong>accepted</strong> — you file the passing run as evidence
              </li>
            </ul>
            <p className="practice-rail-note">
              Accepted runs land on the knowledge graph; misses land in the{" "}
              <Link to="/errors">error catalog</Link>.
            </p>
          </aside>
        </div>
      )}
    </>
  );
}

function PracticeWorkbench({ exerciseId }: { exerciseId: string }) {
  const content = useQuery({
    queryKey: ["tutor-content", "ownership"],
    queryFn: ({ signal }) => getTutorContent(signal),
  });
  const curriculumItem = useQuery({
    queryKey: ["practice-v2-item", exerciseId],
    queryFn: () => getPracticeItem(exerciseId),
    retry: false,
  });
  const bootstrap = useQuery({
    queryKey: ["bootstrap"],
    queryFn: ({ signal }) => getBootstrap(signal),
  });
  const catalogOrder = useQuery({
    queryKey: ["practice-v2-order"],
    queryFn: getPracticeOrder,
    staleTime: 5 * 60 * 1_000,
    retry: false,
  });
  const legacyExercise = content.data?.exercises.find((entry) => entry.id === exerciseId);
  const v2Record = curriculumItem.data?.item;
  const neighbors = useMemo(() => {
    // Same ordering as the catalog page; legacy release order as fallback.
    for (const list of [catalogOrder.data ?? [], content.data?.exercises ?? []]) {
      const index = list.findIndex((item) => item.id === exerciseId);
      if (index !== -1) return { previous: list[index - 1], next: list[index + 1] };
    }
    return { previous: undefined, next: undefined };
  }, [catalogOrder.data, content.data, exerciseId]);
  const v2StarterFile = v2Record?.starter?.files.find((file) => file.path.endsWith(".rs"));
  const v2Starter = v2StarterFile?.content ?? "";
  const visibleTests = v2Record?.tests?.visible ?? [];
  const exercise = useMemo(
    () =>
      legacyExercise ??
      (v2Record
        ? {
            id: v2Record.id,
            title: v2Record.title,
            prompt: v2Record.prompt,
            starter: v2Starter,
            primaryOutcomeIds: v2Record.outcomes,
          }
        : undefined),
    [legacyExercise, v2Record, v2Starter],
  );
  const [source, setSource] = useState("");
  const [sourceVersion, setSourceVersion] = useState(1);
  const [activeRunId, setActiveRunId] = useState<string>();
  const [streamedChunks, setStreamedChunks] = useState<Array<{ channel: string; text: string }>>(
    [],
  );
  const [resetPreview, setResetPreview] = useState(false);
  const [workspaceNotice, setWorkspaceNotice] = useState("");
  const [customArgs, setCustomArgs] = useState("");
  const [customInput, setCustomInput] = useState("");
  const [customExpected, setCustomExpected] = useState("");
  const [plan, setPlan] = useState("");
  const [confidence, setConfidence] = useState<number>();
  const [hintLevel, setHintLevel] = useState(0);
  const [reflection, setReflection] = useState("");
  const [support, setSupport] = useState<
    "none" | "compiler" | "official_docs" | "hint" | "full_reveal" | "external_help"
  >("none");
  const [accessibilityBypass, setAccessibilityBypass] = useState(false);
  useEffect(() => {
    if (exercise) {
      const key = `rust-tutor:workspace-draft:v1:${exercise.id}`;
      const raw = window.localStorage.getItem(key);
      let restored = exercise.starter;
      if (raw) {
        try {
          const draft = JSON.parse(raw) as { body: string; expiresAt: number };
          if (draft.expiresAt > Date.now()) restored = draft.body;
          else window.localStorage.removeItem(key);
        } catch {
          window.localStorage.removeItem(key);
        }
      }
      setSource(restored);
      setSourceVersion(1);
    }
  }, [exercise]);
  useEffect(() => {
    if (!exercise || !source) return;
    window.localStorage.setItem(
      `rust-tutor:workspace-draft:v1:${exercise.id}`,
      JSON.stringify({ body: source, expiresAt: Date.now() + DRAFT_TTL }),
    );
  }, [exercise, source]);
  const evaluation = useMutation({
    mutationFn: (
      action: "check" | "test" | "clippy" | "format_check" | "format_preview" | "run",
    ) => {
      const contentHash = bootstrap.data?.content.checksum;
      if (!contentHash) throw new Error("The reviewed content checksum is not ready.");
      const runId = `RUN-${crypto.randomUUID()}`;
      setActiveRunId(runId);
      setStreamedChunks([]);
      return evaluateRustStreaming(
        {
          runId,
          exerciseId: exercise?.id ?? exerciseId,
          action,
          source,
          files: v2StarterFile ? { [v2StarterFile.path]: source } : undefined,
          contentHash,
          case:
            action === "run" && (customArgs || customInput || customExpected)
              ? {
                  id: "CASE-LEARNER-CUSTOM-001",
                  args: customArgs.split(/\s+/).filter(Boolean),
                  stdin: customInput,
                  expectedStdout: customExpected || undefined,
                }
              : undefined,
        },
        (chunk) => setStreamedChunks((current) => [...current.slice(-199), chunk]),
      );
    },
    onSettled: () => setActiveRunId(undefined),
  });
  const cancellation = useMutation({ mutationFn: cancelEvaluation });
  const v2Hints =
    v2Record?.hints.map((hint, index) => ({
      level: index + 1,
      text: typeof hint === "string" ? hint : hint.text,
      solutionReveal: false,
    })) ?? [];
  const hintLadder = v2Record ? v2Hints : (content.data?.hintLadder ?? []);
  const nextHint = hintLadder[hintLevel];
  const outcome = content.data?.outcomes.find((entry) =>
    exercise?.primaryOutcomeIds.includes(entry.id),
  );
  const errorCatalog = useQuery({ queryKey: ["errors"], queryFn: getErrors });
  const conceptNotes = useQuery({
    queryKey: ["journal", outcome?.conceptId],
    queryFn: () => getJournal({ conceptId: outcome?.conceptId }),
    enabled: Boolean(outcome?.conceptId),
  });
  const queryClient = useQueryClient();
  const reveal = useMutation({
    mutationFn: () => revealPracticeItem(exerciseId),
    onSuccess: () => setSupport("full_reveal"),
  });
  // Only a persisted hidden-test run can become scored evidence; the server
  // re-verifies the run ID, action, and exercise on its side.
  const lastTestRun = evaluation.data?.replay.action === "test" ? evaluation.data : undefined;
  const recording = useMutation({
    mutationFn: () => {
      if (!lastTestRun) {
        throw new Error("Submit the hidden tests first; check/run output is not scored evidence.");
      }
      return recordAttempt({
        exerciseId: exercise?.id ?? exerciseId,
        conceptId: outcome?.conceptId ?? "CON-BORROW-001",
        plan,
        confidence: confidence ?? 0,
        support,
        reflection,
        evaluatorRunId: lastTestRun.runId,
        hintLevel,
        accessibilityBypass,
      });
    },
    onSuccess: () => {
      for (const key of [
        "dashboard-snapshot",
        "review-queue",
        "confidence-calibration",
        "evidence",
        "graph",
      ]) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
  });
  useEffect(() => {
    if (recording.data && exercise) {
      window.localStorage.setItem(`rust-tutor:last-submission:v1:${exercise.id}`, source);
    }
  }, [exercise, recording.data, source]);

  const generatedManifest =
    v2Record?.starter?.manifest ??
    '[package]\nname = "learner_exercise"\nversion = "0.0.0"\nedition = "2024"\n\n[dependencies]\n';
  function restoreLastSubmission() {
    if (!exercise) return;
    const prior = window.localStorage.getItem(`rust-tutor:last-submission:v1:${exercise.id}`);
    if (!prior) {
      setWorkspaceNotice("No prior submitted source is stored for this exercise.");
      return;
    }
    setSource(prior);
    setSourceVersion((value) => value + 1);
    setWorkspaceNotice("Prior submission copied into a new disposable draft.");
  }
  function downloadWorkspace() {
    const body = JSON.stringify(
      {
        exerciseId: exercise?.id ?? exerciseId,
        files: { "src/main.rs": source, "Cargo.toml": generatedManifest },
        replay: evaluation.data?.replay ?? null,
      },
      null,
      2,
    );
    const url = URL.createObjectURL(new Blob([body], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${exercise?.id ?? exerciseId}-workspace.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }
  async function copySource() {
    try {
      await navigator.clipboard.writeText(source);
      setWorkspaceNotice("Source copied to the clipboard.");
    } catch {
      setWorkspaceNotice(
        "Source could not be copied. Select the editor text and copy it manually.",
      );
    }
  }
  if (content.isPending && curriculumItem.isPending) {
    return (
      <PageHero
        eyebrow={`Practice · ${exerciseId}`}
        title="Loading reviewed exercise…"
        lede="Reading the current local content release."
      />
    );
  }
  if (content.isError && curriculumItem.isError) {
    return (
      <>
        <PageHero
          eyebrow={`Practice · ${exerciseId}`}
          title="Exercise unavailable"
          lede="The requested workbench could not be read from the local service."
        />
        <section className="empty-surface">
          <p role="alert">{curriculumItem.error.message}</p>
          <Link to="/practice">Return to the practice catalog</Link>
        </section>
      </>
    );
  }
  if (!exercise) {
    return (
      <>
        <PageHero
          eyebrow={`Practice · ${exerciseId}`}
          title="Exercise not found"
          lede="Deep links remain honest when their content is absent from this release."
        />
        <section className="empty-surface">
          <p>This reviewed content release does not contain that exercise ID.</p>
          <Link to="/practice">Choose an available practice task</Link>
        </section>
      </>
    );
  }
  const editorFile = v2StarterFile?.path ?? "src/main.rs";
  const formattedSource = evaluation.data?.formattedFiles[editorFile];
  const lastEvaluation = evaluation.data;
  const compileState = !lastEvaluation
    ? "pending"
    : lastEvaluation.status === "COMPILE_ERROR"
      ? "fail"
      : "pass";
  const passState = !lastTestRun ? "pending" : lastTestRun.status === "ACCEPTED" ? "pass" : "fail";
  const evidenceState = recording.data ? "pass" : "pending";
  const contractMark = (state: string) => (state === "pass" ? "✓" : state === "fail" ? "✗" : "—");
  const errorCue =
    lastEvaluation && errorCatalog.data
      ? errorCatalog.data.errors.find((record) =>
          lastEvaluation.diagnostics.some((diagnostic) => diagnostic.code === record.code),
        )
      : undefined;
  const latestConceptNote = conceptNotes.data
    ? [...conceptNotes.data.entries].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
    : undefined;
  return (
    <article className="practice-lab">
      <header className="practice-lab__header">
        <Link to="/practice">← Practice</Link>
        <p>{exercise.id}</p>
        <h1>{exercise.title}</h1>
        <PromptBody text={exercise.prompt} />
        <p className="practice-contract">
          <span data-state={compileState}>compiles {contractMark(compileState)}</span>
          <span data-state={passState}>passes {contractMark(passState)}</span>
          <span data-state={evidenceState}>evidence {contractMark(evidenceState)}</span>
        </p>
        {(neighbors.previous || neighbors.next) && (
          <nav className="practice-lab__neighbors" aria-label="Exercise navigation">
            {neighbors.previous && (
              <Link {...workbenchLink(neighbors.previous.id)} title={neighbors.previous.title}>
                ← Previous
              </Link>
            )}
            {neighbors.next && (
              <Link {...workbenchLink(neighbors.next.id)} title={neighbors.next.title}>
                Next exercise →
              </Link>
            )}
          </nav>
        )}
      </header>

      <div className="practice-lab__split">
        <aside className="practice-brief" aria-label="Exercise brief">
          <div>
            {v2Record && (
              <p className="practice-brief__meta">
                <span>{v2Record.difficulty}</span>
                {v2Record.pattern && <span>{v2Record.pattern}</span>}
                <span>~{v2Record.estimateMinutes} min</span>
              </p>
            )}
            <p className="eyebrow">Your task</p>
            <h2>Make the tests pass without weakening the contract.</h2>
            <ul>
              {(v2Record?.constraints.length
                ? v2Record.constraints
                : [
                    "Do not clone the value.",
                    "Keep the caller’s value usable.",
                    "Use the narrowest valid access.",
                  ]
              ).map((constraint) => (
                <li key={constraint}>{constraint}</li>
              ))}
            </ul>
            {v2Record?.complexity && (
              <p className="practice-brief__complexity">
                Target: <code>{v2Record.complexity}</code>
              </p>
            )}
          </div>

          {visibleTests.length > 0 && (
            <div className="practice-examples">
              <p className="eyebrow">Examples · visible tests</p>
              <p>Your solution is graded against this contract, exactly as written.</p>
              {visibleTests.map((test, index) => (
                <pre key={test.path ?? test.name ?? index}>
                  <code>{test.content}</code>
                </pre>
              ))}
            </div>
          )}

          {v2Record &&
            (v2Record.commonMistakes.length > 0 ||
              v2Record.tradeoffs.length > 0 ||
              v2Record.outcomes.length > 0) && (
              <details className="practice-debrief">
                <summary>After you solve: common mistakes &amp; tradeoffs</summary>
                {v2Record.commonMistakes.length > 0 && (
                  <>
                    <p className="eyebrow">Common mistakes</p>
                    <ul>
                      {v2Record.commonMistakes.map((entry) => (
                        <li key={entry}>{entry}</li>
                      ))}
                    </ul>
                  </>
                )}
                {v2Record.tradeoffs.length > 0 && (
                  <>
                    <p className="eyebrow">Tradeoffs</p>
                    <ul>
                      {v2Record.tradeoffs.map((entry) => (
                        <li key={entry}>{entry}</li>
                      ))}
                    </ul>
                  </>
                )}
                {v2Record.outcomes.length > 0 && (
                  <>
                    <p className="eyebrow">You should be able to</p>
                    <ul>
                      {v2Record.outcomes.map((entry) => (
                        <li key={entry}>{entry}</li>
                      ))}
                    </ul>
                  </>
                )}
              </details>
            )}

          {latestConceptNote && (
            <div className="practice-note">
              <p className="eyebrow">✎ Your note on this concept</p>
              <p>{latestConceptNote.body}</p>
              <Link to="/journal">notebook →</Link>
            </div>
          )}

          <details className="practice-brief__plan">
            <summary>
              Write a plan <span>optional</span>
            </summary>
            <label htmlFor="plan">One or two sentences</label>
            <textarea
              id="plan"
              rows={3}
              value={plan}
              placeholder="What will you change, and why should it work?"
              onChange={(event) => setPlan(event.target.value)}
            />
            <fieldset>
              <legend>Confidence</legend>
              {[1, 2, 3, 4, 5].map((value) => (
                <label key={value}>
                  <input
                    type="radio"
                    name="confidence"
                    value={value}
                    checked={confidence === value}
                    disabled={Boolean(evaluation.data)}
                    onChange={() => setConfidence(value)}
                  />
                  {value}
                </label>
              ))}
            </fieldset>
          </details>

          <section className="practice-hints" aria-labelledby="practice-hints-title">
            <div>
              <p className="eyebrow" id="practice-hints-title">
                Hints
              </p>
              <span>
                {hintLevel}/{hintLadder.length}
              </span>
            </div>
            {hintLevel > 0 && <p>{hintLadder[hintLevel - 1]?.text}</p>}
            {nextHint && (
              <button
                type="button"
                onClick={() => {
                  if (!evaluation.data) setAccessibilityBypass(true);
                  setHintLevel((level) => level + 1);
                  setSupport(nextHint.solutionReveal ? "full_reveal" : "hint");
                }}
              >
                Reveal hint {nextHint.level}
              </button>
            )}
            {v2Record && !reveal.data && (
              <button type="button" disabled={reveal.isPending} onClick={() => reveal.mutate()}>
                {reveal.isPending ? "Recording reveal…" : "Show explanation and solution"}
              </button>
            )}
            {reveal.isError && <p role="alert">{reveal.error.message}</p>}
            {reveal.data && (
              <div className="solution-reveal">
                <h3>Assisted explanation</h3>
                <p>
                  {typeof reveal.data.explanation === "string"
                    ? reveal.data.explanation
                    : JSON.stringify(reveal.data.explanation)}
                </p>
                {reveal.data.referenceSolution.files.map((file) => (
                  <details key={file.path}>
                    <summary>{file.path}</summary>
                    <pre>
                      <code>{file.content}</code>
                    </pre>
                  </details>
                ))}
              </div>
            )}
          </section>
        </aside>

        <section className="practice-console" aria-labelledby="practice-editor-title">
          <header className="practice-console__bar">
            <div>
              <span className="practice-console__status" aria-hidden="true" />
              <div>
                <h2 id="practice-editor-title">{editorFile}</h2>
                <p>Draft saved locally</p>
              </div>
            </div>
            <div className="practice-console__actions">
              <button
                type="button"
                disabled={evaluation.isPending || !bootstrap.data?.capabilities.compiler}
                onClick={() => evaluation.mutate("run")}
              >
                Run
              </button>
              <button
                className="practice-console__primary"
                type="button"
                disabled={evaluation.isPending || !bootstrap.data?.capabilities.compiler}
                onClick={() => evaluation.mutate("test")}
              >
                {evaluation.isPending ? "Testing…" : "Run tests"}
              </button>
            </div>
          </header>

          <Suspense
            fallback={
              <p className="practice-console__loading" role="status">
                Loading code editor…
              </p>
            }
          >
            <MonacoSourceEditor
              exerciseId={exercise.id}
              filePath={editorFile}
              source={source}
              sourceVersion={sourceVersion}
              autocompleteEnabled={bootstrap.data?.toolchain.rust_analyzer ?? false}
              diagnostics={evaluation.data?.diagnostics ?? []}
              onChange={(value) => {
                setSource(value);
                setSourceVersion((version) => version + 1);
              }}
            />
          </Suspense>
          <p className="practice-console__keys">
            <kbd>Tab</kbd> indent · <kbd>Shift</kbd>+<kbd>Tab</kbd> outdent · <kbd>Ctrl</kbd>+
            <kbd>Space</kbd> suggestions
          </p>

          <section className="practice-output" aria-live="polite" aria-label="Compiler output">
            <header>
              <span>Compiler</span>
              {evaluation.data && (
                <strong data-ok={evaluation.data.status === "ACCEPTED" || undefined}>
                  {statusLabel(evaluation.data.status)}
                </strong>
              )}
            </header>
            {evaluation.isPending && <p>Cargo is running in a fresh local workspace…</p>}
            {evaluation.isError && <p role="alert">{evaluation.error.message}</p>}
            {!evaluation.isPending && !evaluation.data && streamedChunks.length === 0 && (
              <p>Run the tests when you are ready. Compiler feedback will appear here.</p>
            )}
            {streamedChunks.length > 0 && !evaluation.data && (
              <ConsoleOutput text={streamedChunks.map((chunk) => chunk.text).join("")} />
            )}
            {evaluation.data && (
              <>
                {evaluation.data.diagnostics.map((diagnostic) => (
                  <p key={`${diagnostic.code}-${diagnostic.message}`}>
                    <strong>{diagnostic.code ?? diagnostic.severity}</strong> {diagnostic.message}
                  </p>
                ))}
                {(evaluation.data.stdout || evaluation.data.stderr) && (
                  <ConsoleOutput text={evaluation.data.stdout || evaluation.data.stderr} />
                )}
                {evaluation.data.diagnostics.length === 0 &&
                  !evaluation.data.stdout &&
                  !evaluation.data.stderr && <p>All checks completed without output.</p>}
                {errorCue && (
                  <p className="practice-error-cue">
                    You have filed <code>{errorCue.code}</code> {errorCue.occurrenceCount}× before —
                    cue: <em>{errorCue.futureCue}</em> · <Link to="/errors">catalog</Link>
                  </p>
                )}
              </>
            )}
          </section>

          <details className="practice-console__more">
            <summary>Workspace options</summary>
            <div className="practice-console__utility-actions">
              <button
                type="button"
                disabled={evaluation.isPending}
                onClick={() => evaluation.mutate("check")}
              >
                Cargo check
              </button>
              <button
                type="button"
                disabled={evaluation.isPending || !bootstrap.data?.toolchain.clippy}
                onClick={() => evaluation.mutate("clippy")}
              >
                Clippy
              </button>
              <button
                type="button"
                disabled={evaluation.isPending || !bootstrap.data?.toolchain.rustfmt}
                onClick={() => evaluation.mutate("format_preview")}
              >
                Format preview
              </button>
              <button type="button" onClick={() => void copySource()}>
                Copy code
              </button>
              <button type="button" onClick={restoreLastSubmission}>
                Restore last submission
              </button>
              <button type="button" onClick={() => setResetPreview(true)}>
                Reset starter
              </button>
              <button type="button" onClick={downloadWorkspace}>
                Download workspace
              </button>
              {evaluation.isPending && activeRunId && (
                <button
                  type="button"
                  disabled={cancellation.isPending}
                  onClick={() => cancellation.mutate(activeRunId)}
                >
                  Cancel run
                </button>
              )}
            </div>
            <details className="practice-custom-case">
              <summary>Custom run input</summary>
              <label htmlFor="custom-args">Arguments</label>
              <input
                id="custom-args"
                value={customArgs}
                onChange={(event) => setCustomArgs(event.target.value)}
              />
              <label htmlFor="custom-stdin">Standard input</label>
              <textarea
                id="custom-stdin"
                rows={2}
                value={customInput}
                onChange={(event) => setCustomInput(event.target.value)}
              />
              <label htmlFor="custom-expected">Expected output</label>
              <textarea
                id="custom-expected"
                rows={2}
                value={customExpected}
                onChange={(event) => setCustomExpected(event.target.value)}
              />
            </details>
            <details>
              <summary>Cargo.toml</summary>
              <pre>
                <code>{generatedManifest}</code>
              </pre>
            </details>
          </details>
          {workspaceNotice && (
            <p className="practice-console__notice" role="status">
              {workspaceNotice}
            </p>
          )}
          {resetPreview && (
            <section className="reset-preview">
              <h3>Reset this draft?</h3>
              <p>Your attempt history stays intact.</p>
              <button
                type="button"
                onClick={() => {
                  setSource(exercise.starter);
                  setSourceVersion((value) => value + 1);
                  setResetPreview(false);
                }}
              >
                Reset to starter
              </button>
              <button type="button" onClick={() => setResetPreview(false)}>
                Keep draft
              </button>
            </section>
          )}
          {formattedSource && (
            <section className="format-preview">
              <h3>Format preview</h3>
              <pre>
                <code>{formattedSource}</code>
              </pre>
              <button
                type="button"
                onClick={() => {
                  setSource(formattedSource);
                  setSourceVersion((value) => value + 1);
                }}
              >
                Apply formatting
              </button>
            </section>
          )}
        </section>
      </div>

      {evaluation.data && (
        <section className="practice-reflection" aria-labelledby="reflection-title">
          <div>
            <p className="eyebrow">Explain it</p>
            <h2 id="reflection-title">One line on why it works.</h2>
          </div>
          <div>
            <label className="sr-only" htmlFor="reflection">
              Your one-line explanation
            </label>
            <textarea
              id="reflection"
              rows={1}
              value={reflection}
              placeholder="The borrow ends before the mutation, so…"
              onChange={(event) => setReflection(event.target.value)}
            />
            <details className="practice-reflection__support">
              <summary>Support used: {statusLabel(support)}</summary>
              <select
                aria-label="Support used"
                value={support}
                onChange={(event) => setSupport(event.target.value as typeof support)}
              >
                <option value="none">None</option>
                <option value="compiler">Compiler only</option>
                <option value="official_docs">Official docs</option>
                <option value="hint">Hint</option>
                <option value="full_reveal">Full reveal</option>
                <option value="external_help">External help</option>
              </select>
            </details>
            {!lastTestRun && (
              <p role="status">Run tests to make this attempt eligible for scored evidence.</p>
            )}
            <button
              className="button"
              type="button"
              disabled={!reflection || !lastTestRun || recording.isPending}
              onClick={() => recording.mutate()}
            >
              Save learning evidence
            </button>
            {recording.isError && <p role="alert">{recording.error.message}</p>}
            {recording.data && (
              <p role="status">
                <strong>{statusLabel(recording.data.outcomeState)}</strong> ·{" "}
                {recording.data.whyNext}
              </p>
            )}
          </div>
        </section>
      )}
    </article>
  );
}
