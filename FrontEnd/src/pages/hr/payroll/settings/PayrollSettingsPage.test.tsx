import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Modal } from "antd";

import PayrollSettingsPage from "./PayrollSettingsPage";
import { setPayrollMocksEnabled } from "../../../../services/api/payrollTransport";
import {
  payrollMockState,
  resetPayrollMockState,
} from "../../../../services/api/payrollMocks/handler";
import { clearPayrollEnumCache } from "../../../../services/api/payrollSettingsApi";
import { useI18nStore } from "../../../../i18n/i18nStore";
import { resolveTranslation } from "../../../../i18n/translate";

const FIND = { timeout: 8000 };
const en = (key: string, params?: Record<string, unknown>) =>
  resolveTranslation("en", key, params);

function renderPage() {
  return render(
    <MemoryRouter>
      <PayrollSettingsPage />
    </MemoryRouter>,
  );
}

async function openReasonModal() {
  fireEvent.click(
    screen.getByRole("radio", {
      name: "Prorated by payable days",
    }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: en("payroll.ui.saveSettings") }),
  );
  return screen.findByRole("dialog", {}, FIND);
}

beforeEach(() => {
  setPayrollMocksEnabled(true);
  resetPayrollMockState();
  clearPayrollEnumCache();
  useI18nStore.getState().setLanguage("en");
});

afterEach(() => {
  Modal.destroyAll();
  setPayrollMocksEnabled(undefined);
  useI18nStore.getState().setLanguage("en");
});

describe("PayrollSettingsPage", () => {
  it("renders initial history whose original value is null without crashing", async () => {
    const state = payrollMockState();
    state.settingsHistory = [
      {
        id: 999,
        audit_log_id: 999,
        type: "SETTINGS_CHANGE",
        actor: null,
        created_at: "2026-10-14T09:00:00Z",
        reason: "Initial settings",
        changed_fields: ["absence_base"],
        original_value: null as unknown as Record<string, unknown>,
        new_value: { absence_base: { type: "GROSS", fixed_amount: null } },
      },
    ];
    renderPage();
    await screen.findByText(
      en("payroll.ui.revisionTag", { revision: 2 }),
      {},
      FIND,
    );
    fireEvent.click(screen.getByRole("button", { name: "Change history" }));
    const dialog = await screen.findByRole("dialog", {}, FIND);
    expect(
      await within(dialog).findByText("Initial settings", {}, FIND),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText("GROSS", { exact: false }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Something went wrong")).toBeNull();
  });

  it("shows the settings with rates as percentages and the API assumptions", async () => {
    renderPage();
    expect(
      await screen.findByText(
        en("payroll.ui.revisionTag", { revision: 2 }),
        {},
        FIND,
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(en("payroll.ui.foreignGosiRate"))).toHaveValue(
      "2",
    );
    expect(screen.getByLabelText(en("payroll.ui.saudiGosiRate"))).toHaveValue(
      "9.75",
    );
    // v0.5.3 retired the "proration pending confirmation" assumption.
    expect(screen.queryByText(/awaits user confirmation/)).toBeNull();
    fireEvent.click(screen.getByText(en("payroll.employee.notes")));
    // Other API assumptions are rendered as sent.
    expect(
      screen.getByText(
        "Normal overtime limit is per calendar month (assumption).",
      ),
    ).toBeInTheDocument();
  });

  it("shows the fixed amount field only for FIXED_AMOUNT bases", async () => {
    payrollMockState().settings.overtime_base = {
      type: "FIXED_AMOUNT",
      fixed_amount: "4000.00",
    };
    renderPage();
    const amounts = await screen.findAllByLabelText(
      new RegExp(en("payroll.ui.fixedMonthlyAmount")),
      {},
      FIND,
    );
    expect(amounts).toHaveLength(1);
    expect(amounts[0]).toHaveValue("4000");
  });

  it("separates an unknown medical invoice from no insurance", async () => {
    payrollMockState().settings.annual_medical_invoice = null;
    renderPage();
    expect(
      await screen.findByText(en("payroll.ui.medicalUnknownNote"), {}, FIND),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: en("payroll.ui.medicalUnknown") }),
    ).toBeChecked();
    expect(
      screen.getByRole("radio", { name: en("payroll.ui.medicalNone") }),
    ).not.toBeChecked();
  });

  it("requires a reason before saving", async () => {
    renderPage();
    await screen.findByText(
      en("payroll.ui.revisionTag", { revision: 2 }),
      {},
      FIND,
    );
    const dialog = await openReasonModal();
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: en("payroll.ui.saveSettings"),
      }),
    );
    expect(
      await within(dialog).findByText(
        en("payroll.ui.reasonRequired"),
        {},
        FIND,
      ),
    ).toBeInTheDocument();
    expect(payrollMockState().settings.settings_revision).toBe(2);
  });

  it("saves a sparse change with the reason and the loaded revision", async () => {
    renderPage();
    await screen.findByText(
      en("payroll.ui.revisionTag", { revision: 2 }),
      {},
      FIND,
    );
    const dialog = await openReasonModal();
    fireEvent.change(
      within(dialog).getByLabelText(en("payroll.ui.reasonLabel")),
      {
        target: { value: "Board approved proration" },
      },
    );
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: en("payroll.ui.saveSettings"),
      }),
    );
    expect(
      await screen.findByText(
        en("payroll.ui.revisionTag", { revision: 3 }),
        {},
        FIND,
      ),
    ).toBeInTheDocument();
    const state = payrollMockState();
    expect(state.settings.provision_proration).toBe("PRORATED_BY_DAYS");
    expect(state.settingsHistory[0]).toMatchObject({
      changed_fields: ["provision_proration"],
      reason: "Board approved proration",
    });
  });

  it("stops on a stale revision, reloads and never retries silently", async () => {
    renderPage();
    await screen.findByText(
      en("payroll.ui.revisionTag", { revision: 2 }),
      {},
      FIND,
    );
    // Someone else saves first.
    payrollMockState().settings.settings_revision = 5;

    const dialog = await openReasonModal();
    fireEvent.change(
      within(dialog).getByLabelText(en("payroll.ui.reasonLabel")),
      {
        target: { value: "My change" },
      },
    );
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: en("payroll.ui.saveSettings"),
      }),
    );

    expect(
      await screen.findByText(
        "Payroll data changed; reload and retry.",
        {},
        FIND,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(en("payroll.ui.staleDescription")),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(
        en("payroll.ui.revisionTag", { revision: 5 }),
        {},
        FIND,
      ),
    ).toBeInTheDocument();
    // Nothing was written and the user's edit was not re-sent.
    const state = payrollMockState();
    expect(state.settings.provision_proration).toBe("FULL_MONTH");
    expect(state.settingsHistory).toHaveLength(0);
    await waitFor(() =>
      expect(
        screen.getByRole("radio", { name: "Prorated by payable days" }),
      ).toBeChecked(),
    );
  });

  it("renders in Arabic (RTL smoke test)", async () => {
    useI18nStore.getState().setLanguage("ar");
    renderPage();
    expect(
      await screen.findByText(
        resolveTranslation("ar", "payroll.ui.salaryBasesTitle"),
        {},
        FIND,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText(resolveTranslation("ar", "payroll.ui.settingsTitle"))
        .length,
    ).toBeGreaterThan(0);
  });
});
