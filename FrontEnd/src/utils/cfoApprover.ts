import type { Employee } from "../services/api/employeesApi";

const CFO_POSITION_ID = 3;

export function isCFOApproverEmployee(employee: Employee | null | undefined): boolean {
  if (!employee) return false;
  if ((employee.employment_status || "").toUpperCase() !== "ACTIVE") return false;

  return employee.position_id === CFO_POSITION_ID;
}
