/**
 * Maps the backend's `manager_profile_id` rejection messages onto translated
 * text. Unknown messages are returned unchanged.
 */
export function localizeManagerAssignmentError(
  message: string | null,
  translate: (key: string) => string,
): string | null {
  if (!message) return null;
  if (
    message.includes("cannot be an employee's own manager") ||
    message.includes("cannot be their own manager")
  ) {
    return translate("employees.form.managerErrors.self");
  }
  if (message.includes("archived employee cannot be assigned a manager")) {
    return translate("employees.form.managerErrors.employeeArchived");
  }
  if (message.includes("manager is archived")) {
    return translate("employees.form.managerErrors.archived");
  }
  if (message.includes("must be linked to")) {
    return translate("employees.form.managerErrors.noLogin");
  }
  if (message.includes("must be an active employee")) {
    return translate("employees.form.managerErrors.inactive");
  }
  if (message.includes("reporting cycle")) {
    return translate("employees.form.managerErrors.cycle");
  }
  return message;
}
