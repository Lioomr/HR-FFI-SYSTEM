// @vitest-environment jsdom
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const { createAnnouncement, listDelegationCandidates, navigate } = vi.hoisted(
  () => ({
    createAnnouncement: vi.fn(),
    listDelegationCandidates: vi.fn(),
    navigate: vi.fn(),
  }),
);

vi.mock("../../../services/api/announcementApi", () => ({
  createAnnouncement,
  getAnnouncementWhatsAppGroups: vi.fn(),
  getAnnouncementRecipientCandidates: vi.fn().mockResolvedValue([]),
}));
vi.mock("../../../services/api/employeesApi", () => ({
  listDelegationCandidates,
}));
vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => navigate,
}));

import CreateAnnouncementPage from "./CreateAnnouncementPage";
import { useAuthStore } from "../../../auth/authStore";
import { useI18nStore } from "../../../i18n/i18nStore";

const organizations = [
  {
    id: 1,
    code: "HEAD_OFFICE",
    name: "Main Head Office",
    node_type: "head_office",
    parent_id: null,
    is_active: true,
  },
  {
    id: 2,
    code: "FFI",
    name: "FFI",
    node_type: "company",
    parent_id: 1,
    is_active: true,
  },
  {
    id: 3,
    code: "ASECO",
    name: "Aseco Pro",
    node_type: "company",
    parent_id: 1,
    is_active: true,
  },
] as const;

function signIn(activeOrganizationId: number) {
  useAuthStore.setState({
    isAuthenticated: true,
    user: {
      id: "6",
      email: "hr@ffi.test",
      role: "HRManager",
      accessible_organizations: [...organizations],
      active_organization_id: activeOrganizationId,
    } as never,
  });
}

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation(() => ({
      matches: false,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
});

beforeEach(() => {
  useI18nStore.setState({ language: "en" });
  createAnnouncement.mockReset().mockResolvedValue({ status: "success" });
  listDelegationCandidates
    .mockReset()
    .mockResolvedValue({ status: "success", data: [] });
  navigate.mockReset();
});
afterEach(cleanup);

describe("CreateAnnouncementPage in Main Head Office", () => {
  it("sends to every company without company-only audience fields", async () => {
    signIn(1);
    render(
      <MemoryRouter>
        <CreateAnnouncementPage />
      </MemoryRouter>,
    );

    expect(
      screen.getByText("Sending from Main Head Office"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/every employee in FFI, Aseco Pro/),
    ).toBeInTheDocument();
    expect(screen.getByText("All companies")).toBeInTheDocument();
    expect(listDelegationCandidates).not.toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText(/title/i), {
      target: { value: "Eid holiday" },
    });
    fireEvent.change(screen.getAllByRole("textbox")[1], {
      target: { value: "Offices close on Monday." },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /create announcement|publish/i }),
    );

    await waitFor(() => expect(createAnnouncement).toHaveBeenCalledTimes(1));
    const payload = createAnnouncement.mock.calls[0][0];
    expect(payload).toMatchObject({
      title: "Eid holiday",
      whole_company: true,
      broadcast_audience: "ALL_COMPANIES",
      target_roles: [],
      whatsapp_group_id: "",
    });
    expect(payload.target_user_ids).toBeUndefined();
    expect(payload.company_ids).toBeUndefined();
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith("/hr/announcements"),
    );
  });

  it("keeps the audience choice inside a company", () => {
    signIn(2);
    render(
      <MemoryRouter>
        <CreateAnnouncementPage />
      </MemoryRouter>,
    );

    expect(screen.queryByText("Sending from Main Head Office")).toBeNull();
    expect(listDelegationCandidates).toHaveBeenCalled();
  });
});
