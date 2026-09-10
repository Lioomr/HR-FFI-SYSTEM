import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("../../services/api/employeeSignatureApi", async () => {
  const actual = await vi.importActual<
    typeof import("../../services/api/employeeSignatureApi")
  >("../../services/api/employeeSignatureApi");
  return {
    ...actual,
    getMySignature: vi.fn(),
    getMySignaturePreview: vi.fn(),
    uploadMySignature: vi.fn(),
    deleteMySignature: vi.fn(),
  };
});

import EmployeeSignatureCard from "./EmployeeSignatureCard";
import {
  deleteMySignature,
  getMySignature,
  getMySignaturePreview,
  uploadMySignature,
  type EmployeeSignatureState,
} from "../../services/api/employeeSignatureApi";
import { useI18nStore } from "../../i18n/i18nStore";

const getState = getMySignature as unknown as ReturnType<typeof vi.fn>;
const getPreview = getMySignaturePreview as unknown as ReturnType<typeof vi.fn>;
const upload = uploadMySignature as unknown as ReturnType<typeof vi.fn>;
const remove = deleteMySignature as unknown as ReturnType<typeof vi.fn>;

const stored: EmployeeSignatureState = {
  has_signature: true,
  uploaded_at: "2026-09-05T12:31:44+00:00",
  content_type: "image/png",
  size_bytes: 1180,
  preview_url: "/employees/42/signature/preview",
};

const empty: EmployeeSignatureState = {
  has_signature: false,
  uploaded_at: null,
  content_type: null,
  size_bytes: null,
  preview_url: null,
};

const ok = (data: EmployeeSignatureState) => ({
  status: "success" as const,
  data,
});

const httpError = (status: number) => {
  const error = new Error("request failed") as Error & {
    response: { status: number };
  };
  error.response = { status };
  return error;
};

/** Drops a file on the hidden input Ant Design's Upload renders. */
function selectFile(file: File) {
  const input = document.querySelector(
    'input[type="file"]',
  ) as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
}

function pngFile(name = "signature.png", size = 1180): File {
  const file = new File(["png-bytes"], name, { type: "image/png" });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

beforeEach(() => {
  getState.mockReset();
  getPreview.mockReset();
  upload.mockReset();
  remove.mockReset();
  getPreview.mockResolvedValue(new Blob(["png"], { type: "image/png" }));
  useI18nStore.getState().setLanguage("en");
  if (!URL.createObjectURL) {
    Object.defineProperty(URL, "createObjectURL", {
      value: vi.fn(),
      writable: true,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      value: vi.fn(),
      writable: true,
    });
  }
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:signature");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});

describe("EmployeeSignatureCard", () => {
  it("invites an upload when nothing is stored", async () => {
    getState.mockResolvedValue(ok(empty));

    render(<EmployeeSignatureCard />);

    expect(await screen.findByText("No signature saved")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Upload signature/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Remove/ })).toBeNull();
    expect(getPreview).not.toHaveBeenCalled();
  });

  it("names the forms the signature is printed on", async () => {
    getState.mockResolvedValue(ok(empty));

    render(<EmployeeSignatureCard />);

    const hint = await screen.findByText(/Printed on the forms you submit/);
    expect(hint).toHaveTextContent("leave request");
    expect(hint).toHaveTextContent("loan request");
    expect(hint).toHaveTextContent("job offer");
    expect(hint).toHaveTextContent("starting-work acknowledgment");
    expect(hint).toHaveTextContent("annual entitlements disbursement");
  });

  it("renders the stored image from an authenticated blob", async () => {
    getState.mockResolvedValue(ok(stored));

    render(<EmployeeSignatureCard />);

    const image = (await screen.findByAltText(
      "Your saved signature",
    )) as HTMLImageElement;
    expect(image.src).toBe("blob:signature");
    expect(getPreview).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /Replace/ })).toBeInTheDocument();
  });

  it("uploads a valid PNG and reloads the state", async () => {
    getState.mockResolvedValueOnce(ok(empty)).mockResolvedValue(ok(stored));
    upload.mockResolvedValue(ok(stored));

    render(<EmployeeSignatureCard />);
    await screen.findByText("No signature saved");

    const file = pngFile();
    selectFile(file);

    await waitFor(() => expect(upload).toHaveBeenCalledWith(file));
    expect(await screen.findByText("Signature saved.")).toBeInTheDocument();
    expect(
      await screen.findByAltText("Your saved signature"),
    ).toBeInTheDocument();
  });

  it("refuses an SVG locally without calling the API", async () => {
    getState.mockResolvedValue(ok(empty));

    render(<EmployeeSignatureCard />);
    await screen.findByText("No signature saved");

    selectFile(
      new File(["<svg/>"], "signature.svg", { type: "image/svg+xml" }),
    );

    expect(
      await screen.findByText(
        "Unsupported file type. Upload a PNG or JPG image.",
      ),
    ).toBeInTheDocument();
    expect(upload).not.toHaveBeenCalled();
  });

  it("refuses a file over 2 MB locally without calling the API", async () => {
    getState.mockResolvedValue(ok(empty));

    render(<EmployeeSignatureCard />);
    await screen.findByText("No signature saved");

    selectFile(pngFile("big.png", 2 * 1024 * 1024 + 1));

    expect(
      await screen.findByText("Signature image is too large. Maximum 2 MB."),
    ).toBeInTheDocument();
    expect(upload).not.toHaveBeenCalled();
  });

  it("surfaces a server rejection instead of claiming success", async () => {
    getState.mockResolvedValue(ok(empty));
    const rejected = new Error(
      "File content does not match its extension.",
    ) as Error & { response: { status: number } };
    rejected.response = { status: 422 };
    upload.mockRejectedValue(rejected);

    render(<EmployeeSignatureCard />);
    await screen.findByText("No signature saved");

    selectFile(pngFile());

    expect(
      await screen.findByText("File content does not match its extension."),
    ).toBeInTheDocument();
  });

  it("removes the signature after confirmation", async () => {
    getState.mockResolvedValueOnce(ok(stored)).mockResolvedValue(ok(empty));
    remove.mockResolvedValue(ok(empty));

    render(<EmployeeSignatureCard />);
    fireEvent.click(await screen.findByRole("button", { name: /Remove/ }));

    fireEvent.click(await screen.findByRole("button", { name: /^Yes$/ }));

    await waitFor(() => expect(remove).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Signature removed.")).toBeInTheDocument();
    expect(await screen.findByText("No signature saved")).toBeInTheDocument();
  });

  it("keeps the actions usable when the preview image cannot load", async () => {
    getState.mockResolvedValue(ok(stored));
    getPreview.mockRejectedValue(httpError(404));

    render(<EmployeeSignatureCard />);

    expect(
      await screen.findByText("Could not load the signature preview."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Replace/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Remove/ })).toBeInTheDocument();
  });

  it("offers a retry when the state request fails", async () => {
    getState.mockRejectedValueOnce(httpError(500)).mockResolvedValue(ok(empty));

    render(<EmployeeSignatureCard />);

    fireEvent.click(await screen.findByRole("button", { name: /Retry/ }));

    expect(await screen.findByText("No signature saved")).toBeInTheDocument();
  });

  it("renders Arabic labels", async () => {
    useI18nStore.getState().setLanguage("ar");
    getState.mockResolvedValue(ok(empty));

    render(<EmployeeSignatureCard />);

    expect(await screen.findByText("لا يوجد توقيع محفوظ")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /رفع التوقيع/ }),
    ).toBeInTheDocument();
  });
});
