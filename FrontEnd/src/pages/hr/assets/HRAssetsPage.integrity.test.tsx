import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../../services/api/assetsApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../services/api/assetsApi")>()),
  listAssets: vi.fn(),
  getAssetsDashboardSummary: vi.fn(),
  listAssetDamageReports: vi.fn(),
  listAssetReturnRequests: vi.fn(),
}));

vi.mock("../../../services/api/employeesApi", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../services/api/employeesApi")
  >()),
  listEmployees: vi.fn().mockResolvedValue({
    status: "success",
    data: { results: [], count: 0 },
  }),
}));

vi.mock("../../../components/documents/DocumentIntegrityPanel", async () => ({
  default: (await import("../../../test/integrityPanelStub")).default,
}));

import HRAssetsPage from "./HRAssetsPage";
import * as assetsApi from "../../../services/api/assetsApi";
import type {
  Asset,
  AssetDamageReport,
  AssetReturnRequest,
} from "../../../services/api/assetsApi";
import { useI18nStore } from "../../../i18n/i18nStore";
import { useAuthStore } from "../../../auth/authStore";

const FIND = { timeout: 8000 };

const page = <T,>(items: T[]) => ({
  status: "success" as const,
  data: { items, page: 1, page_size: 20, count: items.length, total_pages: 1 },
});

const asset: Asset = {
  id: 4,
  asset_code: "LT-004",
  name_en: "Work laptop",
  name_ar: "حاسوب العمل",
  type: "LAPTOP",
  status: "ASSIGNED",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const damage: AssetDamageReport = {
  id: 31,
  asset: 4,
  asset_code: "LT-004",
  asset_name: "Work laptop",
  employee: 2,
  employee_name: "Sara Ahmed",
  description: "Cracked screen",
  status: "APPROVED",
  reported_at: "2026-10-01T09:00:00Z",
};

const returned = (
  status: AssetReturnRequest["status"],
): AssetReturnRequest => ({
  id: 41,
  reference_no: "AR-201",
  asset: 4,
  asset_code: "LT-004",
  asset_name: "Work laptop",
  employee: 2,
  employee_name: "Sara Ahmed",
  note: "Leaving the project",
  status,
  requested_at: "2026-10-01T09:00:00Z",
});

async function openAssetHistory(returnStatus: AssetReturnRequest["status"]) {
  vi.mocked(assetsApi.listAssets).mockResolvedValue(page([asset]) as never);
  vi.mocked(assetsApi.getAssetsDashboardSummary).mockResolvedValue({
    status: "success",
    data: {
      total: 1,
      assigned: 1,
      available: 0,
      damaged: 0,
      lost: 0,
      warranty_expiring_soon: 0,
    },
  } as never);
  vi.mocked(assetsApi.listAssetDamageReports).mockResolvedValue(
    page([damage]) as never,
  );
  vi.mocked(assetsApi.listAssetReturnRequests).mockResolvedValue(
    page([returned(returnStatus)]) as never,
  );
  render(
    <MemoryRouter>
      <HRAssetsPage />
    </MemoryRouter>,
  );
  fireEvent.click(
    (await screen.findAllByRole("button", { name: "Work laptop" }, FIND))[0],
  );
  return screen.findByRole("dialog", {}, FIND);
}

beforeEach(() => {
  vi.clearAllMocks();
  useI18nStore.getState().setLanguage("en");
  useAuthStore.setState({
    isAuthenticated: true,
    user: { id: "1", email: "hr@ffi.test", role: "HRManager" },
  });
});

describe("HRAssetsPage document integrity", () => {
  it("gives HR the damage report card with seal retry and profile links", async () => {
    const dialog = await openAssetHistory("PENDING");
    await within(dialog).findByText("Cracked screen", {}, FIND);
    fireEvent.click(
      (await within(dialog).findAllByRole("button", { name: /Show more/ }))[0],
    );
    const card = await within(dialog).findByTestId("integrity-panel");
    expect(card).toHaveAttribute("data-type", "asset_damage");
    expect(card).toHaveAttribute("data-final", "true");
    expect(card).toHaveAttribute("data-retry", "true");
    expect(card).toHaveAttribute("data-profile", "/hr/employees/9");
  });

  it("adds the card to a processed return request's approval map", async () => {
    const dialog = await openAssetHistory("PROCESSED");
    fireEvent.click(
      await within(dialog).findByRole("tab", { name: /Return Requests/ }),
    );
    await within(dialog).findByText("AR-201", {}, FIND);
    const toggles = within(dialog).getAllByRole("button", {
      name: /Show more/,
    });
    fireEvent.click(toggles[toggles.length - 1]);
    const cards = await within(dialog).findAllByTestId("integrity-panel");
    const card = cards.find(
      (node) => node.getAttribute("data-type") === "asset_return",
    );
    expect(card).toBeDefined();
    expect(card).toHaveAttribute("data-final", "true");
    expect(card).toHaveAttribute("data-retry", "true");
  });

  it("keeps an approved but unprocessed return without a card", async () => {
    const dialog = await openAssetHistory("APPROVED");
    fireEvent.click(
      await within(dialog).findByRole("tab", { name: /Return Requests/ }),
    );
    await within(dialog).findByText("AR-201", {}, FIND);
    const toggles = within(dialog).getAllByRole("button", {
      name: /Show more/,
    });
    fireEvent.click(toggles[toggles.length - 1]);
    expect(
      within(dialog)
        .queryAllByTestId("integrity-panel")
        .filter((node) => node.getAttribute("data-type") === "asset_return"),
    ).toHaveLength(0);
  });
});
