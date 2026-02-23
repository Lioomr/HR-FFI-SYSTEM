import type { Employee } from "../services/api/employeesApi";

const FINANCE_DEPARTMENT_ID = 8;
const FINANCE_POSITION_ID = 24;

export function isFinanceApproverEmployee(employee: Employee | null | undefined): boolean {
  if (!employee) return false;
  if ((employee.employment_status || "").toUpperCase() !== "ACTIVE") return false;

  return employee.department_id === FINANCE_DEPARTMENT_ID && employee.position_id === FINANCE_POSITION_ID;
}
