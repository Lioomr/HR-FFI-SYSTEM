import { describe, expect, it } from "vitest";
import { isValidElement } from "react";

import { routes } from "./routes";
import { CancellationRequestsPage } from "./lazyPages";
import RequireAuth from "./RequireAuth";
import RequireRole from "./RequireRole";

type RouteNode = {
  path?: string;
  element?: unknown;
  children?: RouteNode[];
};

function findRoute(
  nodes: RouteNode[],
  path: string,
  ancestors: RouteNode[] = [],
): { node: RouteNode; ancestors: RouteNode[] } | undefined {
  for (const node of nodes) {
    if (node.path === path) return { node, ancestors };
    const nested = node.children
      ? findRoute(node.children, path, [...ancestors, node])
      : undefined;
    if (nested) return nested;
  }
}

describe("HR cancellation requests route", () => {
  it("is lazy-loaded behind the HR role guard", () => {
    const route = findRoute(routes as RouteNode[], "hr/cancellation-requests");
    expect(route).toBeDefined();
    if (!route || !isValidElement(route.node.element)) {
      throw new Error("route element missing");
    }
    expect(route.node.element.type).toBe(CancellationRequestsPage);
    expect(
      route.ancestors.some(
        (node) =>
          isValidElement(node.element) && node.element.type === RequireAuth,
      ),
    ).toBe(true);
    const guard = route.ancestors.find(
      (node) =>
        isValidElement(node.element) && node.element.type === RequireRole,
    );
    expect(
      guard &&
        isValidElement<{ roles: string[] }>(guard.element) &&
        guard.element.props.roles,
    ).toEqual(["HRManager", "SystemAdmin"]);
  });
});
