import { useQuery } from "@tanstack/react-query";
import { Link, useRouterState } from "@tanstack/react-router";
import { type ReactNode, useEffect, useRef } from "react";
import type { Bootstrap } from "../lib/api-contract";
import { getBootstrap, getDashboardSnapshot } from "../lib/service-client";
import { ThemeControl } from "./theme";

const primaryRoutes = [
  { to: "/dashboard", label: "Dashboard", group: "dashboard" },
  { to: "/curriculum", label: "Learn", group: "learn" },
  { to: "/practice", label: "Practice", group: "practice" },
  { to: "/review", label: "Review", group: "review" },
  { to: "/study", label: "Study", group: "study" },
  { to: "/projects", label: "Projects", group: "projects" },
  { to: "/journal", label: "Journal", group: "journal" },
] as const;

const footerRoutes = [
  ["/graph", "Knowledge graph"],
  ["/errors", "Error catalog"],
  ["/library", "Reference library"],
  ["/diagnostic", "Diagnostic"],
  ["/exam", "Final exam"],
  ["/labs", "Systems lab"],
  ["/settings", "Settings"],
  ["/about", "About"],
] as const;

function routeIsActive(pathname: string, group: (typeof primaryRoutes)[number]["group"]) {
  switch (group) {
    case "dashboard":
      return pathname === "/" || pathname.startsWith("/dashboard");
    case "learn":
      return (
        pathname.startsWith("/curriculum") ||
        pathname.startsWith("/learn") ||
        pathname.startsWith("/lessons") ||
        pathname.startsWith("/concepts")
      );
    case "practice":
      return pathname.startsWith("/practice");
    case "review":
      return pathname.startsWith("/review");
    case "study":
      return pathname.startsWith("/study");
    case "projects":
      return pathname.startsWith("/projects");
    case "journal":
      return pathname.startsWith("/journal");
  }
}

function StatusMark({ state }: { state: "ready" | "waiting" | "blocked" }) {
  return (
    <svg className="status-mark" viewBox="0 0 16 16" aria-hidden="true" data-state={state}>
      <circle cx="8" cy="8" r="5" />
      {state === "ready" && <path d="m5.5 8 1.7 1.7 3.5-3.8" />}
      {state === "blocked" && <path d="M8 5.2v3.4M8 11v.1" />}
    </svg>
  );
}

function bootstrapIsReady(data: Bootstrap) {
  return (
    data.content.status === "ready" && data.capabilities.database && data.capabilities.compiler
  );
}

export function bootstrapStatusText(data: Bootstrap) {
  const unavailable = [
    data.content.status === "ready" ? null : "content release missing",
    data.capabilities.database ? null : "learner database unavailable",
    data.capabilities.compiler ? null : "compiler unavailable",
  ].filter(Boolean);
  return unavailable.length
    ? `Limited local service — ${unavailable.join(" · ")}`
    : "Local service, learner database, and compiler ready";
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const previousPath = useRef(pathname);
  const mainContent = useRef<HTMLElement>(null);
  const bootstrap = useQuery({
    queryKey: ["bootstrap"],
    queryFn: ({ signal }) => getBootstrap(signal),
  });
  const snapshot = useQuery({ queryKey: ["dashboard-snapshot"], queryFn: getDashboardSnapshot });
  const dueReviews = snapshot.data?.counts.dueReviews ?? 0;

  const serviceReady = bootstrap.data ? bootstrapIsReady(bootstrap.data) : false;
  const status = bootstrap.isPending
    ? "waiting"
    : bootstrap.isError || !serviceReady
      ? "blocked"
      : "ready";
  const compactStatus =
    status === "waiting"
      ? "Checking local tools"
      : status === "ready"
        ? "Local tools ready"
        : "Setup needed";

  useEffect(() => {
    if (previousPath.current === pathname) return;
    previousPath.current = pathname;
    let focusedHeading: HTMLElement | null = null;
    const focusHeading = (force = false) => {
      const heading = mainContent.current?.querySelector<HTMLElement>("h1");
      if (!heading || heading === focusedHeading) return;
      const activeElement = document.activeElement;
      const focusCanFollow =
        force ||
        activeElement === document.body ||
        activeElement === mainContent.current ||
        activeElement === focusedHeading ||
        (focusedHeading !== null && !focusedHeading.isConnected);
      if (!focusCanFollow) return;

      const previousTabIndex = heading.getAttribute("tabindex");
      heading.setAttribute("tabindex", "-1");
      heading.focus({ preventScroll: true });
      focusedHeading = heading;
      heading.addEventListener(
        "blur",
        () => {
          if (previousTabIndex === null) heading.removeAttribute("tabindex");
          else heading.setAttribute("tabindex", previousTabIndex);
        },
        { once: true },
      );
    };

    const frame = window.requestAnimationFrame(() => focusHeading(true));
    const observer = new MutationObserver(() => focusHeading());
    if (mainContent.current) {
      observer.observe(mainContent.current, { childList: true, subtree: true });
    }
    const observerTimeout = window.setTimeout(() => observer.disconnect(), 2_000);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(observerTimeout);
      observer.disconnect();
    };
  }, [pathname]);

  return (
    <div className="app-frame">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>

      <header className="topbar">
        <Link to="/dashboard" className="wordmark" aria-label="Rust Tutor dashboard">
          <span>rust tutor</span>
        </Link>

        <nav className="primary-nav" aria-label="Primary navigation">
          {primaryRoutes.map(({ to, label, group }) => {
            const active = routeIsActive(pathname, group);
            return (
              <Link
                key={to}
                to={to}
                data-active={active || undefined}
                aria-current={active ? "page" : undefined}
              >
                {label}
                {group === "review" && dueReviews > 0 && (
                  <span className="nav-badge">{dueReviews}</span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="header-actions">
          <div className="service-compact" data-state={status} role="status" aria-live="polite">
            <StatusMark state={status} />
            <span>{compactStatus}</span>
          </div>
          <Link
            className="header-search"
            to="/search"
            data-active={pathname.startsWith("/search") || undefined}
            aria-current={pathname.startsWith("/search") ? "page" : undefined}
          >
            ⌕ <span>Search</span>
          </Link>
        </div>
      </header>

      {status === "blocked" && (
        <aside className="service-banner" role="alert" aria-label="Local service status">
          <StatusMark state="blocked" />
          <div>
            <strong>
              {bootstrap.isError ? "The local service is unavailable." : "Setup is incomplete."}
            </strong>
            <span>
              {bootstrap.isError
                ? " Start it to restore learner data and compiler actions."
                : bootstrap.data
                  ? ` ${bootstrapStatusText(bootstrap.data)}`
                  : " Local tools are still being checked."}
            </span>
          </div>
          {bootstrap.isError ? (
            <button type="button" onClick={() => void bootstrap.refetch()}>
              Retry connection
            </button>
          ) : (
            <Link to="/settings">Review setup</Link>
          )}
        </aside>
      )}

      <main id="main-content" tabIndex={-1} className="main-content" ref={mainContent}>
        {children}
      </main>

      <footer className="page-footer">
        <nav aria-label="Tools and reference">
          {footerRoutes.map(([to, label]) => (
            <Link key={to} to={to}>
              {label}
            </Link>
          ))}
        </nav>
        <div className="page-footer__meta">
          <ThemeControl compact />
          <span>rust tutor · local-first, no account</span>
        </div>
      </footer>
    </div>
  );
}
