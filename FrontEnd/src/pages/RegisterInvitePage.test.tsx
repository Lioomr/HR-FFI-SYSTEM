import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("../services/api/invitesApi", () => ({
  validateInviteToken: vi.fn(),
  acceptInvite: vi.fn(),
}));

import RegisterInvitePage from "./RegisterInvitePage";
import * as invitesApi from "../services/api/invitesApi";
import { useI18nStore } from "../i18n/i18nStore";

const validateInviteToken =
  invitesApi.validateInviteToken as unknown as ReturnType<typeof vi.fn>;
const acceptInvite = invitesApi.acceptInvite as unknown as ReturnType<
  typeof vi.fn
>;

const inviteMeta = (overrides: Record<string, unknown>) => ({
  status: "success" as const,
  data: {
    email: null,
    phone_number: null,
    channel: "email",
    role: "Employee",
    expires_at: "2026-08-20T09:00:00Z",
    ...overrides,
  },
});

beforeEach(() => {
  validateInviteToken.mockReset();
  acceptInvite.mockReset();
  useI18nStore.getState().setLanguage("en");
});

async function renderPage() {
  render(
    <MemoryRouter initialEntries={["/register-invite?token=tok-123"]}>
      <Routes>
        <Route path="/register-invite" element={<RegisterInvitePage />} />
      </Routes>
    </MemoryRouter>,
  );
  await waitFor(() =>
    expect(validateInviteToken).toHaveBeenCalledWith("tok-123"),
  );
  await waitFor(() => expect(document.querySelector("#email")).not.toBeNull());
  return document.querySelector<HTMLInputElement>("#email")!;
}

function setField(selector: string, value: string) {
  const input = document.querySelector<HTMLInputElement>(selector);
  expect(input).not.toBeNull();
  fireEvent.change(input!, { target: { value } });
}

/** Fills the non-email fields and submits the registration form. */
function submitRegistration() {
  setField("#full_name", "Sara Ahmed");
  setField("#password", "Str0ng!Passw0rd");
  setField("#confirm_password", "Str0ng!Passw0rd");
  fireEvent.click(screen.getByRole("button", { name: "Complete" }));
}

describe("RegisterInvitePage email lock", () => {
  it("locks the prefilled email on a WhatsApp invite HR supplied it for", async () => {
    validateInviteToken.mockResolvedValue(
      inviteMeta({
        channel: "whatsapp",
        email: "sara@ffi.test",
        phone_number: "+966512345678",
      }),
    );

    const emailInput = await renderPage();

    await waitFor(() => expect(emailInput.value).toBe("sara@ffi.test"));
    expect(emailInput).toBeDisabled();
  });

  it("keeps the email editable and required on a WhatsApp invite without one", async () => {
    validateInviteToken.mockResolvedValue(
      inviteMeta({
        channel: "whatsapp",
        email: null,
        phone_number: "+966512345678",
      }),
    );

    const emailInput = await renderPage();

    expect(emailInput).not.toBeDisabled();
    expect(emailInput.value).toBe("");

    // Submitting without an email must be blocked before any request goes out.
    fireEvent.click(screen.getByRole("button", { name: "Complete" }));
    expect(await screen.findByText("Email is required")).toBeInTheDocument();
    expect(acceptInvite).not.toHaveBeenCalled();
  });

  it("still locks the prefilled email on an email invite", async () => {
    validateInviteToken.mockResolvedValue(
      inviteMeta({ email: "hire@ffi.test" }),
    );

    const emailInput = await renderPage();

    await waitFor(() => expect(emailInput.value).toBe("hire@ffi.test"));
    expect(emailInput).toBeDisabled();
  });
});

describe("RegisterInvitePage WhatsApp signup submission", () => {
  it("submits the entered email together with the invited phone number", async () => {
    validateInviteToken.mockResolvedValue(
      inviteMeta({
        channel: "whatsapp",
        email: null,
        phone_number: "+966512345678",
      }),
    );
    acceptInvite.mockResolvedValue({
      status: "success",
      data: { email: "sara@ffi.test", role: "Employee" },
    });

    await renderPage();

    // The invited number is prefilled, so only the email needs filling in.
    await waitFor(() =>
      expect(
        document.querySelector<HTMLInputElement>('input[autocomplete="tel"]')
          ?.value,
      ).toBe("512345678"),
    );
    setField("#email", "sara@ffi.test");
    submitRegistration();

    await waitFor(() =>
      expect(acceptInvite).toHaveBeenCalledWith({
        token: "tok-123",
        email: "sara@ffi.test",
        phone_number: "+966512345678",
        full_name: "Sara Ahmed",
        password: "Str0ng!Passw0rd",
      }),
    );
  });

  it("submits the locked email and the invited phone number untouched", async () => {
    validateInviteToken.mockResolvedValue(
      inviteMeta({
        channel: "whatsapp",
        email: "sara@ffi.test",
        phone_number: "+966512345678",
      }),
    );
    acceptInvite.mockResolvedValue({
      status: "success",
      data: { email: "sara@ffi.test", role: "Employee" },
    });

    const emailInput = await renderPage();
    await waitFor(() => expect(emailInput.value).toBe("sara@ffi.test"));
    expect(emailInput).toBeDisabled();

    submitRegistration();

    await waitFor(() =>
      expect(acceptInvite).toHaveBeenCalledWith({
        token: "tok-123",
        email: "sara@ffi.test",
        phone_number: "+966512345678",
        full_name: "Sara Ahmed",
        password: "Str0ng!Passw0rd",
      }),
    );
  });

  it("blocks submission when a WhatsApp invite has no phone number to fall back on", async () => {
    validateInviteToken.mockResolvedValue(
      inviteMeta({
        channel: "whatsapp",
        email: "sara@ffi.test",
        phone_number: null,
      }),
    );

    await renderPage();
    submitRegistration();

    expect(
      await screen.findByText("Phone number is required"),
    ).toBeInTheDocument();
    expect(acceptInvite).not.toHaveBeenCalled();
  });
});
