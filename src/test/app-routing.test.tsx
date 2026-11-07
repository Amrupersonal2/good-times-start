import { QueryClient } from "@tanstack/react-query";
import { createRouter, rootRouteId } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

import { routeTree } from "@/routeTree.gen";

// Match routes without running loaders or rendering: loaders may need a server or
// network the test run lacks, and jsdom never loads the stylesheets React waits on.
describe("App routing", () => {
  it("matches a page for / instead of falling back to not found", () => {
    const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });

    const matches = router.matchRoutes("/");

    expect(matches.at(-1)?.routeId).not.toBe(rootRouteId);
  });

  it.each([
    ["", "/tables?app=pos"],
    ["?app=manager", "/manager?app=manager"],
    ["?app=waiter", "/waiter?app=waiter"],
  ])("redirects empty entry %s before rendering a cart", (searchStr, href) => {
    const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });
    const route = router.routesByPath["/"];
    const beforeLoad = route?.options.beforeLoad;
    expect(typeof beforeLoad).toBe("function");
    try {
      if (typeof beforeLoad !== "function") throw new Error("Missing entry guard");
      // Exercise the public route guard without mounting auth/database components.
      Reflect.apply(beforeLoad, undefined, [{ search: {}, location: { searchStr } }]);
      throw new Error("Empty entry did not redirect");
    } catch (error) {
      expect(error).toMatchObject({ options: { href, replace: true } });
    }
  });

  it.each([{ table: "room-666" }, { bill: "existing-bill" }, { type: "takeaway" }])("preserves explicit bill entry %j", (search) => {
    const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });
    const beforeLoad = router.routesByPath["/"]?.options.beforeLoad;
    if (typeof beforeLoad !== "function") throw new Error("Missing entry guard");
    expect(Reflect.apply(beforeLoad, undefined, [{ search, location: { searchStr: "" } }])).toBeUndefined();
  });
});
