import type { Dayjs } from "dayjs";
import dayjs from "dayjs";
import type { Employee } from "../../../services/api/employeesApi";

/**
 * Transform form values from AntD to API payload format
 * - Converts DatePicker dayjs objects to YYYY-MM-DD strings
 * - Ensures numeric fields are numbers
 * - Strips undefined/null values
 * - Maintains snake_case field names
 * 
 * Used for both create and update operations
 */
export function toPayload(values: any): any {
  const transformed: any = {};

  for (const [key, value] of Object.entries(values)) {
    // Skip undefined and null values
    if (value === undefined || value === null) {
      continue;
    }

    // Convert DatePicker dayjs objects to ISO date strings
    if (value && typeof value === "object" && "format" in value) {
      transformed[key] = (value as Dayjs).format("YYYY-MM-DD");
      continue;
    }

    // Ensure numeric fields are numbers (not strings)
    if (typeof value === "string" && !isNaN(Number(value)) && value.trim() !== "") {
      const numValue = Number(value);
      if (Number.isFinite(numValue)) {
        transformed[key] = numValue;
        continue;
      }
    }

    // Pass through all other values
    transformed[key] = value;
  }

  return transformed;
}

/**
 * Convert Employee data to form values for prefilling
 * - Converts date strings to Dayjs objects for DatePicker
 * - Ensures numeric fields are numbers
 * - Maps reference data correctly
 */
export function fromEmployeeToFormValues(employee: Employee): any {
  const formValues: any = {};

  // Personal Info
  formValues.full_name = employee.full_name || "";
  formValues.employee_number = (employee as any).employee_number || "";
  formValues.nationality = (employee as any).nationality || "";
  formValues.passport_no = employee.passport || (employee as any).passport_no || "";
  formValues.passport_expiry = (employee as any).passport_expiry 
    ? dayjs((employee as any).passport_expiry) 
    : null;
  formValues.national_id = (employee as any).national_id || "";
  formValues.id_expiry = (employee as any).id_expiry 
    ? dayjs((employee as any).id_expiry) 
    : null;
  formValues.date_of_birth = (employee as any).date_of_birth 
    ? dayjs((employee as any).date_of_birth) 
    : null;
  formValues.mobile = employee.mobile || "";

  // Employment Info
  formValues.department_id = (employee as any).department_id || null;
  formValues.position_id = (employee as any).position_id || null;
  formValues.task_group_id = (employee as any).task_group_id || null;
  formValues.sponsor_id = (employee as any).sponsor_id || null;
  formValues.job_offer = (employee as any).job_offer || "";
  formValues.join_date = ((employee as any).join_date || employee.hire_date) 
    ? dayjs((employee as any).join_date || employee.hire_date) 
    : null;
  formValues.contract_date = (employee as any).contract_date 
    ? dayjs((employee as any).contract_date) 
    : null;
  formValues.contract_expiry = (employee as any).contract_expiry 
    ? dayjs((employee as any).contract_expiry) 
    : null;
  formValues.allowed_overtime = (employee as any).allowed_overtime 
    ? Number((employee as any).allowed_overtime) 
    : null;

  // Documents
  formValues.health_card = (employee as any).health_card || "";
  formValues.health_card_expiry = (employee as any).health_card_expiry 
    ? dayjs((employee as any).health_card_expiry) 
    : null;

  // Salary & Allowances
  formValues.basic_salary = (employee as any).basic_salary 
    ? Number((employee as any).basic_salary) 
    : null;
  formValues.transportation_allowance = (employee as any).transportation_allowance 
    ? Number((employee as any).transportation_allowance) 
    : null;
  formValues.accommodation_allowance = (employee as any).accommodation_allowance 
    ? Number((employee as any).accommodation_allowance) 
    : null;
  formValues.telephone_allowance = (employee as any).telephone_allowance 
    ? Number((employee as any).telephone_allowance) 
    : null;
  formValues.petrol_allowance = (employee as any).petrol_allowance 
    ? Number((employee as any).petrol_allowance) 
    : null;
  formValues.other_allowance = (employee as any).other_allowance 
    ? Number((employee as any).other_allowance) 
    : null;
  formValues.total_salary = (employee as any).total_salary 
    ? Number((employee as any).total_salary) 
    : null;

  return formValues;
}

// Backward compatibility alias
export const transformEmployeeFormValues = toPayload;

