import type { AuthUser } from "../auth/authStore";
import type { Employee } from "../services/api/employeesApi";

const CFO_POSITION_ID = 3;

export function isCFOApproverRole(user: AuthUser | null | undefined): boolean {
  if (!user) return false;
  return user.role === "CFO" || user.role === "SystemAdmin";
}

export function isCFOApproverEmployee(employee: Employee | null | undefined): boolean {
  if (!employee) return false;
  if ((employee.employment_status || "").toUpperCase() !== "ACTIVE") return false;

  return employee.position_id === CFO_POSITION_ID;
}

export function isCFOApprover(
  user: AuthUser | null | undefined,
  employee: Employee | null | undefined,
): boolean {
  return isCFOApproverRole(user) || isCFOApproverEmployee(employee);
}
