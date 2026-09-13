import { isValidElement, type ReactElement } from "react";
import { describe, expect, it } from "vitest";

import { getHomePath, getPostLoginDestination } from "./homeRoute";
import HomeRedirect from "./HomeRedirect";
import { routes } from "./routes";

type RouteNode = {
  path?: string;
  index?: boolean;
  element?: unknown;
  children?: RouteNode[];
};

describe("home-route resolution", () => {
  it("registers the protected root with a role-aware index redirect", () => {
    const rootRoute = (routes as RouteNode[]).find(
      (route) => route.path === "/",
    );
    const indexRoute = rootRoute?.children?.[0]?.children?.find(
      (route) => route.index,
    );

    expect(isValidElement(indexRoute?.element)).toBe(true);
    expect((indexRoute?.element as ReactElement).type).toBe(HomeRedirect);
  });

  it.each([
    ["SystemAdmin", "/admin/dashboard"],
    ["HRManager", "/hr/dashboard"],
    ["Manager", "/employee/dashboard"],
    ["CEO", "/ceo/dashboard"],
    ["CFO", "/cfo/dashboard"],
    ["Employee", "/employee/dashboard"],
  ] as const)("sends %s home to %s", (role, expectedPath) => {
    expect(getHomePath(role)).toBe(expectedPath);
  });

  it("never uses the empty application shell as a post-login destination", () => {
    expect(getPostLoginDestination("Employee", "/")).toBe(
      "/employee/dashboard",
    );
  });

  it("rejects a saved route outside the signed-in role's area", () => {
    expect(getPostLoginDestination("Employee", "/hr/employees")).toBe(
      "/employee/dashboard",
    );
  });

  it("preserves a valid deep link for the signed-in role", () => {
    expect(
      getPostLoginDestination("HRManager", "/hr/employees?status=active"),
    ).toBe("/hr/employees?status=active");
  });

  it("does not restore an employee deep link after switching to an HR account", () => {
    expect(getPostLoginDestination("HRManager", "/employee/loans/1")).toBe(
      "/hr/dashboard",
    );
  });
});

describe("capability-based login return paths", () => {
  it.each([
    ["Employee", "/manager/team-requests"],
    ["Employee", "/ceo/loan-requests/123"],
    ["Manager", "/cfo/loan-requests/123"],
    ["SystemAdmin", "/finance/loan-requests/123"],
    ["HRManager", "/finance/loan-requests"],
  ] as const)(
    "restores %s to %s for the route guard to authorize",
    (role, path) => {
      expect(getPostLoginDestination(role, path)).toBe(path);
    },
  );
  it.each([
    "//evil.example/manager",
    "/\\evil.example/manager",
    "https://evil.example/manager",
  ])("rejects external destination %s", (path) => {
    expect(getPostLoginDestination("Employee", path)).toBe(
      "/employee/dashboard",
    );
  });
});

it("restores a legacy HR reminder after login", () => {
  expect(getPostLoginDestination("HRManager", "/employees/123")).toBe(
    "/hr/employees/123",
  );
  expect(getPostLoginDestination("Employee", "/employees/123")).toBe(
    "/employee/dashboard",
  );
});
