import { describe, expect, it } from "vitest";
import type { ReactElement } from "react";
import type { RouteObject } from "react-router-dom";

import { routes } from "./routes";
import UserProfilePage from "../pages/shared/UserProfilePage";
import MyProfilePage from "../pages/employee/MyProfilePage";

type AnyRoute = RouteObject & { children?: AnyRoute[] };

/** Every `path` in the tree, paired with the component its element renders. */
function collect(
  nodes: AnyRoute[] = [],
  found = new Map<string, unknown>(),
): Map<string, unknown> {
  for (const node of nodes) {
    if (node.path && node.element) {
      found.set(node.path, (node.element as ReactElement).type);
    }
    if (node.children) collect(node.children, found);
  }
  return found;
}

const byPath = collect(routes as AnyRoute[]);

/**
 * The signature card lives in the two personal-profile pages, so every profile
 * route must resolve to one of them. A new role profile wired to some other
 * component would silently lose the card; this is the guard against that.
 */
describe("personal profile routes", () => {
  it.each([
    "hr/profile",
    "manager/profile",
    "ceo/profile",
    "cfo/profile",
    "admin/profile",
  ])("%s renders the shared profile page", (path) => {
    expect(byPath.get(path)).toBe(UserProfilePage);
  });

  it("employee/profile still renders the employee profile page", () => {
    expect(byPath.get("employee/profile")).toBe(MyProfilePage);
  });
});
