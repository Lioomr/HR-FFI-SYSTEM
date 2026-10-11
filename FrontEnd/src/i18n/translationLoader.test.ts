import { beforeEach, describe, expect, it, vi } from "vitest";

// test/setup.ts registers both languages for every suite; a fresh module graph
// shows what the browser sees at startup: nothing loaded until asked for.
beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
});

describe("translationLoader", () => {
  it("loads a language on demand and keeps it", async () => {
    const loader = await import("./translationLoader");
    expect(loader.getTranslations("ar")).toBeUndefined();

    await loader.loadTranslations("ar");

    expect(loader.getTranslations("ar")?.["language.label"]).toBe("اللغة");
    expect(loader.getTranslations("en")).toBeUndefined();
  });
});

describe("language switching", () => {
  it("keeps the current language until the new strings have loaded", async () => {
    const { useI18nStore } = await import("./i18nStore");
    expect(useI18nStore.getState().language).toBe("en");

    useI18nStore.getState().setLanguage("ar");
    expect(useI18nStore.getState().language).toBe("en");

    await vi.waitFor(() => expect(useI18nStore.getState().language).toBe("ar"));
    expect(useI18nStore.getState().direction).toBe("rtl");
    expect(localStorage.getItem("ffi_app_language")).toBe("ar");
  });
});
