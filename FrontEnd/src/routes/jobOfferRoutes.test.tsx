import { describe, expect, it } from "vitest";
import { isValidElement } from "react";

import { routes } from "./routes";
import RequireAuth from "./RequireAuth";
import RequireRole from "./RequireRole";

/**
 * The candidate response page is the only job-offer surface that must stay
 * reachable without a session, and the HR surfaces are the only ones that must
 * not be. These tests read the route table rather than the pages so a future
 * reshuffle of the tree cannot quietly move an offer route across that line.
 */

type RouteNode = {
  path?: string;
  element?: unknown;
  children?: RouteNode[];
};

type Located = { node: RouteNode; ancestors: RouteNode[] };

function locate(nodes: RouteNode[], predicate: (path: string) => boolean, ancestors: RouteNode[] = []): Located[] {
  return nodes.flatMap((node) => {
    const here: Located[] =
      typeof node.path === "string" && predicate(node.path) ? [{ node, ancestors }] : [];
    const nested = node.children ? locate(node.children, predicate, [...ancestors, node]) : [];
    return [...here, ...nested];
  });
}

function elementTypeOf(node: RouteNode): unknown {
  return isValidElement(node.element) ? node.element.type : undefined;
}

function rolesOf(node: RouteNode): string[] | undefined {
  if (!isValidElement(node.element) || node.element.type !== RequireRole) return undefined;
  return (node.element.props as { roles?: string[] }).roles;
}

describe("job offer route guards", () => {
  const hrRoutes = locate(routes as RouteNode[], (path) => path.startsWith("hr/job-offers"));

  it("registers the four HR job-offer screens", () => {
    expect(hrRoutes.map((entry) => entry.node.path).sort()).toEqual([
      "hr/job-offers",
      "hr/job-offers/:id",
      "hr/job-offers/:id/edit",
      "hr/job-offers/new",
    ]);
  });

  it("keeps every HR job-offer screen behind auth and the HR roles", () => {
    expect(hrRoutes).not.toHaveLength(0);
    hrRoutes.forEach(({ node, ancestors }) => {
      const guardedByAuth = ancestors.some((ancestor) => elementTypeOf(ancestor) === RequireAuth);
      expect(guardedByAuth, `${node.path} is not behind RequireAuth`).toBe(true);

      const roleGuard = ancestors.map(rolesOf).find(Boolean);
      expect(roleGuard, `${node.path} has no role guard`).toBeDefined();
      expect(roleGuard).toEqual(["HRManager", "SystemAdmin"]);
    });
  });

  it("leaves the public response route unguarded at the top level", () => {
    const publicRoutes = locate(routes as RouteNode[], (path) => path === "/job-offers/respond");
    expect(publicRoutes).toHaveLength(1);

    const [{ ancestors }] = publicRoutes;
    expect(ancestors).toHaveLength(0);
    expect(ancestors.some((ancestor) => elementTypeOf(ancestor) === RequireAuth)).toBe(false);
    expect(ancestors.some((ancestor) => elementTypeOf(ancestor) === RequireRole)).toBe(false);
  });
});

describe("hiring request route guards", () => {
  const hrRoutes = locate(routes as RouteNode[], (path) => path.startsWith("hr/hiring-requests"));
  const ceoRoutes = locate(routes as RouteNode[], (path) => path.startsWith("ceo/hiring-requests"));

  it("registers the HR hiring-request screens", () => {
    expect(hrRoutes.map((entry) => entry.node.path).sort()).toEqual([
      "hr/hiring-requests",
      "hr/hiring-requests/:id",
      "hr/hiring-requests/:id/edit",
      "hr/hiring-requests/new",
    ]);
  });

  it("registers the CEO hiring-request screens", () => {
    expect(ceoRoutes.map((entry) => entry.node.path).sort()).toEqual([
      "ceo/hiring-requests",
      "ceo/hiring-requests/:id",
    ]);
  });

  it("keeps every HR hiring-request screen behind auth and the HR roles", () => {
    expect(hrRoutes).not.toHaveLength(0);
    hrRoutes.forEach(({ node, ancestors }) => {
      expect(
        ancestors.some((ancestor) => elementTypeOf(ancestor) === RequireAuth),
        `${node.path} is not behind RequireAuth`,
      ).toBe(true);
      expect(ancestors.map(rolesOf).find(Boolean)).toEqual(["HRManager", "SystemAdmin"]);
    });
  });

  it("keeps the CEO hiring-request screens behind auth", () => {
    expect(ceoRoutes).not.toHaveLength(0);
    ceoRoutes.forEach(({ node, ancestors }) => {
      expect(
        ancestors.some((ancestor) => elementTypeOf(ancestor) === RequireAuth),
        `${node.path} is not behind RequireAuth`,
      ).toBe(true);
      // The CEO screens sit behind the approver guard rather than a plain role
      // gate, so a profile-based approver reaches them too.
      expect(ancestors.some((ancestor) => rolesOf(ancestor) !== undefined)).toBe(false);
      expect(ancestors.length).toBeGreaterThan(1);
    });
  });

  it("registers the legacy /hiring-requests/:id link as a compatibility route", () => {
    // Backend notifications point here; without this route they 404.
    const compat = locate(routes as RouteNode[], (path) => path === "/hiring-requests/:id");
    expect(compat).toHaveLength(1);
    // It sits at the top level and does its own auth handling, so an
    // unauthenticated visit can keep the link as its post-login destination.
    expect(compat[0].ancestors).toHaveLength(0);
  });

  it("keeps the real CEO and HR screens reachable at their own paths", () => {
    const paths = [...hrRoutes, ...ceoRoutes].map((entry) => entry.node.path);
    expect(paths).toContain("hr/hiring-requests/:id");
    expect(paths).toContain("ceo/hiring-requests/:id");
  });

  it("does not expose any hiring-request screen publicly", () => {
    const publicPaths = (routes as RouteNode[])
      .filter((node) => typeof node.path === "string" && !node.children)
      .map((node) => node.path as string);
    // The compatibility route is the one exception: it renders no data, only a
    // redirect, and gates on auth itself.
    expect(
      publicPaths.filter((path) => path.includes("hiring-requests")),
    ).toEqual(["/hiring-requests/:id"]);
  });
});
