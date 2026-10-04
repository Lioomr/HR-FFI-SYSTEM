import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import PenaltiesListPage from "./PenaltiesListPage";
import * as penaltiesApi from "../../../services/api/penaltiesApi";
import type { PenaltyRecord } from "../../../services/api/penaltiesApi";
import * as employeesApi from "../../../services/api/employeesApi";

vi.mock("react-router-dom", () => ({ useNavigate: () => vi.fn() }));
vi.mock("../../../services/api/penaltiesApi", async () => {
  const actual = await vi.importActual<typeof penaltiesApi>(
    "../../../services/api/penaltiesApi",
  );
  return {
    ...actual,
    listPenalties: vi.fn(),
    getPenaltyCatalog: vi.fn(),
    createPenalty: vi.fn(),
  };
});
vi.mock("../../../services/api/employeesApi", () => ({
  listEmployees: vi.fn(),
}));

const record: PenaltyRecord = {
  id: 7,
  company_id: 1,
  employee_profile_id: 2,
  employee_name_en: "Employee One",
  employee_name_ar: "الموظف الأول",
  catalog_code: "O01",
  category: "work_organization",
  occurred_on: "2026-09-29",
  occurrence_number: 1,
  count_period: "cumulative",
  action: "deduction",
  amount: "25.00",
  total_deduction_amount: "25.00",
  status: "issued",
  source: "hr",
  description: "",
  description_en: "",
  description_ar: "",
  note: "",
  created_at: "2026-09-29T10:00:00Z",
  updated_at: "2026-09-29T10:00:00Z",
};

const page = (items: PenaltyRecord[]) => ({
  status: "success" as const,
  data: { items, page: 1, page_size: 10, count: items.length, total_pages: 1 },
});

beforeEach(() => {
  vi.mocked(penaltiesApi.listPenalties)
    .mockReset()
    .mockResolvedValue(page([record]));
  vi.mocked(penaltiesApi.getPenaltyCatalog)
    .mockReset()
    .mockResolvedValue({ status: "success", data: [] });
  vi.mocked(penaltiesApi.createPenalty).mockReset();
  vi.mocked(employeesApi.listEmployees)
    .mockReset()
    .mockResolvedValue({
      status: "success",
      data: { results: [], count: 0, next: null, previous: null },
    } as never);
});

describe("PenaltiesListPage", () => {
  it("offers only statuses the backend accepts", async () => {
    render(<PenaltiesListPage role="hr" />);
    await waitFor(() => expect(penaltiesApi.listPenalties).toHaveBeenCalled());
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Status" }));
    expect(await screen.findByTitle("Waived")).toBeInTheDocument();
    expect(screen.getByTitle("Applied")).toBeInTheDocument();
    expect(screen.queryByTitle("Upheld")).not.toBeInTheDocument();
  });

  it("clears stale rows on a load failure and offers a retry", async () => {
    render(<PenaltiesListPage role="hr" />);
    expect((await screen.findAllByText("Employee One")).length).toBeGreaterThan(
      0,
    );
    vi.mocked(penaltiesApi.listPenalties).mockRejectedValueOnce({
      message: "Request failed with status code 500",
      response: { status: 500 },
    });
    fireEvent.change(screen.getByRole("searchbox", { name: "Search" }), {
      target: { value: "late" },
    });
    fireEvent.keyDown(screen.getByRole("searchbox", { name: "Search" }), {
      key: "Enter",
      code: "Enter",
    });
    const retry = await screen.findByRole("button", { name: "Retry" });
    expect(screen.getByText("Could not load penalties.")).toBeInTheDocument();
    expect(screen.queryByText("Employee One")).not.toBeInTheDocument();
    fireEvent.click(retry);
    // Page loads use page_size 10; the summary cards use page_size 1.
    await waitFor(() =>
      expect(
        vi
          .mocked(penaltiesApi.listPenalties)
          .mock.calls.filter(([params]) => params?.page_size === 10),
      ).toHaveLength(3),
    );
    expect((await screen.findAllByText("Employee One")).length).toBeGreaterThan(
      0,
    );
  });

  it("limits the employee view to the signed-in user's records", async () => {
    render(<PenaltiesListPage role="employee" />);
    await waitFor(() =>
      expect(penaltiesApi.listPenalties).toHaveBeenCalledWith(
        expect.objectContaining({ mine: true, page: 1, page_size: 10 }),
      ),
    );
    expect(employeesApi.listEmployees).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "Record penalty" }),
    ).not.toBeInTheDocument();
  });

  it("hides automatic warnings from HR by default and shows them with the toggle", async () => {
    render(<PenaltiesListPage role="hr" />);
    await waitFor(() =>
      expect(penaltiesApi.listPenalties).toHaveBeenCalledWith(
        expect.objectContaining({ page: 1, page_size: 10 }),
      ),
    );
    // The list and every summary count use the server's default HR queue.
    for (const [params] of vi.mocked(penaltiesApi.listPenalties).mock.calls) {
      expect(params).not.toHaveProperty("include_automated");
    }
    vi.mocked(penaltiesApi.listPenalties).mockClear();
    fireEvent.click(
      screen.getByRole("switch", { name: "Show automatic warnings" }),
    );
    await waitFor(() =>
      expect(penaltiesApi.listPenalties).toHaveBeenCalledWith(
        expect.objectContaining({ include_automated: true, page_size: 10 }),
      ),
    );
    await waitFor(() =>
      expect(penaltiesApi.listPenalties).toHaveBeenCalledWith(
        expect.objectContaining({ include_automated: true, page_size: 1 }),
      ),
    );
  });

  it("shows the automatic warning ladder before the printed fines", async () => {
    vi.mocked(penaltiesApi.getPenaltyCatalog).mockResolvedValue({
      status: "success",
      data: [
        {
          code: "W01",
          category: "work_time",
          title_en: "Late up to 15 minutes",
          title_ar: "تأخر",
          description_en: "",
          description_ar: "",
          count_period: "monthly",
          automatic: true,
          auto_warning_extra_levels: 2,
          levels: [
            {
              occurrence: 1,
              action: "written_warning",
              amount_basis: null,
              amount_value: null,
            },
            {
              occurrence: 2,
              action: "deduction",
              amount_basis: "daily_wage_percent",
              amount_value: "5",
            },
          ],
        },
      ],
    });
    render(<PenaltiesListPage role="employee" />);
    fireEvent.click(await screen.findByText("Penalty policy"));
    expect(await screen.findByText("#3")).toBeInTheDocument();
    expect(screen.getByText("#4").parentElement).toHaveTextContent(
      "#4 Deduction · 5 % of daily wage",
    );
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });

  it("names each row's view button and requires create fields before submitting", async () => {
    render(<PenaltiesListPage role="hr" />);
    expect(
      await screen.findByRole("button", { name: "View penalty #7: O01" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Record penalty" }));
    fireEvent.click(await screen.findByRole("button", { name: "Submit" }));
    await waitFor(
      () => expect(screen.getAllByText(/required/i).length).toBe(4),
      { timeout: 5000 },
    );
    expect(penaltiesApi.createPenalty).not.toHaveBeenCalled();
  }, 45000); // antd modal + form validation is slow under jsdom.
});
