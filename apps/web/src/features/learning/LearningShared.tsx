import type { ReactNode } from "react";

/* One human status vocabulary for the whole app: cleared / in progress /
   open / recommended / locked. Everything else falls back to lowercased
   words instead of raw enum spelling. */
const STATUS_LABELS: Record<string, string> = {
  accepted: "cleared",
  complete: "cleared",
  completed: "cleared",
  demonstrated: "cleared",
  current: "in progress",
  "not started": "open",
  available: "open",
  unlocked: "open",
};

export function statusLabel(value: string): string;
export function statusLabel(value: string | null | undefined): string | undefined;
export function statusLabel(value: string | null | undefined) {
  if (value == null) return undefined;
  const plain = value.replaceAll("_", " ").toLowerCase();
  return STATUS_LABELS[plain] ?? plain;
}

export function PageHero({
  eyebrow,
  title,
  lede,
  numeral,
  actions,
  tone = "major",
}: {
  eyebrow: string;
  title: string;
  lede?: string;
  numeral?: string;
  actions?: ReactNode;
  tone?: "major" | "quiet";
}) {
  return (
    <header className={`page-hero${tone === "quiet" ? " page-hero--quiet" : ""}`}>
      <div className="page-hero__content">
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        {lede && <p className="lede">{lede}</p>}
        {actions && <div className="page-hero__actions">{actions}</div>}
      </div>
      {numeral && (
        <span className="page-hero__numeral" aria-hidden="true">
          {numeral}
        </span>
      )}
    </header>
  );
}

export function ContextStrip({ children, meta }: { children: ReactNode; meta?: ReactNode }) {
  return (
    <div className="context-strip">
      {children}
      {meta && <span className="context-strip__meta">{meta}</span>}
    </div>
  );
}

export function DataSurfaceState({
  surface,
  state,
  detail,
}: {
  surface: "dashboard" | "curriculum";
  state: "loading" | "partial" | "empty" | "error" | "ready";
  detail?: string;
}) {
  if (state === "ready") return null;
  const message = {
    loading: `Loading ${surface} data…`,
    partial: `${surface} is usable, but one local service view is unavailable.`,
    empty: `No ${surface} activity exists yet. Start with the recommended first step.`,
    error: `${surface} data is unavailable. Retry after checking the local service.`,
  }[state];
  return (
    <aside
      className={`data-surface-state data-surface-state-${state}`}
      role={state === "error" ? "alert" : "status"}
      data-responsive="single-column-under-640px"
    >
      <strong>{message}</strong>
      {detail && <p>{detail}</p>}
    </aside>
  );
}
