import type { Employee } from "../services/api/employeesApi";

const CEO_POSITION_ID = 1;

export function isCEOApproverEmployee(employee: Employee | null | undefined): boolean {
  if (!employee) return false;
  if ((employee.employment_status || "").toUpperCase() !== "ACTIVE") return false;

  return employee.position_id === CEO_POSITION_ID;
}
