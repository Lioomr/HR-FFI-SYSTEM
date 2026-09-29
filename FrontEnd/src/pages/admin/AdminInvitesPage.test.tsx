import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../../services/api/invitesApi", () => ({
  listInvites: vi.fn(),
  createInvite: vi.fn(),
  resendInvite: vi.fn(),
  revokeInvite: vi.fn(),
}));

vi.mock("../../services/api/employeesApi", () => ({
  listEmployees: vi.fn(),
}));

import AdminInvitesPage from "./AdminInvitesPage";
import * as invitesApi from "../../services/api/invitesApi";
import * as employeesApi from "../../services/api/employeesApi";
import type { InviteDto } from "../../services/api/apiTypes";
import { useI18nStore } from "../../i18n/i18nStore";
import { useAuthStore } from "../../auth/authStore";

const listInvites = invitesApi.listInvites as unknown as ReturnType<
  typeof vi.fn
>;
const createInvite = invitesApi.createInvite as unknown as ReturnType<
  typeof vi.fn
>;

const baseInvite = {
  status: "sent",
  sent_at: "2026-08-01T09:00:00Z",
  expires_at: "2026-08-08T09:00:00Z",
  resend_count: 0,
  last_resent_at: null,
};

// A WhatsApp invite HR sent together with the employee email.
const whatsappWithEmail: InviteDto = {
  ...baseInvite,
  id: 1,
  email: "sara@ffi.test",
  phone_number: "+966512345678",
  channel: "whatsapp",
  role: "Employee",
  last_delivery: {
    channel: "whatsapp",
    sent: true,
    // Raw provider metadata is still part of the contract; the UI must ignore it.
    provider: "evolution-api",
    provider_submitted: true,
    delivery_status: "delivered",
  },
};

// A WhatsApp invite with no email yet — the employee supplies it during signup.
const whatsappWithoutEmail: InviteDto = {
  ...baseInvite,
  id: 2,
  email: null,
  phone_number: "+966599887766",
  channel: "whatsapp",
  role: "Employee",
  last_delivery: {
    channel: "whatsapp",
    sent: false,
    provider: "bird",
    provider_submitted: false,
    delivery_status: "failed",
    error: "Bird rejected the request.",
  },
};

// The same invite after signup: the backend now persists the email the employee
// supplied, so HR sees it on the next refresh.
const whatsappAcceptedWithEmail: InviteDto = {
  ...whatsappWithoutEmail,
  status: "accepted",
  email: "late.signup@ffi.test",
};

// A row created before Manager invites were dropped.
const legacyManagerInvite: InviteDto = {
  ...baseInvite,
  id: 3,
  email: "old.manager@ffi.test",
  phone_number: null,
  channel: "email",
  role: "Manager",
  last_delivery: {
    channel: "email",
    sent: true,
    provider: "bird",
    delivery_status: "sent",
  },
};

const page = (
  items: InviteDto[],
  pendingCount = items.filter((item) => item.status === "sent").length,
) => ({
  status: "success" as const,
  data: {
    items,
    page: 1,
    page_size: 8,
    count: items.length,
    pending_count: pendingCount,
  },
});

function createdInvite(overrides: Partial<InviteDto> = {}): {
  status: "success";
  data: InviteDto;
} {
  return {
    status: "success",
    data: {
      ...baseInvite,
      id: 99,
      email: null,
      phone_number: "+966512345678",
      channel: "whatsapp",
      role: "Employee",
      whatsapp_delivery: {
        sent: true,
        provider: "evolution-api",
        delivery_status: "sent",
      },
      ...overrides,
    } as InviteDto,
  };
}

const listEmployees = employeesApi.listEmployees as unknown as ReturnType<
  typeof vi.fn
>;

beforeEach(() => {
  listInvites.mockReset();
  createInvite.mockReset();
  listEmployees.mockResolvedValue({
    status: "success",
    data: {
      results: [{ id: 7, full_name: "Sara Ali", employee_id: "FFI-7" }],
      count: 1,
    },
  });
  useI18nStore.getState().setLanguage("en");
  useAuthStore.setState({
    isAuthenticated: true,
    user: { id: "1", email: "hr@ffi.test", role: "HRManager" },
  } as any);
});

/** Picks the employee the invitation gives an account to. */
async function chooseEmployee() {
  fireEvent.mouseDown(document.querySelector("#employee_profile_id")!);
  fireEvent.click(await screen.findByTitle("Sara Ali (FFI-7)"));
}

/** Renders the page and waits for the initial invite load to settle. */
async function renderPage(items: InviteDto[] = [], pendingCount?: number) {
  listInvites.mockResolvedValue(page(items, pendingCount));
  const utils = render(<AdminInvitesPage />);
  await waitFor(() => expect(listInvites).toHaveBeenCalled());
  await screen.findByRole("heading", { name: "Send invitation" });
  return utils;
}

/** Switches the channel segmented control to WhatsApp. */
async function chooseWhatsappChannel() {
  const options = Array.from(
    document.querySelectorAll<HTMLInputElement>(".ant-segmented-item-input"),
  );
  expect(options).toHaveLength(2);
  fireEvent.click(options[1]);
  await screen.findByText("Phone Number");
}

function typePhone(localNumber: string) {
  const phoneInput = document.querySelector<HTMLInputElement>(
    'input[autocomplete="tel"]',
  );
  expect(phoneInput).not.toBeNull();
  fireEvent.change(phoneInput!, { target: { value: localNumber } });
}

function typeEmail(value: string) {
  const emailInput = document.querySelector<HTMLInputElement>("#email");
  expect(emailInput).not.toBeNull();
  fireEvent.change(emailInput!, { target: { value } });
}

function submitInvite() {
  fireEvent.click(screen.getByRole("button", { name: "Send Invite" }));
}

describe("AdminInvitesPage — WhatsApp invite creation", () => {
  it("submits the phone number as the only recipient detail", async () => {
    await renderPage();
    createInvite.mockResolvedValue(createdInvite());

    await chooseEmployee();
    await chooseWhatsappChannel();
    typePhone("512345678");
    submitInvite();

    await waitFor(() =>
      expect(createInvite).toHaveBeenCalledWith({
        channel: "whatsapp",
        phone_number: "+966512345678",
        role: "Employee",
        employee_profile_id: 7,
      }),
    );
  });

  it("does not ask HR for an employee email on the WhatsApp form", async () => {
    await renderPage();
    await chooseWhatsappChannel();

    expect(screen.queryByText(/employee email/i)).not.toBeInTheDocument();
    expect(document.querySelector("#email")).toBeNull();
  });

  it("keeps the email channel submitting a plain email payload", async () => {
    await renderPage();
    createInvite.mockResolvedValue(
      createdInvite({
        channel: "email",
        email: "someone@ffi.test",
        phone_number: null,
        whatsapp_delivery: undefined,
        email_delivery: {
          sent: true,
          provider: "bird",
          delivery_status: "sent",
        },
      }),
    );

    await chooseEmployee();
    typeEmail("someone@ffi.test");
    submitInvite();

    await waitFor(() =>
      expect(createInvite).toHaveBeenCalledWith({
        channel: "email",
        email: "someone@ffi.test",
        role: "Employee",
        employee_profile_id: 7,
      }),
    );
  });

  it("will not send an invitation until HR picks the employee", async () => {
    await renderPage();

    typeEmail("someone@ffi.test");
    submitInvite();

    expect(
      await screen.findByText("Select the employee this invitation is for"),
    ).toBeInTheDocument();
    expect(createInvite).not.toHaveBeenCalled();
    expect(listEmployees).toHaveBeenCalledWith(
      expect.objectContaining({ account: "unlinked" }),
    );
  });
});

describe("AdminInvitesPage — recipient column", () => {
  it("shows the WhatsApp number with the email as a secondary line", async () => {
    await renderPage([whatsappWithEmail]);

    expect(await screen.findByText("+966512345678")).toBeInTheDocument();
    expect(screen.getByText("sara@ffi.test")).toBeInTheDocument();
  });

  it("tells HR the email is still missing before the invite is accepted", async () => {
    await renderPage([whatsappWithoutEmail]);

    expect(await screen.findByText("+966599887766")).toBeInTheDocument();
    expect(
      screen.getByText("Email will be added during signup."),
    ).toBeInTheDocument();
  });

  it("shows the email the employee supplied once the backend has saved it", async () => {
    await renderPage([whatsappAcceptedWithEmail]);

    expect(await screen.findByText("+966599887766")).toBeInTheDocument();
    expect(screen.getByText("late.signup@ffi.test")).toBeInTheDocument();
    expect(
      screen.queryByText("Email will be added during signup."),
    ).not.toBeInTheDocument();
  });

  it("shows the email as the primary line for email invites", async () => {
    await renderPage([legacyManagerInvite]);

    expect(await screen.findByText("old.manager@ffi.test")).toBeInTheDocument();
    expect(
      screen.queryByText("Email will be added during signup."),
    ).not.toBeInTheDocument();
  });

  it("offers a generic recipient search placeholder", async () => {
    await renderPage([whatsappWithEmail]);

    expect(
      screen.getByPlaceholderText("Search by email or phone"),
    ).toBeInTheDocument();
  });

  it("normalizes the search term before sending it to the API", async () => {
    await renderPage([whatsappWithEmail]);
    listInvites.mockClear();

    fireEvent.change(screen.getByPlaceholderText("Search by email or phone"), {
      // Control characters and padding are stripped; the apostrophe in a real
      // surname must survive untouched.
      target: { value: "  o'brien    " },
    });

    await waitFor(() =>
      expect(listInvites).toHaveBeenCalledWith(
        expect.objectContaining({ search: "o'brien" }),
      ),
    );
  });
});

describe("AdminInvitesPage — pending total", () => {
  it("uses the company total returned by the API instead of the current page length", async () => {
    await renderPage([whatsappWithEmail], 3);

    expect(
      await screen.findByText("Pending invitations: 3"),
    ).toBeInTheDocument();
  });
});

describe("AdminInvitesPage — roles", () => {
  it("does not offer Manager when sending a new invite", async () => {
    await renderPage();

    const roleSelect = document.querySelector("#role");
    expect(roleSelect).not.toBeNull();
    fireEvent.mouseDown(roleSelect!);

    const dropdown = await waitFor(() => {
      const el = document.querySelector(".ant-select-dropdown");
      expect(el).not.toBeNull();
      return el!;
    });
    const optionTitles = Array.from(
      dropdown.querySelectorAll(".ant-select-item-option"),
    ).map((o) => o.getAttribute("title"));

    expect(optionTitles).toContain("Employee");
    expect(optionTitles).not.toContain("Manager");
  });

  it("marks an existing Manager invite as a legacy role", async () => {
    await renderPage([legacyManagerInvite]);

    expect(await screen.findByText("Legacy manager role")).toBeInTheDocument();
    expect(screen.queryByText("Manager")).not.toBeInTheDocument();
  });
});

describe("AdminInvitesPage — delivery reporting", () => {
  it("labels delivery state without naming the delivery provider", async () => {
    await renderPage([
      whatsappWithEmail,
      whatsappWithoutEmail,
      legacyManagerInvite,
    ]);

    expect(await screen.findByText("Delivered")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("Sent")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/bird|evolution/i);
  });

  it("does not expose the WhatsApp provider test tool to HR", async () => {
    await renderPage([whatsappWithEmail]);

    expect(screen.queryByText(/test whatsapp/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /test whatsapp/i }),
    ).not.toBeInTheDocument();
  });
});

describe("AdminInvitesPage — employee picker search", () => {
  const essam = {
    status: "success",
    data: {
      results: [{ id: 9, full_name: "Essam Kamel", employee_id: "ASECO-9" }],
      count: 1,
    },
  };

  it("keeps the chosen employee's name after the list reloads without them", async () => {
    await renderPage();
    const input = document.querySelector<HTMLInputElement>(
      "#employee_profile_id",
    )!;
    fireEvent.mouseDown(input);
    listEmployees.mockResolvedValueOnce(essam);
    fireEvent.change(input, { target: { value: "es" } });
    fireEvent.click(await screen.findByTitle("Essam Kamel (ASECO-9)"));

    // Closing reloads the unfiltered list, which does not include Essam.
    fireEvent.keyDown(input, {
      key: "Escape",
      code: "Escape",
      keyCode: 27,
      which: 27,
    });
    input.blur();
    await waitFor(() =>
      expect(listEmployees).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: undefined }),
      ),
    );
    await waitFor(() =>
      expect(document.querySelector(".ant-select-content")?.textContent).toBe(
        "Essam Kamel (ASECO-9)",
      ),
    );
  });

  it("ignores an older search response that arrives after a newer one", async () => {
    await renderPage();
    const input = document.querySelector<HTMLInputElement>(
      "#employee_profile_id",
    )!;
    fireEvent.mouseDown(input);
    let resolveSlow!: (value: unknown) => void;
    listEmployees
      .mockImplementationOnce(
        () => new Promise((resolve) => (resolveSlow = resolve)),
      )
      .mockResolvedValueOnce(essam);

    fireEvent.change(input, { target: { value: "e" } });
    fireEvent.change(input, { target: { value: "es" } });
    expect(await screen.findByTitle("Essam Kamel (ASECO-9)")).toBeTruthy();

    resolveSlow({
      status: "success",
      data: {
        results: [{ id: 5, full_name: "Old Result", employee_id: "OLD-5" }],
        count: 1,
      },
    });
    await waitFor(() =>
      expect(screen.queryByTitle("Old Result (OLD-5)")).toBeNull(),
    );
    expect(screen.getByTitle("Essam Kamel (ASECO-9)")).toBeTruthy();
  });
});
