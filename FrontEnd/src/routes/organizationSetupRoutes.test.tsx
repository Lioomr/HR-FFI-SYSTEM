import { describe, expect, it } from "vitest";
import { isValidElement } from "react";
import { Navigate } from "react-router-dom";

import { routes } from "./routes";
import { OrganizationSetupPage } from "./lazyPages";
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

describe("organization setup routes", () => {
  it("keeps the combined page behind the HR role guard", () => {
    const route = findRoute(routes as RouteNode[], "hr/organization-setup");
    expect(route).toBeDefined();
    expect(isValidElement(route?.node.element)).toBe(true);
    if (!route || !isValidElement(route.node.element)) return;

    expect(route.node.element.type).toBe(OrganizationSetupPage);
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

  it.each(["departments", "positions", "task-groups", "sponsors"])(
    "redirects the old %s URL to its tab",
    (section) => {
      const route = findRoute(routes as RouteNode[], `hr/${section}`);
      expect(route).toBeDefined();
      expect(isValidElement(route?.node.element)).toBe(true);
      if (
        !route ||
        !isValidElement<{ to: string; replace: boolean }>(route.node.element)
      )
        return;

      expect(route.node.element.type).toBe(Navigate);
      expect(route.node.element.props.to).toBe(
        `/hr/organization-setup?tab=${section}`,
      );
      expect(route.node.element.props.replace).toBe(true);
    },
  );
});
