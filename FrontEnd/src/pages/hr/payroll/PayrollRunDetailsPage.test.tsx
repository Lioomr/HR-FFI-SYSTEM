import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Modal } from "antd";

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ run_id: "5" }),
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
}));
vi.mock("../../../services/api/payrollApi", () => ({
  getPayrollRunDetails: vi.fn(),
  getPayrollRunItems: vi.fn(),
  getPayrollRunSummary: vi.fn(),
  finalizePayrollRun: vi.fn(),
}));
vi.mock("./PayrollPayslips", () => ({ default: () => null }));
vi.mock("./PayrollReports", () => ({ default: () => null }));

import PayrollRunDetailsPage from "./PayrollRunDetailsPage";
import {
  finalizePayrollRun,
  getPayrollRunDetails,
  getPayrollRunItems,
  getPayrollRunSummary,
} from "../../../services/api/payrollApi";
import type {
  PayrollRun,
  PayrollRunSummary,
} from "../../../services/api/payrollApi";
import { useI18nStore } from "../../../i18n/i18nStore";
import { resolveTranslation } from "../../../i18n/translate";

const en = (key: string) => resolveTranslation("en", key);

const run = (status: string): PayrollRun => ({
  id: 5,
  year: 2026,
  month: 9,
  status,
  total_net: 1000,
  total_employees: 1,
});

const summary: PayrollRunSummary = {
  run_id: 5,
  year: 2026,
  month: 9,
  total_employees: 1,
  employees_with_deductions: 1,
  total_basic_salary: 1000,
  total_allowances: 0,
  total_gross_salary: 1000,
  total_deductions: 5,
  total_net_salary: 995,
  average_net_salary: 995,
};

beforeEach(() => {
  vi.clearAllMocks();
  useI18nStore.getState().setLanguage("en");
  vi.mocked(getPayrollRunDetails)
    .mockResolvedValueOnce({ status: "success", data: run("DRAFT") })
    .mockResolvedValue({ status: "success", data: run("COMPLETED") });
  vi.mocked(getPayrollRunItems).mockResolvedValue({
    status: "success",
    data: { items: [], count: 0 },
  });
  vi.mocked(getPayrollRunSummary).mockResolvedValue({
    status: "success",
    data: summary,
  });
  vi.mocked(finalizePayrollRun).mockResolvedValue({
    status: "success",
    data: { message: "Payroll run finalized." } as unknown as PayrollRun,
  });
});

afterEach(() => {
  Modal.destroyAll();
});

describe("payroll finalization", () => {
  it("warns that attendance penalties are included, then refetches the run", async () => {
    render(<PayrollRunDetailsPage />);

    fireEvent.click(
      await screen.findByRole("button", {
        name: new RegExp(en("payroll.runDetails.finalizeBtn")),
      }),
    );

    expect(
      await screen.findByText(en("payroll.runDetails.finalizeAttendanceNote")),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", {
        name: en("payroll.runDetails.finalizeConfirmOkBtn"),
      }),
    );

    await waitFor(() => expect(finalizePayrollRun).toHaveBeenCalledWith(5));
    await waitFor(() => expect(getPayrollRunDetails).toHaveBeenCalledTimes(2));
    expect(getPayrollRunItems).toHaveBeenCalledTimes(2);
    expect(getPayrollRunSummary).toHaveBeenCalledTimes(2);
    expect(await screen.findByText("COMPLETED")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: new RegExp(en("payroll.runDetails.finalizeBtn")),
      }),
    ).not.toBeInTheDocument();
  });
});
