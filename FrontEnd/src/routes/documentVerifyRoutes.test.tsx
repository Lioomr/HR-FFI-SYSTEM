import { describe, expect, it } from "vitest";
import { isValidElement } from "react";

import { routes } from "./routes";
import RequireAuth from "./RequireAuth";
import RequireRole from "./RequireRole";

type RouteNode = { path?: string; element?: unknown; children?: RouteNode[] };

function ancestorsOf(
  nodes: RouteNode[],
  path: string,
  trail: RouteNode[] = [],
): RouteNode[][] {
  return nodes.flatMap((node) => [
    ...(node.path === path ? [trail] : []),
    ...(node.children
      ? ancestorsOf(node.children, path, [...trail, node])
      : []),
  ]);
}

const typeOf = (node: RouteNode) =>
  isValidElement(node.element) ? node.element.type : undefined;

describe("Verify a PDF route", () => {
  it("is registered once behind auth and the HR/admin role guard", () => {
    const found = ancestorsOf(routes as RouteNode[], "hr/documents/verify");
    expect(found).toHaveLength(1);
    const [ancestors] = found;
    expect(ancestors.some((node) => typeOf(node) === RequireAuth)).toBe(true);
    const guard = ancestors.find((node) => typeOf(node) === RequireRole);
    expect(
      (guard?.element as { props: { roles?: string[] } }).props.roles,
    ).toEqual(["HRManager", "SystemAdmin"]);
  });
});
