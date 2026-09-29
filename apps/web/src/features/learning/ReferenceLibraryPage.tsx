import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { learningPaths } from "../../data/course-companions";
import catalog from "../../data/reference-library.json";

type LibraryEntry = {
  id: string;
  title: string;
  author: string;
  url: string;
  repo?: string;
  license: string;
  use: string;
  kind: string;
  level: string;
  blurb: string;
  topics?: string[];
};

const entries = catalog as LibraryEntry[];
const entryById = new Map(entries.map((entry) => [entry.id, entry]));

const levels = [
  ["all", "Every depth"],
  ["foundation", "Foundation"],
  ["intermediate", "Intermediate"],
  ["advanced", "Advanced"],
  ["reference", "Reference"],
  ["practice", "Practice"],
] as const;

/** Coarse shelves over the free-form `kind` field, so filters stay short. */
const shelves = [
  ["all", "Everything", []],
  ["books", "Books & courses", ["book", "course", "tutorial", "interactive", "hub", "recipes"]],
  ["practice", "Exercises & quizzes", ["exercises", "quiz"]],
  ["reference", "References & specs", ["api", "reference", "specification", "checklist"]],
  ["tools", "Tools", ["tooling", "tool"]],
  ["code", "Code to read", ["code"]],
  ["datasets", "Open datasets", ["dataset"]],
  [
    "community",
    "News, talks & research",
    ["community", "newsletter", "video", "research", "design-history"],
  ],
] as const;

const levelBlurbs: Record<string, string> = {
  foundation: "Read alongside chapters 1–9 while the language model is still forming.",
  intermediate: "Idiom and ecosystem judgement, once the borrow checker stops surprising you.",
  advanced: "Unsafe, concurrency, async internals, macros, and measured performance.",
  reference: "Look-up material. Not meant to be read front to back.",
  practice: "Extra repetitions and alternative solutions to compare against your own.",
};

export function libraryMatches(
  entry: LibraryEntry,
  filters: { level: string; shelf: string; query: string },
) {
  if (filters.level !== "all" && entry.level !== filters.level) return false;
  const shelf = shelves.find(([id]) => id === filters.shelf);
  if (shelf && shelf[0] !== "all" && !(shelf[2] as readonly string[]).includes(entry.kind))
    return false;
  const needle = filters.query.trim().toLowerCase();
  if (!needle) return true;
  return `${entry.title} ${entry.author} ${entry.kind} ${entry.blurb} ${(entry.topics ?? []).join(" ")}`
    .toLowerCase()
    .includes(needle);
}

export function ReferenceLibraryPage() {
  const [level, setLevel] = useState<string>("all");
  const [shelf, setShelf] = useState<string>("all");
  const [query, setQuery] = useState("");

  const visible = useMemo(
    () => entries.filter((entry) => libraryMatches(entry, { level, shelf, query })),
    [level, shelf, query],
  );
  const datasetCount = entries.filter((entry) => entry.kind === "dataset").length;

  return (
    <section className="state-view library-page">
      <p className="eyebrow">
        Reference library · {entries.length} free works · {datasetCount} open datasets · link-only
      </p>
      <h1>The open Rust literature, mapped to this curriculum</h1>
      <p className="library-page__lede">
        Every free book, course, exercise set, reference, tool, and public dataset worth your time,
        with its license. Each chapter of the course links the specific pages to read, drill, or
        check yourself against. Nothing is republished: the app stores identity, license, and a
        locally authored reason to read it now, then sends you to the canonical page.
      </p>

      <section className="library-paths" aria-labelledby="library-paths-title">
        <h2 id="library-paths-title">Learning paths</h2>
        <p className="library-page__hint">
          Ordered routes through the library. Each step assumes the ones before it.
        </p>
        <div className="library-paths__grid">
          {learningPaths.map((path) => (
            <details key={path.id} className="library-path">
              <summary>
                <strong>{path.title}</strong>
                <span>{path.audience}</span>
              </summary>
              <ol>
                {path.steps.map((step) => {
                  const entry = entryById.get(step.libraryId);
                  if (!entry) return null;
                  return (
                    <li key={step.libraryId}>
                      <a href={entry.url} target="_blank" rel="noreferrer">
                        {entry.title}
                      </a>{" "}
                      — {step.note}
                    </li>
                  );
                })}
              </ol>
            </details>
          ))}
        </div>
      </section>

      <div className="library-controls">
        <label htmlFor="library-search">Filter the library</label>
        <input
          id="library-search"
          value={query}
          placeholder="ownership, async, embedded, dataset, quizzes…"
          onChange={(event) => setQuery(event.target.value)}
        />
        <fieldset className="library-levels">
          <legend className="visually-hidden">Filter by kind</legend>
          {shelves.map(([value, label]) => (
            <button
              key={value}
              type="button"
              data-active={shelf === value || undefined}
              aria-pressed={shelf === value}
              onClick={() => setShelf(value)}
            >
              {label}
            </button>
          ))}
        </fieldset>
        <fieldset className="library-levels">
          <legend className="visually-hidden">Filter by depth</legend>
          {levels.map(([value, label]) => (
            <button
              key={value}
              type="button"
              data-active={level === value || undefined}
              aria-pressed={level === value}
              onClick={() => setLevel(value)}
            >
              {label}
            </button>
          ))}
        </fieldset>
      </div>

      {level !== "all" && <p className="library-page__hint">{levelBlurbs[level]}</p>}
      <p className="library-page__hint" role="status">
        Showing {visible.length} of {entries.length}
      </p>

      <ol className="library-grid">
        {visible.map((entry) => (
          <li key={entry.id} className="library-card" data-level={entry.level}>
            <p className="library-card__kind">
              {entry.kind} · {entry.level}
            </p>
            <h2>
              <a href={entry.url} target="_blank" rel="noreferrer">
                {entry.title}
              </a>
            </h2>
            <p className="library-card__author">{entry.author}</p>
            <p>{entry.blurb}</p>
            {entry.topics && entry.topics.length > 0 && (
              <ul className="library-card__topics" aria-label="Topics">
                {entry.topics.map((topic) => (
                  <li key={topic}>
                    <button type="button" onClick={() => setQuery(topic)}>
                      {topic}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="library-card__license">
              {entry.license}
              {entry.repo && (
                <>
                  {" · "}
                  <a href={entry.repo} target="_blank" rel="noreferrer">
                    source repository
                  </a>
                </>
              )}
            </p>
          </li>
        ))}
      </ol>

      {visible.length === 0 && (
        <section className="empty-surface">
          <h2>No match in the library</h2>
          <p>
            Clear the filter, or search the reviewed local content instead from{" "}
            <Link to="/search">Search</Link>.
          </p>
        </section>
      )}
    </section>
  );
}
