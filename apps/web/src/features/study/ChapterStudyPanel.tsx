import { Link } from "@tanstack/react-router";
import { chapterCompanions } from "../../data/course-companions";
import { PASS_PERCENT_MARK } from "./constants";
import { segmentStats, useStudyState } from "./store";

const modeLabels = { read: "Read", drill: "Drill", check: "Check yourself" } as const;

/**
 * End-of-chapter study panel: pretest/test/flashcards for this chapter, plus
 * the chapter's companions from the open Rust literature. Deliberately avoids
 * importing the question bank so the chapter route stays light.
 */
export function ChapterStudyPanel({ chapterId }: { chapterId: string }) {
  const state = useStudyState();
  const stats = segmentStats(state, chapterId);
  const companions = chapterCompanions[chapterId] ?? [];
  return (
    <section className="chapter-study" aria-labelledby={`chapter-study-${chapterId}`}>
      <h2 id={`chapter-study-${chapterId}`}>Test yourself, then go deeper</h2>
      <p>
        {stats.best === null
          ? "A randomised test draws ten questions from this chapter's bank — a different form every time."
          : `Best score ${stats.best}% over ${stats.attempts} ${stats.attempts === 1 ? "attempt" : "attempts"}${stats.best >= PASS_PERCENT_MARK ? " — passed. Retake it after a few days to prove it stuck." : `. The pass mark is ${PASS_PERCENT_MARK}%.`}`}
      </p>
      <div className="chapter-study__actions">
        <Link
          className="button"
          to="/study/test/$segmentId"
          params={{ segmentId: chapterId }}
          search={{ mode: "exam" }}
        >
          Take the chapter test
        </Link>
        <Link
          className="button secondary"
          to="/study/test/$segmentId"
          params={{ segmentId: chapterId }}
          search={{ mode: "practice" }}
        >
          Practice with feedback
        </Link>
        <Link className="button secondary" to="/study/cards" search={{ chapter: chapterId }}>
          Flashcards
        </Link>
        <Link
          to="/study/test/$segmentId"
          params={{ segmentId: chapterId }}
          search={{ mode: "pretest" }}
        >
          Pretest (before reading)
        </Link>
      </div>
      {companions.length > 0 && (
        <>
          <h3>Go deeper in the open Rust literature</h3>
          <ul className="reading-list">
            {companions.map((companion) => (
              <li key={companion.url} className="reading-list__item">
                <a href={companion.url} target="_blank" rel="noreferrer">
                  {companion.title}
                </a>
                <span className="reading-list__meta">{modeLabels[companion.mode]}</span>
                <p>{companion.why}</p>
              </li>
            ))}
          </ul>
          <p className="chapter-study__more">
            More in the <Link to="/library">reference library</Link>.
          </p>
        </>
      )}
    </section>
  );
}
