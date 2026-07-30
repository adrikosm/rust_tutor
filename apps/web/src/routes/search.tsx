import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { z } from "zod";
import { statusLabel } from "../features/learning/LearningShared";
import { searchContent } from "../lib/service-client";

const searchSchema = z.object({
  q: z.string().trim().max(120).optional(),
  kind: z.string().trim().max(60).optional(),
});
type SafeSearch = { q?: string; kind?: string; recovered?: boolean };

export function normalizeSearch(value: unknown): SafeSearch {
  const parsed = searchSchema.safeParse(value);
  return parsed.success ? parsed.data : { recovered: true };
}

export const Route = createFileRoute("/search")({
  head: () => ({ meta: [{ title: "Search | Rust Tutor" }] }),
  validateSearch: normalizeSearch,
  component: SearchPage,
});

function SearchPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/search" });
  const results = useQuery({
    queryKey: ["content-search", search.q, search.kind],
    queryFn: () => searchContent(search.q ?? "", search.kind),
    enabled: Boolean(search.q),
  });
  useEffect(() => {
    if (search.recovered) void navigate({ search: {}, replace: true });
  }, [navigate, search.recovered]);
  return (
    <section className="state-view search-page">
      <p className="eyebrow">Search · local index</p>
      <h1>{search.q ? `Results for “${search.q}”` : "Search reviewed content."}</h1>
      {search.recovered && (
        <p role="alert">Invalid search parameters were removed. No query was run.</p>
      )}
      <form action="/search" method="get">
        <label htmlFor="search-query">Concept, error, or outcome</label>
        <input id="search-query" name="q" defaultValue={search.q} maxLength={120} />
        <label htmlFor="search-kind">Optional kind filter</label>
        <select id="search-kind" name="kind" defaultValue={search.kind ?? ""}>
          <option value="">All reviewed kinds</option>
          <option value="concept">Concepts</option>
          <option value="learning_outcome">Outcomes</option>
          <option value="compiler_error">Compiler errors</option>
          <option value="tool">Tools</option>
          <option value="algorithm_pattern">Algorithm patterns</option>
          <option value="project">Projects</option>
          <option value="misconception">Misconceptions</option>
        </select>
        <button className="button" type="submit">
          Search locally
        </button>
      </form>
      {results.isPending && search.q && <p role="status">Searching the local FTS5 index…</p>}
      {results.isError && <p role="alert">{results.error.message}</p>}
      {results.data && (
        <div className="search-results" aria-live="polite">
          <p>
            {results.data.count} reviewed result{results.data.count === 1 ? "" : "s"}
          </p>
          {Object.entries(results.data.groups).map(([kind, entries]) => (
            <section key={kind} aria-labelledby={`search-${kind}`}>
              <h2 id={`search-${kind}`}>{statusLabel(kind)}</h2>
              <ol>
                {entries.map((entry) => (
                  <li key={entry.id}>
                    {kind === "concept" ? (
                      <Link to="/concepts/$conceptId" params={{ conceptId: entry.id }}>
                        {entry.title}
                      </Link>
                    ) : (
                      <Link to="/graph" search={{ id: entry.id, depth: 1 }}>
                        {entry.title}
                      </Link>
                    )}
                    <p>{entry.snippet.replaceAll(/<\/?mark>/g, "")}</p>
                  </li>
                ))}
              </ol>
            </section>
          ))}
          {results.data.count === 0 && (
            <section className="empty-surface">
              <h2>No reviewed match</h2>
              <p>Try a literal title, compiler code, project, or one of these suggestions:</p>
              <nav aria-label="Search suggestions">
                {results.data.suggestions.map((suggestion) => (
                  <Link key={suggestion} to="/search" search={{ q: suggestion }}>
                    {suggestion}
                  </Link>
                ))}
              </nav>
            </section>
          )}
        </div>
      )}
    </section>
  );
}
