import { describe, expect, it } from "vitest";
import type { AuthUser } from "../auth/authStore";
import { pageNeedsCompany, resolveCompanyLink } from "./organizationContext";

describe("pageNeedsCompany", () => {
  it.each([
    "/hr/dashboard",
    "/hr/job-offers",
    "/hr/job-offers/12/edit",
    "/hr/employees",
    "/hr/leave/requests",
    "/hr/payroll",
    "/pending-inbox",
    "/notifications",
    "/admin/invites",
    "/admin/work-locations",
  ])("needs a company for %s", (path) => {
    expect(pageNeedsCompany(path)).toBe(true);
  });

  it.each([
    "/",
    "/admin",
    "/admin/dashboard",
    "/admin/users/create",
    "/admin/audit-logs",
    "/hr/templates",
    "/hr/announcements",
    "/hr/announcements/12/edit",
    "/ceo/announcements/create",
    "/hr/activity/",
    "/hr/profile",
    "/change-password",
  ])("works in head office for %s", (path) => {
    expect(pageNeedsCompany(path)).toBe(false);
  });

  it("does not treat a shared prefix as the same page", () => {
    expect(pageNeedsCompany("/hr/templates-archive")).toBe(true);
  });
});

describe("resolveCompanyLink", () => {
  const org = (id: number, node_type: "company" | "head_office") => ({
    id,
    code: `C${id}`,
    name: `Company ${id}`,
    node_type,
    parent_id: null,
    is_active: true,
  });
  const user: AuthUser = {
    id: "1",
    email: "hr@example.com",
    role: "HRManager",
    accessible_organizations: [
      org(1, "head_office"),
      org(2, "company"),
      org(3, "company"),
    ],
    default_organization_id: 2,
    active_organization_id: 2,
  };
  const at = (pathname: string, search: string, hash = "") => ({
    pathname,
    search,
    hash,
  });

  it("ignores locations without a company hint", () => {
    expect(
      resolveCompanyLink(at("/hr/leave/requests/5", "?tab=x"), user),
    ).toBeNull();
  });

  it("switches to an accessible company and strips the hint", () => {
    const result = resolveCompanyLink(
      at("/hr/leave/requests/5", "?company=3&tab=x", "#top"),
      user,
    );
    expect(result?.switchTo?.id).toBe(3);
    expect(result?.cleanPath).toBe("/hr/leave/requests/5?tab=x#top");
  });

  it("only strips the hint when the company is already active", () => {
    const result = resolveCompanyLink(
      at("/hr/leave/requests/5", "?company=2"),
      user,
    );
    expect(result).toEqual({
      switchTo: null,
      cleanPath: "/hr/leave/requests/5",
    });
  });

  it.each([
    ["an inaccessible company", "/hr/leave/requests/5", "?company=99"],
    ["the head office", "/hr/leave/requests/5", "?company=1"],
    ["a non-numeric value", "/hr/leave/requests/5", "?company=3abc"],
    ["repeated values", "/hr/leave/requests/5", "?company=3&company=3"],
    ["a create page", "/hr/employees/create", "?company=3"],
    ["an edit page", "/hr/employees/7/edit", "?company=3"],
    ["a new-request page", "/employee/permission-requests/new", "?company=3"],
  ])("never switches for %s", (_label, pathname, search) => {
    const result = resolveCompanyLink(at(pathname, search), user);
    expect(result).toEqual({ switchTo: null, cleanPath: pathname });
  });
});
