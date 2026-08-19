import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
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
};

const entries = catalog as LibraryEntry[];

const levels = [
  ["all", "Everything"],
  ["foundation", "Foundation"],
  ["intermediate", "Intermediate"],
  ["advanced", "Advanced"],
  ["reference", "Reference"],
  ["practice", "Practice"],
] as const;

const levelBlurbs: Record<string, string> = {
  foundation: "Read alongside chapters 1–9 while the language model is still forming.",
  intermediate: "Idiom and ecosystem judgement, once the borrow checker stops surprising you.",
  advanced: "Unsafe, concurrency, async internals, macros, and measured performance.",
  reference: "Look-up material. Not meant to be read front to back.",
  practice: "Extra repetitions and alternative solutions to compare against your own.",
};

export function ReferenceLibraryPage() {
  const [level, setLevel] = useState<string>("all");
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return entries.filter((entry) => {
      if (level !== "all" && entry.level !== level) return false;
      if (!needle) return true;
      return `${entry.title} ${entry.author} ${entry.kind} ${entry.blurb}`
        .toLowerCase()
        .includes(needle);
    });
  }, [level, query]);

  return (
    <section className="state-view library-page">
      <p className="eyebrow">Reference library · {entries.length} works · link-only</p>
      <h1>The open Rust literature, mapped to this curriculum</h1>
      <p className="library-page__lede">
        Every lesson ends with three to six deep links into these works, chosen for that specific
        section. Nothing here is republished: the app stores identity, license, and a locally
        authored reason to read it now, then sends you to the canonical page.
      </p>

      <div className="library-controls">
        <label htmlFor="library-search">Filter the library</label>
        <input
          id="library-search"
          value={query}
          placeholder="ownership, macros, async, profiling…"
          onChange={(event) => setQuery(event.target.value)}
        />
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
