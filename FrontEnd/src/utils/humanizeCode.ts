/** "hr_completion" -> "Hr completion": last-resort label for an untranslated backend code. */
export function humanizeCode(code?: string | null): string {
  const text = (code ?? "").replace(/[_.]+/g, " ").trim().toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Translation lookup that falls back to a humanized code instead of the raw key. */
export function labelFromCode(
  t: (key: string) => string,
  prefix: string,
  code?: string | null,
): string {
  const key = `${prefix}.${code ?? ""}`;
  const translated = t(key);
  return translated === key ? humanizeCode(code) : translated;
}
