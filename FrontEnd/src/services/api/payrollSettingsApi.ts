import { useI18nStore } from "../../i18n/i18nStore";
import { payrollData } from "./payrollTransport";
import type {
  EmployeePayrollConfig,
  EmployeePayrollConfigPatch,
  EnumOption,
  HistoryParams,
  PayrollEnums,
  PayrollHistoryEntry,
  PayrollPage,
  PayrollSettings,
  PayrollSettingsPatch,
  SalaryBaseType,
} from "./payrollTypes";

/**
 * Company payroll settings, employee GOSI configuration and the enum directory
 * (contract section 7.1). All endpoints use the strict active company that
 * apiClient sends in X-Active-Company-Id.
 */

/** GET /payroll-settings/ -> S. Never creates settings; defaults have revision 0. */
export function getPayrollSettings(): Promise<PayrollSettings> {
  return payrollData({ method: "GET", url: "/payroll-settings/" });
}

/** PATCH /payroll-settings/ (sparse; reason + expected_revision) -> S */
export function updatePayrollSettings(
  payload: PayrollSettingsPatch,
): Promise<PayrollSettings> {
  return payrollData({
    method: "PATCH",
    url: "/payroll-settings/",
    data: payload,
  });
}

/** GET /payroll-settings/salary-bases/ -> fixed enum list. */
export async function getSalaryBases(): Promise<EnumOption<SalaryBaseType>[]> {
  const data = await payrollData<{ items: EnumOption<SalaryBaseType>[] }>({
    method: "GET",
    url: "/payroll-settings/salary-bases/",
  });
  return data.items;
}

/** GET /payroll-settings/history/ -> page of H (settings form). */
export function getPayrollSettingsHistory(
  query: HistoryParams = {},
): Promise<PayrollPage<PayrollHistoryEntry>> {
  return payrollData({
    method: "GET",
    url: "/payroll-settings/history/",
    params: { ...query },
  });
}

/** GET /payroll-settings/employees/{employee_profile_id}/ */
export function getEmployeePayrollConfig(
  employeeProfileId: number | string,
): Promise<EmployeePayrollConfig> {
  return payrollData({
    method: "GET",
    url: `/payroll-settings/employees/${employeeProfileId}/`,
  });
}

/** PATCH /payroll-settings/employees/{employee_profile_id}/ */
export function updateEmployeePayrollConfig(
  employeeProfileId: number | string,
  payload: EmployeePayrollConfigPatch,
): Promise<EmployeePayrollConfig> {
  return payrollData({
    method: "PATCH",
    url: `/payroll-settings/employees/${employeeProfileId}/`,
    data: payload,
  });
}

/** GET /payroll-settings/employees/{employee_profile_id}/history/ */
export function getEmployeePayrollConfigHistory(
  employeeProfileId: number | string,
  query: HistoryParams = {},
): Promise<PayrollPage<PayrollHistoryEntry>> {
  return payrollData({
    method: "GET",
    url: `/payroll-settings/employees/${employeeProfileId}/history/`,
    params: { ...query },
  });
}

// The enum directory is static per deploy and language, so one request per
// language per session is enough. Labels follow Accept-Language.
const enumCache = new Map<string, Promise<PayrollEnums>>();

/** GET /payroll-settings/enums/ (cached per UI language). */
export function getPayrollEnums(): Promise<PayrollEnums> {
  const language = useI18nStore.getState().language;
  let cached = enumCache.get(language);
  if (!cached) {
    cached = payrollData<PayrollEnums>({
      method: "GET",
      url: "/payroll-settings/enums/",
    });
    cached.catch(() => enumCache.delete(language));
    enumCache.set(language, cached);
  }
  return cached;
}

/** Test hook. */
export function clearPayrollEnumCache(): void {
  enumCache.clear();
}
