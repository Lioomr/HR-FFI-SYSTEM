import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

// Only the HTTP client and the browser save are stubbed, so these tests run
// the real notice API layer: list through apiClient, PDF as a blob.
vi.mock("../../services/api/apiClient", () => ({ api: { get: vi.fn() } }));
vi.mock("../../utils/download", () => ({ downloadBlob: vi.fn() }));

import MyAttendanceNotices from "./MyAttendanceNotices";
import { api } from "../../services/api/apiClient";
import { downloadBlob } from "../../utils/download";
import { useI18nStore } from "../../i18n/i18nStore";
import { restorePhoneViewport, setDesktopViewport } from "../../test/viewport";
import {
  NOTICE_DELIVERY_TEXT,
  deliveryOf,
  styleOf,
} from "../../test/attendanceNoticeText";
import type { AttendanceLateNotice } from "../../types/attendancePolicy";

const get = vi.mocked(api.get);

const notice = (
  overrides: Partial<AttendanceLateNotice> = {},
): AttendanceLateNotice => ({
  id: 31,
  violation_id: 58,
  employee_profile_id: 123,
  employee_name: "Jane Doe",
  employee_code: "FFI-000123",
  violation_date: "2026-08-19",
  occurrence_number: 2,
  notice_level: 2,
  reference_number: "LAN-FFI-000058",
  issued_at: "2026-08-19T09:31:02+03:00",
  delivery_status: "sent",
  delivery_message: NOTICE_DELIVERY_TEXT.sent.serverMessage,
  filename: "late_attendance_notice_LAN-FFI-000058.pdf",
  ...overrides,
});

/** One notice per v2 style and per delivery state; level 3 has no stored PDF. */
const levelOne = notice({
  id: 30,
  violation_id: 38,
  violation_date: "2026-08-12",
  occurrence_number: 1,
  notice_level: 1,
  reference_number: "LAN-FFI-000038",
  delivery_status: "scheduled",
  delivery_message: NOTICE_DELIVERY_TEXT.scheduled.serverMessage,
  filename: "late_attendance_notice_LAN-FFI-000038.pdf",
});
const levelTwo = notice();
const levelThree = notice({
  id: 32,
  violation_id: 61,
  violation_date: "2026-09-01",
  occurrence_number: 3,
  notice_level: 3,
  reference_number: "LAN-FFI-000061",
  delivery_status: "failed",
  delivery_message: NOTICE_DELIVERY_TEXT.failed.serverMessage,
  filename: null,
});
const levelFour = notice({
  id: 33,
  violation_id: 70,
  violation_date: "2026-09-13",
  occurrence_number: 5,
  notice_level: 4,
  reference_number: "LAN-FFI-000070",
  delivery_status: "skipped",
  delivery_message: NOTICE_DELIVERY_TEXT.skipped.serverMessage,
  filename: "late_attendance_notice_LAN-FFI-000070.pdf",
});
const ownNotices = [levelFour, levelThree, levelTwo, levelOne];

const pdf = new Blob(["%PDF-1.4"], { type: "application/octet-stream" });

/** Answers the list and download routes like the backend would. */
function serve(
  items: AttendanceLateNotice[],
  download: () => Promise<unknown> = async () => ({ data: pdf }),
) {
  get.mockImplementation(((url: string) => {
    if (url === "/api/attendance/notices/") {
      return Promise.resolve({
        data: {
          status: "success",
          data: { items, count: items.length, page: 1, page_size: 10 },
        },
      });
    }
    if (url.endsWith("/download/")) return download();
    return Promise.reject(new Error(`Unexpected GET ${url}`));
  }) as unknown as typeof api.get);
}

/** The phone card (or desktop row) holding a notice's violation date. */
function rowFor(date: string) {
  const cell = screen.getByText(date);
  return (cell.closest("li") ?? cell.closest("tr")) as HTMLElement;
}

function expectNoServerDeliveryMessages() {
  for (const delivery of Object.values(NOTICE_DELIVERY_TEXT)) {
    expect(screen.queryByText(delivery.serverMessage)).not.toBeInTheDocument();
  }
}

const failure = (status: number, message = "") => ({
  response: { status, data: { status: "error", message } },
});

beforeEach(() => {
  get.mockReset();
  vi.mocked(downloadBlob).mockReset();
  useI18nStore.getState().setLanguage("en");
  serve(ownNotices);
});

afterEach(() => {
  restorePhoneViewport();
});

describe("employee late attendance notices", () => {
  it("lists the caller's own notices from the scoped endpoint", async () => {
    render(<MyAttendanceNotices />);

    expect(await screen.findByText("LAN-FFI-000070")).toBeInTheDocument();
    for (const item of ownNotices) {
      expect(screen.getByText(item.reference_number)).toBeInTheDocument();
    }
    expect(get).toHaveBeenCalledWith("/api/attendance/notices/", {
      params: { mine: "true", page: 1, page_size: 10 },
    });
    // The server scopes the list; the client never picks a company or employee.
    expect(JSON.stringify(get.mock.calls)).not.toMatch(
      /company|employee_profile_id/i,
    );
    expect(screen.getByText("Late attendance notices")).toBeInTheDocument();
    expect(screen.queryByText("Jane Doe")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /send|retry/i }),
    ).not.toBeInTheDocument();
    // ResponsiveTable renders a table until the breakpoint observer reports a
    // phone, so wait for the card layout.
    await waitFor(() => expect(rowFor("2026-08-12").tagName).toBe("LI"));
  });

  it("shows every style's policy and localized delivery wording in English", async () => {
    render(<MyAttendanceNotices />);
    await screen.findByText("LAN-FFI-000070");

    for (const item of ownNotices) {
      const row = within(rowFor(item.violation_date));
      expect(row.getByText(styleOf(item).en)).toBeInTheDocument();
      expect(row.getByText(styleOf(item).policyEn)).toBeInTheDocument();
      expect(row.getByText(deliveryOf(item).en)).toBeInTheDocument();
      expect(row.getByText(deliveryOf(item).hintEn)).toBeInTheDocument();
    }
    expect(
      within(rowFor("2026-09-13")).getByText("Occurrence #5"),
    ).toBeInTheDocument();
    expectNoServerDeliveryMessages();
  });

  it("keeps level 1 a warning with no payroll deduction, never pending", async () => {
    render(<MyAttendanceNotices />);
    await screen.findByText("LAN-FFI-000038");

    const warning = rowFor("2026-08-12");
    expect(
      within(warning).getByText("Warning only - no payroll deduction."),
    ).toBeInTheDocument();
    expect(warning.textContent).not.toMatch(/pending|awaiting|%/i);
    for (const date of ["2026-08-19", "2026-09-01", "2026-09-13"]) {
      expect(
        within(rowFor(date)).queryByText(
          "Warning only - no payroll deduction.",
        ),
      ).not.toBeInTheDocument();
    }
  });

  it("offers the PDF only for notices with a stored document", async () => {
    render(<MyAttendanceNotices />);
    await screen.findByText("LAN-FFI-000061");

    const absent = within(rowFor("2026-09-01"));
    expect(absent.getByText("PDF not available")).toBeInTheDocument();
    expect(
      absent.queryByRole("button", { name: /Download PDF/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: /^Download PDF: / }),
    ).toHaveLength(3);
    for (const date of ["2026-08-12", "2026-08-19", "2026-09-13"]) {
      expect(
        within(rowFor(date)).getByRole("button", { name: /Download PDF/ }),
      ).toBeInTheDocument();
    }
  });

  it("downloads the PDF through the authenticated blob endpoint", async () => {
    const { container } = render(<MyAttendanceNotices />);
    await screen.findByText("LAN-FFI-000058");

    fireEvent.click(
      screen.getByRole("button", { name: "Download PDF: LAN-FFI-000058" }),
    );

    await waitFor(() =>
      expect(downloadBlob).toHaveBeenCalledWith(
        pdf,
        "late_attendance_notice_LAN-FFI-000058.pdf",
      ),
    );
    expect(get).toHaveBeenCalledWith("/api/attendance/notices/31/download/", {
      responseType: "blob",
    });
    // No plain link could carry the bearer token or company header.
    expect(container.querySelectorAll("a[href]")).toHaveLength(0);
  });

  it("explains a missing PDF instead of saving anything", async () => {
    serve(ownNotices, () => Promise.reject(failure(404)));
    render(<MyAttendanceNotices />);
    await screen.findByText("LAN-FFI-000058");

    fireEvent.click(
      screen.getByRole("button", { name: "Download PDF: LAN-FFI-000058" }),
    );

    expect(
      await screen.findByText("This notice PDF is not available."),
    ).toBeInTheDocument();
    expect(downloadBlob).not.toHaveBeenCalled();
  });

  it("uses a table with column headers on desktop", async () => {
    setDesktopViewport();
    render(<MyAttendanceNotices />);
    await screen.findByText("LAN-FFI-000038");

    expect(rowFor("2026-08-12").tagName).toBe("TR");
    for (const header of [
      "Violation date",
      "Level",
      "Reference",
      "Delivery status",
    ]) {
      expect(
        screen.getByRole("columnheader", { name: header }),
      ).toBeInTheDocument();
    }
    expect(
      screen.queryByRole("columnheader", { name: "Employee" }),
    ).not.toBeInTheDocument();
    const absent = within(rowFor("2026-09-01"));
    expect(absent.getByText("PDF not available")).toBeInTheDocument();
    expect(absent.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders every style, policy and delivery state in Arabic", async () => {
    useI18nStore.getState().setLanguage("ar");
    render(<MyAttendanceNotices />);
    await screen.findByText("LAN-FFI-000038");

    expect(screen.getByText("إشعارات التأخر عن العمل")).toBeInTheDocument();
    for (const item of ownNotices) {
      const row = within(rowFor(item.violation_date));
      expect(row.getByText(styleOf(item).ar)).toBeInTheDocument();
      expect(row.getByText(styleOf(item).policyAr)).toBeInTheDocument();
      expect(row.getByText(deliveryOf(item).ar)).toBeInTheDocument();
      expect(row.getByText(deliveryOf(item).hintAr)).toBeInTheDocument();
    }
    // The English-only server delivery message is never the Arabic meaning.
    expectNoServerDeliveryMessages();

    const warning = rowFor("2026-08-12");
    expect(warning.textContent).not.toMatch(/بانتظار|معلّقة|٪|%/);
    expect(within(warning).getByText("تنزيل PDF")).toBeInTheDocument();
    const absent = within(rowFor("2026-09-01"));
    expect(absent.getByText("ملف PDF غير متاح")).toBeInTheDocument();
    expect(absent.queryByText("تنزيل PDF")).not.toBeInTheDocument();
  });
});

describe("employee late attendance notice states", () => {
  it("shows a skeleton while loading", () => {
    get.mockReturnValue(new Promise(() => {}));
    const { container } = render(<MyAttendanceNotices />);

    expect(container.querySelector(".ant-skeleton")).not.toBeNull();
  });

  it("shows the empty state", async () => {
    serve([]);
    render(<MyAttendanceNotices />);

    expect(
      await screen.findByText("No late attendance notices yet."),
    ).toBeInTheDocument();
  });

  it("explains a 403 as missing access in the selected company", async () => {
    get.mockRejectedValue(
      failure(403, "Select an active company for this request."),
    );
    render(<MyAttendanceNotices />);

    expect(
      await screen.findByText(
        "You don't have access to late attendance notices in the selected company.",
      ),
    ).toBeInTheDocument();
  });

  it("shows a not-available state on a 404", async () => {
    get.mockRejectedValue(failure(404, "Not found."));
    render(<MyAttendanceNotices />);

    expect(
      await screen.findByText(
        "No late attendance notices are available in the selected company.",
      ),
    ).toBeInTheDocument();
  });

  it("shows a generic failure without leaking server details", async () => {
    get.mockRejectedValue(failure(500, "Traceback: relation does not exist"));
    render(<MyAttendanceNotices />);

    expect(
      await screen.findByText("Couldn't load late attendance notices."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Traceback/)).not.toBeInTheDocument();
  });
});
