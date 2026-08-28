import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";

vi.mock("react-router-dom", () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));

vi.mock("../../../services/api/employeesApi", () => ({
  getExpiringEmployees: vi.fn(),
  notifyExpiringEmployee: vi.fn(),
}));

import ExpiringDocumentsPage from "./ExpiringDocumentsPage";
import * as employeesApi from "../../../services/api/employeesApi";
import type { ExpiringEmployee } from "../../../services/api/employeesApi";
import { useI18nStore } from "../../../i18n/i18nStore";

const getExpiringEmployees =
  employeesApi.getExpiringEmployees as unknown as ReturnType<typeof vi.fn>;

function makeEntry(
  overrides: Partial<ExpiringEmployee> = {},
): ExpiringEmployee {
  return {
    id: 41,
    employee_id: "FFI-0041",
    full_name: "Yousef Nasser",
    linked_email: "yousef@ffi.test",
    mobile: "+966500000000",
    nearest_days_left: 8,
    documents: [
      {
        document_type: "WORK_LICENSE",
        label: "Work License",
        expiry_date: "2026-08-18",
        days_left: 8,
      },
    ],
    ...overrides,
  };
}

function expiriesResponse(items: ExpiringEmployee[]) {
  return {
    status: "success" as const,
    data: {
      items,
      page: 1,
      page_size: 25,
      count: items.length,
      total_pages: 1,
    },
  };
}

beforeEach(() => {
  getExpiringEmployees.mockReset();
  getExpiringEmployees.mockResolvedValue(expiriesResponse([makeEntry()]));
  useI18nStore.getState().setLanguage("en");
  window.localStorage.clear();
});

describe("ExpiringDocumentsPage work license", () => {
  it("renders a work license row with the employee, label, expiry date and days left", async () => {
    render(<ExpiringDocumentsPage />);

    expect(await screen.findByText("Yousef Nasser")).toBeInTheDocument();

    const tag = screen.getByTestId("expiry-document-41-work_license");
    expect(tag).toHaveTextContent("Work License");
    expect(tag).toHaveTextContent("2026-08-18");
    expect(tag).toHaveTextContent("8 days remaining");
    expect(tag).toHaveTextContent("Expiring");
  });

  it("reuses the existing expiries endpoint rather than a new one", async () => {
    render(<ExpiringDocumentsPage />);
    await screen.findByText("Yousef Nasser");

    expect(getExpiringEmployees).toHaveBeenCalledTimes(1);
    // (days, page, pageSize) — the established signature.
    expect(getExpiringEmployees).toHaveBeenCalledWith(30, 1, 25);
  });

  it("marks an already-expired work license as overdue", async () => {
    getExpiringEmployees.mockResolvedValue(
      expiriesResponse([
        makeEntry({
          nearest_days_left: -3,
          documents: [
            {
              document_type: "WORK_LICENSE",
              label: "Work License",
              expiry_date: "2026-08-07",
              days_left: -3,
            },
          ],
        }),
      ]),
    );

    render(<ExpiringDocumentsPage />);

    const tag = await screen.findByTestId("expiry-document-41-work_license");
    expect(tag).toHaveTextContent("Expired");
    expect(tag).toHaveTextContent("3 days overdue");
  });

  it("handles a work license with no expiry date without showing bogus day counts", async () => {
    getExpiringEmployees.mockResolvedValue(
      expiriesResponse([
        makeEntry({
          documents: [
            {
              document_type: "WORK_LICENSE",
              label: "Work License",
              expiry_date: null,
              days_left: 0,
            },
          ],
        }),
      ]),
    );

    render(<ExpiringDocumentsPage />);

    const tag = await screen.findByTestId("expiry-document-41-work_license");
    expect(tag).toHaveTextContent("Expiry date unavailable");
    expect(tag).toHaveTextContent("Expiry unavailable");
    expect(tag).not.toHaveTextContent("days remaining");
    expect(tag).not.toHaveTextContent("days overdue");
  });

  it("renders work license alongside the existing document families", async () => {
    getExpiringEmployees.mockResolvedValue(
      expiriesResponse([
        makeEntry({
          documents: [
            {
              doc_type: "passport",
              label: "Passport",
              expiry_date: "2026-08-20",
              days_left: 10,
            },
            {
              document_type: "WORK_LICENSE",
              label: "Work License",
              expiry_date: "2026-08-18",
              days_left: 8,
            },
          ],
        }),
      ]),
    );

    render(<ExpiringDocumentsPage />);

    expect(
      await screen.findByTestId("expiry-document-41-passport"),
    ).toHaveTextContent("Passport");
    expect(
      screen.getByTestId("expiry-document-41-work_license"),
    ).toHaveTextContent("Work License");
  });

  it("falls back to the server label instead of mislabelling an unknown document", async () => {
    getExpiringEmployees.mockResolvedValue(
      expiriesResponse([
        makeEntry({
          documents: [
            {
              label: "Residency Permit",
              expiry_date: "2026-08-25",
              days_left: 15,
            },
          ],
        }),
      ]),
    );

    render(<ExpiringDocumentsPage />);

    const tag = await screen.findByTestId("expiry-document-41-unknown");
    expect(tag).toHaveTextContent("Residency Permit");
    expect(tag).not.toHaveTextContent("Work License");
  });

  it("explains that WhatsApp reminders reach HR automatically inside 10 days", async () => {
    render(<ExpiringDocumentsPage />);
    await screen.findByText("Yousef Nasser");

    expect(
      screen.getByText(
        "WhatsApp reminders are sent automatically to HR only when an expiry is within 10 days.",
      ),
    ).toBeInTheDocument();
  });

  it("renders the automatic reminder explanation in Arabic", async () => {
    useI18nStore.getState().setLanguage("ar");

    render(<ExpiringDocumentsPage />);
    await screen.findByText("Yousef Nasser");

    expect(
      screen.getByText(
        "تُرسل تذكيرات واتساب تلقائياً إلى الموارد البشرية فقط عندما يكون موعد الانتهاء خلال 10 أيام.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("expiry-document-41-work_license"),
    ).toHaveTextContent("رخصة العمل");
  });
});

describe("ExpiringDocumentsPage archived employees", () => {
  it("does not render archived employees returned alongside active ones", async () => {
    // The backend excludes archived employees; the client filter is a defence in depth.
    getExpiringEmployees.mockResolvedValue(
      expiriesResponse([
        makeEntry(),
        makeEntry({
          id: 99,
          employee_id: "FFI-0099",
          full_name: "Archived Person",
          is_archived: true,
        }),
      ]),
    );

    render(<ExpiringDocumentsPage />);
    await screen.findByText("Yousef Nasser");

    expect(screen.queryByText("Archived Person")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("expiry-document-99-work_license"),
    ).not.toBeInTheDocument();
  });

  it("renders every employee when the backend already excluded archived ones", async () => {
    getExpiringEmployees.mockResolvedValue(
      expiriesResponse([
        makeEntry(),
        makeEntry({
          id: 42,
          employee_id: "FFI-0042",
          full_name: "Layla Hassan",
        }),
      ]),
    );

    render(<ExpiringDocumentsPage />);

    expect(await screen.findByText("Yousef Nasser")).toBeInTheDocument();
    expect(screen.getByText("Layla Hassan")).toBeInTheDocument();
  });
});

describe("ExpiringDocumentsPage notification actions", () => {
  it("exposes only the notification channels the backend already supports", async () => {
    render(<ExpiringDocumentsPage />);
    await screen.findByText("Yousef Nasser");

    const row = screen.getByText("Yousef Nasser").closest("tr") as HTMLElement;
    // notify-expiry backs these; no work-license-specific button exists server-side.
    const buttonNames = within(row)
      .getAllByRole("button")
      .map((button) => button.textContent?.trim());

    await waitFor(() => expect(buttonNames.length).toBeGreaterThan(0));
    expect(buttonNames).not.toContain("Notify Work License");
  });
});
