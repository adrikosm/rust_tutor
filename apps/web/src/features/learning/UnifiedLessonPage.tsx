import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  commitLessonCheck,
  getCurriculumLesson,
  getLessonCheckProgress,
  type LessonCheckResult,
} from "../../lib/service-client";
import { ChapterPage, ChapterTerminal } from "./ChapterPage";
import { chapters } from "./course";
import { PageHero } from "./LearningShared";
import { SourceDocumentBlocks, type SourceNode } from "./source-document";

function objectiveText(objective: string | { id: string; text: string }) {
  return typeof objective === "string" ? objective : objective.text;
}

/// The service owns the answer key: the page never receives which option is
/// correct, and the explanation arrives only in the commit response.
function RecallCheck({
  lessonId,
  check,
  committed,
}: {
  lessonId: string;
  check: { id: string; prompt: string; options: string[] };
  committed?: LessonCheckResult | CommittedCheck;
}) {
  const queryClient = useQueryClient();
  const [choice, setChoice] = useState(-1);
  const commit = useMutation({
    mutationFn: (chosenIndex: number) => commitLessonCheck(lessonId, check.id, chosenIndex),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lesson-checks", lessonId] });
    },
  });
  const settled = commit.data ?? committed;
  return (
    <article className="lesson-check">
      <h3>{check.prompt}</h3>
      <fieldset disabled={Boolean(settled) || commit.isPending}>
        <legend>Choose before revealing the explanation</legend>
        {check.options.map((option, index) => (
          <label key={option}>
            <input
              type="radio"
              name={check.id}
              value={index}
              checked={(settled ? settled.chosenIndex : choice) === index}
              onChange={() => setChoice(index)}
            />
            <span>{option}</span>
          </label>
        ))}
      </fieldset>
      {settled ? (
        <div role="status" className="lesson-check__result">
          <p data-correct={settled.correct}>
            <strong>{settled.correct ? "Correct." : "Not quite."}</strong> Your answer is committed
            and cannot be changed.
          </p>
          <p>{settled.explanation}</p>
        </div>
      ) : (
        <>
          <button
            type="button"
            disabled={choice < 0 || commit.isPending}
            onClick={() => commit.mutate(choice)}
          >
            {commit.isPending ? "Committing…" : "Commit answer"}
          </button>
          {commit.isError && (
            <p role="alert" className="lesson-check__error">
              {commit.error.message}
            </p>
          )}
        </>
      )}
    </article>
  );
}

type CommittedCheck = {
  checkId: string;
  chosenIndex: number;
  correct: boolean;
  explanation: string;
};

export function UnifiedLessonPage({ lessonId }: { lessonId: string }) {
  const legacyChapter = chapters.find((chapter) => chapter.id === lessonId);
  const lesson = useQuery({
    queryKey: ["curriculum-lesson-v2", lessonId],
    queryFn: () => getCurriculumLesson(lessonId),
    retry: false,
  });
  // Restores committed answers after a reload; a failure here only means the
  // checks render fresh, so it must never block the reading surface.
  const checks = useQuery({
    queryKey: ["lesson-checks", lessonId],
    queryFn: () => getLessonCheckProgress(lessonId),
    retry: false,
  });
  const committedByCheck = new Map<string, CommittedCheck>(
    (checks.data?.commitments ?? []).map((entry) => [entry.checkId, entry]),
  );

  if (lesson.isPending) {
    return (
      <p className="route-loading" role="status">
        Loading the reviewed lesson…
      </p>
    );
  }
  if (lesson.isError) {
    if (legacyChapter) return <ChapterPage chapterId={lessonId} />;
    return (
      <section className="state-view">
        <p className="eyebrow">Lesson unavailable</p>
        <h1>This lesson is not in the active curriculum release.</h1>
        <p>{lesson.error.message}</p>
        <Link className="button" to="/curriculum">
          Return to the curriculum
        </Link>
      </section>
    );
  }

  const item = lesson.data.lesson;
  const document = item.sourceDocument;
  const terminalFile = item.terminalWork?.files.find(
    (file) => file.editable !== false && file.path.endsWith(".rs"),
  );
  const terminalChapter =
    legacyChapter ??
    (terminalFile
      ? {
          id: item.id,
          title: item.title,
          terminal: {
            file: terminalFile.path,
            code: terminalFile.content,
            task: item.terminalWork?.instructions ?? "Edit the source, then run it.",
            hints: item.misconceptions.slice(0, 3).map((entry) => entry.repair),
            checkOnly: true,
          },
        }
      : undefined);
  return (
    <article className="lesson-v2">
      <PageHero
        eyebrow={`Learn · ${item.moduleId} · ${item.estimateMinutes} min`}
        title={item.title}
        lede={item.summary}
      />

      <nav className="lesson-v2__seam" aria-label="Lesson sections">
        <a href="#objectives">Objectives</a>
        <a href="#model">Mental model</a>
        {document && <a href="#source">Read the page</a>}
        <a href="#examples">Examples</a>
        <a href="#checks">Check yourself</a>
        <a href="#practice">Practice</a>
        <a href="#sources">Sources</a>
      </nav>

      {(item.previousPageId || item.nextPageId) && (
        <nav className="lesson-v2__pager" aria-label="Book page navigation">
          {item.previousPageId ? (
            <Link
              rel="prev"
              to="/lessons/$lessonId"
              params={{ lessonId: item.previousPageId }}
              key={item.previousPageId}
            >
              ← Previous page
            </Link>
          ) : (
            <span />
          )}
          {item.nextPageId && (
            <Link
              rel="next"
              to="/lessons/$lessonId"
              params={{ lessonId: item.nextPageId }}
              key={item.nextPageId}
            >
              Next page →
            </Link>
          )}
        </nav>
      )}

      <dl className="lesson-v2__contract" aria-label="Lesson contract">
        <div>
          <dt>Difficulty</dt>
          <dd>{item.difficulty}</dd>
        </div>
        <div>
          <dt>Estimate</dt>
          <dd>{item.estimateMinutes} min</dd>
        </div>
        <div>
          <dt>Checks</dt>
          <dd>{item.recallChecks.length}</dd>
        </div>
        <div>
          <dt>Practice</dt>
          <dd>{item.practiceBridge.length}</dd>
        </div>
      </dl>

      <div className="lesson-v2__layout" data-workbench={terminalChapter ? "true" : undefined}>
        <main className="lesson-v2__reading">
          <section id="objectives">
            <p className="eyebrow">Observable outcomes</p>
            <h2>What you will be able to do</h2>
            <ul>
              {item.objectives.map((objective) => (
                <li key={objectiveText(objective)}>{objectiveText(objective)}</li>
              ))}
            </ul>
            {item.prerequisiteIds.length > 0 && (
              <details>
                <summary>Prerequisites · {item.prerequisiteIds.length}</summary>
                <ul>
                  {item.prerequisiteIds.map((id) => (
                    <li key={id}>
                      <Link to="/graph" search={{ id, depth: 1 }}>
                        {id}
                      </Link>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </section>

          <section id="model">
            <p className="eyebrow">The model</p>
            <h2>Build the right picture first</h2>
            <p>{item.mentalModel}</p>
            {item.keyTerms.length > 0 && (
              <dl className="lesson-v2__terms">
                {item.keyTerms.map((entry) => (
                  <div key={entry.term}>
                    <dt>{entry.term}</dt>
                    <dd>{entry.definition}</dd>
                  </div>
                ))}
              </dl>
            )}
          </section>

          {document && (
            <section id="source" className="lesson-v2__source">
              <p className="eyebrow">
                Pinned source page · {document.license} · {item.pageRole}
              </p>
              <h2>{document.title}</h2>
              <p className="lesson-v2__attribution">
                {document.attribution} ·{" "}
                <a href={document.canonicalUrl} target="_blank" rel="noreferrer">
                  {document.sourcePath}
                </a>{" "}
                at commit <code>{document.sourceCommit.slice(0, 12)}</code>
              </p>
              {document.headings.length > 1 && (
                <details className="lesson-v2__toc">
                  <summary>On this page · {document.headings.length} sections</summary>
                  <ol>
                    {document.headings.map((heading) => (
                      <li key={heading.id} data-heading-level={heading.level}>
                        <a href={`#${heading.id}`}>{heading.text}</a>
                      </li>
                    ))}
                  </ol>
                </details>
              )}
              {item.sourcePath === "src/ch00-00-introduction.md" && (
                <aside className="practice-note" aria-label="Pinned terminology note">
                  <strong>Snapshot terminology:</strong> this introduction still says “Rust Language
                  Server.” In the same pinned release, Appendix D identifies{" "}
                  <Link to="/lessons/$lessonId" params={{ lessonId: "LESSON-BOOK-APPENDIX-D" }}>
                    rust-analyzer as the IDE integration tool
                  </Link>
                  . The original sentence remains visible so the byte-verified source is not
                  silently rewritten.
                </aside>
              )}
              <div className="book-source-body">
                <SourceDocumentBlocks blocks={document.blocks as readonly SourceNode[]} />
              </div>
            </section>
          )}

          <section id="examples">
            <p className="eyebrow">Syntax and evidence</p>
            <h2>Read the code as a contract</h2>
            {item.syntaxExamples.map((example) => (
              <figure key={example.title} className="lesson-v2__example">
                <figcaption>{example.title}</figcaption>
                <pre>
                  <code>{example.code}</code>
                </pre>
                <p>{example.explanation}</p>
              </figure>
            ))}
            {item.workedTrace.length > 0 && (
              <ol className="lesson-v2__trace">
                {item.workedTrace.map((step) => (
                  <li key={`${step.step}-${step.state}`}>
                    <strong>
                      {step.step}. {step.state}
                    </strong>
                    <p>{step.explanation}</p>
                  </li>
                ))}
              </ol>
            )}
          </section>

          {item.misconceptions.length > 0 && (
            <section className="lesson-v2__misconceptions">
              <p className="eyebrow">Compiler clinic</p>
              <h2>Misconceptions to catch early</h2>
              {item.misconceptions.map((entry) => (
                <details key={entry.symptom}>
                  <summary>{entry.symptom}</summary>
                  <p>{entry.explanation}</p>
                  <p>
                    <strong>Repair:</strong> {entry.repair}
                  </p>
                </details>
              ))}
            </section>
          )}

          <section id="checks">
            <p className="eyebrow">Recall before reveal</p>
            <h2>Check the mental model</h2>
            {item.recallChecks.map((check) => (
              <RecallCheck
                key={check.id}
                lessonId={item.id}
                check={check}
                committed={committedByCheck.get(check.id)}
              />
            ))}
          </section>

          <section id="practice">
            <p className="eyebrow">Practice bridge</p>
            <h2>Turn the idea into evidence</h2>
            {item.practiceBridge.length ? (
              <ol className="lesson-v2__practice">
                {item.practiceBridge.map((practice) => (
                  <li key={practice.exerciseId}>
                    <div>
                      <strong>{practice.requirement}</strong>
                      <p>{practice.whyNow}</p>
                    </div>
                    {practice.exerciseId.startsWith("INT-") ||
                    practice.exerciseId.startsWith("EXE-ALG") ? (
                      <Link
                        className="button"
                        to="/practice/algorithms/$problemId"
                        params={{ problemId: practice.exerciseId }}
                      >
                        Open exercise
                      </Link>
                    ) : (
                      <Link
                        className="button"
                        to="/practice/rust/$exerciseId"
                        params={{ exerciseId: practice.exerciseId }}
                      >
                        Open exercise
                      </Link>
                    )}
                  </li>
                ))}
              </ol>
            ) : (
              <p>No required exercise is attached to this lesson.</p>
            )}
            {item.projectTransfer.map((transfer) => (
              <p key={transfer.stageId} className="lesson-v2__project-link">
                <strong>Project transfer:</strong> {transfer.reason}{" "}
                <Link to="/graph" search={{ id: transfer.stageId, depth: 1 }}>
                  Inspect {transfer.stageId}
                </Link>
              </p>
            ))}
          </section>

          <section>
            <p className="eyebrow">Recap</p>
            <h2>What to carry forward</h2>
            <ul>
              {item.recap.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
          </section>

          {item.furtherReading.length > 0 && (
            <section id="further-reading">
              <p className="eyebrow">Reference library · link-only</p>
              <h2>Go deeper in the open Rust literature</h2>
              <ul className="reading-list">
                {item.furtherReading.map((reading) => (
                  <li key={reading.url} className="reading-list__item">
                    <a href={reading.url} target="_blank" rel="noreferrer">
                      {reading.title}
                    </a>
                    <span className="reading-list__meta">
                      {reading.library} · {reading.level} · {reading.license}
                    </span>
                    <p>{reading.why}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section id="sources">
            <p className="eyebrow">Reviewed sources</p>
            <h2>Read the primary material</h2>
            {item.sectionSources.length || item.sources.length ? (
              <ul>
                {[...item.sectionSources, ...item.sources].map((source) => (
                  <li key={source.url}>
                    <a href={source.url} target="_blank" rel="noreferrer">
                      {source.title ?? source.url}
                    </a>
                    {source.license ? ` · ${source.license}` : ""}
                  </li>
                ))}
              </ul>
            ) : (
              <p>Source IDs: {item.sourceIds.join(", ")}</p>
            )}
          </section>
        </main>

        {terminalChapter && (
          <div className="lesson-v2__workspace">
            <ChapterTerminal key={terminalChapter.id} chapter={terminalChapter} onRan={() => {}} />
          </div>
        )}
      </div>
    </article>
  );
}
