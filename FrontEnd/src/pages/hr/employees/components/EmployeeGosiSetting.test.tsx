import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { Modal } from "antd";

import EmployeeGosiSetting from "./EmployeeGosiSetting";
import { setPayrollMocksEnabled } from "../../../../services/api/payrollTransport";
import {
  payrollMockState,
  resetPayrollMockState,
} from "../../../../services/api/payrollMocks/handler";
import { clearPayrollEnumCache } from "../../../../services/api/payrollSettingsApi";
import { useI18nStore } from "../../../../i18n/i18nStore";
import { resolveTranslation } from "../../../../i18n/translate";

const FIND = { timeout: 8000 };
const en = (key: string) => resolveTranslation("en", key);

async function toggleOn() {
  const toggle = await screen.findByRole(
    "switch",
    { name: en("payroll.ui.gosiFlagLabel") },
    FIND,
  );
  await waitFor(() => expect(toggle).not.toBeDisabled());
  fireEvent.click(toggle);
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
});

describe("EmployeeGosiSetting", () => {
  it("requires a reason and sends the employee-config revision", async () => {
    render(<EmployeeGosiSetting employeeProfileId={101} />);
    const dialog = await toggleOn();
    fireEvent.click(
      within(dialog).getByRole("button", { name: en("common.save") }),
    );
    expect(
      await within(dialog).findByText(
        en("payroll.ui.reasonRequired"),
        {},
        FIND,
      ),
    ).toBeInTheDocument();
    expect(payrollMockState().employeeConfigs.get(101)?.settings_revision).toBe(
      0,
    );

    fireEvent.change(
      within(dialog).getByLabelText(en("payroll.ui.reasonLabel")),
      {
        target: { value: "Employee GOSI bearing arrangement confirmed" },
      },
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: en("common.save") }),
    );

    await waitFor(() =>
      expect(payrollMockState().employeeConfigs.get(101)).toMatchObject({
        deduct_gosi_from_employee: true,
        settings_revision: 1,
      }),
    );
    expect(
      screen.getByRole("switch", { name: en("payroll.ui.gosiFlagLabel") }),
    ).toBeChecked();
  });

  it("keeps the old value when the reason modal is cancelled", async () => {
    render(<EmployeeGosiSetting employeeProfileId={101} />);
    const dialog = await toggleOn();
    fireEvent.click(
      within(dialog).getByRole("button", { name: en("common.cancel") }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("switch", { name: en("payroll.ui.gosiFlagLabel") }),
      ).not.toBeChecked(),
    );
  });

  it("shows the stale-revision message and reloads instead of retrying", async () => {
    render(<EmployeeGosiSetting employeeProfileId={101} />);
    const dialog = await toggleOn();
    // Another HR user changed the flag meanwhile.
    payrollMockState().employeeConfigs.set(101, {
      employee_profile_id: 101,
      employee_id: "EMP-001",
      deduct_gosi_from_employee: false,
      settings_revision: 4,
    });
    fireEvent.change(
      within(dialog).getByLabelText(en("payroll.ui.reasonLabel")),
      {
        target: { value: "Change" },
      },
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: en("common.save") }),
    );

    expect(
      await screen.findByText(
        "Payroll data changed; reload and retry.",
        {},
        FIND,
      ),
    ).toBeInTheDocument();
    expect(payrollMockState().employeeConfigs.get(101)).toMatchObject({
      deduct_gosi_from_employee: false,
      settings_revision: 4,
    });
  });
});
