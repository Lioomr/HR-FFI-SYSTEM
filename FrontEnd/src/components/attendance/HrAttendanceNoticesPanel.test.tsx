import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("../../services/api/attendanceApi", () => ({
  getAttendanceNotices: vi.fn(),
  downloadAttendanceNotice: vi.fn(),
}));
vi.mock("../../services/api/employeesApi", () => ({
  listEmployees: vi.fn(),
}));

import HrAttendanceNoticesPanel from "./HrAttendanceNoticesPanel";
import {
  downloadAttendanceNotice,
  getAttendanceNotices,
} from "../../services/api/attendanceApi";
import { listEmployees } from "../../services/api/employeesApi";
import { useI18nStore } from "../../i18n/i18nStore";
import { restorePhoneViewport, setDesktopViewport } from "../../test/viewport";
import {
  NOTICE_DELIVERY_TEXT,
  deliveryOf,
  styleOf,
} from "../../test/attendanceNoticeText";
import type { AttendanceLateNotice } from "../../types/attendancePolicy";

const getNotices = vi.mocked(getAttendanceNotices);
const download = vi.mocked(downloadAttendanceNotice);

const notice = (
  overrides: Partial<AttendanceLateNotice> = {},
): AttendanceLateNotice => ({
  id: 41,
  violation_id: 91,
  employee_profile_id: 7,
  employee_name: "Jane Doe",
  employee_code: "FFI-000007",
  violation_date: "2026-09-13",
  occurrence_number: 1,
  notice_level: 1,
  reference_number: "LAN-FFI-000091",
  issued_at: "2026-09-13T09:31:02+03:00",
  delivery_status: "scheduled",
  delivery_message: NOTICE_DELIVERY_TEXT.scheduled.serverMessage,
  filename: "late_attendance_notice_LAN-FFI-000091.pdf",
  ...overrides,
});

/** Four employees: one per v2 style and per delivery state. */
const jane = notice();
const omar = notice({
  id: 42,
  violation_id: 95,
  employee_profile_id: 9,
  employee_name: "Omar Saleh",
  employee_code: "FFI-000009",
  violation_date: "2026-09-10",
  occurrence_number: 2,
  notice_level: 2,
  reference_number: "LAN-FFI-000095",
  delivery_status: "sent",
  delivery_message: NOTICE_DELIVERY_TEXT.sent.serverMessage,
  filename: "late_attendance_notice_LAN-FFI-000095.pdf",
});
/** No stored document: the backend sends `filename: null`. */
const sara = notice({
  id: 43,
  violation_id: 97,
  employee_profile_id: 11,
  employee_name: "Sara Ali",
  employee_code: "FFI-000011",
  violation_date: "2026-09-08",
  occurrence_number: 3,
  notice_level: 3,
  reference_number: "LAN-FFI-000097",
  delivery_status: "failed",
  delivery_message: NOTICE_DELIVERY_TEXT.failed.serverMessage,
  filename: null,
});
const lina = notice({
  id: 44,
  violation_id: 99,
  employee_profile_id: 12,
  employee_name: "Lina Haddad",
  employee_code: "FFI-000012",
  violation_date: "2026-09-02",
  occurrence_number: 6,
  notice_level: 4,
  reference_number: "LAN-FFI-000099",
  delivery_status: "skipped",
  delivery_message: NOTICE_DELIVERY_TEXT.skipped.serverMessage,
  filename: "late_attendance_notice_LAN-FFI-000099.pdf",
});
const companyNotices = [jane, omar, sara, lina];

const page = (items: AttendanceLateNotice[]) => ({
  status: "success" as const,
  data: { items, page: 1, page_size: 25, count: items.length },
});

const failure = (status: number, body: Record<string, unknown> = {}) => ({
  response: { status, data: { status: "error", message: "", ...body } },
});

function renderPanel(search: string) {
  return render(
    <MemoryRouter initialEntries={[`/hr/attendance${search}`]}>
      <Routes>
        <Route path="/hr/attendance" element={<HrAttendanceNoticesPanel />} />
      </Routes>
    </MemoryRouter>,
  );
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

beforeEach(() => {
  getNotices.mockReset();
  download.mockReset();
  vi.mocked(listEmployees).mockResolvedValue({
    status: "success",
    data: { results: [], count: 0 },
  });
  useI18nStore.getState().setLanguage("en");
  getNotices.mockResolvedValue(page(companyNotices));
});

afterEach(() => {
  restorePhoneViewport();
});

describe("HR late attendance notice history", () => {
  it("sends the URL filters to the server and never adds a company", async () => {
    renderPanel(
      "?tab=notices&notice_level=1,4&employee_profile_id=7&date_from=2026-09-01&date_to=2026-09-13&search=jane&page=2",
    );

    expect(await screen.findByText("Jane Doe")).toBeInTheDocument();
    expect(getNotices).toHaveBeenCalledWith({
      page: 2,
      page_size: 25,
      notice_level: ["1", "4"],
      employee_profile_id: "7",
      date_from: "2026-09-01",
      date_to: "2026-09-13",
      search: "jane",
    });
    expect(JSON.stringify(getNotices.mock.calls)).not.toMatch(/company/i);
  });

  it("shows every employee, style and delivery state the company response contains", async () => {
    renderPanel("?tab=notices");
    await screen.findByText("Jane Doe");

    expect(screen.getByText("4 notices")).toBeInTheDocument();
    for (const item of companyNotices) {
      const row = within(rowFor(item.violation_date));
      expect(row.getByText(item.employee_name)).toBeInTheDocument();
      expect(row.getByText(item.employee_code)).toBeInTheDocument();
      expect(row.getByText(item.reference_number)).toBeInTheDocument();
      expect(row.getByText(styleOf(item).en)).toBeInTheDocument();
      expect(row.getByText(styleOf(item).policyEn)).toBeInTheDocument();
      expect(row.getByText(deliveryOf(item).en)).toBeInTheDocument();
      expect(row.getByText(deliveryOf(item).hintEn)).toBeInTheDocument();
    }
    expectNoServerDeliveryMessages();

    // Notices are issued and delivered automatically; HR has nothing to send.
    expect(
      screen.queryByRole("button", { name: /send|retry/i }),
    ).not.toBeInTheDocument();
  });

  it("keeps level 1 a warning with no payroll deduction, never pending", async () => {
    renderPanel("?tab=notices");
    await screen.findByText("Jane Doe");

    const warning = rowFor("2026-09-13");
    expect(
      within(warning).getByText("Warning only - no payroll deduction."),
    ).toBeInTheDocument();
    expect(warning.textContent).not.toMatch(/pending|awaiting|%/i);
  });

  it("offers the PDF only for notices with a stored document", async () => {
    renderPanel("?tab=notices");
    await screen.findByText("Sara Ali");

    const absent = within(rowFor("2026-09-08"));
    expect(absent.getByText("PDF not available")).toBeInTheDocument();
    expect(
      absent.queryByRole("button", { name: /Download PDF/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: /^Download PDF: / }),
    ).toHaveLength(3);
  });

  it("downloads a notice through the API layer", async () => {
    download.mockResolvedValue(undefined);
    renderPanel("?tab=notices");
    await screen.findByText("Omar Saleh");

    fireEvent.click(
      screen.getByRole("button", { name: "Download PDF: LAN-FFI-000095" }),
    );

    await waitFor(() => expect(download).toHaveBeenCalledWith(omar));
  });

  it("applies the level filter through the URL", async () => {
    renderPanel("?tab=notices");
    await screen.findByText("Jane Doe");

    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Notice level" }));
    fireEvent.click(await screen.findByTitle("Serious warning"));

    await waitFor(() =>
      expect(getNotices).toHaveBeenLastCalledWith(
        expect.objectContaining({ notice_level: ["3"] }),
      ),
    );
  });

  it("maps 422 filter errors onto the filter controls", async () => {
    getNotices.mockRejectedValue(
      failure(422, {
        errors: [
          { field: "notice_level", message: "Use levels 1 to 4." },
          {
            field: "date_to",
            message: "date_to must not be before date_from.",
          },
        ],
      }),
    );

    renderPanel("?notice_level=9&date_from=2026-09-13&date_to=2026-09-01");

    // antd renders field help asynchronously; allow for a busy test runner.
    const levelError = await screen.findByText(
      "Use levels 1 to 4.",
      undefined,
      { timeout: 5000 },
    );
    expect(levelError.closest(".ant-form-item")).toHaveTextContent(
      "Notice level",
    );
    expect(
      screen
        .getByText("date_to must not be before date_from.")
        .closest(".ant-form-item"),
    ).toHaveTextContent("Violation dates");
    expect(
      screen.getByText("Correct the highlighted filters to see results."),
    ).toBeInTheDocument();
  });

  it("explains a 403 as missing access in the selected company", async () => {
    getNotices.mockRejectedValue(
      failure(403, { message: "Select an active company for this request." }),
    );
    renderPanel("?tab=notices");

    expect(
      await screen.findByText(
        "You don't have access to late attendance notices in the selected company.",
      ),
    ).toBeInTheDocument();
  });

  it("shows a not-available state on a 404 and a failure on other errors", async () => {
    getNotices.mockRejectedValueOnce(failure(404));
    const { unmount } = renderPanel("?tab=notices");
    expect(
      await screen.findByText(
        "No late attendance notices are available in the selected company.",
      ),
    ).toBeInTheDocument();
    unmount();

    getNotices.mockRejectedValueOnce(failure(500));
    renderPanel("?tab=notices");
    expect(
      await screen.findByText("Couldn't load late attendance notices."),
    ).toBeInTheDocument();
  });

  it("shows the empty state", async () => {
    getNotices.mockResolvedValue(page([]));
    renderPanel("?tab=notices");

    expect(
      await screen.findByText("No late attendance notices yet."),
    ).toBeInTheDocument();
  });

  it("uses a table with an employee column on desktop", async () => {
    setDesktopViewport();
    renderPanel("?tab=notices");
    await screen.findByText("Jane Doe");

    expect(rowFor("2026-09-13").tagName).toBe("TR");
    for (const header of [
      "Violation date",
      "Employee",
      "Level",
      "Reference",
      "Delivery status",
    ]) {
      expect(
        screen.getByRole("columnheader", { name: header }),
      ).toBeInTheDocument();
    }
    const absent = within(rowFor("2026-09-08"));
    expect(absent.getByText("PDF not available")).toBeInTheDocument();
    expect(absent.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders every style, policy and delivery state in Arabic", async () => {
    useI18nStore.getState().setLanguage("ar");
    renderPanel("?tab=notices");
    await screen.findByText("Jane Doe");

    expect(screen.getByText("4 إشعار")).toBeInTheDocument();
    for (const item of companyNotices) {
      const row = within(rowFor(item.violation_date));
      expect(row.getByText(styleOf(item).ar)).toBeInTheDocument();
      expect(row.getByText(styleOf(item).policyAr)).toBeInTheDocument();
      expect(row.getByText(deliveryOf(item).ar)).toBeInTheDocument();
      expect(row.getByText(deliveryOf(item).hintAr)).toBeInTheDocument();
    }
    // The English-only server delivery message is never the Arabic meaning.
    expectNoServerDeliveryMessages();

    const warning = rowFor("2026-09-13");
    expect(warning.textContent).not.toMatch(/بانتظار|معلّقة|٪|%/);
    expect(within(warning).getByText("تنزيل PDF")).toBeInTheDocument();
    const absent = within(rowFor("2026-09-08"));
    expect(absent.getByText("ملف PDF غير متاح")).toBeInTheDocument();
    expect(absent.queryByText("تنزيل PDF")).not.toBeInTheDocument();
  });
});
