import { describe, expect, it } from "vitest";
import { isValidElement } from "react";

import { routes } from "./routes";
import RequireAuth from "./RequireAuth";
import RequireRole from "./RequireRole";

/**
 * Starting work acknowledgements are HR-only by design: they are never
 * delivered to the employee and carry no employee-facing action. These tests
 * read the route table rather than the pages, so a future reshuffle of the
 * tree cannot quietly expose one outside the HR branch.
 */

type RouteNode = {
  path?: string;
  element?: unknown;
  children?: RouteNode[];
};

type Located = { node: RouteNode; ancestors: RouteNode[] };

function locate(
  nodes: RouteNode[],
  predicate: (path: string) => boolean,
  ancestors: RouteNode[] = [],
): Located[] {
  return nodes.flatMap((node) => {
    const here: Located[] =
      typeof node.path === "string" && predicate(node.path)
        ? [{ node, ancestors }]
        : [];
    const nested = node.children
      ? locate(node.children, predicate, [...ancestors, node])
      : [];
    return [...here, ...nested];
  });
}

function elementTypeOf(node: RouteNode): unknown {
  return isValidElement(node.element) ? node.element.type : undefined;
}

function rolesOf(node: RouteNode): string[] | undefined {
  if (!isValidElement(node.element) || node.element.type !== RequireRole)
    return undefined;
  return (node.element.props as { roles?: string[] }).roles;
}

const acknowledgmentRoutes = locate(routes as RouteNode[], (path) =>
  path.includes("starting-work-acknowledgments"),
);

describe("starting work acknowledgement route guards", () => {
  it("registers the inbox and the review screen", () => {
    expect(acknowledgmentRoutes.map((entry) => entry.node.path).sort()).toEqual(
      [
        "hr/starting-work-acknowledgments",
        "hr/starting-work-acknowledgments/:id",
      ],
    );
  });

  it("keeps both screens behind auth and the HR roles", () => {
    expect(acknowledgmentRoutes).not.toHaveLength(0);
    acknowledgmentRoutes.forEach(({ node, ancestors }) => {
      expect(
        ancestors.some((ancestor) => elementTypeOf(ancestor) === RequireAuth),
        `${node.path} is not behind RequireAuth`,
      ).toBe(true);

      const roleGuard = ancestors.map(rolesOf).find(Boolean);
      expect(roleGuard, `${node.path} has no role guard`).toBeDefined();
      expect(roleGuard).toEqual(["HRManager", "SystemAdmin"]);
    });
  });

  it("registers no employee-facing or public acknowledgement route", () => {
    acknowledgmentRoutes.forEach(({ node }) => {
      expect(node.path?.startsWith("hr/")).toBe(true);
    });

    const publicPaths = (routes as RouteNode[])
      .filter((node) => typeof node.path === "string" && !node.children)
      .map((node) => node.path as string);
    expect(
      publicPaths.filter((path) =>
        path.includes("starting-work-acknowledgments"),
      ),
    ).toEqual([]);

    expect(
      locate(
        routes as RouteNode[],
        (path) =>
          /^(employee|manager|ceo|cfo)\//.test(path) &&
          path.includes("starting-work"),
      ),
    ).toHaveLength(0);
  });
});
