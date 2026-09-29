import { Link } from "@tanstack/react-router";
import {
  type ChangeEvent,
  type ReactElement,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { chapterProgress, chapters } from "../learning/course";
import { ContextStrip, PageHero, RichText } from "../learning/LearningShared";
import { bankByChapter } from "./bank";
import { cardFromMissedItem, type DeckCard, deckCards, planSession } from "./deck";
import {
  answered,
  assembleTest,
  type Confidence,
  correctAnswerText,
  type ItemResponse,
  isCorrect,
  listSegments,
  normalizeRecall,
  PASS_PERCENT,
  type PreparedItem,
  type Segment,
  segmentById,
  summarize,
  type TestForm,
  type TestMode,
  type TestSummary,
} from "./engine";
import { freshSeed } from "./rng";
import {
  dayNumber,
  type Grade,
  INTERVAL_DAYS,
  MATURE_STEP,
  previewIntervals,
  schedule,
} from "./scheduler";
import {
  applyReview,
  emptyStudyState,
  loadStudy,
  parseStudyState,
  recordAttempt,
  retention,
  saveStudy,
  segmentStats,
  type StudyState,
  updateStudy,
  useStudyState,
} from "./store";
import type { Question } from "./types";

const confidenceLabels: Record<Confidence, string> = { 1: "Guessing", 2: "Unsure", 3: "Sure" };

function startedChapterIds(): string[] {
  return chapters
    .filter((chapter) => {
      const progress = chapterProgress(chapter.id);
      return progress.ran || progress.stops.length > 0;
    })
    .map((chapter) => chapter.id);
}

function chapterTitle(chapterId: string): string {
  const chapter = chapters.find((entry) => entry.id === chapterId);
  return chapter ? `${chapter.number}. ${chapter.title}` : chapterId;
}

function topicLabel(topic: string): string {
  return topic.replaceAll("-", " ");
}

function CodeBlock({ code }: { code: string }) {
  return (
    <pre className="study-code">
      <code>{code}</code>
    </pre>
  );
}

/* ------------------------------------------------------------------ hub */

export function StudyHubPage(): ReactElement {
  const state = useStudyState();
  const today = dayNumber();
  const segments = useMemo(() => listSegments(), []);
  const plan = useMemo(
    () => planSession({ state, today, startedChapterIds: startedChapterIds(), seed: 1 }),
    [state, today],
  );
  const cards = useMemo(() => deckCards(state), [state]);
  const learned = cards.filter((card) => (state.cards[card.id]?.step ?? -1) >= 0).length;
  const mature = cards.filter((card) => (state.cards[card.id]?.step ?? -1) >= MATURE_STEP).length;
  const recall = retention(state, today);
  const chapterSegments = segments.filter((segment) => segment.kind === "chapter");
  const passedChapters = chapterSegments.filter(
    (segment) => (segmentStats(state, segment.id).best ?? 0) >= PASS_PERCENT,
  ).length;
  const strands = [...new Set(chapters.map((chapter) => chapter.strand))];
  const mixed = segments.find((segment) => segment.kind === "mixed");
  const questionCount = [...bankByChapter.values()].reduce(
    (sum, bank) => sum + bank.questions.length,
    0,
  );
  const generatorCount = [...bankByChapter.values()].reduce(
    (sum, bank) => sum + bank.generators.length,
    0,
  );

  return (
    <>
      <PageHero
        eyebrow="Study · retrieval, spacing, and self-testing"
        title={
          plan.queue.length > 0
            ? `${plan.queue.length} ${plan.queue.length === 1 ? "card is" : "cards are"} ready today.`
            : "Test yourself, then let spacing do the rest."
        }
        lede={`Every chapter has a randomised test drawn from ${questionCount} compiler-verified questions and ${generatorCount} generators that write fresh variants, so no two forms are the same. Cards you miss come back on an expanding schedule until they stick.`}
        numeral={plan.queue.length > 0 ? String(plan.queue.length).padStart(2, "0") : undefined}
        actions={
          <>
            <Link className="button" to="/study/cards">
              {plan.queue.length > 0 ? "Start today's cards" : "Open flashcards"}
            </Link>
            {mixed && (
              <Link
                className="button secondary"
                to="/study/test/$segmentId"
                params={{ segmentId: mixed.id }}
                search={{ mode: "exam" }}
              >
                Mixed review test
              </Link>
            )}
          </>
        }
      />
      <ContextStrip
        meta={`intervals ${INTERVAL_DAYS.join(" · ")} days · pass mark ${PASS_PERCENT}%`}
      >
        <span>
          {plan.dueCount} due · {plan.newAvailable} new available · {learned} learned · {mature}{" "}
          mature
          {recall === null ? "" : ` · ${Math.round(recall * 100)}% recalled (30 days)`} ·{" "}
          {passedChapters}/{chapterSegments.length} chapter tests passed
        </span>
      </ContextStrip>

      <section className="study-section" aria-labelledby="study-tests-title">
        <h2 id="study-tests-title">Segment tests</h2>
        <p className="study-hint">
          <strong>Test</strong> holds feedback to the end, like the real thing.{" "}
          <strong>Practice</strong> explains each answer as you go. <strong>Pretest</strong> is four
          questions to try <em>before</em> reading a chapter — wrong guesses there make the reading
          stick better.
        </p>
        {strands.map((strand) => {
          const strandSegment = segments.find(
            (segment) => segment.kind === "strand" && segment.title === strand,
          );
          const strandChapters = chapterSegments.filter((segment) =>
            chapters.some((chapter) => chapter.id === segment.id && chapter.strand === strand),
          );
          return (
            <article className="study-strand" key={strand}>
              <header>
                <h3>{strand}</h3>
                {strandSegment && (
                  <SegmentActions segment={strandSegment} state={state} compact={false} />
                )}
              </header>
              <ol className="study-segment-list">
                {strandChapters.map((segment) => (
                  <li key={segment.id}>
                    <span className="study-segment-list__title">{segment.title}</span>
                    <SegmentActions segment={segment} state={state} compact />
                  </li>
                ))}
              </ol>
            </article>
          );
        })}
      </section>

      <StudySettings state={state} />
      <ResearchNotes />
    </>
  );
}

function SegmentActions({
  segment,
  state,
  compact,
}: {
  segment: Segment;
  state: StudyState;
  compact: boolean;
}) {
  const stats = segmentStats(state, segment.id);
  return (
    <span className="study-segment-actions">
      <span className="study-score" data-passed={(stats.best ?? 0) >= PASS_PERCENT || undefined}>
        {stats.best === null
          ? "not taken"
          : `best ${stats.best}% · ${stats.attempts} ${stats.attempts === 1 ? "try" : "tries"}`}
      </span>
      <Link
        className="button"
        to="/study/test/$segmentId"
        params={{ segmentId: segment.id }}
        search={{ mode: "exam" }}
      >
        {compact ? "Test" : `Test the whole strand (${segment.length})`}
      </Link>
      <Link
        to="/study/test/$segmentId"
        params={{ segmentId: segment.id }}
        search={{ mode: "practice" }}
      >
        Practice
      </Link>
      {segment.kind === "chapter" && (
        <Link
          to="/study/test/$segmentId"
          params={{ segmentId: segment.id }}
          search={{ mode: "pretest" }}
        >
          Pretest
        </Link>
      )}
    </span>
  );
}

function StudySettings({ state }: { state: StudyState }) {
  const [message, setMessage] = useState<string>();
  const fileInput = useRef<HTMLInputElement>(null);
  const setSetting = <K extends keyof StudyState["settings"]>(
    key: K,
    value: StudyState["settings"][K],
  ) => updateStudy((current) => ({ ...current, settings: { ...current.settings, [key]: value } }));
  const exportData = () => {
    const blob = new Blob([JSON.stringify(loadStudy(), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `rust-tutor-study-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setMessage("Study data exported.");
  };
  const importData = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const parsed = parseStudyState(JSON.parse(await file.text()));
      if (!parsed) {
        setMessage("That file is not a Rust Tutor study export; nothing was changed.");
        return;
      }
      saveStudy(parsed);
      setMessage("Study data imported.");
    } catch {
      setMessage("That file could not be read as JSON; nothing was changed.");
    }
  };
  return (
    <section className="study-section" aria-labelledby="study-settings-title">
      <h2 id="study-settings-title">Flashcard settings and data</h2>
      <div className="study-settings">
        <label>
          New cards per day
          <input
            type="number"
            min={0}
            max={50}
            value={state.settings.newPerDay}
            onChange={(event) =>
              setSetting("newPerDay", Math.max(0, Math.min(50, Number(event.target.value) || 0)))
            }
          />
        </label>
        <label>
          Cards per session
          <input
            type="number"
            min={5}
            max={200}
            value={state.settings.sessionLimit}
            onChange={(event) =>
              setSetting(
                "sessionLimit",
                Math.max(5, Math.min(200, Number(event.target.value) || 5)),
              )
            }
          />
        </label>
        <label>
          Introduce cards from
          <select
            value={state.settings.scope}
            onChange={(event) =>
              setSetting("scope", event.target.value === "all" ? "all" : "started")
            }
          >
            <option value="started">chapters I have reached</option>
            <option value="all">every chapter</option>
          </select>
        </label>
        <label className="study-settings__check">
          <input
            type="checkbox"
            checked={state.settings.typeToRecall}
            onChange={(event) => setSetting("typeToRecall", event.target.checked)}
          />
          Type my answer before revealing (recommended)
        </label>
      </div>
      <div className="study-data-actions">
        <button type="button" className="button secondary" onClick={exportData}>
          Export study data
        </button>
        <button
          type="button"
          className="button secondary"
          onClick={() => fileInput.current?.click()}
        >
          Import study data
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json"
          className="visually-hidden"
          tabIndex={-1}
          onChange={(event) => void importData(event)}
        />
        <button
          type="button"
          className="button secondary"
          onClick={() => {
            if (window.confirm("Erase all flashcard schedules and test history on this device?")) {
              saveStudy(emptyStudyState());
              setMessage("Study data reset.");
            }
          }}
        >
          Reset study data
        </button>
      </div>
      <p className="study-hint">
        Study data lives in this browser, separate from the service's learner database. Export it to
        back it up or move it to another machine.
      </p>
      {message && <p role="status">{message}</p>}
    </section>
  );
}

function ResearchNotes() {
  return (
    <details className="study-section study-research">
      <summary>Why the study system works this way</summary>
      <ul>
        <li>
          <strong>Retrieval practice.</strong> Recalling an answer strengthens memory more than
          re-reading it (Roediger &amp; Karpicke, 2006; meta-analysis: Rowland, 2014). Every card
          and question asks you to produce, not recognise.
        </li>
        <li>
          <strong>Production over recognition.</strong> Typed recall and output prediction beat
          multiple choice for later retention (Kang, McDermott &amp; Roediger, 2007), so many items
          ask you to type the exact output or name.
        </li>
        <li>
          <strong>Spacing.</strong> Reviews are spread on expanding intervals (1 · 3 · 7 · 21 · 45 ·
          90 days); the best gap grows with how long you want to remember (Cepeda et al., 2006,
          2008).
        </li>
        <li>
          <strong>Successive relearning.</strong> New cards must be recalled twice before they
          graduate, and missed cards return in the same session until you get them (Rawson &amp;
          Dunlosky, 2011).
        </li>
        <li>
          <strong>Interleaving.</strong> Strand and mixed tests, and each day's cards, mix chapters
          so you practise choosing the right idea, not just applying the one you just read (Rohrer
          &amp; Taylor, 2007; Brunmair &amp; Richter, 2019).
        </li>
        <li>
          <strong>Confidence and hypercorrection.</strong> You rate confidence before seeing
          feedback. Errors made with high confidence are the easiest to correct once seen
          (Butterfield &amp; Metcalfe, 2001), so results list them first, and calibration shows
          whether "sure" really means right.
        </li>
        <li>
          <strong>Elaborative feedback.</strong> Every answer explains why, and distractors carry
          misconception-specific feedback, which improves retention over right/wrong alone (Butler,
          Godbole &amp; Marsh, 2013).
        </li>
        <li>
          <strong>Pretesting.</strong> Attempting questions before studying improves learning of the
          tested material, even when the guesses are wrong (Richland, Kornell &amp; Kao, 2009).
        </li>
        <li>
          <strong>Varied forms.</strong> Forms are stratified and freshly generated, so you learn
          the concept rather than memorising a particular question (desirable difficulties: Bjork,
          1994). Distractors are plausible, misconception-based alternatives (Little et al., 2012),
          with three to four options (Rodriguez, 2005).
        </li>
      </ul>
      <p>
        Practice testing and distributed practice are the two techniques rated highest-utility in
        Dunlosky et al.'s 2013 review of learning techniques. The question bank's design also draws
        on the Brown University Rust Book experiment's analysis of where Rust learners struggle
        (Crichton &amp; Krishnamurthi, 2024).
      </p>
    </details>
  );
}

/* ----------------------------------------------------------------- tests */

export function SegmentTestPage({
  segmentId,
  mode,
  seed: requestedSeed,
}: {
  segmentId: string;
  mode: TestMode;
  seed?: number;
}): ReactElement {
  const segment = segmentById(segmentId);
  const [seed, setSeed] = useState(() => requestedSeed ?? freshSeed());
  if (!segment) {
    return (
      <section className="state-view">
        <p className="eyebrow">Study · unknown segment</p>
        <h1>No test with that name</h1>
        <p>
          Choose a chapter, strand, or mixed review from <Link to="/study">Study</Link>.
        </p>
      </section>
    );
  }
  const effectiveMode: TestMode =
    segment.kind !== "chapter" && mode === "pretest" ? "practice" : mode;
  return (
    <TestRunner
      key={`${segment.id}:${effectiveMode}:${seed}`}
      segment={segment}
      mode={effectiveMode}
      seed={seed}
      onRestart={() => setSeed(freshSeed())}
    />
  );
}

function weaknessWeights(state: StudyState): Record<string, number> {
  const weights: Record<string, number> = {};
  for (const chapter of chapters) {
    const best = segmentStats(state, chapter.id).best;
    weights[chapter.id] = best === null ? 0.5 : (100 - best) / 100;
  }
  return weights;
}

function TestRunner({
  segment,
  mode,
  seed,
  onRestart,
}: {
  segment: Segment;
  mode: TestMode;
  seed: number;
  onRestart: () => void;
}) {
  const [form] = useState<TestForm>(() => {
    const state = loadStudy();
    const previous = [...state.attempts]
      .reverse()
      .find((attempt) => attempt.segmentId === segment.id);
    return assembleTest({
      segment,
      seed,
      mode,
      history: state.itemHistory,
      previousSourceIds: previous?.sourceIds,
      weakness: weaknessWeights(state),
    });
  });
  const [index, setIndex] = useState(0);
  const [responses, setResponses] = useState<Record<string, ItemResponse>>({});
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [summary, setSummary] = useState<TestSummary>();
  const heading = useRef<HTMLHeadingElement>(null);
  const item = form.items[index];
  const needsConfidence = mode !== "pretest";
  const immediate = mode !== "exam";

  useEffect(() => {
    if (summary) heading.current?.focus();
  }, [summary]);

  const update = (key: string, change: Partial<ItemResponse>) =>
    setResponses((current) => ({ ...current, [key]: { ...current[key], ...change } }));

  const finish = () => {
    const result = summarize(form, responses);
    const now = Date.now();
    const missed = new Set(result.missed);
    updateStudy((state) =>
      recordAttempt(state, {
        segmentId: segment.id,
        mode,
        seed,
        summary: result,
        items: form.items.map((entry) => ({
          key: entry.key,
          sourceId: entry.sourceId,
          correct: !missed.has(entry.key),
          confidence: responses[entry.key]?.confidence,
        })),
        derived: form.items
          .filter((entry) => missed.has(entry.key))
          .map((entry) => cardFromMissedItem(entry, now)),
        now,
      }),
    );
    setSummary(result);
  };

  if (summary) {
    return (
      <TestResults
        segment={segment}
        mode={mode}
        form={form}
        responses={responses}
        summary={summary}
        headingRef={heading}
        onRestart={onRestart}
      />
    );
  }
  if (!item) {
    return (
      <section className="state-view">
        <h1>This segment has no questions yet</h1>
        <Link to="/study">Back to Study</Link>
      </section>
    );
  }
  const response = responses[item.key];
  const isChecked = checked[item.key] === true;
  const ready =
    answered(item.question, response) && (!needsConfidence || response?.confidence !== undefined);
  const last = index === form.items.length - 1;

  return (
    <>
      <PageHero
        tone="quiet"
        eyebrow={`${mode === "exam" ? "Test" : mode === "practice" ? "Practice" : "Pretest"} · ${segment.title}`}
        title={`Question ${index + 1} of ${form.items.length}`}
        lede={
          mode === "pretest"
            ? "Guess before you read — wrong answers now are part of how this works."
            : mode === "exam"
              ? "Feedback comes at the end. Rate your confidence honestly; it is scored separately."
              : "Each answer is explained as soon as you check it."
        }
      />
      <ContextStrip meta={`form ${seed.toString(36)} · every retake draws a new form`}>
        <span>
          {topicLabel(item.topic)}
          {segment.kind !== "chapter" ? ` · ${chapterTitle(item.chapterId)}` : ""}
          {item.generated ? " · generated variant" : ""}
        </span>
      </ContextStrip>
      <div className="study-test">
        <progress
          className="study-progress"
          max={form.items.length}
          value={index}
          aria-label="Test progress"
        />
        <section className="study-question" aria-labelledby="study-question-prompt">
          <QuestionBody
            question={item.question}
            response={response}
            locked={isChecked}
            onChange={(change) => update(item.key, change)}
          />
          {needsConfidence && (
            <fieldset className="study-confidence" disabled={isChecked}>
              <legend>How sure are you?</legend>
              {([1, 2, 3] as Confidence[]).map((level) => (
                <button
                  key={level}
                  type="button"
                  aria-pressed={response?.confidence === level}
                  data-active={response?.confidence === level || undefined}
                  onClick={() => update(item.key, { confidence: level })}
                >
                  {confidenceLabels[level]}
                </button>
              ))}
            </fieldset>
          )}
          {immediate && isChecked && <Feedback question={item.question} response={response} />}
          <div className="study-nav">
            {mode === "exam" && index > 0 && (
              <button
                type="button"
                className="button secondary"
                onClick={() => setIndex(index - 1)}
              >
                ← Previous
              </button>
            )}
            {immediate && !isChecked ? (
              <button
                type="button"
                className="button"
                disabled={!ready}
                onClick={() => setChecked((current) => ({ ...current, [item.key]: true }))}
              >
                Check answer
              </button>
            ) : last ? (
              <button
                type="button"
                className="button"
                disabled={mode === "exam" && !ready}
                onClick={finish}
              >
                {mode === "exam" ? "Submit test" : "See results"}
              </button>
            ) : (
              <button
                type="button"
                className="button"
                disabled={mode === "exam" && !ready}
                onClick={() => setIndex(index + 1)}
              >
                Next →
              </button>
            )}
            {!immediate && !ready && (
              <small>Answer{needsConfidence ? " and rate your confidence" : ""} to continue.</small>
            )}
          </div>
        </section>
      </div>
    </>
  );
}

function QuestionBody({
  question,
  response,
  locked,
  onChange,
}: {
  question: Question;
  response: ItemResponse | undefined;
  locked: boolean;
  onChange: (change: Partial<ItemResponse>) => void;
}) {
  return (
    <>
      <h2 id="study-question-prompt" className="study-question__prompt">
        <RichText text={question.prompt} />
      </h2>
      {question.code && <CodeBlock code={question.code} />}
      {(question.kind === "choice" || question.kind === "compiles") && (
        <fieldset className="study-options" disabled={locked}>
          <legend className="visually-hidden">Choose one answer</legend>
          {(question.kind === "choice"
            ? question.options
            : ["Yes, it compiles", "No, it does not compile"]
          ).map((option, optionIndex) => (
            <button
              key={option}
              type="button"
              aria-pressed={response?.choice === optionIndex}
              data-active={response?.choice === optionIndex || undefined}
              data-state={
                !locked
                  ? undefined
                  : optionIndex ===
                      (question.kind === "choice" ? question.answer : question.compiles ? 0 : 1)
                    ? "correct"
                    : response?.choice === optionIndex
                      ? "incorrect"
                      : undefined
              }
              onClick={() => onChange({ choice: optionIndex })}
            >
              <span className="study-options__letter" aria-hidden="true">
                {String.fromCharCode(65 + optionIndex)}
              </span>
              <RichText text={option} />
            </button>
          ))}
        </fieldset>
      )}
      {question.kind === "multi" && (
        <fieldset className="study-options" disabled={locked}>
          <legend>Select every correct answer</legend>
          {question.options.map((option, optionIndex) => {
            const selected = response?.choices?.includes(optionIndex) ?? false;
            return (
              <label
                key={option}
                className="study-options__check"
                data-active={selected || undefined}
              >
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() => {
                    const current = new Set(response?.choices ?? []);
                    if (selected) current.delete(optionIndex);
                    else current.add(optionIndex);
                    onChange({ choices: [...current] });
                  }}
                />
                <RichText text={option} />
              </label>
            );
          })}
        </fieldset>
      )}
      {question.kind === "output" && (
        <label className="study-answer">
          Type the exact output (one line per printed line)
          <textarea
            rows={Math.max(2, question.answer.split("\n").length + 1)}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            value={response?.text ?? ""}
            readOnly={locked}
            onChange={(event) => onChange({ text: event.target.value })}
          />
        </label>
      )}
      {question.kind === "recall" && (
        <label className="study-answer">
          Your answer
          <input
            type="text"
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            value={response?.text ?? ""}
            readOnly={locked}
            onChange={(event) => onChange({ text: event.target.value })}
          />
        </label>
      )}
    </>
  );
}

function Feedback({
  question,
  response,
}: {
  question: Question;
  response: ItemResponse | undefined;
}) {
  const ok = isCorrect(question, response ?? {});
  const optionFeedback =
    question.kind === "choice" &&
    response?.choice !== undefined &&
    response.choice !== question.answer
      ? question.feedback?.[response.choice]
      : null;
  return (
    <div className="study-feedback" data-tone={ok ? "correct" : "incorrect"} role="status">
      <p className="study-feedback__verdict">{ok ? "Correct." : "Not quite."}</p>
      {!ok && (
        <div className="study-feedback__key">
          <span>Answer:</span>{" "}
          {question.kind === "output" ? (
            <CodeBlock code={correctAnswerText(question)} />
          ) : (
            <RichText text={correctAnswerText(question)} />
          )}
        </div>
      )}
      {optionFeedback && (
        <p>
          <RichText text={optionFeedback} />
        </p>
      )}
      <p>
        <RichText text={question.explain} />
      </p>
    </div>
  );
}

function describeResponse(question: Question, response: ItemResponse | undefined): string {
  if (!response || !answered(question, response)) return "no answer";
  switch (question.kind) {
    case "choice":
      return question.options[response.choice ?? -1] ?? "no answer";
    case "compiles":
      return response.choice === 0 ? "It compiles." : "It does not compile.";
    case "multi":
      return (response.choices ?? []).map((index) => question.options[index]).join(" · ");
    case "output":
    case "recall":
      return response.text ?? "";
  }
}

function TestResults({
  segment,
  mode,
  form,
  responses,
  summary,
  headingRef,
  onRestart,
}: {
  segment: Segment;
  mode: TestMode;
  form: TestForm;
  responses: Record<string, ItemResponse>;
  summary: TestSummary;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onRestart: () => void;
}) {
  const confident = new Set(summary.confidentMisses);
  const byKey = new Map(form.items.map((item) => [item.key, item]));
  const ordered = [
    ...summary.confidentMisses,
    ...summary.missed.filter((key) => !confident.has(key)),
    ...form.items.map((item) => item.key).filter((key) => !summary.missed.includes(key)),
  ];
  const calibrated = summary.calibration.filter((band) => band.total > 0);
  return (
    <>
      <header className="page-hero page-hero--quiet">
        <div className="page-hero__content">
          <p className="eyebrow">
            {mode === "pretest" ? "Pretest" : mode === "practice" ? "Practice" : "Test"} results ·{" "}
            {segment.title}
          </p>
          <h1 ref={headingRef} tabIndex={-1}>
            {summary.correct} of {summary.total} · {summary.percent}%
            {mode === "pretest" ? "" : summary.passed ? " — passed" : " — not yet"}
          </h1>
          <p className="lede">
            {mode === "pretest"
              ? "A pretest is not scored against you. Read the chapter now — the questions you just met will be easier to notice and remember."
              : summary.passed
                ? `At or above the ${PASS_PERCENT}% mark. Take it again in a few days: passing after a delay is the evidence that matters.`
                : `The pass mark is ${PASS_PERCENT}%. Missed items are now flashcards; review them, then draw a fresh form.`}
          </p>
        </div>
      </header>
      <div className="study-results">
        <section className="study-results__panel" aria-labelledby="results-topics">
          <h2 id="results-topics">
            By {segment.kind === "chapter" ? "topic" : "topic, weakest first"}
          </h2>
          <ul className="study-bars">
            {summary.byTopic.map((topic) => (
              <li key={topic.topic}>
                <span>{topicLabel(topic.topic)}</span>
                <meter
                  min={0}
                  max={topic.total}
                  value={topic.correct}
                  aria-label={`${topic.correct} of ${topic.total}`}
                />
                <small>
                  {topic.correct}/{topic.total}
                </small>
              </li>
            ))}
          </ul>
        </section>
        {calibrated.length > 0 && (
          <section className="study-results__panel" aria-labelledby="results-calibration">
            <h2 id="results-calibration">Confidence calibration</h2>
            <table className="study-calibration">
              <thead>
                <tr>
                  <th scope="col">You said</th>
                  <th scope="col">Answers</th>
                  <th scope="col">Correct</th>
                </tr>
              </thead>
              <tbody>
                {calibrated.map((band) => (
                  <tr key={band.confidence}>
                    <th scope="row">{confidenceLabels[band.confidence]}</th>
                    <td>{band.total}</td>
                    <td>{Math.round((band.correct / band.total) * 100)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="study-hint">
              Well calibrated means "Sure" answers are nearly always right and "Guessing" ones often
              wrong.{" "}
              {summary.confidentMisses.length > 0
                ? `${summary.confidentMisses.length} confident ${summary.confidentMisses.length === 1 ? "miss is" : "misses are"} listed first below — those are the corrections most worth your attention.`
                : "No confident misses this time."}
            </p>
          </section>
        )}
      </div>
      <div className="study-results__actions">
        <button type="button" className="button" onClick={onRestart}>
          Draw a new form
        </button>
        {summary.missed.length > 0 && mode !== "pretest" && (
          <Link
            className="button secondary"
            to="/study/cards"
            search={segment.kind === "chapter" ? { chapter: segment.id } : {}}
          >
            Review the {summary.missed.length} missed as flashcards
          </Link>
        )}
        {segment.kind === "chapter" && (
          <Link
            className="button secondary"
            to="/learn/$chapterId"
            params={{ chapterId: segment.id }}
          >
            {mode === "pretest" ? "Read the chapter →" : "Back to the chapter"}
          </Link>
        )}
        <Link to="/study">All tests</Link>
      </div>
      <section className="study-review" aria-labelledby="results-review">
        <h2 id="results-review">Every question, explained</h2>
        <ol>
          {ordered.map((key) => {
            const item = byKey.get(key) as PreparedItem;
            const ok = !summary.missed.includes(key);
            const response = responses[key];
            return (
              <li key={key} className="study-review__item" data-tone={ok ? "correct" : "incorrect"}>
                <p className="study-review__meta">
                  {ok ? "Correct" : confident.has(key) ? "Confident miss" : "Missed"} ·{" "}
                  {topicLabel(item.topic)}
                  {segment.kind !== "chapter" ? ` · ${chapterTitle(item.chapterId)}` : ""}
                  {response?.confidence
                    ? ` · you said ${confidenceLabels[response.confidence].toLowerCase()}`
                    : ""}
                </p>
                <h3>
                  <RichText text={item.question.prompt} />
                </h3>
                {item.question.code && <CodeBlock code={item.question.code} />}
                <dl>
                  <dt>Your answer</dt>
                  <dd>
                    {item.question.kind === "output" ? (
                      <CodeBlock code={describeResponse(item.question, response)} />
                    ) : (
                      <RichText text={describeResponse(item.question, response)} />
                    )}
                  </dd>
                  {!ok && (
                    <>
                      <dt>Correct answer</dt>
                      <dd>
                        {item.question.kind === "output" ? (
                          <CodeBlock code={correctAnswerText(item.question)} />
                        ) : (
                          <RichText text={correctAnswerText(item.question)} />
                        )}
                      </dd>
                    </>
                  )}
                  <dt>Why</dt>
                  <dd>
                    <RichText text={item.question.explain} />
                  </dd>
                </dl>
              </li>
            );
          })}
        </ol>
      </section>
    </>
  );
}

/* ------------------------------------------------------------ flashcards */

export function FlashcardsPage({ chapter }: { chapter?: string }): ReactElement {
  const [plan] = useState(() =>
    planSession({
      state: loadStudy(),
      today: dayNumber(),
      startedChapterIds: startedChapterIds(),
      chapterFilter: chapter && bankByChapter.has(chapter) ? chapter : undefined,
      seed: freshSeed(),
    }),
  );
  const [queue, setQueue] = useState<DeckCard[]>(plan.queue);
  const [revealed, setRevealed] = useState(false);
  const [typed, setTyped] = useState("");
  const [tally, setTally] = useState({ reviewed: 0, again: 0 });
  const state = useStudyState();
  const today = dayNumber();
  const card = queue[0];
  const cardState = card ? state.cards[card.id] : undefined;
  const intervals = previewIntervals(cardState, today);
  const typeFirst = state.settings.typeToRecall;
  const typedMatches =
    typed.trim().length > 0 &&
    card !== undefined &&
    normalizeRecall(typed) === normalizeRecall(card.back);

  const grade = (value: Grade) => {
    if (!card) return;
    const wasNew = state.cards[card.id] === undefined;
    const result = schedule(state.cards[card.id], value, today);
    updateStudy((current) =>
      applyReview(current, { cardId: card.id, next: result.next, grade: value, today, wasNew }),
    );
    setTally((current) => ({
      reviewed: current.reviewed + 1,
      again: current.again + (value === "again" ? 1 : 0),
    }));
    setQueue((current) => {
      const [head, ...rest] = current;
      if (!head) return rest;
      if (!result.requeue) return rest;
      // Bring the card back after a few others, so the retry is a real retrieval.
      const gap = Math.min(rest.length, 3);
      return [...rest.slice(0, gap), head, ...rest.slice(gap)];
    });
    setRevealed(false);
    setTyped("");
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (!revealed && (event.key === " " || event.key === "Enter")) {
        event.preventDefault();
        setRevealed(true);
      } else if (revealed) {
        const map: Record<string, Grade> = { "1": "again", "2": "hard", "3": "good", "4": "easy" };
        const chosen = map[event.key];
        if (chosen) {
          event.preventDefault();
          grade(chosen);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const scopeLabel = chapter ? chapterTitle(chapter) : "chapters you have reached";
  return (
    <>
      <PageHero
        tone="quiet"
        eyebrow={`Flashcards · ${scopeLabel}`}
        title={
          card
            ? `${queue.length} ${queue.length === 1 ? "card" : "cards"} left in this session`
            : "Session complete."
        }
        lede={
          card
            ? "Recall first — type or say the answer — then reveal and grade yourself honestly. Missed cards come back before the session ends."
            : tally.reviewed > 0
              ? `You made ${tally.reviewed} retrievals (${tally.again} needed another go). Each grade set the card's next interval.`
              : plan.newAvailable === 0 && plan.dueCount === 0
                ? "Nothing is due. Clear a chapter stop or take a test to unlock more cards, or allow every chapter in Study settings."
                : "Nothing is due right now. Come back tomorrow — spacing is the point."
        }
      />
      <ContextStrip meta="space reveals · 1 again · 2 hard · 3 good · 4 easy">
        <span>
          {plan.dueCount} due · {plan.newCount} new in this session · {tally.reviewed} graded
        </span>
      </ContextStrip>
      {card ? (
        <section className="study-card" aria-labelledby="study-card-front">
          <p className="eyebrow">
            {chapterTitle(card.chapterId)}
            {card.origin === "missed" ? " · from a missed test question" : ""}
            {cardState === undefined ? " · new" : ""}
          </p>
          <h2 id="study-card-front">
            <RichText text={card.front} />
          </h2>
          {card.code && <CodeBlock code={card.code} />}
          {typeFirst && !revealed && (
            <label className="study-answer">
              Your answer (optional, but recalling in writing helps)
              <textarea
                rows={2}
                spellCheck={false}
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
              />
            </label>
          )}
          {!revealed ? (
            <button type="button" className="button" onClick={() => setRevealed(true)}>
              Reveal answer
            </button>
          ) : (
            <>
              <div className="study-card__back" role="status">
                {typed.trim() && (
                  <p className="study-card__typed">
                    You wrote: <code>{typed.trim()}</code>
                    {typedMatches ? " — exact match." : ""}
                  </p>
                )}
                <p className="study-card__answer">
                  <RichText text={card.back} />
                </p>
                {card.why && (
                  <p className="study-card__why">
                    <RichText text={card.why} />
                  </p>
                )}
              </div>
              <fieldset className="study-grades">
                <legend>How well did you recall it?</legend>
                {(
                  [
                    ["again", "Again", "forgot or wrong"],
                    ["hard", "Hard", "recalled with effort"],
                    ["good", "Good", "recalled"],
                    ["easy", "Easy", "instant"],
                  ] as const
                ).map(([value, label, hint], position) => (
                  <button
                    key={value}
                    type="button"
                    data-grade={value}
                    onClick={() => grade(value)}
                    aria-label={`${label}: ${hint}; next ${intervals[value]} (key ${position + 1})`}
                  >
                    <strong>{label}</strong>
                    <small>{intervals[value]}</small>
                  </button>
                ))}
              </fieldset>
            </>
          )}
        </section>
      ) : (
        <section className="study-card study-card--done">
          <div className="study-results__actions">
            <Link className="button" to="/study">
              Back to Study
            </Link>
            {chapter && (
              <Link
                className="button secondary"
                to="/study/test/$segmentId"
                params={{ segmentId: chapter }}
                search={{ mode: "exam" }}
              >
                Test this chapter
              </Link>
            )}
          </div>
        </section>
      )}
    </>
  );
}
