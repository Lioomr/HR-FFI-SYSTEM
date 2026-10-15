import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

vi.mock("../../../services/api/loanApi", () => ({
  createLoanRequest: vi.fn(),
  editLoanRequest: vi.fn(),
  getMyLoanRequest: vi.fn(),
  getMyLoanRequests: vi.fn(),
  cancelLoanRequest: vi.fn(),
}));
vi.mock("../../../services/api/employeesApi", () => ({
  getEmployee: vi.fn(),
}));
vi.mock("../../../components/requests/RequestCancellationPanel", () => ({
  default: () => null,
}));
vi.mock("../../../components/requests/PendingActionBanner", () => ({
  default: () => null,
}));
vi.mock("../../../components/loans/LoanApprovalMap", () => ({
  default: () => null,
}));
vi.mock("../../../components/loan/LoanPdfDownloadButton", () => ({
  default: () => null,
}));
vi.mock("../../../components/documents/DocumentIntegrityPanel", () => ({
  default: () => null,
}));

import RequestLoanPage from "./RequestLoanPage";
import MyLoanRequestsPage from "./MyLoanRequestsPage";
import EmployeeLoanRequestDetailsPage from "./LoanRequestDetailsPage";
import * as loanApi from "../../../services/api/loanApi";
import { getEmployee } from "../../../services/api/employeesApi";
import { useI18nStore } from "../../../i18n/i18nStore";

const m = loanApi as unknown as Record<string, ReturnType<typeof vi.fn>>;
const ok = (data: unknown) => ({ status: "success" as const, data });

const existing = {
  id: 9,
  public_reference: "LN-9",
  employee: {
    id: 2,
    email: "a@ffi.test",
    full_name: "Sara",
    employee_profile_id: 2,
  },
  requested_amount: 1200,
  loan_type: "installment",
  installment_months: 3,
  reason: "Rent deposit",
  status: "pending_manager",
  created_at: "2026-10-01T09:00:00Z",
  workflow: { status: "in_review", can_edit: true, history: [] },
};

function Landing() {
  return <div>At {useLocation().pathname}</div>;
}

function renderEdit() {
  return render(
    <MemoryRouter initialEntries={["/employee/loans/9/edit"]}>
      <Routes>
        <Route
          path="/employee/loans/:id/edit"
          element={<RequestLoanPage mode="edit" />}
        />
        <Route path="/employee/loans/:id" element={<Landing />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function clickSave() {
  const save = screen.getByRole("button", { name: /Save changes/ });
  await waitFor(() => expect(save).not.toBeDisabled());
  fireEvent.click(save);
}

beforeEach(() => {
  Object.values(m).forEach((fn) => fn.mockReset());
  vi.mocked(getEmployee).mockReset();
  useI18nStore.getState().setLanguage("en");
  vi.mocked(getEmployee).mockResolvedValue(
    ok({ id: 2, basic_salary: 8000 }) as never,
  );
  m.getMyLoanRequest.mockResolvedValue(ok(existing));
});

describe("RequestLoanPage edit mode", () => {
  it("prefills from the request and PATCHes the changed fields", async () => {
    m.editLoanRequest.mockResolvedValue(ok(existing));
    renderEdit();
    expect(await screen.findByDisplayValue("Rent deposit")).toBeInTheDocument();
    expect(screen.getByDisplayValue("1200.00")).toBeInTheDocument();
    expect(
      screen.getAllByText("You can edit this request until it reaches HR.")[0],
    ).toBeInTheDocument();
    fireEvent.change(screen.getByDisplayValue("Rent deposit"), {
      target: { value: "Rent and fees" },
    });
    await clickSave();
    await waitFor(() =>
      expect(m.editLoanRequest).toHaveBeenCalledWith("9", {
        amount: 1200,
        loan_type: "installment",
        installment_months: 3,
        reason: "Rent and fees",
      }),
    );
    expect(m.createLoanRequest).not.toHaveBeenCalled();
    expect(await screen.findByText("At /employee/loans/9")).toBeInTheDocument();
  });

  it("disables Save when the server says the request is not editable", async () => {
    m.getMyLoanRequest.mockResolvedValue(
      ok({ ...existing, workflow: { ...existing.workflow, can_edit: false } }),
    );
    renderEdit();
    await screen.findByDisplayValue("Rent deposit");
    expect(screen.getByRole("button", { name: /Save changes/ })).toBeDisabled();
  });

  it("shows the server message and refreshes on a not-editable 422", async () => {
    m.editLoanRequest.mockRejectedValue({
      response: {
        status: 422,
        data: {
          status: "error",
          message: "Loan is no longer editable.",
          errors: ["Loan is no longer editable."],
        },
      },
    });
    renderEdit();
    await screen.findByDisplayValue("Rent deposit");
    m.getMyLoanRequest.mockResolvedValue(
      ok({ ...existing, workflow: { ...existing.workflow, can_edit: false } }),
    );
    const calls = m.getMyLoanRequest.mock.calls.length;
    await clickSave();
    expect(
      (await screen.findAllByText("Loan is no longer editable.")).length,
    ).toBeGreaterThan(0);
    await waitFor(() =>
      expect(m.getMyLoanRequest.mock.calls.length).toBeGreaterThan(calls),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Save changes/ }),
      ).toBeDisabled(),
    );
  });

  it("maps field errors onto the form fields", async () => {
    m.editLoanRequest.mockRejectedValue({
      response: {
        status: 422,
        data: {
          status: "error",
          message: "Validation failed",
          errors: [{ field: "amount", message: "Amount is too high." }],
        },
      },
    });
    renderEdit();
    await screen.findByDisplayValue("Rent deposit");
    await clickSave();
    expect(await screen.findByText("Amount is too high.")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Save changes/ }),
    ).not.toBeDisabled();
  });

  it("shows the localized message on 404", async () => {
    m.editLoanRequest.mockRejectedValue({
      response: {
        status: 404,
        data: { status: "error", message: "Not found" },
      },
    });
    renderEdit();
    await screen.findByDisplayValue("Rent deposit");
    await clickSave();
    expect(
      (await screen.findAllByText(/can no longer be edited/)).length,
    ).toBeGreaterThan(0);
  });
});

describe("loan Edit entry points", () => {
  function renderList() {
    return render(
      <MemoryRouter initialEntries={["/employee/loans"]}>
        <Routes>
          <Route path="/employee/loans" element={<MyLoanRequestsPage />} />
          <Route path="/employee/loans/:id/edit" element={<Landing />} />
        </Routes>
      </MemoryRouter>,
    );
  }
  const page = (items: unknown[]) =>
    ok({ items, results: items, count: items.length, page: 1, page_size: 10 });

  it("shows Edit on list rows only when can_edit is true", async () => {
    m.getMyLoanRequests.mockResolvedValue(
      page([
        existing,
        {
          ...existing,
          id: 10,
          public_reference: "LN-10",
          workflow: { status: "in_review", history: [] },
        },
      ]),
    );
    renderList();
    await screen.findByText("LN-9");
    expect(
      screen.getAllByRole("button", { name: "Edit request" }),
    ).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Edit request" }));
    expect(
      await screen.findByText("At /employee/loans/9/edit"),
    ).toBeInTheDocument();
  });

  function renderDetail(item: unknown) {
    m.getMyLoanRequest.mockResolvedValue(ok(item));
    return render(
      <MemoryRouter initialEntries={["/employee/loans/9"]}>
        <Routes>
          <Route
            path="/employee/loans/:id"
            element={<EmployeeLoanRequestDetailsPage />}
          />
          <Route path="/employee/loans/:id/edit" element={<Landing />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it("shows Edit on details when can_edit is true and navigates", async () => {
    renderDetail(existing);
    fireEvent.click(
      await screen.findByRole("button", { name: "Edit request" }),
    );
    expect(
      await screen.findByText("At /employee/loans/9/edit"),
    ).toBeInTheDocument();
  });

  it("hides Edit on details when the flag is false", async () => {
    renderDetail({
      ...existing,
      workflow: { status: "in_review", can_edit: false, history: [] },
    });
    await screen.findByText(/LN-9/);
    expect(
      screen.queryByRole("button", { name: "Edit request" }),
    ).not.toBeInTheDocument();
  });
});
