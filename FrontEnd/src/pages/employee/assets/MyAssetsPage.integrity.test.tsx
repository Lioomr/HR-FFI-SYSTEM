import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../../services/api/assetsApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../services/api/assetsApi")>()),
  listMyAssets: vi.fn(),
  cancelAssetDamageReport: vi.fn(),
  cancelAssetReturnRequest: vi.fn(),
  listMyAssetDamageReports: vi.fn(),
  listMyAssetReturnRequests: vi.fn(),
}));

vi.mock("../../../components/documents/DocumentIntegrityPanel", async () => ({
  default: (await import("../../../test/integrityPanelStub")).default,
}));

import MyAssetsPage from "./MyAssetsPage";
import * as assetsApi from "../../../services/api/assetsApi";
import type {
  AssetDamageReport,
  AssetReturnRequest,
} from "../../../services/api/assetsApi";
import { useI18nStore } from "../../../i18n/i18nStore";

const FIND = { timeout: 8000 };

const page = <T,>(items: T[]) => ({
  status: "success" as const,
  data: {
    items,
    page: 1,
    page_size: 5,
    count: items.length,
    total_pages: 1,
  },
});

const damage = (status: AssetDamageReport["status"]): AssetDamageReport => ({
  id: 31,
  asset: 4,
  asset_code: "LT-004",
  asset_name: "Laptop",
  employee: 2,
  description: "Cracked screen",
  status,
  reported_at: "2026-10-01T09:00:00Z",
});

const returned = (
  status: AssetReturnRequest["status"],
): AssetReturnRequest => ({
  id: 41,
  reference_no: "AR-201",
  asset: 4,
  asset_code: "LT-004",
  asset_name: "Laptop",
  employee: 2,
  note: "Leaving the project",
  status,
  requested_at: "2026-10-01T09:00:00Z",
});

function setup(
  damageStatus: AssetDamageReport["status"],
  returnStatus: AssetReturnRequest["status"],
) {
  vi.mocked(assetsApi.listMyAssets).mockResolvedValue(page([]) as never);
  vi.mocked(assetsApi.listMyAssetDamageReports).mockResolvedValue(
    page([damage(damageStatus)]) as never,
  );
  vi.mocked(assetsApi.listMyAssetReturnRequests).mockResolvedValue(
    page([returned(returnStatus)]) as never,
  );
  render(
    <MemoryRouter>
      <MyAssetsPage />
    </MemoryRouter>,
  );
}

async function openTab(name: RegExp) {
  fireEvent.click(await screen.findByRole("tab", { name }, FIND));
  return screen.findByRole("tabpanel", {}, FIND);
}

beforeEach(() => {
  vi.clearAllMocks();
  useI18nStore.getState().setLanguage("en");
});

describe("MyAssetsPage document integrity (owner, read-only)", () => {
  it("offers a read-only card on a CEO-approved damage report", async () => {
    setup("APPROVED", "PENDING");
    const panel = await openTab(/Damage Reports/);
    fireEvent.click(
      await within(panel).findByRole("button", { name: /Show more/ }, FIND),
    );
    const card = await within(panel).findByTestId("integrity-panel");
    expect(card).toHaveAttribute("data-type", "asset_damage");
    expect(card).toHaveAttribute("data-id", "31");
    expect(card).toHaveAttribute("data-final", "true");
    expect(card).toHaveAttribute("data-retry", "false");
    expect(card).toHaveAttribute("data-profile", "");
  });

  it("offers a read-only card on a processed return request", async () => {
    setup("PENDING_HR", "PROCESSED");
    const panel = await openTab(/Return Requests/);
    fireEvent.click(
      await within(panel).findByRole("button", { name: /Show more/ }, FIND),
    );
    const card = await within(panel).findByTestId("integrity-panel");
    expect(card).toHaveAttribute("data-type", "asset_return");
    expect(card).toHaveAttribute("data-final", "true");
    expect(card).toHaveAttribute("data-retry", "false");
  });

  it("offers no card before the return is processed", async () => {
    // APPROVED still renders live: the form's last row is "Processed".
    setup("PENDING_CEO", "APPROVED");
    const panel = await openTab(/Return Requests/);
    await within(panel).findByText("AR-201", {}, FIND);
    expect(
      within(panel).queryByRole("button", { name: /Show more/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("integrity-panel")).not.toBeInTheDocument();
  });
});

describe("employee asset cancellation", () => {
  it.each(["damage", "return"] as const)(
    "cancels the %s request and refreshes both history tabs",
    async (kind) => {
      const pendingDamage = {
        ...damage("PENDING_HR"),
        can_cancel: kind === "damage",
      };
      const pendingReturn = {
        ...returned("PENDING_MANAGER"),
        workflow: {
          status: "in_review" as const,
          can_cancel: kind === "return",
          history: [],
        },
      };
      vi.mocked(assetsApi.listMyAssets).mockResolvedValue(page([]) as never);
      vi.mocked(assetsApi.listMyAssetDamageReports)
        .mockResolvedValueOnce(page([pendingDamage]))
        .mockResolvedValue(
          page([
            { ...pendingDamage, status: "CANCELLED", can_cancel: false },
          ]) as never,
        );
      vi.mocked(assetsApi.listMyAssetReturnRequests)
        .mockResolvedValueOnce(page([pendingReturn]))
        .mockResolvedValue(
          page([
            {
              ...pendingReturn,
              status: "CANCELLED",
              workflow: { status: "cancelled", can_cancel: false, history: [] },
            },
          ]) as never,
        );
      const cancel =
        kind === "damage"
          ? assetsApi.cancelAssetDamageReport
          : assetsApi.cancelAssetReturnRequest;
      vi.mocked(cancel).mockResolvedValue({
        status: "success",
        data: { id: kind === "damage" ? 31 : 41 },
      } as never);
      render(
        <MemoryRouter>
          <MyAssetsPage />
        </MemoryRouter>,
      );
      const panel = await openTab(
        kind === "damage" ? /Damage Reports/ : /Return Requests/,
      );
      fireEvent.click(
        await within(panel).findByRole(
          "button",
          { name: "Cancel request" },
          FIND,
        ),
      );
      expect(cancel).not.toHaveBeenCalled();
      fireEvent.click(
        within(await screen.findByRole("dialog")).getByRole("button", {
          name: "Cancel request",
        }),
      );
      await waitFor(
        () => expect(cancel).toHaveBeenCalledWith(kind === "damage" ? 31 : 41),
        FIND,
      );
      await waitFor(
        () =>
          expect(assetsApi.listMyAssetReturnRequests).toHaveBeenCalledTimes(2),
        FIND,
      );
      expect(assetsApi.listMyAssetDamageReports).toHaveBeenCalledTimes(2);
      expect(
        await within(panel).findByText("Cancelled", {}, FIND),
      ).toBeInTheDocument();
      expect(
        within(panel).queryByRole("button", { name: "Cancel request" }),
      ).not.toBeInTheDocument();
    },
  );
});
