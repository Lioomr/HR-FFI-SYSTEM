import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

vi.mock("../../services/api/apiClient", () => ({
  api: { get: vi.fn(), post: vi.fn() },
}));

import ProfileChangeRequestForm, {
  OCR_POLL_INTERVAL_MS,
  OCR_POLL_TIMEOUT_MS,
} from "./ProfileChangeRequestForm";
import { api } from "../../services/api/apiClient";
import { useI18nStore } from "../../i18n/i18nStore";
import type { Employee } from "../../services/api/employeesApi";
import { setDesktopViewport } from "../../test/viewport";

const get = api.get as unknown as ReturnType<typeof vi.fn>;
const post = api.post as unknown as ReturnType<typeof vi.fn>;
const BASE = "/api/employees/me/profile-change-requests/";
const envelope = (data: unknown) => ({ data: { status: "success", data } });

const employee = {
  id: 77,
  employee_id: "FFI-077",
  full_name: "Omar Farouk",
  email: "omar@ffi.test",
  mobile: "0500000000",
  nationality: "Egypt",
  date_of_birth: "1990-05-01",
  passport_no: "A1234567",
  passport_expiry: "2027-01-01",
  national_id: "1098765432",
  id_expiry: "2028-02-02",
  is_archived: false,
} as unknown as Employee;

const attachment = (overrides: Record<string, unknown>) => ({
  id: 41,
  document_type: "PASSPORT",
  original_filename: "passport.png",
  extraction_status: "pending",
  suggested: {},
  warnings: [],
  confidence: null,
  ...overrides,
});

const onSubmitted = vi.fn();
const renderForm = () =>
  render(
    <ProfileChangeRequestForm
      open
      employee={employee}
      onClose={() => {}}
      onSubmitted={onSubmitted}
    />,
  );

const uploadPassport = async () => {
  const input = document.querySelector(
    "#profile-change-passport input[type=file]",
  ) as HTMLInputElement;
  const file = new File(["png"], "passport.png", { type: "image/png" });
  await act(async () => {
    fireEvent.change(input, { target: { files: [file] } });
  });
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.useRealTimers();
  setDesktopViewport();
  useI18nStore.getState().setLanguage("en");
});

describe("ProfileChangeRequestForm", () => {
  it("submits only the fields the employee changed", async () => {
    post.mockResolvedValue(envelope({ id: 1 }));
    renderForm();
    const mobile = await screen.findByLabelText(/^Mobile number/);
    expect(mobile).toHaveValue("0500000000");
    fireEvent.change(mobile, { target: { value: "0511111111" } });
    fireEvent.change(screen.getByLabelText(/^Nationality/), {
      target: { value: "Egypt" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(BASE, {
        items: { mobile: "0511111111" },
        attachment_ids: [],
      }),
    );
    await waitFor(() => expect(onSubmitted).toHaveBeenCalled());
  });

  it("refuses to submit when nothing changed", async () => {
    renderForm();
    await screen.findByLabelText(/^Full name/);
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(
      await screen.findByText(
        "Change at least one detail or upload a document.",
      ),
    ).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it("polls the upload and pre-fills editable values read from the document", async () => {
    post.mockImplementation((url: string) =>
      Promise.resolve(
        envelope(url === `${BASE}attachments/` ? attachment({}) : { id: 1 }),
      ),
    );
    get.mockResolvedValue(
      envelope(
        attachment({
          extraction_status: "success",
          suggested: { passport_no: "B7654321", passport_expiry: "2034-03-03" },
          warnings: ["Name could not be read clearly."],
        }),
      ),
    );
    renderForm();
    await screen.findByLabelText(/^Passport number/);
    await uploadPassport();

    const [url, body] = post.mock.calls[0];
    expect(url).toBe(`${BASE}attachments/`);
    expect((body as FormData).get("document_type")).toBe("PASSPORT");
    expect(screen.getByText("Reading the document…")).toBeInTheDocument();

    await waitFor(
      () =>
        expect(screen.getByLabelText(/^Passport number/)).toHaveValue(
          "B7654321",
        ),
      { timeout: OCR_POLL_INTERVAL_MS + 2000 },
    );
    expect(get).toHaveBeenCalledWith(`${BASE}attachments/41/`);
    expect(screen.getAllByText("Read from document")).toHaveLength(2);
    expect(
      screen.getByText("Name could not be read clearly."),
    ).toBeInTheDocument();

    // The suggestion is editable; the edited value is what gets sent.
    fireEvent.change(screen.getByLabelText(/^Passport number/), {
      target: { value: "B7654329" },
    });
    await waitFor(() =>
      expect(screen.getAllByText("Read from document")).toHaveLength(1),
    );
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await waitFor(() =>
      expect(post).toHaveBeenLastCalledWith(BASE, {
        items: { passport_no: "B7654329", passport_expiry: "2034-03-03" },
        attachment_ids: [41],
      }),
    );
  });

  it("leaves the inputs untouched and asks for manual entry when reading fails", async () => {
    post.mockResolvedValue(
      envelope(attachment({ extraction_status: "failed" })),
    );
    renderForm();
    await screen.findByLabelText(/^Passport number/);
    await uploadPassport();
    expect(
      await screen.findByText(
        "We couldn’t read this document. Please fill in the details manually.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/^Passport number/)).toHaveValue("A1234567");
    expect(get).not.toHaveBeenCalled();
  });

  it("stops polling after the time limit", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    post.mockResolvedValue(envelope(attachment({})));
    get.mockResolvedValue(envelope(attachment({})));
    renderForm();
    await screen.findByLabelText(/^Passport number/);
    await uploadPassport();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(
        OCR_POLL_TIMEOUT_MS + OCR_POLL_INTERVAL_MS,
      );
    });
    expect(
      screen.getByText(
        "Reading the document is taking too long. Please fill in the details manually.",
      ),
    ).toBeInTheDocument();
    const calls = get.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(OCR_POLL_INTERVAL_MS * 3);
    });
    expect(get.mock.calls.length).toBe(calls);
    vi.useRealTimers();
  });
});
