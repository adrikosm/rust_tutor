import { QueryClientProvider } from "@tanstack/react-query";
import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { AppShell } from "../app/AppShell";
import { createLocalQueryClient } from "../app/query-client";
import { ThemeProvider, themeBootstrapScript } from "../app/theme";
import { ErrorView, NotFoundView, PendingView } from "../components/RouteStates";
import appCss from "../styles/app.css?url";

const queryClient = createLocalQueryClient();

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "theme-color", content: "#f4efe2" },
      { title: "Rust Tutor" },
    ],
    links: [
      {
        rel: "preload",
        href: "/fonts/albert-sans/albert-sans-latin-variable.woff2",
        as: "font",
        type: "font/woff2",
        crossOrigin: "anonymous",
      },
      { rel: "stylesheet", href: appCss },
    ],
  }),
  component: RootLayout,
  pendingComponent: PendingView,
  errorComponent: ({ error, reset }) => <ErrorView error={error} reset={reset} />,
  notFoundComponent: NotFoundView,
  shellComponent: RootDocument,
});

function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AppShell>
          <Outlet />
        </AppShell>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: This constant theme bootstrap contains no user-controlled input. */}
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
