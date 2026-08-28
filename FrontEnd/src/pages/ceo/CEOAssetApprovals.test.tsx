import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../../services/api/assetsApi", () => ({
  getCEOAssetDamageReports: vi.fn(),
  approveCEOAssetDamageReport: vi.fn(),
  rejectCEOAssetDamageReport: vi.fn(),
  getCEOAssetReturnRequests: vi.fn(),
  approveCEOAssetReturnRequest: vi.fn(),
  rejectCEOAssetReturnRequest: vi.fn(),
}));

vi.mock("../../components/assets/AssetReturnApprovalMap", () => ({
  default: () => <div data-testid="asset-return-approval-map" />,
}));

import CEOAssetDamageReportsPage from "./CEOAssetDamageReportsPage";
import CEOAssetReturnRequestsPage from "./CEOAssetReturnRequestsPage";
import * as assetsApi from "../../services/api/assetsApi";
import { useI18nStore } from "../../i18n/i18nStore";
import { useAuthStore } from "../../auth/authStore";

const getDamage = assetsApi.getCEOAssetDamageReports as unknown as ReturnType<
  typeof vi.fn
>;
const approveDamage =
  assetsApi.approveCEOAssetDamageReport as unknown as ReturnType<typeof vi.fn>;
const rejectDamage =
  assetsApi.rejectCEOAssetDamageReport as unknown as ReturnType<typeof vi.fn>;
const getReturns = assetsApi.getCEOAssetReturnRequests as unknown as ReturnType<
  typeof vi.fn
>;

const damageRow = {
  id: 12,
  asset: 3,
  asset_code: "LAP-004",
  asset_name: "ThinkPad X1",
  employee: 7,
  employee_name: "Sara Ahmed",
  employee_email: "sara@ffi.test",
  description: "Cracked screen after a fall.",
  status: "PENDING_CEO" as const,
  reported_at: "2026-08-01T09:00:00Z",
};

const returnRow = {
  id: 88,
  asset: 5,
  asset_code: "PHN-011",
  asset_name: "iPhone 15",
  employee: 9,
  employee_name: "Omar Nasser",
  note: "Leaving the company.",
  status: "PENDING_CEO" as const,
  requested_at: "2026-08-02T09:00:00Z",
};

const ok = (items: unknown[]) => ({
  status: "success" as const,
  data: { items, count: items.length },
});

beforeEach(() => {
  [getDamage, approveDamage, rejectDamage, getReturns].forEach((fn) =>
    fn.mockReset(),
  );
  useI18nStore.getState().setLanguage("en");
  useAuthStore.setState({
    isAuthenticated: true,
    user: { id: "1", email: "ceo@ffi.test", role: "CEO" },
  });
});

describe("CEO asset approval queues", () => {
  it("renders damage reports with a labelled status and decision pair", async () => {
    getDamage.mockResolvedValue(ok([damageRow]));

    render(<CEOAssetDamageReportsPage />);

    expect(await screen.findByText("LAP-004")).toBeInTheDocument();
    expect(screen.getByText("Sara Ahmed")).toBeInTheDocument();
    // Status reads as words, not a bare backend enum.
    expect(screen.getByText("Pending CEO")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Approve: Sara Ahmed" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Reject: Sara Ahmed" }),
    ).toBeInTheDocument();
  });

  it("shows the empty state when no damage report is awaiting approval", async () => {
    getDamage.mockResolvedValue(ok([]));

    render(<CEOAssetDamageReportsPage />);

    expect(
      await screen.findByText("No damage reports awaiting approval"),
    ).toBeInTheDocument();
  });

  it("shows a retryable error state when the queue fails", async () => {
    getDamage.mockResolvedValue({
      status: "error" as const,
      message: "asset service down",
    });

    render(<CEOAssetDamageReportsPage />);

    expect(await screen.findByText("asset service down")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("confirms an approval and reloads the queue", async () => {
    getDamage.mockResolvedValue(ok([damageRow]));
    approveDamage.mockResolvedValue({
      status: "success" as const,
      data: damageRow,
    });

    render(<CEOAssetDamageReportsPage />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Approve: Sara Ahmed" }),
    );
    expect(await screen.findByText("Approve request")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() =>
      expect(approveDamage).toHaveBeenCalledWith(12, "Approved by CEO"),
    );
    await waitFor(() => expect(getDamage).toHaveBeenCalledTimes(2));
  });

  it("sends the CEO's own note when one is written", async () => {
    getDamage.mockResolvedValue(ok([damageRow]));
    approveDamage.mockResolvedValue({
      status: "success" as const,
      data: damageRow,
    });

    render(<CEOAssetDamageReportsPage />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Approve: Sara Ahmed" }),
    );
    await screen.findByText("Approve request");
    fireEvent.change(screen.getByLabelText("Decision note (optional)"), {
      target: { value: "Replace under warranty" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() =>
      expect(approveDamage).toHaveBeenCalledWith(12, "Replace under warranty"),
    );
  });

  it("blocks a rejection until a reason is written", async () => {
    getDamage.mockResolvedValue(ok([damageRow]));
    rejectDamage.mockResolvedValue({
      status: "success" as const,
      data: damageRow,
    });

    render(<CEOAssetDamageReportsPage />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Reject: Sara Ahmed" }),
    );
    expect(await screen.findByText("Reject damage report")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(
      await screen.findByText("A rejection reason is required."),
    ).toBeInTheDocument();
    expect(rejectDamage).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Reason for rejection"), {
      target: { value: "Employee negligence" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));

    await waitFor(() =>
      expect(rejectDamage).toHaveBeenCalledWith(12, "Employee negligence"),
    );
  });

  it("keeps the approval map available on return requests", async () => {
    getReturns.mockResolvedValue(ok([returnRow]));

    render(<CEOAssetReturnRequestsPage />);

    expect(await screen.findByText("PHN-011")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Expand row/i }));
    expect(
      await screen.findByTestId("asset-return-approval-map"),
    ).toBeInTheDocument();
  });

  it("renders Arabic decision labels in Arabic", async () => {
    useI18nStore.getState().setLanguage("ar");
    getDamage.mockResolvedValue(ok([damageRow]));

    render(<CEOAssetDamageReportsPage />);

    expect(
      await screen.findByRole("button", { name: "موافقة: Sara Ahmed" }),
    ).toBeInTheDocument();
    expect(screen.getByText("بانتظار المدير التنفيذي")).toBeInTheDocument();
  });
});
