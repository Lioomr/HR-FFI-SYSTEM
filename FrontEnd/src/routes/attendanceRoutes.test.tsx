import { describe, expect, it } from "vitest";
import type { ReactElement } from "react";
import { Navigate, type RouteObject } from "react-router-dom";
import { routes } from "./routes";
import EmployeeAttendancePage from "../pages/employee/AttendancePage";
import ManagerAttendancePage from "../pages/manager/ManagerAttendancePage";
import AttendancePreviewPage from "../pages/shared/AttendancePreviewPage";
function collect(
  nodes: RouteObject[],
  found = new Map<
    string,
    ReactElement<{ to?: string; replace?: boolean; role?: string }>
  >(),
) {
  for (const node of nodes) {
    if (node.path && node.element)
      found.set(
        node.path,
        node.element as ReactElement<{
          to?: string;
          replace?: boolean;
          role?: string;
        }>,
      );
    if (node.children) collect(node.children, found);
  }
  return found;
}
const paths = collect(routes);
describe("BioTime attendance routes", () => {
  it.each([
    ["employee/attendance-corrections", "/employee/attendance"],
    ["hr/attendance-correction-requests", "/hr/attendance"],
    ["manager/attendance-corrections", "/manager/attendance"],
  ])("%s redirects to %s", (path, to) => {
    expect(paths.get(path)?.type).toBe(Navigate);
    expect(paths.get(path)?.props).toMatchObject({ to, replace: true });
  });
  it("mounts the read-only employee and manager pages", () => {
    expect(paths.get("employee/attendance")?.type).toBe(EmployeeAttendancePage);
    expect(paths.get("manager/attendance")?.type).toBe(ManagerAttendancePage);
  });
  it.each(["hr", "ceo"])("%s keeps its scoped read-only preview", (role) => {
    expect(paths.get(`${role}/attendance`)?.type).toBe(AttendancePreviewPage);
    expect(paths.get(`${role}/attendance`)?.props.role).toBe(role);
  });
});
