import type { Employee } from "../services/api/employeesApi";

const CEO_DEPARTMENT_ID = 1;

export function isCEOApproverEmployee(employee: Employee | null | undefined): boolean {
  if (!employee) return false;
  if ((employee.employment_status || "").toUpperCase() !== "ACTIVE") return false;

  return employee.department_id === CEO_DEPARTMENT_ID;
}
