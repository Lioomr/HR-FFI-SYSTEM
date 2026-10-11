/** Localize the shared server error without hiding other password policy advice. */
export function localizePasswordError(
  message: string | undefined,
  t: (key: string) => string,
) {
  return message ===
    "New password must be different from your current password."
    ? t("changePassword.samePassword")
    : message;
}
