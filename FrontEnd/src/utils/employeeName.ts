/** Compact UI name; full identity remains in API data and employee records. */
export function shortEmployeeName(name?: string | null): string {
  return (name ?? "").trim().split(/\s+/).slice(0, 2).join(" ");
}
