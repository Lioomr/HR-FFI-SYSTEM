import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createMemoryRouter, Link, RouterProvider } from "react-router-dom";
import PayrollSettingsPage from "./PayrollSettingsPage";
import * as api from "../../../../services/api/payrollSettingsApi";
import { setPayrollMocksEnabled } from "../../../../services/api/payrollTransport";
import { resetPayrollMockState } from "../../../../services/api/payrollMocks/handler";
import { useI18nStore } from "../../../../i18n/i18nStore";
import { resolveTranslation } from "../../../../i18n/translate";

beforeEach(async () => {
  setPayrollMocksEnabled(true);
  resetPayrollMockState();
  api.clearPayrollEnumCache();
  await useI18nStore.getState().setLanguage("en");
});
afterEach(() => {
  vi.restoreAllMocks();
  setPayrollMocksEnabled(undefined);
});
function mount() {
  const router = createMemoryRouter(
    [
      {
        path: "/settings",
        element: (
          <>
            <Link to="/other">Leave settings</Link>
            <PayrollSettingsPage />
          </>
        ),
      },
      { path: "/other", element: <p>Other page</p> },
    ],
    { initialEntries: ["/settings"] },
  );
  render(<RouterProvider router={router} />);
  return router;
}
describe("UX3 settings", () => {
  it("counts actual changes and guards navigation until discard", async () => {
    const router = mount();
    const input = await screen.findByLabelText(
      "Non-Saudi employees",
      {},
      { timeout: 8000 },
    );
    expect(
      screen.getByRole("button", { name: "Save settings" }),
    ).toBeDisabled();
    fireEvent.change(input, { target: { value: "3" } });
    await screen.findByText(/1 changes/);
    expect(document.querySelector(".payroll-settings-save")).toBeTruthy();
    fireEvent.click(screen.getByRole("link", { name: "Leave settings" }));
    await screen.findByRole("dialog");
    expect(router.state.location.pathname).toBe("/settings");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(input).toHaveValue("3");
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(screen.getByLabelText("Non-Saudi employees")).toHaveValue("2");
    fireEvent.click(screen.getByRole("link", { name: "Leave settings" }));
    await screen.findByText("Other page");
  });
  it("refetches server settings and bases on language switch while retaining a draft", async () => {
    const get = vi.spyOn(api, "getPayrollSettings");
    const bases = vi.spyOn(api, "getSalaryBases");
    mount();
    const input = await screen.findByLabelText(
      "Non-Saudi employees",
      {},
      { timeout: 8000 },
    );
    fireEvent.change(input, { target: { value: "3" } });
    const reads = get.mock.calls.length;
    const baseReads = bases.mock.calls.length;
    await act(async () => {
      await useI18nStore.getState().setLanguage("ar");
    });
    await waitFor(() => expect(get.mock.calls.length).toBeGreaterThan(reads));
    await waitFor(() =>
      expect(bases.mock.calls.length).toBeGreaterThan(baseReads),
    );
    expect(
      await screen.findByLabelText(
        resolveTranslation("ar", "payroll.ui.foreignGosiRate"),
      ),
    ).toHaveValue("3");
    expect(
      screen.getByRole("button", {
        name: resolveTranslation("ar", "payroll.ui.saveSettings"),
      }),
    ).toBeEnabled();
  });
});
