import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../../services/api/assetsApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../services/api/assetsApi")>()),
  listMyAssets: vi.fn(),
  listMyAssetDamageReports: vi.fn(),
  listMyAssetReturnRequests: vi.fn(),
  cancelAssetReturnRequest: vi.fn(),
  cancelAssetDamageReport: vi.fn(),
  editAssetReturnRequest: vi.fn(),
}));
vi.mock("../../../components/documents/DocumentIntegrityPanel", () => ({
  default: () => null,
}));

import MyAssetsPage from "./MyAssetsPage";
import * as assetsApi from "../../../services/api/assetsApi";
import type { AssetReturnRequest } from "../../../services/api/assetsApi";
import { useI18nStore } from "../../../i18n/i18nStore";

const FIND = { timeout: 8000 };

const page = <T,>(items: T[]) => ({
  status: "success" as const,
  data: { items, page: 1, page_size: 5, count: items.length, total_pages: 1 },
});

const base: AssetReturnRequest = {
  id: 41,
  reference_no: "AR-201",
  asset: 4,
  asset_code: "LT-004",
  asset_name: "Laptop",
  employee: 2,
  note: "Leaving the project",
  status: "PENDING_MANAGER",
  requested_at: "2026-10-01T09:00:00Z",
  workflow: { status: "in_review", can_edit: true, history: [] },
};

async function setup(item: AssetReturnRequest = base) {
  vi.mocked(assetsApi.listMyAssets).mockResolvedValue(page([]) as never);
  vi.mocked(assetsApi.listMyAssetDamageReports).mockResolvedValue(
    page([]) as never,
  );
  vi.mocked(assetsApi.listMyAssetReturnRequests).mockResolvedValue(
    page([item]) as never,
  );
  render(
    <MemoryRouter>
      <MyAssetsPage />
    </MemoryRouter>,
  );
  fireEvent.click(
    await screen.findByRole("tab", { name: /Return Requests/ }, FIND),
  );
  return screen.findByRole("tabpanel", {}, FIND);
}

beforeEach(() => {
  vi.clearAllMocks();
  useI18nStore.getState().setLanguage("en");
});

describe("MyAssetsPage return request edit", () => {
  it("hides Edit when can_edit is false or absent", async () => {
    const panel = await setup({
      ...base,
      workflow: { status: "in_review", can_edit: false, history: [] },
    });
    await within(panel).findByText("AR-201", {}, FIND);
    expect(
      within(panel).queryByRole("button", { name: "Edit request" }),
    ).not.toBeInTheDocument();
  });

  it("opens a prefilled modal and PATCHes the trimmed note, then refreshes", async () => {
    vi.mocked(assetsApi.editAssetReturnRequest).mockResolvedValue({
      status: "success",
      data: base,
    } as never);
    const panel = await setup();
    fireEvent.click(
      await within(panel).findByRole("button", { name: "Edit request" }, FIND),
    );
    const textarea = await screen.findByDisplayValue("Leaving the project");
    const calls = vi.mocked(assetsApi.listMyAssetReturnRequests).mock.calls
      .length;
    fireEvent.change(textarea, { target: { value: "  Handing back  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(assetsApi.editAssetReturnRequest).toHaveBeenCalledWith(41, {
        note: "Handing back",
      }),
    );
    await waitFor(() =>
      expect(
        vi.mocked(assetsApi.listMyAssetReturnRequests).mock.calls.length,
      ).toBeGreaterThan(calls),
    );
  });

  it("requires a non-blank note", async () => {
    const panel = await setup();
    fireEvent.click(
      await within(panel).findByRole("button", { name: "Edit request" }, FIND),
    );
    const textarea = await screen.findByDisplayValue("Leaving the project");
    fireEvent.change(textarea, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(assetsApi.editAssetReturnRequest).not.toHaveBeenCalled();
  });

  it("shows the server message and refreshes on a not-editable 422", async () => {
    vi.mocked(assetsApi.editAssetReturnRequest).mockRejectedValue({
      response: {
        status: 422,
        data: {
          status: "error",
          message: "Return request is no longer editable.",
          errors: ["Return request is no longer editable."],
        },
      },
    });
    const panel = await setup();
    fireEvent.click(
      await within(panel).findByRole("button", { name: "Edit request" }, FIND),
    );
    await screen.findByDisplayValue("Leaving the project");
    const calls = vi.mocked(assetsApi.listMyAssetReturnRequests).mock.calls
      .length;
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(
      await screen.findByText("Return request is no longer editable."),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        vi.mocked(assetsApi.listMyAssetReturnRequests).mock.calls.length,
      ).toBeGreaterThan(calls),
    );
  });

  it("maps a note field error onto the textarea", async () => {
    vi.mocked(assetsApi.editAssetReturnRequest).mockRejectedValue({
      response: {
        status: 422,
        data: {
          status: "error",
          message: "Validation failed",
          errors: [{ field: "note", message: "Note is too long." }],
        },
      },
    });
    const panel = await setup();
    fireEvent.click(
      await within(panel).findByRole("button", { name: "Edit request" }, FIND),
    );
    await screen.findByDisplayValue("Leaving the project");
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(
      (await screen.findAllByText("Note is too long.")).length,
    ).toBeGreaterThan(0);
  });
});
