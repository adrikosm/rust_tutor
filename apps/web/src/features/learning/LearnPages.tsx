import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { getDashboardSnapshot, getErrors, getJournal } from "../../lib/service-client";

import { useCourseProgressSync } from "./ChapterPage";
import { DataSurfaceState } from "./LearningShared";
import { chapterIsComplete, chapters } from "./course";

export function DashboardPage() {
  useCourseProgressSync();
  const chaptersComplete = chapters.filter(chapterIsComplete).length;
  const currentIndex = chapters.findIndex((chapter) => !chapterIsComplete(chapter));
  const currentChapter =
    currentIndex === -1 ? chapters[chapters.length - 1] : chapters[currentIndex];
  const nextChapter = currentIndex === -1 ? undefined : chapters[currentIndex + 1];
  const snapshot = useQuery({ queryKey: ["dashboard-snapshot"], queryFn: getDashboardSnapshot });
  const journal = useQuery({ queryKey: ["journal"], queryFn: () => getJournal() });
  const errorCatalog = useQuery({ queryKey: ["errors"], queryFn: getErrors });
  const dashboardState = snapshot.isPending
    ? "loading"
    : snapshot.isError
      ? "error"
      : journal.isError || errorCatalog.isError
        ? "partial"
        : snapshot.data.counts.evidenceEvents === 0 && snapshot.data.counts.attempts === 0
          ? "empty"
          : "ready";
  const hasEvidence =
    (snapshot.data?.counts.evidenceEvents ?? 0) > 0 || (snapshot.data?.counts.attempts ?? 0) > 0;
  const dueReviews = snapshot.data?.counts.dueReviews ?? 0;
  const hasDueReview = dueReviews > 0;
  const latestNote = journal.data
    ? [...journal.data.entries].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
    : undefined;
  const topError = errorCatalog.data
    ? [...errorCatalog.data.errors].sort((a, b) => b.occurrenceCount - a.occurrenceCount)[0]
    : undefined;
  const nextTitle = !hasEvidence
    ? "Start Rust from zero."
    : hasDueReview
      ? "Clear the review queue first."
      : `Continue chapter ${currentChapter?.number ?? 1}: ${currentChapter?.title ?? "Hello, Rust"}.`;
  const nextDescription = !hasEvidence
    ? "Chapter one assumes nothing. Read the model, clear two quick stops, and run real code — or take the short diagnostic to skip what you already know."
    : hasDueReview
      ? `${dueReviews} due retrievals are ready before you add new material.`
      : "Read the next model, trace the value, then carry it into the local compiler.";
  return (
    <div className="dashboard-page">
      <header className="dashboard-hero">
        <div className="dashboard-hero__content">
          <p className="eyebrow">
            Your learning path · {snapshot.data?.counts.studyDayCount ?? 0} study days
          </p>
          <h1>{nextTitle}</h1>
          <p className="lede">{nextDescription}</p>
          <div className="dashboard-hero__actions">
            {!hasEvidence ? (
              <Link
                className="button"
                to="/learn/$chapterId"
                params={{ chapterId: currentChapter?.id ?? "hello-rust" }}
              >
                Start chapter 1
              </Link>
            ) : hasDueReview ? (
              <Link className="button" to="/review">
                Clear {dueReviews} {dueReviews === 1 ? "review" : "reviews"}
              </Link>
            ) : (
              <Link
                className="button"
                to="/learn/$chapterId"
                params={{ chapterId: currentChapter?.id ?? "hello-rust" }}
              >
                Continue the course
              </Link>
            )}
            <Link className="button secondary" to="/curriculum">
              See the full path
            </Link>
          </div>
        </div>
        <span className="dashboard-hero__number" aria-hidden="true">
          {String(currentChapter?.number ?? 1).padStart(2, "0")}
        </span>
      </header>
      <DataSurfaceState
        surface="dashboard"
        state={dashboardState}
        detail={snapshot.isError ? snapshot.error.message : undefined}
      />
      {snapshot.data && (
        <section className="dashboard-progress-band" aria-label="Learning status">
          <span>
            chapters{" "}
            <strong>
              {chaptersComplete}/{chapters.length}
            </strong>
          </span>
          <span>
            retained{" "}
            <strong>
              {snapshot.data.retainedCoverage.numerator}/
              {snapshot.data.retainedCoverage.denominator}
            </strong>
          </span>
          <span>
            reviews due <strong>{dueReviews}</strong>
          </span>
          <span>
            project artifacts <strong>{snapshot.data.counts.projectArtifacts}</strong>
          </span>
          <small>Everything stays on this machine.</small>
        </section>
      )}
      {snapshot.data && (
        <div className="dashboard-home-grid">
          <section aria-labelledby="dashboard-path-title">
            <p className="eyebrow">Next on the path</p>
            <h2 id="dashboard-path-title">The course, one clear step at a time</h2>
            <ol className="dashboard-path-list">
              <li data-state="current">
                <span>{String(currentChapter?.number ?? 1).padStart(2, "0")}</span>
                <div>
                  <h3>{currentChapter?.title ?? "Hello, Rust"}</h3>
                  <p>{currentChapter?.summary ?? "Meet the compiler you will be working with."}</p>
                </div>
                <Link
                  to="/learn/$chapterId"
                  params={{ chapterId: currentChapter?.id ?? "hello-rust" }}
                >
                  {hasEvidence ? "Continue" : "Begin"} →
                </Link>
              </li>
              {nextChapter && (
                <li>
                  <span>{String(nextChapter.number).padStart(2, "0")}</span>
                  <div>
                    <h3>{nextChapter.title}</h3>
                    <p>{nextChapter.summary}</p>
                  </div>
                  <Link to="/learn/$chapterId" params={{ chapterId: nextChapter.id }}>
                    Up next →
                  </Link>
                </li>
              )}
              <li>
                <span>{hasDueReview ? "↻" : ".rs"}</span>
                <div>
                  <h3>
                    {hasDueReview
                      ? `${dueReviews} due ${dueReviews === 1 ? "retrieval" : "retrievals"}`
                      : "Practice workbench"}
                  </h3>
                  <p>
                    {hasDueReview
                      ? "Recall before you reveal — the grade sets the next interval."
                      : "Apply the current chapter in the local compiler."}
                  </p>
                </div>
                {hasDueReview ? (
                  <Link to="/review">Review →</Link>
                ) : (
                  <Link to="/practice">Open practice →</Link>
                )}
              </li>
            </ol>
          </section>
          <aside className="dashboard-side-note">
            <p className="eyebrow">From your notebook</p>
            {latestNote ? (
              <>
                <p className="dashboard-note-body">{latestNote.body}</p>
                <p className="dashboard-note-meta">
                  {latestNote.title} · <Link to="/journal">all notes →</Link>
                </p>
              </>
            ) : (
              <>
                <p>A note written while a chapter is fresh is worth three written later.</p>
                <Link to="/journal">Write the first note →</Link>
              </>
            )}
            <hr />
            <p className="eyebrow">Error watch</p>
            {topError ? (
              <>
                <p className="dashboard-note-body">
                  <code>{topError.code}</code> · {topError.occurrenceCount}{" "}
                  {topError.occurrenceCount === 1 ? "occurrence" : "occurrences"} — cue:{" "}
                  <em>{topError.futureCue}</em>
                </p>
                <Link to="/errors">Error catalog →</Link>
              </>
            ) : (
              <>
                <p>No recurring compiler error pattern yet. Misses will be filed here.</p>
                <Link to="/errors">Error catalog →</Link>
              </>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
