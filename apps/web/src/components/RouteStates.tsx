import { Link } from "@tanstack/react-router";

export function PendingView() {
  return (
    <section className="state-view" aria-busy="true" aria-labelledby="pending-title">
      <p className="eyebrow">Loading local evidence</p>
      <h1 id="pending-title">Opening the workspace…</h1>
      <div className="skeleton-lines" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    </section>
  );
}

export function ErrorView({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <section className="state-view" role="alert" aria-labelledby="error-title">
      <p className="eyebrow">Route error</p>
      <h1 id="error-title">This view could not be opened.</h1>
      <p>{error.message || "An unknown local error occurred."}</p>
      <button type="button" className="button" onClick={reset}>
        Try this view again
      </button>
    </section>
  );
}

export function NotFoundView() {
  return (
    <section className="state-view" aria-labelledby="missing-title">
      <p className="eyebrow">404 · path not found</p>
      <h1 id="missing-title">That learning path does not exist.</h1>
      <p>No progress was changed. Return to the dashboard and choose a reviewed route.</p>
      <Link className="button" to="/dashboard">
        Return to dashboard
      </Link>
    </section>
  );
}
