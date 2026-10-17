import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { AuthProvider } from "@/lib/auth-context";
import { LiveSync } from "@/components/LiveSync";
import { PrintHost } from "@/components/PrintHost";
import { AppInstall } from "@/components/AppInstall";
import { PersistentFrame } from "@/components/AppShell";
import { PreloadScreens } from "@/components/PreloadScreens";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            search={{}}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    if (isStaleChunkError(error) && reloadOnceForStaleChunk()) return;
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: "XTSY POS" },
      { name: "description", content: "Restaurant billing, KOTs and live multi-device sync for India — works offline." },
      { name: "author", content: "XTSY" },
      { property: "og:title", content: "XTSY POS" },
      { property: "og:description", content: "Restaurant billing, KOTs and live multi-device sync for India — works offline." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", type: "image/png", href: "/favicon.png" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

const RELOAD_KEY = "xtsy-stale-chunk-reload";

/** After a deploy, an open tab may request old hashed chunks that no longer exist: reload once to pick up the new build. */
function reloadOnceForStaleChunk(): boolean {
  if (typeof window === "undefined") return false;
  const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
  if (Date.now() - last < 10_000) return false;
  sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  window.location.reload();
  return true;
}

function isStaleChunkError(error: unknown) {
  const msg = error instanceof Error ? error.message : String(error ?? "");
  return /dynamically imported module|Importing a module script failed|Failed to fetch dynamically|error loading dynamically imported/i.test(msg);
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  useEffect(() => {
    const onPreload = (e: Event) => { e.preventDefault(); reloadOnceForStaleChunk(); };
    const onRejection = (e: PromiseRejectionEvent) => { if (isStaleChunkError(e.reason)) reloadOnceForStaleChunk(); };
    window.addEventListener("vite:preloadError", onPreload);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("vite:preloadError", onPreload);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <LiveSync />
        <PrintHost />
        <AppInstall />
        <PreloadScreens />
        {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
        <PersistentFrame><Outlet /></PersistentFrame>
      </AuthProvider>
    </QueryClientProvider>
  );
}
