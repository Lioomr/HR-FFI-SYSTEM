export function localizeManagerAssignmentError(
  message: string | null,
  translate: (key: string) => string,
): string | null {
  if (!message) return null;
  if (message.includes("already assigned to this employee")) {
    return translate("employees.form.managerErrors.duplicate");
  }
  if (message.includes("must belong to the employee's company")) {
    return translate("employees.form.managerErrors.company");
  }
  if (
    message.includes("cannot be an employee's own manager") ||
    message.includes("cannot be their own manager")
  ) {
    return translate("employees.form.managerErrors.self");
  }
  if (message.includes("manager is archived")) {
    return translate("employees.form.managerErrors.archived");
  }
  if (message.includes("must be an active employee")) {
    return translate("employees.form.managerErrors.inactive");
  }
  if (message.includes("reporting cycle")) {
    return translate("employees.form.managerErrors.cycle");
  }
  return message;
}
