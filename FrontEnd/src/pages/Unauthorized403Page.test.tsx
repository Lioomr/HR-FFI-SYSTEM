import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import Unauthorized403Page from "./Unauthorized403Page";
import { useI18nStore } from "../i18n/i18nStore";
import { translations } from "../i18n/translations";

function renderAt(state?: unknown) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: "/unauthorized", state }]}>
      <Routes>
        <Route path="/unauthorized" element={<Unauthorized403Page />} />
        <Route path="/" element={<div>Home page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Unauthorized403Page", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useI18nStore.getState().setLanguage("en");
  });

  afterEach(() => {
    vi.useRealTimers();
    useI18nStore.getState().setLanguage("en");
  });

  it("counts down and goes home after 10 seconds", () => {
    renderAt();

    expect(screen.getByText("403 - Unauthorized")).toBeInTheDocument();
    expect(
      screen.getByText("Redirecting you to the home page (10)…"),
    ).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(9000);
    });
    expect(
      screen.getByText("Redirecting you to the home page (1)…"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Home page")).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText("Home page")).toBeInTheDocument();
  });

  it("explains that no employees report to the user", () => {
    renderAt({ reason: "no_direct_reports" });

    expect(
      screen.getByText("Manager access not available"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Ask HR to assign you as a direct manager/),
    ).toBeInTheDocument();
    expect(screen.queryByText("403 - Unauthorized")).not.toBeInTheDocument();
  });

  it("shows the reason and countdown in Arabic", () => {
    useI18nStore.getState().setLanguage("ar");

    renderAt({ reason: "no_direct_reports" });

    expect(
      screen.getByText(translations.ar["manager.access.forbiddenTitle"]),
    ).toBeInTheDocument();
    expect(
      screen.getByText(translations.ar["manager.access.forbiddenDesc"]),
    ).toBeInTheDocument();
    expect(
      screen.getByText("جارٍ إعادة توجيهك إلى الصفحة الرئيسية (10)…"),
    ).toBeInTheDocument();
  });
});
