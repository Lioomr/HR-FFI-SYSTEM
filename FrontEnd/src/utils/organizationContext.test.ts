import { describe, expect, it } from "vitest";
import { pageNeedsCompany } from "./organizationContext";

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
