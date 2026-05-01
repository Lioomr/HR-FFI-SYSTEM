import type { AuthUser } from "../auth/authStore";
import type { Employee } from "../services/api/employeesApi";

const CEO_DEPARTMENT_ID = 1;

export function isCEOApproverRole(user: AuthUser | null | undefined): boolean {
  if (!user) return false;
  return user.role === "CEO" || user.role === "SystemAdmin";
}

export function isCEOApproverEmployee(employee: Employee | null | undefined): boolean {
  if (!employee) return false;
  if ((employee.employment_status || "").toUpperCase() !== "ACTIVE") return false;

  return employee.department_id === CEO_DEPARTMENT_ID;
}

export function isCEOApprover(
  user: AuthUser | null | undefined,
  employee: Employee | null | undefined,
): boolean {
  return isCEOApproverRole(user) || isCEOApproverEmployee(employee);
}
