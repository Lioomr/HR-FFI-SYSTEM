import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../../services/api/apiClient", () => ({
  api: { get: vi.fn(), post: vi.fn() },
}));

import ProfileChangeRequestsPage from "./ProfileChangeRequestsPage";
import { api } from "../../../services/api/apiClient";
import { useI18nStore } from "../../../i18n/i18nStore";
import { setDesktopViewport } from "../../../test/viewport";

const get = api.get as unknown as ReturnType<typeof vi.fn>;
const post = api.post as unknown as ReturnType<typeof vi.fn>;
const BASE = "/api/employees/profile-change-requests/";
const envelope = (data: unknown) => ({ data: { status: "success", data } });

const pending = {
  id: 9,
  employee: { id: 77, full_name: "Omar Farouk", employee_number: "FFI-077" },
  status: "PENDING_HR",
  items: [
    {
      field: "passport_no",
      old: "A1234567",
      new: "B7654321",
      source: "ocr",
      decision: "pending",
      note: "",
    },
    {
      field: "mobile",
      old: "0500000000",
      new: "0511111111",
      source: "manual",
      decision: "pending",
      note: "",
    },
    {
      field: "passport_file",
      old: null,
      new: "passport-scan.pdf",
      source: "manual",
      decision: "pending",
      note: "",
    },
  ],
  attachments: [
    {
      id: 41,
      document_type: "PASSPORT",
      original_filename: "passport-scan.pdf",
      field: "passport_file",
    },
  ],
  decision_note: null,
  submitted_at: "2026-09-20T08:00:00Z",
  decided_at: null,
  decided_by_name: null,
  can_act: true,
  workflow: { status: "in_review", current_stage: "hr", history: [] },
};

beforeEach(() => {
  vi.resetAllMocks();
  setDesktopViewport();
  useI18nStore.getState().setLanguage("en");
  get.mockImplementation((url: string) => {
    if (url === BASE)
      return Promise.resolve(envelope({ items: [pending], count: 1 }));
    if (url === `${BASE}9/`) return Promise.resolve(envelope(pending));
    return Promise.reject(new Error(`Unexpected ${url}`));
  });
});

const renderPage = async () => {
  render(
    <MemoryRouter>
      <ProfileChangeRequestsPage />
    </MemoryRouter>,
  );
  await screen.findByText("Omar Farouk");
  fireEvent.click(screen.getByRole("button", { name: "Review" }));
  return screen.findByRole("dialog");
};

const decide = (drawer: HTMLElement, field: string, choice: string) =>
  fireEvent.click(
    within(within(drawer).getByRole("radiogroup", { name: field })).getByText(
      choice,
    ),
  );

describe("ProfileChangeRequestsPage", () => {
  it("lists pending requests and shows each field with current and requested values", async () => {
    const drawer = await renderPage();
    expect(get).toHaveBeenCalledWith(BASE, {
      params: { status: "PENDING_HR", page: 1, page_size: 20 },
    });
    expect(within(drawer).getByText("A1234567")).toBeInTheDocument();
    expect(within(drawer).getByText("B7654321")).toBeInTheDocument();
    expect(within(drawer).getByText("Read from document")).toBeInTheDocument();
    expect(
      within(drawer).getByRole("button", { name: /passport-scan\.pdf/ }),
    ).toBeInTheDocument();
    expect(
      within(drawer).getByRole("button", { name: "Submit decisions" }),
    ).toBeDisabled();
  });

  it("requires every field decided and a reason for each rejection", async () => {
    post.mockResolvedValue(
      envelope({ ...pending, status: "PARTIALLY_APPROVED" }),
    );
    const drawer = await renderPage();
    const submit = within(drawer).getByRole("button", {
      name: "Submit decisions",
    });
    fireEvent.click(
      within(drawer).getByRole("button", { name: "Approve all" }),
    );
    await waitFor(() => expect(submit).toBeEnabled());

    decide(drawer, "Mobile number", "Reject");
    await waitFor(() => expect(submit).toBeDisabled());
    fireEvent.change(
      within(drawer).getByLabelText("Reason for rejecting Mobile number"),
      { target: { value: "Number is not registered to you" } },
    );
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(`${BASE}9/decide/`, {
        decisions: [
          { field: "passport_no", decision: "approve" },
          {
            field: "mobile",
            decision: "reject",
            note: "Number is not registered to you",
          },
          { field: "passport_file", decision: "approve" },
        ],
      }),
    );
    // Optimistic removal from the pending queue.
    await waitFor(() =>
      expect(screen.queryByText("Omar Farouk")).not.toBeInTheDocument(),
    );
  });

  it("restores the request when saving the decisions fails", async () => {
    post.mockRejectedValue(new Error("Server unavailable"));
    const drawer = await renderPage();
    fireEvent.click(
      within(drawer).getByRole("button", { name: "Approve all" }),
    );
    const submit = within(drawer).getByRole("button", {
      name: "Submit decisions",
    });
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(await screen.findAllByText("Omar Farouk")).not.toHaveLength(0);
  });
});
