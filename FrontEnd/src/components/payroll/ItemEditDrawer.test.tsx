import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import ItemEditDrawer from "./ItemEditDrawer";
import { setPayrollMocksEnabled } from "../../services/api/payrollTransport";
import {
  payrollMockState,
  resetPayrollMockState,
} from "../../services/api/payrollMocks/handler";
import { clearPayrollEnumCache } from "../../services/api/payrollSettingsApi";
import { useI18nStore } from "../../i18n/i18nStore";
import { resolveTranslation } from "../../i18n/translate";
import type { PayrollStatus } from "../../services/api/payrollTypes";

const FIND = { timeout: 8000 };
const en = (key: string) => resolveTranslation("en", key);

function renderDrawer(runStatus: PayrollStatus = "DRAFT") {
  const onChanged = vi.fn();
  render(
    <MemoryRouter>
      <ItemEditDrawer
        runId={7}
        itemId={71}
        runStatus={runStatus}
        open
        onClose={() => undefined}
        onChanged={onChanged}
      />
    </MemoryRouter>,
  );
  return onChanged;
}

beforeEach(() => {
  setPayrollMocksEnabled(true);
  resetPayrollMockState();
  clearPayrollEnumCache();
  useI18nStore.getState().setLanguage("en");
});

afterEach(() => {
  setPayrollMocksEnabled(undefined);
});

describe("ItemEditDrawer", () => {
  it("shows observed absence evidence read-only", async () => {
    renderDrawer();
    const drawer = await screen.findByRole("dialog", {}, FIND);
    expect(
      await within(drawer).findByText(
        en("payroll.ui.observedAbsentDays"),
        {},
        FIND,
      ),
    ).toBeInTheDocument();
    expect(
      within(drawer).getByText(en("payroll.ui.attendanceCovered")),
    ).toBeInTheDocument();
  });

  it("requires a reason and sends a sparse change with the run revision", async () => {
    const onChanged = renderDrawer();
    const drawer = await screen.findByRole("dialog", {}, FIND);
    const hours = await within(drawer).findByLabelText(
      en("payroll.ui.overtimeNormalHours"),
      {},
      FIND,
    );
    fireEvent.change(hours, { target: { value: "4" } });

    fireEvent.click(
      within(drawer).getByRole("button", { name: en("payroll.ui.saveItem") }),
    );
    expect(
      await within(drawer).findByText(
        en("payroll.ui.reasonRequired"),
        {},
        FIND,
      ),
    ).toBeInTheDocument();
    expect(payrollMockState().runs[0].revision).toBe(1);

    fireEvent.change(
      within(drawer).getByLabelText(en("payroll.ui.reasonLabel")),
      {
        target: { value: "Approved extra work" },
      },
    );
    fireEvent.click(
      within(drawer).getByRole("button", { name: en("payroll.ui.saveItem") }),
    );

    await waitFor(() => expect(payrollMockState().runs[0].revision).toBe(2));
    const item = payrollMockState().items.get(7)![0];
    expect(item.overtime.normal_hours).toBe("4.00");
    // Untouched fields were not sent.
    expect(item.absence.override_days).toBeNull();
    expect(onChanged).toHaveBeenCalled();
  });

  it("stops on stale_revision and keeps the server data", async () => {
    renderDrawer();
    const drawer = await screen.findByRole("dialog", {}, FIND);
    const bonus = await within(drawer).findByLabelText(
      en("payroll.line.bonus"),
      {},
      FIND,
    );
    payrollMockState().runs[0].revision = 9;
    fireEvent.change(bonus, { target: { value: "250" } });
    fireEvent.change(
      within(drawer).getByLabelText(en("payroll.ui.reasonLabel")),
      {
        target: { value: "Bonus" },
      },
    );
    fireEvent.click(
      within(drawer).getByRole("button", { name: en("payroll.ui.saveItem") }),
    );
    expect(
      await within(drawer).findByText(
        "Payroll data changed; reload and retry.",
        {},
        FIND,
      ),
    ).toBeInTheDocument();
    expect(payrollMockState().runs[0].revision).toBe(9);
  });

  it("edits the run-only monthly salary and sends only the changed key", async () => {
    renderDrawer();
    const drawer = await screen.findByRole("dialog", {}, FIND);
    expect(
      await within(drawer).findByText(
        en("payroll.ui.monthlySalaryTitle"),
        {},
        FIND,
      ),
    ).toBeInTheDocument();
    const basic = within(drawer).getByLabelText(
      en("payroll.line.basic_salary"),
    );
    expect(basic).toHaveValue("6000");
    fireEvent.change(basic, { target: { value: "6100" } });
    fireEvent.change(
      within(drawer).getByLabelText(en("payroll.ui.reasonLabel")),
      {
        target: { value: "Approved run-only salary correction" },
      },
    );
    fireEvent.click(
      within(drawer).getByRole("button", { name: en("payroll.ui.saveItem") }),
    );
    await waitFor(() => expect(payrollMockState().runs[0].revision).toBe(2));
    const item = payrollMockState().items.get(7)![0];
    expect(item.monthly_salary_components).toMatchObject({
      basic_salary: "6100.00",
      accommodation_allowance: "3000.00",
    });
    expect(item.salary_adjusted).toBe(true);
    expect(
      await within(drawer).findByText(
        en("payroll.ui.salaryAdjusted"),
        {},
        FIND,
      ),
    ).toBeInTheDocument();
  });

  it("prefills the entered amount and shows the posted line as evidence", async () => {
    const item = payrollMockState().items.get(7)![0];
    item.manual_inputs.bonus = "250.50";
    item.bonus = "251.00";
    item.additions.push({
      id: 990,
      type: "BONUS",
      label: "Bonus",
      label_key: "payroll.line.bonus",
      amount: "251.00",
      quantity: null,
      source_kind: "manual_adjustment",
      source_id: null,
      source_period: { year: 2026, month: 9 },
      requested_amount: "251.00",
      collected_amount: "251.00",
      uncollected_amount: "0.00",
      carried_in: false,
    });
    renderDrawer();
    const drawer = await screen.findByRole("dialog", {}, FIND);
    const bonus = await within(drawer).findByLabelText(
      en("payroll.line.bonus"),
      {},
      FIND,
    );
    expect(bonus).toHaveValue("250.50");
    expect(
      within(drawer).getByText((content) =>
        content.includes(en("payroll.ui.postedAmount")),
      ),
    ).toBeInTheDocument();
    expect(within(drawer).getAllByText("251").length).toBeGreaterThan(0);
  });

  it("is read-only for a finalized run", async () => {
    renderDrawer("COMPLETED");
    const drawer = await screen.findByRole("dialog", {}, FIND);
    expect(
      await within(drawer).findByText(en("payroll.ui.itemReadOnly"), {}, FIND),
    ).toBeInTheDocument();
    expect(
      within(drawer).queryByRole("button", { name: en("payroll.ui.saveItem") }),
    ).toBeNull();
  });
});
