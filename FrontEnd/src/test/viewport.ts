/**
 * The jsdom shim in setup.ts answers every media query with `matches: false`,
 * which antd reads as a phone: ResponsiveTable then renders cards, not a
 * table. Tests that check desktop-only markup (rows, column headers) switch to
 * a desktop viewport and restore the phone one afterwards.
 */
const phoneMatchMedia = window.matchMedia;

export function setDesktopViewport() {
  window.matchMedia = ((query: string) => ({
    matches: true,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

export function restorePhoneViewport() {
  window.matchMedia = phoneMatchMedia;
}
