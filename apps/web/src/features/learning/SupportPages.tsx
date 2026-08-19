import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { lazy, type ReactNode, Suspense, useEffect, useState } from "react";
import { ThemeControl } from "../../app/theme";
import {
  acceptWorkbenchItem,
  applyVerifiedImport,
  compareSqlResults,
  createDatabaseBackup,
  createJournalEntry,
  dryRunImport,
  evaluateRustStreaming,
  exportLearnerData,
  finishFinalExam,
  finishFocusSession,
  getAbout,
  getBootstrap,
  getCatalog,
  getDiagnosticsPreview,
  getErrors,
  getFinalExam,
  getGraph,
  getJournal,
  getPracticeItem,
  getWorkbenchProgress,
  type LabReport,
  openFinalExam,
  recordError,
  resetProgress,
  runSystemsLab,
  saveExamAnswer,
  saveExternalPractice,
  startFocusSession,
} from "../../lib/service-client";

import { PageHero, statusLabel } from "./LearningShared";

// Renders the authored prompt (headings, bullets, fenced spans) without a
// markdown dependency: the generator only emits `### `, `**bold**` lines,
// `- ` bullets, `---` rules, and `` `code` `` spans.
function PromptProse({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];
  const flush = (key: string) => {
    if (bullets.length === 0) return;
    blocks.push(
      <ul key={key}>
        {bullets.map((item) => (
          <li key={item}>{inlineProse(item)}</li>
        ))}
      </ul>,
    );
    bullets = [];
  };
  text.split("\n").forEach((line, index) => {
    const key = `line-${index}`;
    if (line.startsWith("- ")) {
      bullets.push(line.slice(2));
      return;
    }
    flush(`${key}-list`);
    if (line.trim() === "") return;
    if (line.startsWith("---")) blocks.push(<hr key={key} />);
    else if (line.startsWith("### ")) blocks.push(<h3 key={key}>{line.slice(4)}</h3>);
    else blocks.push(<p key={key}>{inlineProse(line)}</p>);
  });
  flush("tail-list");
  return <div className="prompt-prose">{blocks}</div>;
}

function inlineProse(line: string) {
  return line.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((part, index) => {
    const key = `${index}-${part}`;
    if (part.startsWith("`") && part.endsWith("`") && part.length > 1)
      return <code key={key}>{part.slice(1, -1)}</code>;
    if (part.startsWith("**") && part.endsWith("**") && part.length > 3)
      return <strong key={key}>{part.slice(2, -2)}</strong>;
    return <span key={key}>{part}</span>;
  });
}

function hintText(hint: string | { text: string }) {
  return typeof hint === "string" ? hint : hint.text;
}

const ALGORITHM_WORKSHEET = [
  "Restate the input/output contract and edge cases",
  "Trace one normal and one adversarial example",
  "Describe a correct baseline before optimizing",
  "Select the pattern and reject one confusable alternative",
  "State the loop/state invariant",
  "Choose Rust data structures and ownership mode",
  "Derive time and auxiliary-space bounds",
  "Name visible, unseen, adversarial, and property checks",
  "Write pseudocode and a failure hypothesis",
] as const;

const MonacoSourceEditor = lazy(() =>
  import("../workbench/MonacoSourceEditor").then((module) => ({
    default: module.MonacoSourceEditor,
  })),
);

export function AlgorithmProblemPage({ problemId }: { problemId: string }) {
  // The route keeps this component mounted when $problemId changes, so the
  // draft, the hint rung, and the worksheet answers would all follow the
  // learner onto the next problem. Keying the body on the id retires them
  // with the problem they belong to.
  return <AlgorithmProblem key={problemId} problemId={problemId} />;
}

function AlgorithmProblem({ problemId }: { problemId: string }) {
  const queryClient = useQueryClient();
  const graph = useQuery({
    queryKey: ["algorithm-problem", problemId],
    queryFn: () => getGraph({ id: problemId, depth: 1 }),
  });
  const bootstrap = useQuery({
    queryKey: ["bootstrap"],
    queryFn: ({ signal }) => getBootstrap(signal),
  });
  const catalogEntry = useQuery({
    queryKey: ["catalog", "algorithm-problem", problemId],
    queryFn: () => getCatalog("exercise", problemId, 1),
  });
  // The reviewed exercise contract carries the prompt, constraints, visible
  // test, hint ladder, complexity target, and the editable-file allowlist the
  // evaluator enforces. Without it the console would post the wrong path.
  const exercise = useQuery({
    queryKey: ["practice-item", problemId],
    queryFn: () => getPracticeItem(problemId),
    retry: false,
  });
  const item = exercise.data?.item;
  const runnable =
    item?.runnable ??
    catalogEntry.data?.records.find((record) => record.id === problemId)?.runnable ??
    false;
  const problem = graph.data?.nodes.find((node) => node.id === problemId);
  const starterFile = item?.starter?.files?.[0];
  const editablePath = starterFile?.path ?? "src/main.rs";
  const [revealedHints, setRevealedHints] = useState(0);
  const progress = useQuery({ queryKey: ["workbench-progress"], queryFn: getWorkbenchProgress });
  const [worksheet, setWorksheet] = useState<Record<number, string>>({});
  const [source, setSource] = useState(() =>
    problemId === "EXE-ALG-CATALOG-PROBE-001"
      ? 'pub fn catalog_probe(catalog: &[i64], target: i64) -> Result<usize, usize> {\n    // Return the exact index or insertion position.\n    todo!()\n}\n\nfn main() {\n    println!("{:?}", catalog_probe(&[2, 5, 9, 14], 7));\n}\n'
      : 'fn solve(input: &[i64]) -> i64 {\n    // implement your invariant\n    0\n}\n\nfn main() {\n    println!("{}", solve(&[]));\n}\n',
  );
  const [sourceVersion, setSourceVersion] = useState(1);
  const [starterLoaded, setStarterLoaded] = useState(false);
  useEffect(() => {
    if (!starterFile || starterLoaded) return;
    // Seed once from the reviewed starter so the learner edits the same file
    // the evaluator will accept, then never clobber their draft again.
    setStarterLoaded(true);
    setSource(starterFile.content);
    setSourceVersion((version) => version + 1);
  }, [starterFile, starterLoaded]);
  const [customInput, setCustomInput] = useState("");
  const [customExpected, setCustomExpected] = useState("");
  const [bookmarkUrl, setBookmarkUrl] = useState("");
  const [bookmarkNotes, setBookmarkNotes] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const acceptance = useMutation({
    mutationFn: (runId: string) => acceptWorkbenchItem(problemId, runId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["workbench-progress"] }),
  });
  const evaluation = useMutation({
    mutationFn: (action: "check" | "test" | "run") => {
      const contentHash = bootstrap.data?.content.checksum;
      if (!contentHash) throw new Error("The reviewed content checksum is not ready.");
      return evaluateRustStreaming(
        {
          runId: `RUN-${crypto.randomUUID()}`,
          exerciseId: problemId,
          action,
          source,
          files: { [editablePath]: source },
          contentHash,
          case:
            action === "run" && (customInput || customExpected)
              ? {
                  id: "CASE-ALGORITHM-CUSTOM-001",
                  args: [],
                  stdin: customInput,
                  expectedStdout: customExpected || undefined,
                }
              : undefined,
        },
        () => undefined,
      );
    },
    onSuccess: (result, action) => {
      setHistory((items) =>
        [
          `${new Date().toISOString()} · ${result.status} · ${result.durationMs} ms`,
          ...items,
        ].slice(0, 8),
      );
      if (action === "test" && result.status === "ACCEPTED") acceptance.mutate(result.runId);
    },
  });
  const bookmark = useMutation({
    mutationFn: () =>
      saveExternalPractice({
        platform: "learner_selected",
        urlOrId: bookmarkUrl,
        localExerciseId: problemId,
        notes: bookmarkNotes,
      }),
  });
  return (
    <article className="practice-lab algorithm-lab">
      <header className="practice-lab__header">
        <Link to="/practice">← Practice</Link>
        <p>{problemId}</p>
        <h1>{item?.title ?? problem?.title ?? "Loading reviewed problem…"}</h1>
        <p>
          {problem?.summary ||
            item?.whyNow ||
            "This prompt is local and reviewable; no proprietary external statement or tests are fetched."}
        </p>
        {item && (
          <ul className="practice-lab__facts">
            {item.pattern && <li>{item.pattern}</li>}
            <li>{statusLabel(item.difficulty)}</li>
            {item.complexity && <li>Target {item.complexity}</li>}
            <li>~{item.estimateMinutes} min</li>
          </ul>
        )}
      </header>

      <div className="practice-lab__split">
        <aside className="practice-brief" aria-label="Interview problem brief">
          <div>
            <p className="eyebrow">Solve the contract</p>
            <h2>Start with a correct invariant. Optimize only after it holds.</h2>
            {exercise.isPending && <p role="status">Loading the reviewed problem statement…</p>}
            {item?.prompt ? <PromptProse text={item.prompt} /> : <p>{problem?.summary}</p>}
          </div>
          {item && item.constraints.length > 0 && (
            <section className="practice-brief__block">
              <h3>Constraints</h3>
              <ul>
                {item.constraints.map((constraint) => (
                  <li key={constraint}>{constraint}</li>
                ))}
              </ul>
            </section>
          )}
          {item && (item.tests?.visible?.length ?? 0) > 0 && (
            <details className="practice-brief__block">
              <summary>Visible contract test</summary>
              {item.tests?.visible.map((test) => (
                <pre key={test.path ?? test.name}>
                  <code>{test.content}</code>
                </pre>
              ))}
            </details>
          )}
          {item && item.hints.length > 0 && (
            <section className="practice-brief__block algorithm-hints">
              <h3>
                Hint ladder{" "}
                <span>
                  {revealedHints}/{item.hints.length}
                </span>
              </h3>
              <p>Each rung costs a little independence. Try the next idea first.</p>
              <ol>
                {item.hints.slice(0, revealedHints).map((hint) => (
                  <li key={hintText(hint)}>{inlineProse(hintText(hint))}</li>
                ))}
              </ol>
              {revealedHints < item.hints.length && (
                <button type="button" onClick={() => setRevealedHints((count) => count + 1)}>
                  Reveal hint {revealedHints + 1}
                </button>
              )}
            </section>
          )}
          {item && item.commonMistakes.length > 0 && (
            <details className="practice-brief__block">
              <summary>Traps this pattern sets</summary>
              <ul>
                {item.commonMistakes.map((mistake) => (
                  <li key={mistake}>{mistake}</li>
                ))}
              </ul>
            </details>
          )}
          <details className="algorithm-strategy">
            <summary>
              Reasoning worksheet <span>optional</span>
            </summary>
            <ol className="algorithm-worksheet">
              {ALGORITHM_WORKSHEET.map((prompt, index) => (
                <li key={prompt}>
                  <label htmlFor={`worksheet-${index}`}>{prompt}</label>
                  <textarea
                    id={`worksheet-${index}`}
                    rows={2}
                    value={worksheet[index] ?? ""}
                    onChange={(event) =>
                      setWorksheet((current) => ({ ...current, [index]: event.target.value }))
                    }
                  />
                </li>
              ))}
            </ol>
          </details>
          <details className="algorithm-bookmark">
            <summary>
              Link a LeetCode problem <span>optional</span>
            </summary>
            <p>The link and your notes stay local; external prompts are never copied.</p>
            <label htmlFor="external-bookmark">Public URL or ID</label>
            <input
              id="external-bookmark"
              placeholder="https://leetcode.com/problems/…"
              value={bookmarkUrl}
              onChange={(event) => setBookmarkUrl(event.target.value)}
            />
            <label htmlFor="external-reflection">Pattern and takeaway</label>
            <textarea
              id="external-reflection"
              rows={3}
              value={bookmarkNotes}
              onChange={(event) => setBookmarkNotes(event.target.value)}
            />
            <button
              type="button"
              disabled={!bookmarkUrl || !bookmarkNotes || bookmark.isPending}
              onClick={() => bookmark.mutate()}
            >
              Save local link
            </button>
            {bookmark.data && <p role="status">Saved locally. No external content was fetched.</p>}
          </details>
          {!runnable && (
            <p className="algorithm-inspect-only" role="status">
              Inspect-only: this release has no acceptance contract for this prompt yet.
            </p>
          )}
        </aside>

        <section className="practice-console" aria-labelledby="algorithm-editor-title">
          <header className="practice-console__bar">
            <div>
              <span className="practice-console__status" aria-hidden="true" />
              <div>
                <h2 id="algorithm-editor-title">{editablePath}</h2>
                <p>Original local interview problem</p>
              </div>
            </div>
            <div className="practice-console__actions">
              <button
                type="button"
                disabled={!runnable || !bootstrap.data?.content.checksum || evaluation.isPending}
                onClick={() => evaluation.mutate("run")}
              >
                Run
              </button>
              <button
                className="practice-console__primary"
                type="button"
                disabled={!runnable || !bootstrap.data?.content.checksum || evaluation.isPending}
                onClick={() => evaluation.mutate("test")}
              >
                {evaluation.isPending ? "Testing…" : "Run tests"}
              </button>
            </div>
          </header>
          <Suspense fallback={<p className="practice-console__loading">Loading code editor…</p>}>
            <MonacoSourceEditor
              exerciseId={problemId}
              filePath={editablePath}
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
            {!evaluation.data && !evaluation.isPending && (
              <p>Run the code or its hidden tests when you are ready.</p>
            )}
            {evaluation.isPending && <p>Checking the solution offline…</p>}
            {evaluation.error && <p role="alert">{evaluation.error.message}</p>}
            {evaluation.data?.diagnostics.map((diagnostic) => (
              <p key={`${diagnostic.code}-${diagnostic.message}`}>
                <strong>{diagnostic.code ?? diagnostic.severity}</strong> {diagnostic.message}
              </p>
            ))}
            {(evaluation.data?.stdout || evaluation.data?.stderr) && (
              <pre>
                <code>{evaluation.data.stdout || evaluation.data.stderr}</code>
              </pre>
            )}
            {acceptance.error && <p role="alert">{acceptance.error.message}</p>}
            {acceptance.data && (
              <p>
                Accepted.
                {acceptance.data.unlockedItemId
                  ? ` Unlocked ${acceptance.data.unlockedItemId}.`
                  : " This is the final item in the track."}
              </p>
            )}
          </section>
          <details className="practice-console__more">
            <summary>Run options and history</summary>
            <div className="practice-console__utility-actions">
              <button
                type="button"
                disabled={!runnable || !bootstrap.data?.content.checksum || evaluation.isPending}
                onClick={() => evaluation.mutate("check")}
              >
                Cargo check
              </button>
            </div>
            <details className="practice-custom-case">
              <summary>Custom input</summary>
              <label htmlFor="algorithm-input">stdin</label>
              <textarea
                id="algorithm-input"
                rows={2}
                value={customInput}
                onChange={(event) => setCustomInput(event.target.value)}
              />
              <label htmlFor="algorithm-expected">Expected output</label>
              <textarea
                id="algorithm-expected"
                rows={2}
                value={customExpected}
                onChange={(event) => setCustomExpected(event.target.value)}
              />
            </details>
            {history.length > 0 && (
              <ol>
                {history.map((entry) => (
                  <li key={entry}>{entry}</li>
                ))}
              </ol>
            )}
          </details>
          {progress.data?.completions.find((item) => item.itemId === problemId) && (
            <p className="practice-console__notice">Completed and restart-safe.</p>
          )}
        </section>
      </div>
    </article>
  );
}

export function FinalExamPage() {
  const queryClient = useQueryClient();
  const blueprint = useQuery({ queryKey: ["final-exam"], queryFn: getFinalExam });
  const [session, setSession] = useState<Awaited<ReturnType<typeof openFinalExam>>>();
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<number>();
  const [commitment, setCommitment] = useState("");
  const [accessibilityBypass, setAccessibilityBypass] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const firstUnanswered = (saved: Record<string, unknown>) => {
    const items = blueprint.data?.items ?? [];
    const position = items.findIndex((entry) => !(entry.id in saved));
    return position < 0 ? Math.max(0, items.length - 1) : position;
  };
  const open = useMutation({
    mutationFn: (retake: boolean) => openFinalExam(retake),
    onSuccess: (opened) => {
      setSession(opened);
      setAnswers(opened.answers);
      // Resume where the attempt actually is: the first unanswered item.
      setIndex(firstUnanswered(opened.answers));
    },
  });
  const item = blueprint.data?.items[index];
  const itemLocked = Boolean(item && answers[item.id]);
  const savedAnswerIndex =
    item && typeof answers[item.id] === "object" && answers[item.id] !== null
      ? (answers[item.id] as { answerIndex?: number }).answerIndex
      : undefined;
  const save = useMutation({
    mutationFn: () => {
      if (!session || !item || selected === undefined) throw new Error("Choose an answer.");
      if (answers[item.id])
        throw new Error("This item is already committed and cannot be edited in this attempt.");
      return saveExamAnswer(session.sessionId, item.id, {
        answerIndex: selected,
        commitment,
        accessibilityBypass,
      });
    },
    onSuccess: (saved) => {
      setAnswers(saved.answers);
      setSelected(undefined);
      setCommitment("");
      setConfirmed(false);
      setIndex(firstUnanswered(saved.answers));
    },
  });
  const finish = useMutation({
    mutationFn: () => {
      if (!session) throw new Error("Open the exam first.");
      return finishFinalExam(session.sessionId);
    },
    onSuccess: () => {
      // Misses persist review work; refresh dependent surfaces.
      for (const key of ["dashboard-snapshot", "review-queue"]) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
  });
  const needsCommitment =
    item &&
    ["debugging_decision", "system_design", "observability_diagnosis"].includes(item.format);
  if (finish.data) {
    const result = finish.data.result;
    return (
      <>
        <PageHero
          eyebrow={`Final exam · ${result.formVersion}`}
          title={result.passed ? "The form passed." : "The form found proof still to build."}
          lede={`${result.correct} of ${result.total} · ${result.percent}% · threshold ${result.passThresholdPercent}%. This result does not automatically master any outcome.`}
        />
        <section className="exam-results" aria-label="Outcome-level results">
          {result.results.map((entry) => (
            <article key={entry.itemId}>
              <p className="eyebrow">
                {statusLabel(entry.category)} · {entry.correct ? "correct" : "needs fresh proof"}
              </p>
              <h2>{entry.outcomeId}</h2>
              <p>{entry.explanation}</p>
              <p>
                <strong>Rubric:</strong> {entry.rubric}
              </p>
              <p>
                <strong>Next proof:</strong> {entry.nextProof}
              </p>
            </article>
          ))}
        </section>
        <p>{result.reviewPolicy}</p>
        <button
          type="button"
          onClick={() => {
            finish.reset();
            open.mutate(true);
          }}
        >
          Begin a fresh versioned attempt
        </button>
      </>
    );
  }
  return (
    <>
      <PageHero
        eyebrow="Final exam · 15 scored categories"
        title="Proof, not vibes."
        lede="One form, fifteen explicit claims, a versioned 80% threshold. You see exactly what was scored and what to revisit — one pass never converts into blanket mastery."
        numeral="15"
      />
      {blueprint.data && !session && (
        <section className="exam-policy">
          <h2>Support and disclosure</h2>
          <p>{blueprint.data.supportPolicy}</p>
          <p>{blueprint.data.retryPolicy}</p>
          <button type="button" disabled={open.isPending} onClick={() => open.mutate(false)}>
            Open or resume exam
          </button>
        </section>
      )}
      {session && item && blueprint.data && (
        <div className="exam-shell">
          <aside aria-label="Exam progress">
            <p>
              <strong>{Object.keys(answers).length}</strong> of 15 saved
            </p>
            <ol>
              {blueprint.data.items.map((entry, itemIndex) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    aria-current={itemIndex === index ? "step" : undefined}
                    onClick={() => setIndex(itemIndex)}
                  >
                    {itemIndex + 1}. {statusLabel(entry.category)}
                    {answers[entry.id] ? " · saved" : ""}
                  </button>
                </li>
              ))}
            </ol>
          </aside>
          <form
            className="exam-item"
            onSubmit={(event) => {
              event.preventDefault();
              save.mutate();
            }}
          >
            <p className="eyebrow">
              Question {index + 1} · {statusLabel(item.category)} · support: {item.support}
            </p>
            <h2>{item.prompt}</h2>
            {itemLocked ? (
              <aside className="exam-locked" role="status">
                <p>
                  <strong>Committed.</strong> This answer is locked for the rest of the attempt.
                </p>
                <ol>
                  {item.choices.map((choice, answerIndex) => (
                    <li key={choice}>
                      {answerIndex === savedAnswerIndex ? (
                        <strong>{choice} — saved</strong>
                      ) : (
                        choice
                      )}
                    </li>
                  ))}
                </ol>
              </aside>
            ) : (
              <>
                <fieldset>
                  <legend>Choose one answer</legend>
                  {item.choices.map((choice, answerIndex) => (
                    <label key={choice} className="exam-choice">
                      <input
                        type="radio"
                        name="exam-answer"
                        checked={selected === answerIndex}
                        onChange={() => setSelected(answerIndex)}
                      />
                      <span>{choice}</span>
                    </label>
                  ))}
                </fieldset>
                {needsCommitment && (
                  <label>
                    Commit your hypothesis/reasoning before consequence reveal (recorded verbatim,
                    never graded)
                    <textarea
                      required
                      rows={4}
                      value={commitment}
                      onChange={(event) => setCommitment(event.target.value)}
                    />
                  </label>
                )}
                <label className="inline-check">
                  <input
                    type="checkbox"
                    checked={accessibilityBypass}
                    onChange={(event) => setAccessibilityBypass(event.target.checked)}
                  />{" "}
                  Accessibility interaction bypass used (logged, score unchanged)
                </label>
                <label className="inline-check">
                  <input
                    type="checkbox"
                    required
                    checked={confirmed}
                    onChange={(event) => setConfirmed(event.target.checked)}
                  />{" "}
                  Confirm this answer. It cannot be edited in this attempt after saving.
                </label>
                <button
                  type="submit"
                  disabled={selected === undefined || !confirmed || save.isPending}
                >
                  Save committed answer
                </button>
              </>
            )}
            {save.error && <p role="alert">{save.error.message}</p>}
          </form>
        </div>
      )}
      {session && Object.keys(answers).length === 15 && (
        <section className="exam-submit">
          <h2>All categories are committed.</h2>
          <button type="button" disabled={finish.isPending} onClick={() => finish.mutate()}>
            Submit final exam for scoring
          </button>
          {finish.error && <p role="alert">{finish.error.message}</p>}
        </section>
      )}
      {(blueprint.error || open.error) && (
        <p role="alert">{blueprint.error?.message ?? open.error?.message}</p>
      )}
    </>
  );
}

function dateBoundary(value: string, end = false): number | undefined {
  if (!value) return undefined;
  const instant = new Date(`${value}T${end ? "23:59:59" : "00:00:00"}`);
  return Math.floor(instant.getTime() / 1_000);
}

export function JournalPage() {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState({
    q: "",
    projectId: "",
    conceptId: "",
    errorId: "",
    fromDate: "",
    toDate: "",
  });
  const [draft, setDraft] = useState({
    kind: "reflection",
    title: "",
    body: "",
    projectId: "",
    conceptId: "",
    errorId: "",
    confidence: "",
  });
  const concepts = useQuery({
    queryKey: ["catalog", "concept"],
    queryFn: () => getCatalog("concept", undefined, 500),
  });
  const projects = useQuery({
    queryKey: ["catalog", "project"],
    queryFn: () => getCatalog("project", undefined, 100),
  });
  const errorCatalog = useQuery({ queryKey: ["errors"], queryFn: getErrors });
  const anchorTitle = (id: string | null) => {
    if (!id) return null;
    return (
      concepts.data?.records.find((record) => record.id === id)?.title ??
      projects.data?.records.find((record) => record.id === id)?.title ??
      errorCatalog.data?.errors.find((record) => record.errorId === id)?.code ??
      id
    );
  };
  const anchorSelect = (
    key: "projectId" | "conceptId" | "errorId",
    label: string,
    value: string,
    onChange: (next: string) => void,
  ) => (
    <label>
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">—</option>
        {key === "conceptId" &&
          concepts.data?.records.map((record) => (
            <option key={record.id} value={record.id}>
              {record.title}
            </option>
          ))}
        {key === "projectId" &&
          projects.data?.records.map((record) => (
            <option key={record.id} value={record.id}>
              {record.title}
            </option>
          ))}
        {key === "errorId" &&
          errorCatalog.data?.errors.map((record) => (
            <option key={record.errorId} value={record.errorId}>
              {record.code} — {record.rootCause.slice(0, 40)}
            </option>
          ))}
      </select>
    </label>
  );
  const entries = useQuery({
    queryKey: ["journal", filters],
    queryFn: () =>
      getJournal({
        q: filters.q || undefined,
        projectId: filters.projectId || undefined,
        conceptId: filters.conceptId || undefined,
        errorId: filters.errorId || undefined,
        from: dateBoundary(filters.fromDate),
        to: dateBoundary(filters.toDate, true),
      }),
  });
  const create = useMutation({
    mutationFn: () => {
      // Title is optional in the UI: derive it from the first line of the note.
      const firstLine = draft.body.trim().split("\n")[0] ?? "";
      const title =
        draft.title.trim() || (firstLine.length > 64 ? `${firstLine.slice(0, 61)}…` : firstLine);
      return createJournalEntry({
        kind: draft.kind,
        title,
        body: draft.body,
        projectId: draft.projectId || undefined,
        conceptId: draft.conceptId || undefined,
        errorId: draft.errorId || undefined,
        confidence: draft.confidence ? Number(draft.confidence) : undefined,
      });
    },
    onSuccess: async () => {
      setDraft((current) => ({ ...current, title: "", body: "" }));
      await queryClient.invalidateQueries({ queryKey: ["journal"] });
    },
  });
  const filterField = (key: keyof typeof filters, label: string, type = "text") => (
    <label>
      {label}
      <input
        type={type}
        value={filters[key]}
        onChange={(event) => setFilters((current) => ({ ...current, [key]: event.target.value }))}
      />
    </label>
  );
  return (
    <>
      <PageHero
        eyebrow="Notebook · learner-owned"
        title="Journal"
        lede="Everything you write while learning, anchored to where you wrote it. One box, four kinds of note — the first line becomes the title."
        numeral="✎"
      />
      <div className="journal-layout">
        <form
          className="journal-editor"
          onSubmit={(event) => {
            event.preventDefault();
            if (draft.body.trim()) create.mutate();
          }}
        >
          <h2>New note</h2>
          <fieldset className="journal-kind-chips">
            <legend className="sr-only">Entry type</legend>
            {(
              [
                ["reflection", "Reflection"],
                ["decision", "Decision"],
                ["failure", "Failure"],
                ["transfer", "Transfer cue"],
              ] as const
            ).map(([value, label]) => (
              <label key={value} data-active={draft.kind === value || undefined}>
                <input
                  type="radio"
                  name="journal-kind"
                  value={value}
                  checked={draft.kind === value}
                  onChange={() => setDraft((current) => ({ ...current, kind: value }))}
                />
                {label}
              </label>
            ))}
          </fieldset>
          <label className="sr-only" htmlFor="journal-body">
            Note
          </label>
          <textarea
            id="journal-body"
            required
            rows={7}
            value={draft.body}
            placeholder={
              draft.kind === "failure"
                ? "What broke, what the compiler said, and the rule you'll apply next time…"
                : "The model that changed, in your own words. First line becomes the title."
            }
            onChange={(event) => setDraft((current) => ({ ...current, body: event.target.value }))}
          />
          <details className="journal-linking">
            <summary>Link this note (optional)</summary>
            <label>
              Title override
              <input
                value={draft.title}
                placeholder="Defaults to the first line"
                onChange={(event) =>
                  setDraft((current) => ({ ...current, title: event.target.value }))
                }
              />
            </label>
            <div className="compact-fields">
              {anchorSelect("conceptId", "Concept", draft.conceptId, (next) =>
                setDraft((current) => ({ ...current, conceptId: next })),
              )}
              {anchorSelect("projectId", "Project", draft.projectId, (next) =>
                setDraft((current) => ({ ...current, projectId: next })),
              )}
              {anchorSelect("errorId", "Error pattern", draft.errorId, (next) =>
                setDraft((current) => ({ ...current, errorId: next })),
              )}
              <label>
                Confidence (1–5)
                <input
                  type="number"
                  min={1}
                  max={5}
                  value={draft.confidence}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, confidence: event.target.value }))
                  }
                />
              </label>
            </div>
          </details>
          <button
            className="button"
            type="submit"
            disabled={create.isPending || !draft.body.trim()}
          >
            {create.isPending ? "Saving…" : "Save note"}
          </button>
          {create.data && (
            <p role="status">Saved. It's in the list — and it stays on this machine.</p>
          )}
          {create.error && <p role="alert">{create.error.message}</p>}
        </form>
        <section className="journal-records" aria-labelledby="journal-records-title">
          <h2 id="journal-records-title">Your notes</h2>
          <div className="journal-search">{filterField("q", "Search notes")}</div>
          <details className="journal-advanced-filters">
            <summary>Filter by link or date</summary>
            <div className="journal-filters">
              {anchorSelect("conceptId", "Concept", filters.conceptId, (next) =>
                setFilters((current) => ({ ...current, conceptId: next })),
              )}
              {anchorSelect("projectId", "Project", filters.projectId, (next) =>
                setFilters((current) => ({ ...current, projectId: next })),
              )}
              {anchorSelect("errorId", "Error pattern", filters.errorId, (next) =>
                setFilters((current) => ({ ...current, errorId: next })),
              )}
              {filterField("fromDate", "From", "date")}
              {filterField("toDate", "To", "date")}
            </div>
          </details>
          {entries.isError && <p role="alert">{entries.error.message}</p>}
          {entries.data?.entries.length === 0 && (
            <p className="journal-empty">
              No notes yet. The best first note: the last compiler error that surprised you, and the
              rule that explains it.
            </p>
          )}
          <ol className="journal-list">
            {entries.data?.entries.map((entry) => (
              <li key={entry.entryId}>
                <article>
                  <header>
                    <span className="journal-kind" data-kind={entry.kind}>
                      {statusLabel(entry.kind)}
                    </span>
                    <small>{new Date(Number(entry.createdAt) * 1_000).toLocaleString()}</small>
                  </header>
                  <h3>{entry.title}</h3>
                  {entry.body !== entry.title && <p>{entry.body}</p>}
                  {(entry.conceptId || entry.projectId || entry.errorId || entry.confidence) && (
                    <small>
                      anchored to{" "}
                      {[
                        anchorTitle(entry.conceptId),
                        anchorTitle(entry.projectId),
                        anchorTitle(entry.errorId),
                        entry.confidence ? `confidence ${entry.confidence}/5` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </small>
                  )}
                </article>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </>
  );
}

export function ErrorCatalogPage() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState({
    code: "",
    rootCause: "",
    correction: "",
    futureCue: "",
    conceptIds: "",
  });
  const errors = useQuery({ queryKey: ["error-catalog"], queryFn: getErrors });
  const conceptCatalog = useQuery({
    queryKey: ["catalog", "concept"],
    queryFn: () => getCatalog("concept", undefined, 500),
  });
  const create = useMutation({
    mutationFn: () =>
      recordError({
        ...draft,
        conceptIds: draft.conceptIds
          .split(",")
          .map((id) => id.trim())
          .filter(Boolean),
      }),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["error-catalog"] }),
  });
  return (
    <>
      <PageHero
        eyebrow={`Error catalog · ${errors.data ? `${errors.data.errors.length} patterns tracked` : "your recurring mistakes"}`}
        title="Error catalog"
        lede="Every recurring compiler error gets a root cause in your words and a prevention cue. The workbench re-surfaces the cue right before you repeat yourself."
        numeral="E—"
      />
      <section className="error-grid" aria-label="Recorded errors">
        {errors.isPending && <p role="status">Loading recorded patterns…</p>}
        {errors.isError && <p role="alert">{errors.error.message}</p>}
        {errors.data?.errors.length === 0 && (
          <p className="journal-empty">
            Nothing recorded yet. Patterns are filed from workbench runs — or record one manually
            below.
          </p>
        )}
        {errors.data?.errors.map((error) => (
          <article key={error.errorId}>
            <p className="eyebrow">
              {error.code} · {error.occurrenceCount} occurrence
              {error.occurrenceCount === 1 ? "" : "s"}
            </p>
            <h2>{error.rootCause}</h2>
            <p>
              <strong>Correction:</strong> {error.correction}
            </p>
            <p>
              <strong>Future cue:</strong> {error.futureCue}
            </p>
          </article>
        ))}
      </section>
      <details className="error-editor-disclosure">
        <summary>Record a pattern manually</summary>
        <form
          className="error-editor"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate();
          }}
        >
          <label>
            Compiler/test code
            <input
              required
              value={draft.code}
              onChange={(event) => setDraft({ ...draft, code: event.target.value })}
            />
          </label>
          <label>
            Root cause
            <textarea
              required
              value={draft.rootCause}
              onChange={(event) => setDraft({ ...draft, rootCause: event.target.value })}
            />
          </label>
          <label>
            Correction
            <textarea
              required
              value={draft.correction}
              onChange={(event) => setDraft({ ...draft, correction: event.target.value })}
            />
          </label>
          <label>
            Future cue
            <textarea
              required
              value={draft.futureCue}
              onChange={(event) => setDraft({ ...draft, futureCue: event.target.value })}
            />
          </label>
          <label>
            Related concept
            <select
              required
              value={draft.conceptIds}
              onChange={(event) => setDraft({ ...draft, conceptIds: event.target.value })}
            >
              <option value="">Choose a concept</option>
              {conceptCatalog.data?.records.map((record) => (
                <option key={record.id} value={record.id}>
                  {record.title}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={create.isPending}>
            Record occurrence
          </button>
          {create.data && <p role="status">Occurrence preserved under {create.data.errorId}.</p>}
          {create.error && <p role="alert">{create.error.message}</p>}
        </form>
      </details>
    </>
  );
}

export function SettingsPage() {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState("standard");
  const [intention, setIntention] = useState("");
  const [backupConfirmed, setBackupConfirmed] = useState(false);
  const [interruptionNotes, setInterruptionNotes] = useState("");
  const [endReview, setEndReview] = useState("");
  const [importArchive, setImportArchive] = useState<unknown>();
  const [resetScope, setResetScope] = useState<"module" | "lesson" | "all_progress">(
    "all_progress",
  );
  const [resetTarget, setResetTarget] = useState("");
  const [resetConfirmation, setResetConfirmation] = useState("");
  const focus = useMutation({ mutationFn: () => startFocusSession({ mode, intention }) });
  const finishFocus = useMutation({
    mutationFn: () =>
      finishFocusSession(focus.data?.focusSessionId ?? "", {
        interruptionNotes: interruptionNotes
          .split("\n")
          .map((note) => note.trim())
          .filter(Boolean),
        endReview,
      }),
  });
  const backup = useMutation({ mutationFn: createDatabaseBackup });
  const exportData = useMutation({
    mutationFn: exportLearnerData,
    onSuccess: (archive) => {
      const blob = new Blob([JSON.stringify(archive, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `rust-tutor-export-${archive.manifest.checksumSha256.slice(0, 12)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    },
  });
  const importDryRun = useMutation({
    mutationFn: () => dryRunImport(importArchive),
  });
  const importApply = useMutation({
    mutationFn: () => applyVerifiedImport(importArchive, importDryRun.data?.checksumSha256 ?? ""),
    // Imported rows change every learner surface; drop the whole cache.
    onSuccess: () => queryClient.invalidateQueries(),
  });
  const reset = useMutation({
    mutationFn: () =>
      resetProgress({
        scope: resetScope,
        targetId: resetScope === "all_progress" ? null : resetTarget,
        confirmation: resetConfirmation,
      }),
    onSuccess: () => queryClient.invalidateQueries(),
  });
  const diagnostics = useMutation({ mutationFn: getDiagnosticsPreview });
  return (
    <>
      <PageHero
        eyebrow="Settings · everything lives on this machine"
        title="Settings"
        lede="You hold the only copy. Exports are redacted, backups are verified, and nothing here uploads anything."
        numeral="⚙"
      />
      <section className="appearance-settings" aria-labelledby="appearance-title">
        <p className="eyebrow">Appearance</p>
        <h2 id="appearance-title">Choose a comfortable reading surface</h2>
        <p>
          Light uses the warm field-manual paper palette. Dark preserves the same hierarchy for
          lower-light environments. System follows this device automatically.
        </p>
        <ThemeControl />
      </section>
      <details className="focus-settings-disclosure">
        <summary>Focus session — set an intention for a study block</summary>
        <form
          className="focus-settings"
          onSubmit={(event) => {
            event.preventDefault();
            focus.mutate();
          }}
        >
          <fieldset>
            <legend>Focus mode</legend>
            {(
              [
                ["standard", "Standard", "All normal help remains available."],
                [
                  "deep_work",
                  "Deep Work",
                  "Record a self-directed focus block; all controls remain available.",
                ],
                [
                  "llm_free",
                  "LLM-Free",
                  "Use recall, compiler evidence, and official docs; no surveillance.",
                ],
              ] as const
            ).map(([value, label, detail]) => (
              <label key={value} className="mode-choice">
                <input
                  type="radio"
                  name="mode"
                  value={value}
                  checked={mode === value}
                  onChange={() => setMode(value)}
                />
                <span>
                  <strong>{label}</strong>
                  <small>{detail}</small>
                </span>
              </label>
            ))}
          </fieldset>
          <label>
            Intention for this block
            <textarea
              required
              rows={4}
              value={intention}
              onChange={(event) => setIntention(event.target.value)}
            />
          </label>
          <button type="submit" disabled={focus.isPending}>
            Start focus session
          </button>
          {focus.data && (
            <>
              <p role="status">Session started. Surveillance: no. Time counts as mastery: no.</p>
              {!finishFocus.data && (
                <fieldset>
                  <legend>End-of-session review</legend>
                  <label>
                    Interruption notes, one per line
                    <textarea
                      rows={3}
                      value={interruptionNotes}
                      onChange={(event) => setInterruptionNotes(event.target.value)}
                    />
                  </label>
                  <label>
                    What changed, what remains, and the next proof
                    <textarea
                      required
                      rows={4}
                      value={endReview}
                      onChange={(event) => setEndReview(event.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    disabled={finishFocus.isPending || !endReview.trim()}
                    onClick={() => finishFocus.mutate()}
                  >
                    End focus session
                  </button>
                </fieldset>
              )}
              {finishFocus.data && (
                <p role="status">
                  Focus review saved. Time remains descriptive, never mastery evidence.
                </p>
              )}
            </>
          )}
          {(focus.error || finishFocus.error) && (
            <p role="alert">{focus.error?.message ?? finishFocus.error?.message}</p>
          )}
        </form>
      </details>
      <section className="data-lifecycle" aria-labelledby="data-lifecycle-title">
        <h2 id="data-lifecycle-title">Export, backup, and recovery</h2>
        <p>Exports are redacted; backups are integrity-checked before success is reported.</p>
        <div className="workbench-toolbar">
          <button type="button" disabled={exportData.isPending} onClick={() => exportData.mutate()}>
            Download portable JSON
          </button>
          <button
            type="button"
            disabled={!backupConfirmed || backup.isPending}
            onClick={() => backup.mutate()}
          >
            Create verified database backup
          </button>
        </div>
        <label className="inline-check">
          <input
            type="checkbox"
            checked={backupConfirmed}
            onChange={(event) => setBackupConfirmed(event.target.checked)}
          />
          I understand this creates a new local backup beside the application data; it does not
          upload or replace the live database.
        </label>
        {exportData.data && (
          <p role="status">Exported checksum {exportData.data.manifest.checksumSha256}.</p>
        )}
        {backup.data && (
          <p role="status">
            Backup verified at {backup.data.backupPath} · {backup.data.bytes} bytes · checksum{" "}
            {backup.data.checksumSha256}.
          </p>
        )}
        {(exportData.error || backup.error) && (
          <p role="alert">{exportData.error?.message ?? backup.error?.message}</p>
        )}
        <form
          className="import-dry-run"
          onSubmit={(event) => {
            event.preventDefault();
            importDryRun.mutate();
          }}
        >
          <h3>Validate an import without changing data</h3>
          <input
            aria-label="Portable JSON archive"
            type="file"
            accept="application/json,.json"
            required
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              if (file.size > 1_048_576) {
                setImportArchive(undefined);
                return;
              }
              try {
                setImportArchive(JSON.parse(await file.text()));
              } catch {
                setImportArchive(undefined);
              }
            }}
          />
          <button type="submit" disabled={!importArchive || importDryRun.isPending}>
            Dry-run checksum and conflicts
          </button>
          {importDryRun.data && (
            <>
              <p role="status">
                Valid archive; the full apply was rehearsed and rolled back.{" "}
                {importDryRun.data.canonicalRowsChanged} row
                {importDryRun.data.canonicalRowsChanged === 1 ? "" : "s"} would be applied.{" "}
                {importDryRun.data.conflicts}
              </p>
              <button
                type="button"
                disabled={importApply.isPending}
                onClick={() => importApply.mutate()}
              >
                Apply checksum-verified import with automatic backup
              </button>
            </>
          )}
          {importApply.data && (
            <p role="status">
              Applied {importApply.data.apply.appliedRows} rows; append-only import ledger recorded.
            </p>
          )}
          {(importDryRun.error || importApply.error) && (
            <p role="alert">{importDryRun.error?.message ?? importApply.error?.message}</p>
          )}
        </form>
        <details className="danger-zone">
          <summary>Danger zone · progress baseline</summary>
          <form
            className="import-dry-run"
            onSubmit={(event) => {
              event.preventDefault();
              reset.mutate();
            }}
          >
            <h3>Start a new effective progress baseline</h3>
            <p>
              Reset writes an append-only baseline event after an automatic verified backup, then
              rebuilds mastery, review, and dashboard projections from that baseline. Historical
              rows stay exportable; no canonical row is deleted.
            </p>
            <label>
              Scope
              <select
                value={resetScope}
                onChange={(event) => {
                  setResetScope(event.target.value as typeof resetScope);
                  setResetConfirmation("");
                }}
              >
                <option value="all_progress">All progress</option>
                <option value="module">One module</option>
                <option value="lesson">One lesson</option>
              </select>
            </label>
            {resetScope !== "all_progress" && (
              <label>
                Canonical target ID
                <input
                  required
                  value={resetTarget}
                  onChange={(event) => setResetTarget(event.target.value)}
                />
              </label>
            )}
            <label>
              Type RESET {resetScope.toUpperCase()}
              <input
                required
                value={resetConfirmation}
                onChange={(event) => setResetConfirmation(event.target.value)}
              />
            </label>
            <button
              className="danger"
              type="submit"
              disabled={
                reset.isPending || resetConfirmation !== `RESET ${resetScope.toUpperCase()}`
              }
            >
              Create backup and record reset baseline
            </button>
            {reset.data && (
              <p role="status">
                Reset baseline {reset.data.reset.resetId} recorded and projections rebuilt; history
                preserved and canonical rows deleted: no.
              </p>
            )}
            {reset.error && <p role="alert">{reset.error.message}</p>}
          </form>
        </details>
        <details className="settings-advanced">
          <summary>Advanced · diagnostics and recovery</summary>
          <p>
            Corrupt database recovery never creates a blank replacement over the only copy. Preserve
            the original, attempt read-only export, and restore a checksum-verified backup.
          </p>
          <button
            type="button"
            onClick={() => diagnostics.mutate()}
            disabled={diagnostics.isPending}
          >
            Preview redacted diagnostics bundle
          </button>
          {diagnostics.data && <pre>{JSON.stringify(diagnostics.data, null, 2)}</pre>}
          {diagnostics.error && <p role="alert">{diagnostics.error.message}</p>}
        </details>
      </section>
    </>
  );
}

export function AboutPage() {
  const about = useQuery({ queryKey: ["about"], queryFn: getAbout });
  return (
    <>
      <PageHero
        eyebrow="About · reconstructable release"
        title="Local, inspectable, and explicit about its limits."
        lede="Your work stays local, compiler evidence stays inspectable, and the application states its execution boundary plainly."
        tone="quiet"
      />
      <section className="trust-boundary" aria-labelledby="trust-boundary-title">
        <h2 id="trust-boundary-title">Trust boundary</h2>
        <p>
          Native learner code is trusted local execution, not a hostile-code sandbox. The app has no
          telemetry, automatic upload, clipboard or process monitoring, or runtime external
          dependency.
        </p>
      </section>
      {about.isPending && <p role="status">Reading local release information…</p>}
      {about.isError && <p role="alert">{about.error.message}</p>}
      {about.data && (
        <details className="about-release-details">
          <summary>Release identifiers and diagnostics</summary>
          <p>These values come from the running service and packaged release inputs.</p>
          <dl className="about-grid">
            {Object.entries(about.data).map(([key, value]) => (
              <div className="about-item" key={key}>
                <dt>{key.replaceAll(/([A-Z])/g, " $1")}</dt>
                <dd>{String(value)}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
      <section className="credits-licenses" aria-labelledby="credits-licenses-title">
        <p className="eyebrow">Credits and licenses</p>
        <h2 id="credits-licenses-title">Every imported lesson keeps its source boundary.</h2>
        <dl>
          <div>
            <dt>The Rust Programming Language</dt>
            <dd>
              Rust Project Developers · MIT or Apache-2.0. Lessons use original synthesis and link
              to the official section that supports each claim.{" "}
              <a href="https://doc.rust-lang.org/book/" target="_blank" rel="noreferrer">
                Open the official Rust Book
              </a>
            </dd>
          </div>
          <div>
            <dt>100 Exercises to Learn Rust</dt>
            <dd>
              Mainmatter GmbH · CC BY-NC 4.0 · noncommercial use only. The pinned source contains 98
              runnable units; adaptations identify changes and do not imply endorsement.{" "}
              <a
                href="https://github.com/mainmatter/100-exercises-to-learn-rust"
                target="_blank"
                rel="noreferrer"
              >
                Inspect the upstream course
              </a>
            </dd>
          </div>
          <div>
            <dt>Interview-pattern practice</dt>
            <dd>
              Scenarios, tests, explanations, and solutions are Rust Tutor originals. Optional
              external links are study metadata only; no LeetCode prompt, example, constraint, test,
              editorial, or solution is copied into the app.
            </dd>
          </div>
        </dl>
        {about.data && (
          <>
            <p className="credits-licenses__notice" role="note">
              <strong>Bundled curriculum: noncommercial.</strong>{" "}
              {about.data.contentLicensing.notice}
            </p>
            <table className="credits-licenses__pins">
              <caption>Exactly what this build bundles, and the commit it is pinned to</caption>
              <thead>
                <tr>
                  <th scope="col">Source</th>
                  <th scope="col">License</th>
                  <th scope="col">Use</th>
                  <th scope="col">Pinned at</th>
                </tr>
              </thead>
              <tbody>
                {about.data.contentLicensing.sources.map((source) => (
                  <tr key={source.id}>
                    <th scope="row">
                      <a href={source.canonicalUrl} target="_blank" rel="noreferrer">
                        {source.title}
                      </a>
                      <small>{source.attribution}</small>
                    </th>
                    <td>
                      {source.licenseUrl ? (
                        <a href={source.licenseUrl} target="_blank" rel="noreferrer">
                          {source.license}
                        </a>
                      ) : (
                        source.license
                      )}
                    </td>
                    <td>{source.use}</td>
                    <td>
                      <code>{source.sourceCommit?.slice(0, 12) ?? "—"}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>
    </>
  );
}

const LAB_SCENARIOS = [
  ["duplicate_delivery", "Duplicate delivery"],
  ["partial_write_recovery", "Partial write recovery"],
  ["schema_evolution", "Schema evolution"],
  ["late_event_time", "Late event time"],
  ["bounded_backpressure", "Bounded backpressure"],
  ["orchestration_dag", "Orchestration DAG"],
  ["observability_diagnosis", "Observability diagnosis"],
  ["slo_error_budget", "SLO error budget"],
] as const;

export function SystemsLabPage() {
  const [scenario, setScenario] = useState<string>("duplicate_delivery");
  const [seed, setSeed] = useState(7);
  const [capacity, setCapacity] = useState(3);
  const [hypothesis, setHypothesis] = useState("");
  const [report, setReport] = useState<LabReport>();
  const [sqlExpected, setSqlExpected] = useState('[["a", 1], ["b", 2]]');
  const [sqlActual, setSqlActual] = useState('[["a", 1], ["b", 2.0000001]]');
  const [sqlOrdered, setSqlOrdered] = useState(false);
  const run = useMutation({
    mutationFn: () => runSystemsLab(scenario, { seed, hypothesis, capacity }),
    onSuccess: setReport,
  });
  const compare = useMutation({
    mutationFn: () => {
      const expected: unknown = JSON.parse(sqlExpected);
      const actual: unknown = JSON.parse(sqlActual);
      if (!Array.isArray(expected) || !Array.isArray(actual)) {
        throw new Error("Both result sets must be JSON arrays of rows.");
      }
      return compareSqlResults({
        ordered: sqlOrdered,
        numericTolerance: 0.0001,
        expected: expected as unknown[][],
        actual: actual as unknown[][],
      });
    },
  });
  return (
    <>
      <PageHero
        eyebrow="Systems lab · deterministic failure fixtures"
        title="Inject the failure, then defend the invariant."
        lede="Each scenario replays a seeded distributed-systems failure with a virtual clock and no network. Commit a hypothesis where required, then read the correlated evidence."
      />
      <section className="lab-controls" aria-labelledby="lab-controls-title">
        <h2 id="lab-controls-title">Run a deterministic scenario</h2>
        <label htmlFor="lab-scenario">Scenario</label>
        <select
          id="lab-scenario"
          value={scenario}
          onChange={(event) => setScenario(event.target.value)}
        >
          {LAB_SCENARIOS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <label htmlFor="lab-seed">Seed</label>
        <input
          id="lab-seed"
          type="number"
          min={0}
          value={seed}
          onChange={(event) => setSeed(Number(event.target.value))}
        />
        <label htmlFor="lab-capacity">Capacity (bounded queues)</label>
        <input
          id="lab-capacity"
          type="number"
          min={1}
          max={128}
          value={capacity}
          onChange={(event) => setCapacity(Number(event.target.value))}
        />
        {scenario === "observability_diagnosis" && (
          <label htmlFor="lab-hypothesis">
            Root-cause hypothesis (required before causal evidence)
            <textarea
              id="lab-hypothesis"
              rows={3}
              value={hypothesis}
              onChange={(event) => setHypothesis(event.target.value)}
            />
          </label>
        )}
        <button
          className="button"
          type="button"
          disabled={run.isPending}
          onClick={() => run.mutate()}
        >
          Run scenario
        </button>
        {run.error && <p role="alert">{run.error.message}</p>}
      </section>
      {report && (
        <section className="lab-report" aria-live="polite" aria-label="Lab report">
          <h2>
            {statusLabel(report.scenario)} ·{" "}
            {report.passed ? "invariant held" : "invariant violated"}
          </h2>
          <p>{report.invariant}</p>
          <p>
            Seed {report.seed} · virtual clock {report.virtualClock} · wall clock used: no · network
            used: no
          </p>
          <ol>
            {report.events.map((event) => (
              <li key={`${event.tick}-${event.kind}-${event.detail}`}>
                t{event.tick} <strong>{statusLabel(event.kind)}</strong>: {event.detail}
              </li>
            ))}
          </ol>
          <details>
            <summary>Outputs and metrics</summary>
            <pre>
              {JSON.stringify({ outputs: report.outputs, metrics: report.metrics }, null, 2)}
            </pre>
          </details>
        </section>
      )}
      <section className="lab-sql" aria-labelledby="lab-sql-title">
        <h2 id="lab-sql-title">SQL result comparison</h2>
        <p>
          Compare two JSON row sets with explicit ordering and numeric-tolerance semantics; JSON
          null compares only with null.
        </p>
        <label htmlFor="sql-expected">Expected rows (JSON array of arrays)</label>
        <textarea
          id="sql-expected"
          rows={3}
          value={sqlExpected}
          onChange={(event) => setSqlExpected(event.target.value)}
        />
        <label htmlFor="sql-actual">Actual rows</label>
        <textarea
          id="sql-actual"
          rows={3}
          value={sqlActual}
          onChange={(event) => setSqlActual(event.target.value)}
        />
        <label className="inline-check">
          <input
            type="checkbox"
            checked={sqlOrdered}
            onChange={(event) => setSqlOrdered(event.target.checked)}
          />{" "}
          Row order matters
        </label>
        <button type="button" disabled={compare.isPending} onClick={() => compare.mutate()}>
          Compare result sets
        </button>
        {compare.data && (
          <p role="status">
            {compare.data.accepted ? "Accepted" : "Rejected"} · tolerance{" "}
            {compare.data.numericTolerance} · {compare.data.nullSemantics}
          </p>
        )}
        {compare.error && <p role="alert">{compare.error.message}</p>}
      </section>
    </>
  );
}

export function CollectionPage({ area, detail }: { area: string; detail?: string }) {
  const graph = useQuery({
    queryKey: ["graph", "collection", detail],
    queryFn: () => getGraph({ id: detail ?? "", depth: 1 }),
    enabled: Boolean(detail),
  });
  const concept = graph.data?.nodes.find((node) => node.id === detail);
  const relations =
    graph.data?.edges.filter((edge) => edge.sourceId === detail || edge.targetId === detail) ?? [];
  return (
    <>
      <PageHero
        eyebrow={`${area} · reviewed content`}
        title={concept?.title ?? (detail ? `${area}: ${detail}` : `${area} is ready for content.`)}
        lede={
          concept?.summary ??
          "This view stays honest and quiet until the reviewed graph release provides a matching record."
        }
        tone="quiet"
      />
      {graph.isPending && <p role="status">Loading reviewed concept evidence…</p>}
      {graph.isError && <p role="alert">{graph.error.message}</p>}
      {graph.data && !concept && (
        <section className="empty-surface">
          <h2>No reviewed record matches this identifier.</h2>
          <p>The application does not fabricate examples to make an empty screen look busy.</p>
          <Link to="/curriculum">Browse reviewed curriculum</Link>
        </section>
      )}
      {concept && (
        <section className="concept-evidence" aria-labelledby="concept-evidence-title">
          <p className="eyebrow">
            {statusLabel(concept.kind)} · content {concept.contentVersion}
          </p>
          <h2 id="concept-evidence-title">Prerequisites and transfer evidence</h2>
          {relations.length > 0 ? (
            <ul>
              {relations.map((edge) => (
                <li key={edge.edgeId}>
                  <strong>{statusLabel(edge.kind)}</strong>: {edge.rationale}
                </li>
              ))}
            </ul>
          ) : (
            <p>No direct relationships are present in this bounded release view.</p>
          )}
          <Link to="/graph" search={{ id: concept.id, depth: 1 }}>
            Inspect the focused knowledge graph
          </Link>
        </section>
      )}
    </>
  );
}
