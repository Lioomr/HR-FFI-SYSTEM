type Translate = (
  key: string,
  params?: Record<string, any> | string,
  fallback?: string,
) => string;

/**
 * Team-size caption for manager surfaces. The translator does simple token
 * replacement, so the zero/one forms are separate keys.
 */
export function managedCountLabel(t: Translate, count: number): string {
  if (count <= 0) return t("manager.capability.managedCountNone");
  if (count === 1) return t("manager.capability.managedCountOne");
  return t("manager.capability.managedCount", { count });
}
