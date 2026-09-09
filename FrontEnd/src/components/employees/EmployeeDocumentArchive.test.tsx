import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";

vi.mock("../../services/api/employeesApi", () => ({
  getEmployeeDocuments: vi.fn(),
  uploadEmployeeDocument: vi.fn(),
  downloadEmployeeDocument: vi.fn(),
  notifyEmployeeDocumentExpiry: vi.fn(),
  extractEmployeeDocument: vi.fn(),
  deleteEmployeeDocument: vi.fn(),
}));

import EmployeeDocumentArchive from "./EmployeeDocumentArchive";
import * as employeesApi from "../../services/api/employeesApi";
import type {
  DocumentType,
  EmployeeDocument,
} from "../../services/api/employeesApi";
import { useI18nStore } from "../../i18n/i18nStore";

const getEmployeeDocuments =
  employeesApi.getEmployeeDocuments as unknown as ReturnType<typeof vi.fn>;
const uploadEmployeeDocument =
  employeesApi.uploadEmployeeDocument as unknown as ReturnType<typeof vi.fn>;
const extractEmployeeDocument =
  employeesApi.extractEmployeeDocument as unknown as ReturnType<typeof vi.fn>;
const downloadEmployeeDocument =
  employeesApi.downloadEmployeeDocument as unknown as ReturnType<typeof vi.fn>;
const deleteEmployeeDocument =
  employeesApi.deleteEmployeeDocument as unknown as ReturnType<typeof vi.fn>;

/** An axios-shaped rejection, matching what the shared API client re-throws. */
function apiRejection(status: number, message: string) {
  return Object.assign(new Error(message), {
    message,
    response: { status, data: { status: "error", message, errors: [message] } },
  });
}

/** Opens the danger confirmation for the single rendered row. */
async function openDeleteConfirmation() {
  fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
  return await screen.findByRole("button", { name: "Delete permanently" });
}

let nextId = 1;

function makeDocument(
  overrides: Partial<EmployeeDocument> = {},
): EmployeeDocument {
  return {
    id: nextId++,
    employee_profile_id: 7,
    document_type: "PASSPORT",
    display_name: "Passport",
    original_filename: "passport.pdf",
    extraction_status: "success",
    created_at: "2026-08-01T10:00:00Z",
    updated_at: "2026-08-01T10:00:00Z",
    ...overrides,
  } as EmployeeDocument;
}

function documentsResponse(documents: EmployeeDocument[]) {
  return { status: "success" as const, data: documents };
}

/** Expands the single rendered row so the extracted-metadata grid becomes visible. */
async function expandFirstRow() {
  const expand = await screen.findByRole("button", { name: /expand row/i });
  fireEvent.click(expand);
}

beforeEach(() => {
  nextId = 1;
  getEmployeeDocuments.mockReset();
  uploadEmployeeDocument.mockReset();
  extractEmployeeDocument.mockReset();
  downloadEmployeeDocument.mockReset();
  deleteEmployeeDocument.mockReset();
  getEmployeeDocuments.mockResolvedValue(documentsResponse([]));
  useI18nStore.getState().setLanguage("en");
});

describe("EmployeeDocumentArchive OCR", () => {
  it("allows a failed extraction to be queued again", async () => {
    const failed = makeDocument({
      extraction_status: "failed",
      extraction_error: "OCR failed",
    });
    getEmployeeDocuments.mockResolvedValue(documentsResponse([failed]));
    extractEmployeeDocument.mockResolvedValue({
      status: "success",
      data: { ...failed, extraction_status: "pending", extraction_error: "" },
    });

    render(<EmployeeDocumentArchive employeeId={7} canManageDocuments />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Run OCR extraction" }),
    );

    await waitFor(() =>
      expect(extractEmployeeDocument).toHaveBeenCalledWith(7, failed.id),
    );
  });
});

describe("EmployeeDocumentArchive document preview", () => {
  beforeEach(() => {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:employee-document-preview"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
  });

  it("does not fetch a document until Preview is explicitly clicked", async () => {
    const doc = makeDocument({ original_filename: "passport.pdf" });
    getEmployeeDocuments.mockResolvedValue(documentsResponse([doc]));
    downloadEmployeeDocument.mockResolvedValue(
      new Blob(["pdf"], { type: "application/pdf" }),
    );

    render(<EmployeeDocumentArchive employeeId={7} />);
    await screen.findByTestId("document-type-1");

    expect(downloadEmployeeDocument).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Preview document" }));

    await waitFor(() =>
      expect(downloadEmployeeDocument).toHaveBeenCalledWith(7, doc.id),
    );
    expect(await screen.findByTestId("document-preview-pdf")).toHaveAttribute(
      "src",
      "blob:employee-document-preview",
    );
  });

  it("renders a fetched common image in the preview dialog", async () => {
    const doc = makeDocument({ original_filename: "iqama.jpeg" });
    getEmployeeDocuments.mockResolvedValue(documentsResponse([doc]));
    downloadEmployeeDocument.mockResolvedValue(
      new Blob(["image"], { type: "image/jpeg" }),
    );

    render(<EmployeeDocumentArchive employeeId={7} />);
    await screen.findByTestId("document-type-1");
    fireEvent.click(screen.getByRole("button", { name: "Preview document" }));

    expect(await screen.findByTestId("document-preview-image")).toHaveAttribute(
      "src",
      "blob:employee-document-preview",
    );
  });

  it("does not fetch unsupported file types and explains that preview is unavailable", async () => {
    const doc = makeDocument({ original_filename: "passport.docx" });
    getEmployeeDocuments.mockResolvedValue(documentsResponse([doc]));

    render(<EmployeeDocumentArchive employeeId={7} />);
    await screen.findByTestId("document-type-1");
    fireEvent.click(screen.getByRole("button", { name: "Preview document" }));

    expect(downloadEmployeeDocument).not.toHaveBeenCalled();
    expect(
      await screen.findByText(/This document type cannot be previewed/i),
    ).toBeInTheDocument();
  });

  it("shows a localized preview failure without affecting download", async () => {
    const doc = makeDocument({ original_filename: "passport.pdf" });
    getEmployeeDocuments.mockResolvedValue(documentsResponse([doc]));
    downloadEmployeeDocument.mockRejectedValue(new Error("network error"));

    render(<EmployeeDocumentArchive employeeId={7} />);
    await screen.findByTestId("document-type-1");
    fireEvent.click(screen.getByRole("button", { name: "Preview document" }));

    expect(
      await screen.findByText("Could not load the document preview."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "download" })).toBeEnabled();
  });
});

describe("EmployeeDocumentArchive document types", () => {
  const cases: {
    documentType: DocumentType;
    displayName: string;
    expected: string;
  }[] = [
    { documentType: "PASSPORT", displayName: "Passport", expected: "Passport" },
    { documentType: "IQAMA", displayName: "Iqama", expected: "Iqama" },
    { documentType: "SAUDI_ID", displayName: "Saudi ID", expected: "Saudi ID" },
    { documentType: "VISA", displayName: "Visa", expected: "Visa" },
    {
      documentType: "OTHER",
      displayName: "Medical Certificate",
      expected: "Medical Certificate",
    },
  ];

  it.each(cases)(
    "renders the $documentType headline from display_name",
    async ({ documentType, displayName, expected }) => {
      getEmployeeDocuments.mockResolvedValue(
        documentsResponse([
          makeDocument({
            document_type: documentType,
            display_name: displayName,
            custom_name: documentType === "OTHER" ? "Medical Certificate" : "",
          }),
        ]),
      );

      render(<EmployeeDocumentArchive employeeId={7} />);

      expect(await screen.findByTestId("document-type-1")).toHaveTextContent(
        expected,
      );
    },
  );

  it.each(["PASSPORT", "IQAMA", "SAUDI_ID"] as DocumentType[])(
    "never labels a %s as Visa when the backend sends no display_name",
    async (documentType) => {
      getEmployeeDocuments.mockResolvedValue(
        documentsResponse([
          makeDocument({ document_type: documentType, display_name: "" }),
        ]),
      );

      render(<EmployeeDocumentArchive employeeId={7} />);

      const headline = await screen.findByTestId("document-type-1");
      expect(headline).not.toHaveTextContent("Visa");
      expect(headline).toHaveTextContent(
        { PASSPORT: "Passport", IQAMA: "Iqama", SAUDI_ID: "Saudi ID" }[
          documentType as "PASSPORT" | "IQAMA" | "SAUDI_ID"
        ],
      );
    },
  );

  it("falls back to custom_name for an OTHER document with no display_name", async () => {
    getEmployeeDocuments.mockResolvedValue(
      documentsResponse([
        makeDocument({
          document_type: "OTHER",
          display_name: "",
          custom_name: "Medical Certificate",
        }),
      ]),
    );

    render(<EmployeeDocumentArchive employeeId={7} />);

    expect(await screen.findByTestId("document-type-1")).toHaveTextContent(
      "Medical Certificate",
    );
  });

  it("falls back to a neutral label for an unlabelled OTHER document", async () => {
    getEmployeeDocuments.mockResolvedValue(
      documentsResponse([
        makeDocument({
          document_type: "OTHER",
          display_name: "",
          custom_name: "",
        }),
      ]),
    );

    render(<EmployeeDocumentArchive employeeId={7} />);

    expect(await screen.findByTestId("document-type-1")).toHaveTextContent(
      "Other",
    );
  });

  it("renders Arabic type labels when the language is Arabic", async () => {
    useI18nStore.getState().setLanguage("ar");
    getEmployeeDocuments.mockResolvedValue(
      documentsResponse([
        makeDocument({ document_type: "IQAMA", display_name: "" }),
      ]),
    );

    render(<EmployeeDocumentArchive employeeId={7} />);

    expect(await screen.findByTestId("document-type-1")).toHaveTextContent(
      "الإقامة",
    );
  });
});

describe("EmployeeDocumentArchive extracted metadata", () => {
  it("renders every contract metadata field with its translated label", async () => {
    getEmployeeDocuments.mockResolvedValue(
      documentsResponse([
        makeDocument({
          document_type: "IQAMA",
          display_name: "Iqama",
          extracted_fields: {
            passport_number: "P1234567",
            iqama_number: "2123456789",
            full_name: "Example Employee",
            nationality: "Egyptian",
            date_of_birth: "1990-01-01",
            issue_date: "2020-01-01",
            expiry_date: "2030-01-01",
            iqama_expiry_date: "2030-02-01",
            profession: "Engineer",
          },
        }),
      ]),
    );

    render(<EmployeeDocumentArchive employeeId={7} />);
    await screen.findByTestId("document-type-1");
    await expandFirstRow();

    const panel = await screen.findByTestId("extracted-fields-1");
    const expectations: [string, string][] = [
      ["Passport Number", "P1234567"],
      ["Iqama Number", "2123456789"],
      ["Full Name", "Example Employee"],
      ["Nationality", "Egyptian"],
      ["Date of Birth", "1990-01-01"],
      ["Issue Date", "2020-01-01"],
      ["Expiry Date", "2030-01-01"],
      ["Iqama Expiry Date", "2030-02-01"],
      ["Profession", "Engineer"],
    ];
    for (const [label, value] of expectations) {
      expect(within(panel).getByText(`${label}:`)).toBeInTheDocument();
      expect(within(panel).getByText(value)).toBeInTheDocument();
    }
  });

  it("labels the shared number field as ID Number for a SAUDI_ID document", async () => {
    getEmployeeDocuments.mockResolvedValue(
      documentsResponse([
        makeDocument({
          document_type: "SAUDI_ID",
          display_name: "Saudi ID",
          extracted_fields: {
            iqama_number: "1098765432",
            full_name: "Saudi Employee",
          },
        }),
      ]),
    );

    render(<EmployeeDocumentArchive employeeId={7} />);
    await screen.findByTestId("document-type-1");
    await expandFirstRow();

    const panel = await screen.findByTestId("extracted-fields-1");
    expect(within(panel).getByText("ID Number:")).toBeInTheDocument();
    expect(within(panel).queryByText("Iqama Number:")).not.toBeInTheDocument();
    expect(within(panel).getByText("1098765432")).toBeInTheDocument();
    expect(within(panel).getByText("Saudi Employee")).toBeInTheDocument();
  });

  it("hides metadata fields that carry no value", async () => {
    getEmployeeDocuments.mockResolvedValue(
      documentsResponse([
        makeDocument({
          document_type: "PASSPORT",
          extracted_fields: {
            passport_number: "P7654321",
            full_name: "   ",
            nationality: "",
            date_of_birth: null,
            issue_date: undefined,
            profession: [],
          },
        }),
      ]),
    );

    render(<EmployeeDocumentArchive employeeId={7} />);
    await screen.findByTestId("document-type-1");
    await expandFirstRow();

    const panel = await screen.findByTestId("extracted-fields-1");
    expect(within(panel).getByText("Passport Number:")).toBeInTheDocument();
    expect(within(panel).queryByText("Full Name:")).not.toBeInTheDocument();
    expect(within(panel).queryByText("Nationality:")).not.toBeInTheDocument();
    expect(within(panel).queryByText("Date of Birth:")).not.toBeInTheDocument();
    expect(within(panel).queryByText("Issue Date:")).not.toBeInTheDocument();
    expect(within(panel).queryByText("Profession:")).not.toBeInTheDocument();
  });

  it("keeps the visa extraction fields and hides the raw OCR payload", async () => {
    getEmployeeDocuments.mockResolvedValue(
      documentsResponse([
        makeDocument({
          document_type: "VISA",
          display_name: "Visa",
          visa_number: "V-88",
          extracted_fields: {
            visa_number: "V-88",
            exit_before_raw: "01/09/2026",
            raw_text: "PAGE ONE OF THE SCANNED VISA",
          },
        }),
      ]),
    );

    render(<EmployeeDocumentArchive employeeId={7} />);
    await screen.findByTestId("document-type-1");
    await expandFirstRow();

    const panel = await screen.findByTestId("extracted-fields-1");
    expect(within(panel).getByText("Visa Number:")).toBeInTheDocument();
    expect(
      within(panel).queryByText(/PAGE ONE OF THE SCANNED VISA/),
    ).not.toBeInTheDocument();
    expect(
      within(panel).queryByText("Exit Before Raw:"),
    ).not.toBeInTheDocument();
  });

  it("does not offer expansion when no metadata, warning or error exists", async () => {
    getEmployeeDocuments.mockResolvedValue(
      documentsResponse([
        makeDocument({ extracted_fields: { full_name: "" } }),
      ]),
    );

    render(<EmployeeDocumentArchive employeeId={7} />);
    await screen.findByTestId("document-type-1");

    expect(
      screen.queryByRole("button", { name: /expand row/i }),
    ).not.toBeInTheDocument();
  });
});

describe("EmployeeDocumentArchive metadata columns", () => {
  const VISA_COLUMNS = ["Visa Number", "Exit Before", "Visa Duration"];

  function group(type: DocumentType) {
    return screen.getByTestId(`document-group-${type}`);
  }

  function headers(scope: HTMLElement): string[] {
    return within(scope)
      .getAllByRole("columnheader")
      .map((cell) => cell.textContent?.trim() ?? "");
  }

  it("gives a passport its own columns and no visa columns", async () => {
    getEmployeeDocuments.mockResolvedValue(
      documentsResponse([
        makeDocument({
          document_type: "PASSPORT",
          visa_number: "SHOULD-NOT-SHOW",
          exit_before: "2026-09-01",
          extracted_fields: {
            passport_number: "P1234567",
            full_name: "Example Employee",
            nationality: "Egyptian",
            date_of_birth: "1990-01-01",
            issue_date: "2020-01-01",
            expiry_date: "2030-01-01",
            profession: "Engineer",
          },
        }),
      ]),
    );

    render(<EmployeeDocumentArchive employeeId={7} />);
    await screen.findByTestId("document-type-1");

    const passport = group("PASSPORT");
    expect(headers(passport)).toEqual(
      expect.arrayContaining([
        "Passport Number",
        "Full Name",
        "Nationality",
        "Date of Birth",
        "Issue Date",
        "Expiry Date",
        "Profession",
      ]),
    );
    for (const column of [...VISA_COLUMNS, "Visa No.", "Duration"]) {
      expect(headers(passport)).not.toContain(column);
    }
    expect(within(passport).getByText("P1234567")).toBeInTheDocument();
    // The stored visa columns are not just hidden — their values never reach the row.
    expect(
      within(passport).queryByText("SHOULD-NOT-SHOW"),
    ).not.toBeInTheDocument();
  });

  it("gives an iqama its own columns and no visa columns", async () => {
    getEmployeeDocuments.mockResolvedValue(
      documentsResponse([
        makeDocument({
          document_type: "IQAMA",
          display_name: "Iqama",
          extracted_fields: {
            iqama_number: "2123456789",
            full_name: "Example Employee",
            nationality: "Egyptian",
            date_of_birth: "1990-01-01",
            iqama_expiry_date: "2030-02-01",
            profession: "Engineer",
          },
        }),
      ]),
    );

    render(<EmployeeDocumentArchive employeeId={7} />);
    await screen.findByTestId("document-type-1");

    const iqama = group("IQAMA");
    expect(headers(iqama)).toEqual(
      expect.arrayContaining([
        "Iqama Number",
        "Full Name",
        "Nationality",
        "Date of Birth",
        "Expiry Date",
        "Profession",
      ]),
    );
    for (const column of [...VISA_COLUMNS, "Visa No.", "Duration"]) {
      expect(headers(iqama)).not.toContain(column);
    }
    expect(within(iqama).getByText("2123456789")).toBeInTheDocument();
    expect(within(iqama).getByText("2030-02-01")).toBeInTheDocument();
  });

  it("titles the SAUDI_ID number column ID Number", async () => {
    getEmployeeDocuments.mockResolvedValue(
      documentsResponse([
        makeDocument({
          document_type: "SAUDI_ID",
          display_name: "Saudi ID",
          extracted_fields: {
            iqama_number: "1098765432",
            full_name: "Saudi Employee",
          },
        }),
      ]),
    );

    render(<EmployeeDocumentArchive employeeId={7} />);
    await screen.findByTestId("document-type-1");

    const saudiId = group("SAUDI_ID");
    expect(headers(saudiId)).toContain("ID Number");
    expect(headers(saudiId)).not.toContain("Iqama Number");
    for (const column of VISA_COLUMNS) {
      expect(headers(saudiId)).not.toContain(column);
    }
    expect(within(saudiId).getByText("1098765432")).toBeInTheDocument();
  });

  it("shows the employer/sponsor column only when the extraction provides it", async () => {
    getEmployeeDocuments.mockResolvedValue(
      documentsResponse([
        makeDocument({
          document_type: "IQAMA",
          display_name: "Iqama",
          extracted_fields: { iqama_number: "2123456789", sponsor: "FFI Co." },
        }),
      ]),
    );

    render(<EmployeeDocumentArchive employeeId={7} />);
    await screen.findByTestId("document-type-1");

    expect(headers(group("IQAMA"))).toContain("Employer / Sponsor");
    expect(within(group("IQAMA")).getByText("FFI Co.")).toBeInTheDocument();
  });

  it("keeps the visa columns for a visa document", async () => {
    getEmployeeDocuments.mockResolvedValue(
      documentsResponse([
        makeDocument({
          document_type: "VISA",
          display_name: "Visa",
          visa_number: "V-88",
          exit_before: "2026-09-01",
          visa_duration: "90",
          extracted_fields: { expiry_date: "2026-12-31" },
        }),
      ]),
    );

    render(<EmployeeDocumentArchive employeeId={7} />);
    await screen.findByTestId("document-type-1");

    const visa = group("VISA");
    expect(headers(visa)).toEqual(
      expect.arrayContaining([...VISA_COLUMNS, "Expiry Date"]),
    );
    expect(within(visa).getByText("V-88")).toBeInTheDocument();
    expect(within(visa).getByText("2026-09-01")).toBeInTheDocument();
    expect(within(visa).getByText("90")).toBeInTheDocument();
    expect(within(visa).getByText("2026-12-31")).toBeInTheDocument();
  });

  it("hides columns no document in the group fills", async () => {
    getEmployeeDocuments.mockResolvedValue(
      documentsResponse([
        makeDocument({
          document_type: "PASSPORT",
          extracted_fields: {
            passport_number: "P7654321",
            full_name: "   ",
            nationality: "",
            date_of_birth: null,
            profession: [],
          },
        }),
      ]),
    );

    render(<EmployeeDocumentArchive employeeId={7} />);
    await screen.findByTestId("document-type-1");

    const passport = group("PASSPORT");
    expect(headers(passport)).toContain("Passport Number");
    for (const column of [
      "Full Name",
      "Nationality",
      "Date of Birth",
      "Issue Date",
      "Expiry Date",
      "Profession",
    ]) {
      expect(headers(passport)).not.toContain(column);
    }
  });

  it("separates the groups so a mixed archive never puts visa headers on a passport", async () => {
    getEmployeeDocuments.mockResolvedValue(
      documentsResponse([
        makeDocument({
          document_type: "PASSPORT",
          extracted_fields: { passport_number: "P1234567" },
        }),
        makeDocument({
          document_type: "VISA",
          display_name: "Visa",
          visa_number: "V-88",
          exit_before: "2026-09-01",
        }),
      ]),
    );

    render(<EmployeeDocumentArchive employeeId={7} />);
    await screen.findByTestId("document-type-1");

    expect(headers(group("PASSPORT"))).toContain("Passport Number");
    for (const column of VISA_COLUMNS) {
      expect(headers(group("PASSPORT"))).not.toContain(column);
    }
    expect(headers(group("VISA"))).toEqual(
      expect.arrayContaining(["Visa Number", "Exit Before"]),
    );
    expect(headers(group("VISA"))).not.toContain("Passport Number");
  });

  it("limits OTHER columns to approved business fields", async () => {
    getEmployeeDocuments.mockResolvedValue(
      documentsResponse([
        makeDocument({
          document_type: "OTHER",
          display_name: "Medical Certificate",
          custom_name: "Medical Certificate",
          extracted_fields: {
            full_name: "Example Employee",
            clinic_name: "City Clinic",
            parser_debug: "internal OCR diagnostic",
            raw_text: "SCANNED PAGE",
          },
        }),
      ]),
    );

    render(<EmployeeDocumentArchive employeeId={7} />);
    await screen.findByTestId("document-type-1");

    const other = group("OTHER");
    expect(headers(other)).toContain("Full Name");
    expect(headers(other)).not.toContain("Clinic Name");
    expect(headers(other)).not.toContain("Parser Debug");
    for (const column of VISA_COLUMNS) {
      expect(headers(other)).not.toContain(column);
    }
    expect(within(other).queryByText("City Clinic")).not.toBeInTheDocument();
    expect(
      within(other).queryByText("internal OCR diagnostic"),
    ).not.toBeInTheDocument();
    expect(within(other).queryByText("SCANNED PAGE")).not.toBeInTheDocument();
  });

  it("translates the metadata column titles into Arabic", async () => {
    useI18nStore.getState().setLanguage("ar");
    getEmployeeDocuments.mockResolvedValue(
      documentsResponse([
        makeDocument({
          document_type: "IQAMA",
          display_name: "الإقامة",
          extracted_fields: { iqama_number: "2123456789" },
        }),
      ]),
    );

    render(<EmployeeDocumentArchive employeeId={7} />);
    await screen.findByTestId("document-type-1");

    expect(headers(group("IQAMA"))).toContain("رقم الإقامة");
  });
});

describe("EmployeeDocumentArchive upload", () => {
  async function openUploadModal() {
    render(<EmployeeDocumentArchive employeeId={7} />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Upload Document/i }),
    );
    return screen.findByRole("dialog");
  }

  async function chooseType(dialog: HTMLElement, label: string) {
    fireEvent.mouseDown(within(dialog).getByRole("combobox"));
    const option = await screen.findByTitle(label);
    fireEvent.click(option);
  }

  function attachFile(dialog: HTMLElement, file: File) {
    const input = dialog.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
  }

  it.each([
    ["Iqama", "IQAMA"],
    ["Passport", "PASSPORT"],
    ["Visa", "VISA"],
    ["Saudi ID", "SAUDI_ID"],
  ] as [string, DocumentType][])(
    "submits %s as document_type %s",
    async (label, documentType) => {
      uploadEmployeeDocument.mockResolvedValue({
        status: "success",
        data: makeDocument(),
      });

      const dialog = await openUploadModal();
      await chooseType(dialog, label);
      const file = new File(["data"], "scan.pdf", { type: "application/pdf" });
      attachFile(dialog, file);

      fireEvent.click(within(dialog).getByRole("button", { name: "Upload" }));

      await waitFor(() =>
        expect(uploadEmployeeDocument).toHaveBeenCalledWith(7, {
          document_type: documentType,
          file,
          custom_name: undefined,
        }),
      );
    },
  );

  it("submits OTHER together with the custom name", async () => {
    uploadEmployeeDocument.mockResolvedValue({
      status: "success",
      data: makeDocument(),
    });

    const dialog = await openUploadModal();
    await chooseType(dialog, "Other");
    fireEvent.change(
      within(dialog).getByPlaceholderText(/Medical Certificate/i),
      {
        target: { value: "Medical Certificate" },
      },
    );
    const file = new File(["data"], "certificate.pdf", {
      type: "application/pdf",
    });
    attachFile(dialog, file);

    fireEvent.click(within(dialog).getByRole("button", { name: "Upload" }));

    await waitFor(() =>
      expect(uploadEmployeeDocument).toHaveBeenCalledWith(7, {
        document_type: "OTHER",
        file,
        custom_name: "Medical Certificate",
      }),
    );
  });

  it("does not carry a stale custom name onto a classified document", async () => {
    uploadEmployeeDocument.mockResolvedValue({
      status: "success",
      data: makeDocument(),
    });

    const dialog = await openUploadModal();
    await chooseType(dialog, "Other");
    fireEvent.change(
      within(dialog).getByPlaceholderText(/Medical Certificate/i),
      {
        target: { value: "Medical Certificate" },
      },
    );
    await chooseType(dialog, "Passport");
    const file = new File(["data"], "passport.pdf", {
      type: "application/pdf",
    });
    attachFile(dialog, file);

    fireEvent.click(within(dialog).getByRole("button", { name: "Upload" }));

    await waitFor(() =>
      expect(uploadEmployeeDocument).toHaveBeenCalledWith(7, {
        document_type: "PASSPORT",
        file,
        custom_name: undefined,
      }),
    );
  });

  it("does not upload when no document type is selected", async () => {
    const dialog = await openUploadModal();
    attachFile(
      dialog,
      new File(["data"], "scan.pdf", { type: "application/pdf" }),
    );

    fireEvent.click(within(dialog).getByRole("button", { name: "Upload" }));

    await waitFor(() =>
      expect(within(dialog).getByRole("combobox")).toBeInvalid(),
    );
    expect(uploadEmployeeDocument).not.toHaveBeenCalled();
  });
});

describe("EmployeeDocumentArchive starting work acknowledgment", () => {
  /**
   * How the backend files the generated acknowledgment: an OTHER document whose
   * custom name is the headline, with extraction already marked done and the
   * OCR markers standing in for extracted fields.
   */
  const acknowledgment = () =>
    makeDocument({
      document_type: "OTHER",
      custom_name: "Starting Work Acknowledgment",
      display_name: "Starting Work Acknowledgment",
      original_filename: "starting-work-acknowledgment-EMP-1-20260810.pdf",
      extraction_status: "success",
      extracted_fields: { ocr: "skipped", generated_by_system: true },
    });

  it("renders the acknowledgment under its own name", async () => {
    getEmployeeDocuments.mockResolvedValue(
      documentsResponse([acknowledgment()]),
    );

    render(<EmployeeDocumentArchive employeeId={7} canManageDocuments />);

    expect(await screen.findByTestId("document-type-1")).toHaveTextContent(
      "Starting Work Acknowledgment",
    );
  });

  it("downloads it through the existing document endpoint", async () => {
    getEmployeeDocuments.mockResolvedValue(
      documentsResponse([acknowledgment()]),
    );
    downloadEmployeeDocument.mockResolvedValue(
      new Blob(["pdf"], { type: "application/pdf" }),
    );

    render(<EmployeeDocumentArchive employeeId={7} canManageDocuments />);
    await screen.findByTestId("document-type-1");

    fireEvent.click(await screen.findByRole("button", { name: /download/i }));

    await waitFor(() =>
      expect(downloadEmployeeDocument).toHaveBeenCalledWith(7, 1),
    );
  });

  it("offers no OCR controls for a document the system generated", async () => {
    getEmployeeDocuments.mockResolvedValue(
      documentsResponse([acknowledgment()]),
    );

    render(<EmployeeDocumentArchive employeeId={7} canManageDocuments />);
    await screen.findByTestId("document-type-1");

    expect(
      screen.queryByRole("button", { name: "Run OCR extraction" }),
    ).not.toBeInTheDocument();
  });

  it("keeps the OCR re-run hidden even if the record is marked failed", async () => {
    // Guards the affordance against a future change to extraction_status.
    getEmployeeDocuments.mockResolvedValue(
      documentsResponse([{ ...acknowledgment(), extraction_status: "failed" }]),
    );

    render(<EmployeeDocumentArchive employeeId={7} canManageDocuments />);
    await screen.findByTestId("document-type-1");

    expect(
      screen.queryByRole("button", { name: "Run OCR extraction" }),
    ).not.toBeInTheDocument();
  });

  it("labels it Generated rather than reporting an OCR outcome", async () => {
    getEmployeeDocuments.mockResolvedValue(
      documentsResponse([acknowledgment()]),
    );

    render(<EmployeeDocumentArchive employeeId={7} canManageDocuments />);
    await screen.findByTestId("document-type-1");

    expect(screen.getByText("Generated")).toBeInTheDocument();
    expect(screen.queryByText("Success")).not.toBeInTheDocument();
  });

  it("does not surface the internal OCR markers as extracted fields", async () => {
    getEmployeeDocuments.mockResolvedValue(
      documentsResponse([acknowledgment()]),
    );

    render(<EmployeeDocumentArchive employeeId={7} canManageDocuments />);
    await screen.findByTestId("document-type-1");

    // With the markers filtered out there is no metadata left, so the row is
    // not expandable at all — and neither marker reaches the screen.
    expect(
      screen.queryByRole("button", { name: /expand row/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Generated By System/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/skipped/i)).not.toBeInTheDocument();
  });

  it("shows generated approval timestamps in Riyadh time", async () => {
    getEmployeeDocuments.mockResolvedValue(
      documentsResponse([
        {
          ...acknowledgment(),
          extracted_fields: {
            ocr: "skipped",
            generated_by_system: true,
            approved_at: "2026-08-31T23:57:11.810314+00:00",
          },
        },
      ]),
    );

    render(<EmployeeDocumentArchive employeeId={7} canManageDocuments />);

    expect(await screen.findByText("2026-09-01 02:57")).toBeInTheDocument();
    expect(screen.queryByText(/2026-08-31T23:57/)).not.toBeInTheDocument();
  });
});

describe("EmployeeDocumentArchive delete", () => {
  const deletable = () =>
    makeDocument({ original_filename: "passport-scan.pdf" });

  const deleteSuccess = (doc: EmployeeDocument) => ({
    status: "success" as const,
    data: {
      id: doc.id,
      employee_profile_id: 7,
      document_type: doc.document_type,
      original_filename: doc.original_filename,
      deleted: true,
    },
  });

  it("names the file in a danger confirmation before deleting anything", async () => {
    getEmployeeDocuments.mockResolvedValue(documentsResponse([deletable()]));

    render(<EmployeeDocumentArchive employeeId={7} canManageDocuments />);
    await screen.findByTestId("document-type-1");
    await openDeleteConfirmation();

    expect(
      await screen.findByTestId("delete-target-filename"),
    ).toHaveTextContent("passport-scan.pdf");
    expect(deleteEmployeeDocument).not.toHaveBeenCalled();
  });

  it("does nothing when the confirmation is cancelled", async () => {
    getEmployeeDocuments.mockResolvedValue(documentsResponse([deletable()]));

    render(<EmployeeDocumentArchive employeeId={7} canManageDocuments />);
    await screen.findByTestId("document-type-1");
    await openDeleteConfirmation();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() =>
      expect(
        screen.queryByTestId("delete-target-filename"),
      ).not.toBeInTheDocument(),
    );
    expect(deleteEmployeeDocument).not.toHaveBeenCalled();
    expect(screen.getByTestId("document-type-1")).toBeInTheDocument();
  });

  it("removes the row and reports success on a 200", async () => {
    const doc = deletable();
    getEmployeeDocuments.mockResolvedValue(documentsResponse([doc]));
    deleteEmployeeDocument.mockResolvedValue(deleteSuccess(doc));

    render(<EmployeeDocumentArchive employeeId={7} canManageDocuments />);
    await screen.findByTestId("document-type-1");
    fireEvent.click(await openDeleteConfirmation());

    await waitFor(() =>
      expect(deleteEmployeeDocument).toHaveBeenCalledWith(7, doc.id),
    );
    await waitFor(() =>
      expect(screen.queryByTestId("document-type-1")).not.toBeInTheDocument(),
    );
    expect(
      await screen.findByText("Document deleted permanently."),
    ).toBeInTheDocument();
  });

  it("disables the delete action while a deletion is in progress", async () => {
    const doc = deletable();
    getEmployeeDocuments.mockResolvedValue(documentsResponse([doc]));
    let release: (value: unknown) => void = () => {};
    deleteEmployeeDocument.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );

    render(<EmployeeDocumentArchive employeeId={7} canManageDocuments />);
    await screen.findByTestId("document-type-1");
    fireEvent.click(await openDeleteConfirmation());

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled(),
    );

    release(deleteSuccess(doc));
    await waitFor(() =>
      expect(screen.queryByTestId("document-type-1")).not.toBeInTheDocument(),
    );
  });

  // 403 is covered by the capability suite: it is a permission refusal, not a
  // statement about the document, so it does not belong in this fixed-message set.
  it.each([
    [404, "This document is no longer available in the active company."],
    [
      409,
      "This document is already being deleted, or another record still protects it.",
    ],
  ])("keeps the row and explains a %s refusal", async (status, expected) => {
    const doc = deletable();
    getEmployeeDocuments.mockResolvedValue(documentsResponse([doc]));
    deleteEmployeeDocument.mockRejectedValue(
      apiRejection(status as number, "backend detail"),
    );

    render(<EmployeeDocumentArchive employeeId={7} canManageDocuments />);
    await screen.findByTestId("document-type-1");
    fireEvent.click(await openDeleteConfirmation());

    expect(await screen.findByText(expected as string)).toBeInTheDocument();
    expect(screen.getByTestId("document-type-1")).toBeInTheDocument();
  });

  it("re-fetches after a storage-failure 500, where the document may still exist", async () => {
    const doc = deletable();
    getEmployeeDocuments.mockResolvedValue(documentsResponse([doc]));
    deleteEmployeeDocument.mockRejectedValue(
      apiRejection(
        500,
        "The document file could not be deleted from storage. Nothing was removed; try again.",
      ),
    );

    render(<EmployeeDocumentArchive employeeId={7} canManageDocuments />);
    await screen.findByTestId("document-type-1");
    const listCalls = getEmployeeDocuments.mock.calls.length;
    fireEvent.click(await openDeleteConfirmation());

    await waitFor(() =>
      expect(getEmployeeDocuments.mock.calls.length).toBeGreaterThan(listCalls),
    );
    expect(
      await screen.findByText(/could not be deleted from storage/i),
    ).toBeInTheDocument();
    expect(screen.getByTestId("document-type-1")).toBeInTheDocument();
  });

  it("re-fetches on a cleanup_pending 500 and never restores the hidden row", async () => {
    const doc = deletable();
    getEmployeeDocuments.mockResolvedValueOnce(documentsResponse([doc]));
    // The record is hidden for reconciliation, so the refreshed list omits it.
    getEmployeeDocuments.mockResolvedValue(documentsResponse([]));
    deleteEmployeeDocument.mockRejectedValue(
      apiRejection(
        500,
        "The document file was permanently removed, but the archive entry could not be cleared. It is hidden and will be cleaned up automatically.",
      ),
    );

    render(<EmployeeDocumentArchive employeeId={7} canManageDocuments />);
    await screen.findByTestId("document-type-1");
    fireEvent.click(await openDeleteConfirmation());

    await waitFor(() =>
      expect(screen.queryByTestId("document-type-1")).not.toBeInTheDocument(),
    );
    expect(
      await screen.findByText(/hidden and will be cleaned up automatically/i),
    ).toBeInTheDocument();
    expect(screen.getByText("No documents uploaded yet.")).toBeInTheDocument();
  });

  it("offers no delete action for a system-generated document", async () => {
    getEmployeeDocuments.mockResolvedValue(
      documentsResponse([
        makeDocument({
          is_system_generated: true,
          original_filename: "starting-work-acknowledgment.pdf",
        }),
      ]),
    );

    render(<EmployeeDocumentArchive employeeId={7} canManageDocuments />);
    await screen.findByTestId("document-type-1");

    expect(
      screen.queryByRole("button", { name: "Delete" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Run OCR extraction" }),
    ).not.toBeInTheDocument();
  });

  it("offers no delete action in readonly mode", async () => {
    getEmployeeDocuments.mockResolvedValue(documentsResponse([deletable()]));

    render(
      <EmployeeDocumentArchive employeeId={7} readonly canManageDocuments />,
    );
    await screen.findByTestId("document-type-1");

    expect(
      screen.queryByRole("button", { name: "Delete" }),
    ).not.toBeInTheDocument();
  });
});

describe("EmployeeDocumentArchive OCR reliability signals", () => {
  it("presents a partial result as concise HR guidance without technical diagnostics", async () => {
    getEmployeeDocuments.mockResolvedValue(
      documentsResponse([
        makeDocument({
          extraction_status: "partial",
          extraction_confidence: 0.62,
          extraction_attempts: 2,
          extraction_completed_at: "2026-08-31T23:57:11.810314+00:00",
          extraction_warnings: [
            "No passport machine readable zone was detected.",
            "Could not extract: Passport Number, Full Name.",
          ],
          extraction_error: "PaddleOCR MRZ parser returned no matches.",
          extraction_metadata: {
            engine: "paddleocr",
            engine_version: "2.10.0",
            languages: ["en", "ar"],
            min_confidence: 0.6,
            line_count: 18,
            duration_ms: 18284,
            field_confidence: { passport_number: 0.4 },
          },
          extracted_fields: {
            passport_number: "P1234567",
            parser_debug: "INTERNAL ONLY",
          },
        }),
      ]),
    );

    render(<EmployeeDocumentArchive employeeId={7} canManageDocuments />);
    await screen.findByTestId("document-type-1");
    await expandFirstRow();

    expect(
      await screen.findByTestId("verification-required-1"),
    ).toHaveTextContent(/Compare every suggested value/i);
    expect(screen.getByText("Suggested metadata (OCR)")).toBeInTheDocument();
    expect(
      screen.getByText(/Nothing here is approved employee data/i),
    ).toBeInTheDocument();
    const fields = screen.getByTestId("extracted-fields-1");
    expect(within(fields).getByText("Passport Number:")).toBeInTheDocument();
    expect(within(fields).getByText("P1234567")).toBeInTheDocument();

    const status = screen.getByTestId("extraction-status-1");
    expect(within(status).getByText("Needs review")).toBeInTheDocument();
    expect(within(status).getByText("62%")).toBeInTheDocument();
    expect(within(status).getByText("2026-09-01 02:57")).toBeInTheDocument();
    for (const technicalText of [
      "2",
      "paddleocr",
      "2.10.0",
      "en, ar",
      "0.6",
      "18",
      "18284",
      "No passport machine readable zone was detected.",
      "Could not extract: Passport Number, Full Name.",
      "PaddleOCR MRZ parser returned no matches.",
      "INTERNAL ONLY",
    ]) {
      expect(screen.queryByText(technicalText)).not.toBeInTheDocument();
    }
  });

  it("uses localized decision labels and guidance for a failed extraction", async () => {
    useI18nStore.getState().setLanguage("ar");
    getEmployeeDocuments.mockResolvedValue(
      documentsResponse([
        makeDocument({
          extraction_status: "failed",
          extraction_error: "PaddleOCR internal failure",
          extraction_warnings: ["MRZ parser did not find a line."],
        }),
      ]),
    );

    render(<EmployeeDocumentArchive employeeId={7} canManageDocuments />);
    await screen.findByTestId("document-type-1");
    await expandFirstRow();

    const status = screen.getByTestId("extraction-status-1");
    expect(within(status).getByText("فشل")).toBeInTheDocument();
    expect(
      screen.getByText(/تعذر على OCR قراءة هذا المستند/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("PaddleOCR internal failure"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("MRZ parser did not find a line."),
    ).not.toBeInTheDocument();
  });

  it("never renders raw OCR text, whatever key carries it", async () => {
    getEmployeeDocuments.mockResolvedValue(
      documentsResponse([
        makeDocument({
          extraction_status: "partial",
          extraction_confidence: 0.5,
          extracted_fields: {
            passport_number: "P1234567",
            raw_text: "SECRET RAW SCAN LINE",
            ocr_text: "SECRET RAW SCAN LINE",
            passport_number_raw: "SECRET RAW SCAN LINE",
          },
          extraction_metadata: {
            engine: "paddleocr",
            raw_text: "SECRET RAW SCAN LINE",
            field_confidence: { passport_number: 0.5 },
          },
        }),
      ]),
    );

    render(<EmployeeDocumentArchive employeeId={7} canManageDocuments />);
    await screen.findByTestId("document-type-1");
    await expandFirstRow();

    const panel = await screen.findByTestId("extracted-fields-1");
    expect(within(panel).getByText("P1234567")).toBeInTheDocument();
    expect(screen.queryByText(/SECRET RAW SCAN LINE/)).not.toBeInTheDocument();
    expect(screen.queryByText(/field_confidence/i)).not.toBeInTheDocument();
  });

  it("keeps polling a pending extraction past the former 60-second stop", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      // A fresh array per call, as the real client returns: the archive keeps a
      // new list in state each poll, which is what re-arms the next tick.
      const pending = makeDocument({
        extraction_status: "pending",
        extraction_attempts: 1,
      });
      getEmployeeDocuments.mockImplementation(async () =>
        documentsResponse([{ ...pending }]),
      );

      render(<EmployeeDocumentArchive employeeId={7} canManageDocuments />);
      await screen.findByTestId("document-type-1");

      // Well past the old 24-attempt / 60-second cap, which stopped silently.
      for (let i = 0; i < 60; i += 1) {
        await vi.advanceTimersByTimeAsync(2500);
      }

      expect(getEmployeeDocuments.mock.calls.length).toBeGreaterThan(25);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops polling once the extraction reaches a terminal status", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      getEmployeeDocuments.mockResolvedValue(
        documentsResponse([makeDocument({ extraction_status: "success" })]),
      );

      render(<EmployeeDocumentArchive employeeId={7} canManageDocuments />);
      await screen.findByTestId("document-type-1");
      const settled = getEmployeeDocuments.mock.calls.length;

      for (let i = 0; i < 5; i += 1) {
        await vi.advanceTimersByTimeAsync(2500);
      }

      expect(getEmployeeDocuments.mock.calls.length).toBe(settled);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("EmployeeDocumentArchive document management capability", () => {
  const userUploaded = () =>
    makeDocument({
      extraction_status: "failed",
      original_filename: "passport-scan.pdf",
    });

  it("offers no delete and no OCR retry when the capability is absent", async () => {
    // What an ordinary employee sees on their own profile: the archive is
    // writable for uploads, but carries no management controls.
    getEmployeeDocuments.mockResolvedValue(documentsResponse([userUploaded()]));

    render(<EmployeeDocumentArchive employeeId={7} readonly={false} />);
    await screen.findByTestId("document-type-1");

    expect(
      screen.queryByRole("button", { name: "Delete" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Run OCR extraction" }),
    ).not.toBeInTheDocument();
    // Reading the archive is still allowed.
    expect(
      screen.getByRole("button", { name: /download/i }),
    ).toBeInTheDocument();
  });

  it("offers delete and OCR retry for a user-uploaded document when the capability is granted", async () => {
    getEmployeeDocuments.mockResolvedValue(documentsResponse([userUploaded()]));

    render(<EmployeeDocumentArchive employeeId={7} canManageDocuments />);
    await screen.findByTestId("document-type-1");

    expect(
      await screen.findByRole("button", { name: "Delete" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Run OCR extraction" }),
    ).toBeInTheDocument();
  });

  it("keeps a system-generated document undeletable even with the capability", async () => {
    getEmployeeDocuments.mockResolvedValue(
      documentsResponse([
        makeDocument({
          is_system_generated: true,
          extraction_status: "failed",
          original_filename: "starting-work-acknowledgment.pdf",
        }),
      ]),
    );

    render(<EmployeeDocumentArchive employeeId={7} canManageDocuments />);
    await screen.findByTestId("document-type-1");

    expect(
      screen.queryByRole("button", { name: "Delete" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Run OCR extraction" }),
    ).not.toBeInTheDocument();
  });

  it("reports a generic 403 as a permission problem, not as a system-generated document", async () => {
    const doc = userUploaded();
    getEmployeeDocuments.mockResolvedValue(documentsResponse([doc]));
    // The backend returns a bare "Forbidden." for a role or company-scope refusal.
    deleteEmployeeDocument.mockRejectedValue(apiRejection(403, "Forbidden."));

    render(<EmployeeDocumentArchive employeeId={7} canManageDocuments />);
    await screen.findByTestId("document-type-1");
    fireEvent.click(await openDeleteConfirmation());

    expect(await screen.findByText("Forbidden.")).toBeInTheDocument();
    expect(
      screen.queryByText(/System-generated documents cannot be deleted/i),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("document-type-1")).toBeInTheDocument();
  });

  it("falls back to a permission message when a 403 carries no detail", async () => {
    const doc = userUploaded();
    getEmployeeDocuments.mockResolvedValue(documentsResponse([doc]));
    const bare = Object.assign(new Error(""), {
      message: "",
      response: { status: 403, data: {} },
    });
    deleteEmployeeDocument.mockRejectedValue(bare);

    render(<EmployeeDocumentArchive employeeId={7} canManageDocuments />);
    await screen.findByTestId("document-type-1");
    fireEvent.click(await openDeleteConfirmation());

    expect(
      await screen.findByText(
        "You do not have permission to delete this document.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId("document-type-1")).toBeInTheDocument();
  });
});
