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
import { Form } from "antd";

const { getAnnouncementRecipientCandidates } = vi.hoisted(() => ({
  getAnnouncementRecipientCandidates: vi.fn(),
}));
vi.mock("../../../services/api/announcementApi", () => ({
  getAnnouncementRecipientCandidates,
}));

import HeadOfficeAudienceFields from "./HeadOfficeAudienceFields";
import { useI18nStore } from "../../../i18n/i18nStore";
import type { OrganizationNodeDto } from "../../../services/api/apiTypes";

const companies: OrganizationNodeDto[] = [
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
];

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
  getAnnouncementRecipientCandidates.mockReset().mockResolvedValue([
    {
      user_id: 41,
      employee_id: "FFI-001",
      full_name: "Sara Ali",
      full_name_en: "Sara Ali",
      company_id: 2,
      company_name: "FFI",
    },
    {
      user_id: 52,
      employee_id: "ASP-007",
      full_name: "Omar Said",
      full_name_en: "Omar Said",
      company_id: 3,
      company_name: "Aseco Pro",
    },
  ]);
});
afterEach(cleanup);

describe("HeadOfficeAudienceFields", () => {
  it("offers employees from every company, grouped by company", async () => {
    render(
      <Form initialValues={{ broadcast_audience: "EMPLOYEES" }}>
        <HeadOfficeAudienceFields companies={companies} canPickEmployees />
      </Form>,
    );

    await waitFor(() =>
      expect(getAnnouncementRecipientCandidates).toHaveBeenCalledTimes(1),
    );
    fireEvent.mouseDown(screen.getAllByRole("combobox")[1]);
    expect(
      await screen.findByText("Sara Ali (FFI-001) · FFI"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Omar Said (ASP-007) · Aseco Pro"),
    ).toBeInTheDocument();
  });

  it("hides the employee option from users who cannot pick employees", async () => {
    render(
      <Form initialValues={{ broadcast_audience: "ALL_COMPANIES" }}>
        <HeadOfficeAudienceFields
          companies={companies}
          canPickEmployees={false}
        />
      </Form>,
    );

    fireEvent.mouseDown(screen.getByRole("combobox"));
    expect(await screen.findByText("Chosen companies")).toBeInTheDocument();
    expect(screen.queryByText("Chosen employees")).toBeNull();
    expect(getAnnouncementRecipientCandidates).not.toHaveBeenCalled();
  });
});
