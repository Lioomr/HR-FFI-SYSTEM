import type { MenuProps } from "antd";

/**
 * Resolves the sidebar entry to highlight for a path.
 *
 * Menu keys are route prefixes, so the longest matching key wins — that keeps
 * `/ceo/team-requests` on its own entry rather than lighting up `/ceo/team`,
 * and keeps detail routes highlighted on their list entry.
 *
 * Group items carry no `key` of their own; the walk must still descend into
 * them, otherwise every entry nested under a section heading is invisible here
 * and nothing highlights unless the path matches an item key exactly.
 */
export function getSelectedKey(
  pathname: string,
  items: MenuProps["items"],
): string {
  if (!items) return pathname;
  let longestMatch = pathname;
  let longestMatchLength = 0;
  const checkItems = (menuItems: MenuProps["items"]) => {
    menuItems?.forEach((item) => {
      if (!item || typeof item !== "object") return;
      const key = (item as { key?: unknown }).key;
      if (
        typeof key === "string" &&
        pathname.startsWith(key) &&
        key.length > longestMatchLength
      ) {
        longestMatch = key;
        longestMatchLength = key.length;
      }
      const children = (item as { children?: MenuProps["items"] }).children;
      if (children) checkItems(children);
    });
  };
  checkItems(items);
  return longestMatch;
}

/** Group heading used by every role's sidebar. */
export function sectionLabel(title: string) {
  return <span>{title}</span>;
}
