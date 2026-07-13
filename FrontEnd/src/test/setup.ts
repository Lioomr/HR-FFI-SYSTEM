import '@testing-library/jest-dom';
import { vi } from 'vitest';

// ── jsdom polyfills required by Ant Design components ────────────────────────
// antd's responsive observer, waves, and some overlays rely on browser APIs
// that jsdom does not implement. Provide minimal shims so component tests run.

if (!window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // deprecated
    removeListener: vi.fn(), // deprecated
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

if (!('ResizeObserver' in globalThis)) {
  class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
    ResizeObserver;
}
