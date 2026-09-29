import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import type { EvaluationResult } from "../../lib/api-contract";
import { ChapterStudyPanel } from "../study/ChapterStudyPanel";
import {
  completeRust,
  createJournalEntry,
  evaluateRustStreaming,
  getBootstrap,
  getCourseProgress,
  saveCourseProgress,
} from "../../lib/service-client";
import {
  type Chapter,
  chapterById,
  chapterNeighbors,
  chapterProgress,
  chapters,
  mergeServerProgress,
  type Section,
  type Stop,
  saveChapterProgress,
} from "./course";
import { RichText, statusLabel } from "./LearningShared";
import { ConsoleOutput } from "./PracticePages";

/**
 * Pulls durable course progress from SQLite once and folds it into the
 * localStorage cache that drives synchronous rendering, so a cleared browser
 * re-hydrates. Returns a version that bumps when the cache actually changed.
 * Failures are ignored — the local cache keeps the UI working offline.
 */
export function useCourseProgressSync(): number {
  const [version, setVersion] = useState(0);
  const query = useQuery({
    queryKey: ["course-progress"],
    queryFn: getCourseProgress,
    staleTime: 60_000,
    retry: false,
  });
  useEffect(() => {
    if (query.data && mergeServerProgress(query.data.chapters)) {
      setVersion((current) => current + 1);
    }
  }, [query.data]);
  return version;
}

function StopCard({
  stop,
  index,
  total,
  cleared,
  onCleared,
}: {
  stop: Stop;
  index: number;
  total: number;
  cleared: boolean;
  onCleared: () => void;
}) {
  const [choice, setChoice] = useState<number>();
  const correct = choice === stop.answerIndex;
  return (
    <section className="chapter-stop" data-cleared={cleared || correct || undefined}>
      <header>
        <p className="chapter-stop__eyebrow">
          Stop {index} of {total} — clear it to roll on
        </p>
        <span>stops keep you honest</span>
      </header>
      <h3>
        <RichText text={stop.prompt} />
      </h3>
      <div className="chapter-stop__options">
        {stop.options.map((option, optionIndex) => (
          <button
            key={option}
            type="button"
            data-state={
              choice === undefined
                ? undefined
                : optionIndex === stop.answerIndex && choice === optionIndex
                  ? "correct"
                  : choice === optionIndex
                    ? "incorrect"
                    : undefined
            }
            onClick={() => {
              setChoice(optionIndex);
              if (optionIndex === stop.answerIndex) onCleared();
            }}
          >
            <RichText text={option} />
          </button>
        ))}
      </div>
      {choice !== undefined && (
        <p role="status" data-tone={correct ? "correct" : "incorrect"}>
          {correct ? "Cleared. " : "Not yet — pick again. "}
          <RichText text={stop.explain} />
        </p>
      )}
    </section>
  );
}

function ChapterNote({ chapter }: { chapter: Chapter }) {
  const key = `rust-tutor:chapter-note:v1:${chapter.id}`;
  const [note, setNote] = useState("");
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    setNote(window.localStorage.getItem(key) ?? "");
    setEditing(false);
  }, [key]);
  const save = useMutation({
    mutationFn: () =>
      createJournalEntry({
        kind: "reflection",
        title: `Note — ${chapter.title}`,
        body: note,
        conceptId: chapter.concepts[0],
      }),
  });
  return (
    <aside className="chapter-note">
      <p className="chapter-note__label">✎ My note</p>
      {editing || !note ? (
        <>
          <textarea
            aria-label="Chapter note"
            rows={3}
            value={note}
            placeholder="Write the rule in your own words — the one sentence you'd want back when this gets confusing."
            onChange={(event) => {
              setNote(event.target.value);
              window.localStorage.setItem(key, event.target.value);
            }}
          />
          {note && (
            <div className="chapter-note__actions">
              <button type="button" onClick={() => setEditing(false)}>
                Done
              </button>
            </div>
          )}
        </>
      ) : (
        <>
          <p className="chapter-note__body">{note}</p>
          <div className="chapter-note__actions">
            <span>saved to this page</span>
            <button type="button" onClick={() => setEditing(true)}>
              edit
            </button>
            <button
              type="button"
              disabled={save.isPending || save.isSuccess}
              onClick={() => save.mutate()}
            >
              {save.isSuccess ? "in notebook ✓" : "save to notebook"}
            </button>
          </div>
          {save.isError && <p role="alert">{save.error.message}</p>}
        </>
      )}
    </aside>
  );
}

// Stable in-page anchor for a subsection heading.
function sectionAnchor(heading: string): string {
  return `sec-${heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")}`;
}

function highlightRust(line: string): ReactNode {
  // Line-level tint only: keywords and strings, enough to read — not a parser.
  const tokens = line.split(
    /(\bfn\b|\blet\b|\bmut\b|\bif\b|\belse\b|\bmatch\b|\bfor\b|\bin\b|\bloop\b|\bwhile\b|\breturn\b|\bstruct\b|\benum\b|\bimpl\b|\buse\b|\bpub\b|"[^"]*")/g,
  );
  return tokens.map((token, index) =>
    /^(fn|let|mut|if|else|match|for|in|loop|while|return|struct|enum|impl|use|pub)$/.test(token) ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: static split of one line
      <span key={index} className="tok-keyword">
        {token}
      </span>
    ) : token.startsWith('"') ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: static split of one line
      <span key={index} className="tok-string">
        {token}
      </span>
    ) : (
      token
    ),
  );
}

type CompletionItem = { label: string; detail: string | null };
type CompletionBox = {
  items: CompletionItem[];
  active: number;
  top: number;
  left: number;
  flip: boolean;
};

let measureCanvas: HTMLCanvasElement | undefined;

// Caret geometry inside the monospace editor, used to anchor the completion
// popup. Content coordinates (no scroll subtraction): the popup is a child of
// the same scrolling content, so it tracks the caret line as the editor scrolls.
function caretGeometry(textarea: HTMLTextAreaElement, value: string, caret: number) {
  const linesBefore = value.slice(0, caret).split("\n");
  const lineIndex = linesBefore.length - 1;
  const colIndex = linesBefore[lineIndex]?.length ?? 0;
  const style = getComputedStyle(textarea);
  const lineHeight = Number.parseFloat(style.lineHeight) || 20;
  const padTop = Number.parseFloat(style.paddingTop) || 0;
  const padLeft = Number.parseFloat(style.paddingLeft) || 0;
  measureCanvas ??= document.createElement("canvas");
  const ctx = measureCanvas.getContext("2d");
  let charWidth = 8;
  if (ctx) {
    ctx.font = `${style.fontSize} ${style.fontFamily}`;
    charWidth = ctx.measureText("m").width || 8;
  }
  return {
    lineIndex,
    colIndex,
    lineHeight,
    charWidth,
    padTop,
    padLeft,
    totalLines: value.split("\n").length,
  };
}

// Suggest after a member-access dot, or once a word is at least two identifier
// characters — the same feel as an editor without spamming rust-analyzer.
function shouldSuggest(value: string, caret: number): boolean {
  if (value[caret - 1] === ".") return true;
  const word = value.slice(0, caret).match(/[A-Za-z_][A-Za-z0-9_]*$/)?.[0] ?? "";
  return word.length >= 2;
}

// rust-analyzer labels look like `ends_with(…)`, `is_empty()`, `ge(…)(as Ord)`.
// Derive the text to insert and where the caret should land.
function completionInsert(label: string): { text: string; caretInside: boolean } {
  const clean = label.replace(/\s*\(as [^)]*\)\s*$/, "");
  if (clean.endsWith("(…)")) return { text: `${clean.slice(0, -3)}()`, caretInside: true };
  return { text: clean, caretInside: false };
}

export function ChapterTerminal({
  chapter,
  onRan,
}: {
  chapter: Pick<Chapter, "id" | "title" | "terminal">;
  onRan: () => void;
}) {
  const bootstrap = useQuery({
    queryKey: ["bootstrap"],
    queryFn: ({ signal }) => getBootstrap(signal),
  });
  const draftKey = `rust-tutor:chapter-code:v1:${chapter.id}`;
  // Read the saved draft synchronously so the starter never flashes. The parent
  // remounts this component per chapter (key), so no manual per-chapter reset is
  // needed — source, output, and completions all start fresh.
  const [source, setSource] = useState(
    () => window.localStorage.getItem(draftKey) ?? chapter.terminal.code,
  );
  const [hintsOpen, setHintsOpen] = useState(0);
  const [chunks, setChunks] = useState<Array<{ channel: string; text: string }>>([]);
  const [box, setBox] = useState<CompletionBox | null>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  // Document version and debounce timer kept in refs so completion never reads
  // stale render state (the bug that stopped the popup from ever appearing).
  const versionRef = useRef(1);
  const suggestTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const analyzerReady = bootstrap.data?.toolchain.rust_analyzer ?? false;
  const exerciseId = chapter.terminal.exerciseId ?? `CH-${chapter.id.toUpperCase()}`;

  function writeSource(next: string) {
    setSource(next);
    versionRef.current += 1;
    window.localStorage.setItem(draftKey, next);
  }

  useEffect(() => () => window.clearTimeout(suggestTimer.current), []);

  const evaluation = useMutation({
    mutationFn: () => {
      const contentHash = bootstrap.data?.content.checksum;
      if (!contentHash) throw new Error("The local service has not finished starting.");
      setChunks([]);
      return evaluateRustStreaming(
        {
          runId: `RUN-${crypto.randomUUID()}`,
          exerciseId,
          action: chapter.terminal.exerciseId
            ? "test"
            : chapter.terminal.checkOnly
              ? "check"
              : "run",
          source,
          files: chapter.terminal.checkOnly ? { [chapter.terminal.file]: source } : undefined,
          contentHash,
        },
        (chunk) => setChunks((current) => [...current.slice(-199), chunk]),
      );
    },
    onSuccess: (result: EvaluationResult) => {
      if (result.status === "ACCEPTED") onRan();
    },
  });

  const completion = useMutation({
    mutationFn: async (input: { value: string; caret: number }) => {
      const linesBefore = input.value.slice(0, input.caret).split("\n");
      const result = await completeRust({
        exerciseId,
        source: input.value,
        version: versionRef.current,
        line: linesBefore.length - 1,
        character: linesBefore.at(-1)?.length ?? 0,
      });
      return { result, value: input.value, caret: input.caret };
    },
    onSuccess: ({ result, value, caret }) => {
      const textarea = editorRef.current;
      const seen = new Set<string>();
      const items = result.items
        .filter((item) => item.label && !item.label.startsWith("("))
        .map((item) => ({ label: item.label, detail: item.detail }))
        .filter((item) => {
          const key = `${item.label}::${item.detail ?? ""}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .slice(0, 40);
      if (!textarea || items.length === 0) {
        setBox(null);
        return;
      }
      const geometry = caretGeometry(textarea, value, caret);
      const flip = geometry.lineIndex > geometry.totalLines - 5 && geometry.totalLines > 8;
      setBox({
        items,
        active: 0,
        left: geometry.padLeft + geometry.colIndex * geometry.charWidth,
        top: flip
          ? geometry.padTop + geometry.lineIndex * geometry.lineHeight
          : geometry.padTop + (geometry.lineIndex + 1) * geometry.lineHeight,
        flip,
      });
    },
  });

  // Ask rust-analyzer for completions at the editor's current caret.
  function requestCompletion() {
    const textarea = editorRef.current;
    if (!analyzerReady || !textarea) return;
    window.clearTimeout(suggestTimer.current);
    completion.mutate({ value: textarea.value, caret: textarea.selectionStart });
  }

  // Debounced auto-suggest as the learner types.
  function scheduleCompletion(value: string, caret: number) {
    window.clearTimeout(suggestTimer.current);
    suggestTimer.current = setTimeout(() => {
      if (analyzerReady) completion.mutate({ value, caret });
    }, 160);
  }

  function acceptCompletion(item: CompletionItem) {
    const textarea = editorRef.current;
    if (!textarea) return;
    const value = textarea.value;
    const cursor = textarea.selectionStart;
    const prefix = value.slice(0, cursor).match(/[A-Za-z0-9_]*$/)?.[0] ?? "";
    const { text, caretInside } = completionInsert(item.label);
    const start = cursor - prefix.length;
    writeSource(value.slice(0, start) + text + value.slice(cursor));
    setBox(null);
    const caret = caretInside ? start + text.length - 1 : start + text.length;
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(caret, caret);
    });
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    const textarea = event.currentTarget;
    if (box) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setBox({ ...box, active: Math.min(box.active + 1, box.items.length - 1) });
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setBox({ ...box, active: Math.max(box.active - 1, 0) });
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        const item = box.items[box.active];
        if (item) acceptCompletion(item);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setBox(null);
        return;
      }
    }
    // Cmd/Ctrl+Enter runs; Ctrl/Cmd+Space asks rust-analyzer for completions.
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      if (!evaluation.isPending && bootstrap.data?.capabilities.compiler) evaluation.mutate();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key === " ") {
      event.preventDefault();
      requestCompletion();
      return;
    }
    // Escape releases keyboard focus so Tab-trapping never strands a user.
    if (event.key === "Escape") {
      textarea.blur();
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      const { selectionStart: from, selectionEnd: to } = textarea;
      if (event.shiftKey) {
        // Dedent: drop up to two leading spaces on the caret's line.
        const lineStart = source.lastIndexOf("\n", from - 1) + 1;
        const removable = source.slice(lineStart).match(/^ {1,2}/)?.[0].length ?? 0;
        if (removable > 0) {
          writeSource(source.slice(0, lineStart) + source.slice(lineStart + removable));
          requestAnimationFrame(() => textarea.setSelectionRange(from - removable, to - removable));
        }
      } else {
        writeSource(`${source.slice(0, from)}  ${source.slice(to)}`);
        requestAnimationFrame(() => textarea.setSelectionRange(from + 2, from + 2));
      }
    }
  }

  const lines = source.split("\n");
  const output = evaluation.data;
  return (
    <aside className="chapter-terminal" aria-label="Chapter workbench">
      <header className="chapter-terminal__bar">
        <span>{chapter.terminal.file}</span>
        <div>
          {analyzerReady && (
            <button
              type="button"
              className="chapter-terminal__suggest-button"
              disabled={completion.isPending}
              title="Autocomplete with rust-analyzer"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                editorRef.current?.focus();
                requestCompletion();
              }}
            >
              {completion.isPending ? "…" : "⌄ Suggest"}
            </button>
          )}
          <button
            type="button"
            className="chapter-terminal__hint-button"
            disabled={hintsOpen >= chapter.terminal.hints.length}
            onClick={() => setHintsOpen((count) => count + 1)}
          >
            💡 Hint
          </button>
          <button
            type="button"
            className="chapter-terminal__run-button"
            disabled={evaluation.isPending || !bootstrap.data?.capabilities.compiler}
            onClick={() => evaluation.mutate()}
          >
            {evaluation.isPending
              ? chapter.terminal.checkOnly
                ? "Checking…"
                : "Running…"
              : chapter.terminal.checkOnly
                ? "✓ Check"
                : "▶ Run"}
          </button>
        </div>
      </header>
      <p className="chapter-terminal__task">{chapter.terminal.task}</p>
      <div className="chapter-terminal__editor">
        <pre aria-hidden="true" className="chapter-terminal__gutter">
          {lines.map((_, index) => `${index + 1}\n`).join("")}
        </pre>
        <div className="chapter-terminal__code">
          <pre aria-hidden="true">
            {lines.map((line, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: mirrors textarea lines
              <div key={index}>{highlightRust(line) ?? " "}</div>
            ))}
          </pre>
          <textarea
            ref={editorRef}
            aria-label={`Rust source for ${chapter.terminal.file}`}
            value={source}
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            onKeyDown={onKeyDown}
            onBlur={() => setBox(null)}
            onChange={(event) => {
              const value = event.target.value;
              const caret = event.target.selectionStart;
              writeSource(value);
              if (analyzerReady && shouldSuggest(value, caret)) {
                scheduleCompletion(value, caret);
              } else {
                window.clearTimeout(suggestTimer.current);
                if (box) setBox(null);
              }
            }}
          />
          {box && (
            <ul
              className="chapter-terminal__completions"
              data-flip={box.flip || undefined}
              style={{ top: box.top, left: box.left }}
              aria-label="Code completions"
            >
              {box.items.map((item, index) => (
                <li key={`${item.label}::${item.detail ?? ""}`}>
                  <button
                    type="button"
                    data-active={index === box.active || undefined}
                    // Keep textarea focus so Escape/arrows keep working after a click.
                    onMouseDown={(event) => {
                      event.preventDefault();
                      acceptCompletion(item);
                    }}
                  >
                    <code>{item.label}</code>
                    {item.detail && <span>{item.detail}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <p className="chapter-terminal__keys">
        {analyzerReady ? (
          <>
            autocomplete as you type · <kbd>Tab</kbd> indent · <kbd>⌘</kbd>
            <kbd>↵</kbd> run · <kbd>Esc</kbd> leave editor
          </>
        ) : (
          <>
            <kbd>Tab</kbd> indent · <kbd>⌘</kbd>
            <kbd>↵</kbd> run · autocomplete needs <code>rustup component add rust-analyzer</code>
          </>
        )}
      </p>
      {hintsOpen > 0 && (
        <div className="chapter-terminal__hints">
          <p>
            Hint · {hintsOpen} of {chapter.terminal.hints.length}
            {hintsOpen < chapter.terminal.hints.length ? " — tap to reveal next" : ""}
          </p>
          {chapter.terminal.hints.slice(0, hintsOpen).map((hint) => (
            <p key={hint}>{hint}</p>
          ))}
        </div>
      )}
      <section className="chapter-terminal__output" aria-live="polite">
        <p className="chapter-terminal__output-label">Output</p>
        {evaluation.isPending && (
          <p className="chapter-terminal__compiling">Compiling in a fresh local workspace…</p>
        )}
        {evaluation.isError && <p className="tok-error">{evaluation.error.message}</p>}
        {chunks.length > 0 && !output && (
          <ConsoleOutput text={chunks.map((chunk) => chunk.text).join("")} />
        )}
        {output && (
          <>
            <p
              className="chapter-terminal__verdict"
              data-ok={output.status === "ACCEPTED" || undefined}
            >
              {output.status === "ACCEPTED" ? "Compiling ✓" : statusLabel(output.status)} ·{" "}
              {(output.durationMs / 1000).toFixed(2)}s
            </p>
            {output.diagnostics.slice(0, 4).map((diagnostic) => (
              <p key={`${diagnostic.code}-${diagnostic.message}`} className="tok-error">
                {diagnostic.code ? `${diagnostic.code}: ` : ""}
                {diagnostic.message}
                {diagnostic.spans.find((span) => span.primary) &&
                  ` — line ${diagnostic.spans.find((span) => span.primary)?.lineStart}`}
              </p>
            ))}
            {(output.stdout || output.stderr) && (
              <ConsoleOutput text={output.stdout || output.stderr} />
            )}
            {!output.stdout && !output.stderr && output.diagnostics.length === 0 && (
              <p>The program completed without output.</p>
            )}
          </>
        )}
        {!output && !evaluation.isPending && chunks.length === 0 && (
          <p className="chapter-terminal__idle">
            {chapter.terminal.checkOnly
              ? "Check the code to see real compiler output here."
              : "Run the code to see real compiler output here."}
          </p>
        )}
      </section>
      {chapter.terminal.exerciseId && (
        <Link
          className="chapter-terminal__workbench-link"
          to="/practice/rust/$exerciseId"
          params={{ exerciseId: chapter.terminal.exerciseId }}
        >
          Open this exercise in the full workbench →
        </Link>
      )}
    </aside>
  );
}

export function ChapterPage({ chapterId }: { chapterId: string }) {
  const chapter = chapterById(chapterId);
  // Progress lives in localStorage; this state only forces a re-read after saves.
  const [, setProgressVersion] = useState(0);
  const [railOpen, setRailOpen] = useState(true);
  useCourseProgressSync();
  const persist = useMutation({
    mutationFn: (input: { chapterId: string; clearedStops: string[]; ran: boolean }) =>
      saveCourseProgress(input.chapterId, { clearedStops: input.clearedStops, ran: input.ran }),
  });
  const progress = chapter ? chapterProgress(chapter.id) : { stops: [], ran: false };
  if (!chapter) {
    return (
      <div className="chapter-page">
        <header className="chapter-hero">
          <div className="chapter-hero__inner">
            <p className="chapter-hero__eyebrow">Course · unknown chapter</p>
            <h1>Chapter not found</h1>
            <p className="lede">
              This course has no chapter with that ID. No progress was changed.
            </p>
            <Link className="button" to="/curriculum">
              Back to the learning path
            </Link>
          </div>
        </header>
      </div>
    );
  }
  const stops = chapter.sections.filter(
    (section): section is Extract<Section, { kind: "stop" }> => section.kind === "stop",
  );
  // Prose headings are the chapter's subsections; anchor + list them so long
  // chapters get an in-page table of contents.
  const subsections = chapter.sections
    .filter(
      (section): section is Extract<Section, { kind: "prose" }> =>
        section.kind === "prose" && Boolean(section.heading),
    )
    .map((section) => ({ id: sectionAnchor(section.heading ?? ""), title: section.heading ?? "" }));
  const clearedStops = stops.filter((section) => progress.stops.includes(section.stop.id)).length;
  const { previous, next } = chapterNeighbors(chapter.id);
  const strandChapters = chapters.filter((entry) => entry.strand === chapter.strand);
  const chapterDone = clearedStops === stops.length && progress.ran;
  let stopIndex = 0;
  const numberLabel = String(chapter.number).padStart(2, "0");
  return (
    <div className="chapter-page">
      <header className="chapter-hero">
        <div className="chapter-hero__inner">
          <p className="chapter-hero__eyebrow">
            Chapter {chapter.number} — {chapter.strand}
          </p>
          <h1>{chapter.title}</h1>
          <p className="lede">{chapter.summary}</p>
          <div className="chapter-hero__meta">
            <span>◷ {chapter.minutes} min</span>
            {subsections.length >= 2 && <span>❏ {subsections.length} sections</span>}
            <span>◈ {stops.length} stops</span>
            <span>▣ 1 terminal exercise</span>
          </div>
        </div>
        <span className="chapter-hero__number" aria-hidden="true">
          {numberLabel}
        </span>
      </header>
      <nav className="chapter-seam" aria-label="Chapter context">
        <button
          type="button"
          className="chapter-seam__rail-toggle"
          aria-expanded={railOpen}
          onClick={() => setRailOpen((open) => !open)}
        >
          {railOpen ? "⟨ hide path" : "⟩ show path"}
        </button>
        <Link to="/curriculum">‹ Learning path</Link>
        <span>
          {chapter.strand} /{" "}
          <strong>
            {numberLabel} · {chapter.title}
          </strong>
        </span>
        <span>
          {clearedStops} of {stops.length} stops cleared{progress.ran ? " · code ran" : ""}
        </span>
      </nav>
      <div className="chapter-shell" data-rail={railOpen ? "open" : "closed"}>
        {railOpen && (
          <aside className="chapter-rail" aria-label="Chapters in this part">
            <p className="chapter-rail__label">{chapter.strand}</p>
            <ol>
              {strandChapters.map((entry) => {
                const state =
                  entry.id === chapter.id
                    ? "current"
                    : chapterProgress(entry.id).ran
                      ? "complete"
                      : undefined;
                return (
                  <li key={entry.id} data-state={state}>
                    <Link
                      to="/learn/$chapterId"
                      params={{ chapterId: entry.id }}
                      aria-current={entry.id === chapter.id ? "page" : undefined}
                    >
                      <span className="chapter-rail__dot" aria-hidden="true" />
                      {entry.title}
                    </Link>
                    {entry.id === chapter.id && (
                      <small>
                        you are here · stop {Math.min(clearedStops + 1, Math.max(stops.length, 1))}/
                        {stops.length}
                      </small>
                    )}
                  </li>
                );
              })}
            </ol>
            <Link
              className="chapter-rail__graph"
              to="/graph"
              search={{ id: chapter.concepts[0] ?? "CON-RUST-OWNERSHIP-001", depth: 1 }}
            >
              Inspect concept graph →
            </Link>
          </aside>
        )}
        <article className="chapter-reading">
          {subsections.length >= 2 && (
            <nav className="chapter-toc" aria-label="In this chapter">
              <p className="chapter-toc__label">In this chapter</p>
              <ol>
                {subsections.map((entry, index) => (
                  <li key={entry.id}>
                    <a href={`#${entry.id}`}>
                      <span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                      {entry.title}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          )}
          {chapter.sections.map((section, index) => {
            switch (section.kind) {
              case "prose":
                return (
                  // biome-ignore lint/suspicious/noArrayIndexKey: static content order
                  <section key={index}>
                    {section.eyebrow && <p className="eyebrow">{section.eyebrow}</p>}
                    {section.heading && (
                      <h2 id={sectionAnchor(section.heading)}>{section.heading}</h2>
                    )}
                    {section.body.map((paragraph) => (
                      <p key={paragraph.slice(0, 40)}>
                        <RichText text={paragraph} />
                      </p>
                    ))}
                  </section>
                );
              case "code":
                return (
                  // biome-ignore lint/suspicious/noArrayIndexKey: static content order
                  <figure className="chapter-figure" key={index}>
                    {section.title && (
                      <figcaption className="chapter-figure__title">{section.title}</figcaption>
                    )}
                    <pre>
                      <code>{section.code}</code>
                    </pre>
                    {section.caption && (
                      <figcaption className="chapter-figure__caption">
                        <RichText text={section.caption} />
                      </figcaption>
                    )}
                  </figure>
                );
              case "callout":
                return (
                  // biome-ignore lint/suspicious/noArrayIndexKey: static content order
                  <aside className="chapter-callout" key={index}>
                    <strong>{section.title}</strong>
                    <span>
                      <RichText text={section.body} />
                    </span>
                  </aside>
                );
              case "stop": {
                stopIndex += 1;
                return (
                  <StopCard
                    key={section.stop.id}
                    stop={section.stop}
                    index={stopIndex}
                    total={stops.length}
                    cleared={progress.stops.includes(section.stop.id)}
                    onCleared={() => {
                      const next = saveChapterProgress(chapter.id, {
                        stops: [...progress.stops, section.stop.id],
                      });
                      persist.mutate({
                        chapterId: chapter.id,
                        clearedStops: next.stops,
                        ran: next.ran,
                      });
                      setProgressVersion((version) => version + 1);
                    }}
                  />
                );
              }
              default:
                return null;
            }
          })}
          <ChapterStudyPanel chapterId={chapter.id} />
          <ChapterNote chapter={chapter} />
          <nav className="chapter-navigation" aria-label="Chapter navigation">
            {previous ? (
              <Link to="/learn/$chapterId" params={{ chapterId: previous.id }}>
                ← {previous.title}
              </Link>
            ) : (
              <Link to="/curriculum">← Learning path</Link>
            )}
            {next ? (
              chapterDone ? (
                <Link className="button" to="/learn/$chapterId" params={{ chapterId: next.id }}>
                  Continue → {next.title}
                </Link>
              ) : (
                <span className="chapter-navigation__locked">
                  <span className="button secondary" aria-disabled="true">
                    Continue → {next.title}
                  </span>
                  <small>
                    {stops.length - clearedStops > 0
                      ? `clear ${stops.length - clearedStops} more ${stops.length - clearedStops === 1 ? "stop" : "stops"}`
                      : ""}
                    {stops.length - clearedStops > 0 && !progress.ran ? " and " : ""}
                    {progress.ran ? "" : "run the code"} to continue
                  </small>
                </span>
              )
            ) : (
              <Link className="button" to="/curriculum">
                Finish the course → full path
              </Link>
            )}
          </nav>
        </article>
        <ChapterTerminal
          key={chapter.id}
          chapter={chapter}
          onRan={() => {
            const next = saveChapterProgress(chapter.id, { ran: true });
            persist.mutate({
              chapterId: chapter.id,
              clearedStops: next.stops,
              ran: next.ran,
            });
            setProgressVersion((version) => version + 1);
          }}
        />
      </div>
    </div>
  );
}
