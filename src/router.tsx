import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      // Cloud data (plans, outlets, guest orders) stays fresh for 30 s, so moving between pages doesn't refetch it.
      queries: { staleTime: 30_000, gcTime: 10 * 60_000, retry: 2, refetchOnWindowFocus: true },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    // Start loading a page's code as soon as a finger or pointer heads for its link.
    defaultPreload: "intent",
    defaultPreloadDelay: 30,
    defaultPreloadStaleTime: 0,
    // Never flash a loading state for quick page changes.
    defaultPendingMs: 400,
    defaultPendingMinMs: 0,
    // A short cross-fade between pages where the browser supports it (Chrome, Edge, Safari 18+).
    defaultViewTransition: true,
  });

  return router;
};
