import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../services/api/workLocationsApi", async () => {
  const actual = await vi.importActual<
    typeof import("../../services/api/workLocationsApi")
  >("../../services/api/workLocationsApi");
  return {
    ...actual,
    listWorkLocations: vi.fn(),
    createWorkLocation: vi.fn(),
    updateWorkLocation: vi.fn(),
    deleteWorkLocation: vi.fn(),
  };
});

/**
 * The picker itself is covered by WorkLocationMapPicker.test.tsx. Here it is
 * stubbed so these tests stay about the modal wiring — and so no Leaflet or
 * tile machinery is pulled into the page suite.
 */
vi.mock("../../components/workLocations/WorkLocationMapPicker", () => ({
  default: ({ latitude, longitude, radiusMeters, onChange }: any) => (
    <button
      type="button"
      data-testid="map-picker-stub"
      data-latitude={String(latitude ?? "")}
      data-longitude={String(longitude ?? "")}
      data-radius={String(radiusMeters ?? "")}
      onClick={() => onChange(26.333333, 43.977778)}
    />
  ),
}));

import AdminWorkLocationsPage from "./AdminWorkLocationsPage";
import { parseCoordinatePair } from "../../utils/coordinates";
import {
  createWorkLocation,
  deleteWorkLocation,
  listWorkLocations,
  updateWorkLocation,
} from "../../services/api/workLocationsApi";
import type { WorkLocation } from "../../services/api/workLocationsApi";
import { useAuthStore } from "../../auth/authStore";
import { useI18nStore } from "../../i18n/i18nStore";

const list = listWorkLocations as unknown as ReturnType<typeof vi.fn>;
const create = createWorkLocation as unknown as ReturnType<typeof vi.fn>;
const update = updateWorkLocation as unknown as ReturnType<typeof vi.fn>;
const remove = deleteWorkLocation as unknown as ReturnType<typeof vi.fn>;

/** antd + jsdom are slow under a full-suite run; the 1s waitFor default is tight. */
const FIND = { timeout: 8000 };

function makeLocation(overrides: Partial<WorkLocation> = {}): WorkLocation {
  return {
    id: 7,
    name: "Riyadh Main Office",
    latitude: "24.713600",
    longitude: "46.675300",
    radius_meters: 100,
    is_active: true,
    company_id: 3,
    company_name: "FFI Riyadh",
    created_at: "2026-08-29T09:15:00Z",
    updated_at: "2026-08-29T09:15:00Z",
    ...overrides,
  };
}

const listResponse = (items: WorkLocation[]) => ({
  status: "success" as const,
  data: {
    items,
    page: 1,
    page_size: 25,
    count: items.length,
    total_pages: 1,
  },
});

function setActiveCompany(id: number) {
  useAuthStore.setState({
    isAuthenticated: true,
    user: {
      id: "1",
      email: "admin@ffi.test",
      role: "SystemAdmin",
      accessible_organizations: [
        { id: 3, name: "FFI Riyadh", code: "RUH", node_type: "company" },
        { id: 4, name: "FFI Jeddah", code: "JED", node_type: "company" },
      ],
      active_organization_id: id,
      default_organization_id: 3,
    } as any,
  });
}

/** Unauthorized403Page calls useNavigate(), so every render needs a Router. */
function renderPage() {
  return render(
    <MemoryRouter>
      <AdminWorkLocationsPage />
    </MemoryRouter>,
  );
}

/** Opens the create modal and returns its dialog element. */
async function openCreateDialog() {
  fireEvent.click(screen.getByRole("button", { name: /Add Work Location/i }));
  return screen.findByRole("dialog", {}, FIND);
}

function fillField(dialog: HTMLElement, label: string, value: string) {
  fireEvent.change(within(dialog).getByLabelText(label), {
    target: { value },
  });
}

beforeEach(() => {
  list.mockReset();
  create.mockReset();
  update.mockReset();
  remove.mockReset();
  useI18nStore.getState().setLanguage("en");
  setActiveCompany(3);
  list.mockResolvedValue(listResponse([makeLocation()]));
});

describe("listing", () => {
  it("loads the active company's work locations and shows radius in metres", async () => {
    renderPage();

    expect(
      await screen.findByText("Riyadh Main Office", {}, FIND),
    ).toBeInTheDocument();
    expect(screen.getByText("100 m")).toBeInTheDocument();
  });

  it("requests the list without any company selector", async () => {
    renderPage();

    await waitFor(() => expect(list).toHaveBeenCalled(), FIND);
    expect(JSON.stringify(list.mock.calls[0])).not.toContain("company");
  });

  it("shows the empty state when the company has no sites", async () => {
    list.mockResolvedValue(listResponse([]));

    renderPage();

    expect(
      await screen.findByText("No work locations yet", {}, FIND),
    ).toBeInTheDocument();
  });

  it("renders the backend message when the list fails", async () => {
    list.mockResolvedValue({
      status: "error",
      message: "Select an active company for this request.",
    });

    renderPage();

    expect(
      await screen.findByText(
        "Select an active company for this request.",
        {},
        FIND,
      ),
    ).toBeInTheDocument();
  });

  it("does not render company rows when the API answers 403", async () => {
    list.mockRejectedValue({ response: { status: 403 } });

    renderPage();

    await waitFor(() => expect(list).toHaveBeenCalled(), FIND);
    expect(screen.queryByText("Riyadh Main Office")).not.toBeInTheDocument();
  });
});

function setHeadOffice() {
  useAuthStore.setState({
    isAuthenticated: true,
    user: {
      id: "1",
      email: "admin@ffi.test",
      role: "SystemAdmin",
      accessible_organizations: [
        {
          id: 1,
          name: "FFI Head Office",
          code: "HO",
          node_type: "head_office",
        },
        { id: 3, name: "FFI Riyadh", code: "RUH", node_type: "company" },
      ],
      active_organization_id: 1,
      default_organization_id: 1,
    } as any,
  });
}

describe("head office", () => {
  it("makes no list request and shows the switch-to-a-company notice", async () => {
    setHeadOffice();

    renderPage();

    expect(
      await screen.findByText(
        "Switch to a company to manage its work locations.",
        {},
        FIND,
      ),
    ).toBeInTheDocument();
    expect(list).not.toHaveBeenCalled();
    // Not the unauthorized page, and no empty-state call to action.
    expect(screen.queryByText("No work locations yet")).not.toBeInTheDocument();
  });

  it("drops the previous company's rows when switching to head office", async () => {
    const { rerender } = renderPage();

    // A company is active first, so its rows are on screen.
    expect(
      await screen.findByText("Riyadh Main Office", {}, FIND),
    ).toBeInTheDocument();
    expect(list).toHaveBeenCalledTimes(1);

    setHeadOffice();
    rerender(
      <MemoryRouter>
        <AdminWorkLocationsPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.queryByText("Riyadh Main Office")).not.toBeInTheDocument();
    }, FIND);
    // Still only the one call made while the company was active.
    expect(list).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText("Switch to a company to manage its work locations."),
    ).toBeInTheDocument();
  });

  it("disables the add button under head office", async () => {
    setHeadOffice();

    renderPage();

    await screen.findByText(
      "Switch to a company to manage its work locations.",
      {},
      FIND,
    );
    expect(
      screen.getByRole("button", { name: /Add Work Location/i }),
    ).toBeDisabled();
  });
});

describe("active company switching", () => {
  it("refetches the scoped list when the active company changes", async () => {
    const { rerender } = renderPage();

    await waitFor(() => expect(list).toHaveBeenCalledTimes(1), FIND);

    list.mockResolvedValue(
      listResponse([
        makeLocation({
          id: 9,
          name: "Jeddah Site",
          company_id: 4,
          company_name: "FFI Jeddah",
        }),
      ]),
    );
    setActiveCompany(4);
    rerender(
      <MemoryRouter>
        <AdminWorkLocationsPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(list).toHaveBeenCalledTimes(2), FIND);
    expect(
      await screen.findByText("Jeddah Site", {}, FIND),
    ).toBeInTheDocument();
  });
});

describe("create", () => {
  it("sends exactly the contract payload with no company field", async () => {
    create.mockResolvedValue({ status: "success", data: makeLocation() });

    renderPage();
    await screen.findByText("Riyadh Main Office", {}, FIND);

    const dialog = await openCreateDialog();
    fillField(dialog, "Site name", "Riyadh Main Office");
    fillField(dialog, "Latitude", "24.7136");
    fillField(dialog, "Longitude", "46.6753");
    fillField(dialog, "Radius", "100");

    fireEvent.click(within(dialog).getByRole("button", { name: /^Create$/i }));

    await waitFor(() => expect(create).toHaveBeenCalled(), FIND);
    const payload = create.mock.calls[0][0];
    expect(payload).toEqual({
      name: "Riyadh Main Office",
      latitude: "24.713600",
      longitude: "46.675300",
      radius_meters: 100,
    });
    expect(Object.keys(payload)).not.toContain("company");
    expect(Object.keys(payload)).not.toContain("company_id");
  });

  it("renders a backend validation message without rewriting it", async () => {
    create.mockResolvedValue({
      status: "error",
      message: "Latitude must be between -90 and 90.",
      errors: [
        { field: "latitude", message: "Latitude must be between -90 and 90." },
      ],
    });

    renderPage();
    await screen.findByText("Riyadh Main Office", {}, FIND);

    const dialog = await openCreateDialog();
    fillField(dialog, "Site name", "Bad site");
    fillField(dialog, "Latitude", "24.7136");
    fillField(dialog, "Longitude", "46.6753");
    fillField(dialog, "Radius", "100");
    fireEvent.click(within(dialog).getByRole("button", { name: /^Create$/i }));

    expect(
      await screen.findByText("Latitude must be between -90 and 90.", {}, FIND),
    ).toBeInTheDocument();
  });
});

describe("edit", () => {
  it("PUTs every writable field and keeps company out of the payload", async () => {
    update.mockResolvedValue({
      status: "success",
      data: makeLocation({ radius_meters: 125 }),
    });

    renderPage();
    await screen.findByText("Riyadh Main Office", {}, FIND);

    fireEvent.click(
      screen.getByRole("button", { name: "Edit Riyadh Main Office" }),
    );

    const dialog = await screen.findByRole("dialog", {}, FIND);
    fillField(dialog, "Radius", "125");
    fireEvent.click(within(dialog).getByRole("button", { name: /^Save$/i }));

    await waitFor(() => expect(update).toHaveBeenCalled(), FIND);
    const [id, payload] = update.mock.calls[0];
    expect(id).toBe(7);
    expect(payload).toEqual({
      name: "Riyadh Main Office",
      latitude: "24.713600",
      longitude: "46.675300",
      radius_meters: 125,
    });
    expect(JSON.stringify(payload)).not.toContain("company");
  });
});

describe("soft delete", () => {
  it("confirms, calls DELETE, and refetches the list", async () => {
    remove.mockResolvedValue({ status: "success", data: {} });

    renderPage();
    await screen.findByText("Riyadh Main Office", {}, FIND);

    fireEvent.click(
      screen.getByRole("button", { name: "Remove Riyadh Main Office" }),
    );

    expect(
      await screen.findByText("Remove this work location?", {}, FIND),
    ).toBeInTheDocument();

    list.mockResolvedValue(listResponse([]));
    const confirmButtons = screen.getAllByRole("button", { name: /^Delete$/i });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]);

    await waitFor(() => expect(remove).toHaveBeenCalledWith(7), FIND);
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2), FIND);
  });
});

describe("map picker in the modal", () => {
  it("feeds the edited row's coordinates and radius to the map", async () => {
    renderPage();
    await screen.findByText("Riyadh Main Office", {}, FIND);

    fireEvent.click(
      screen.getByRole("button", { name: "Edit Riyadh Main Office" }),
    );
    await screen.findByRole("dialog", {}, FIND);

    const stub = screen.getByTestId("map-picker-stub");
    expect(stub).toHaveAttribute("data-latitude", "24.713600");
    expect(stub).toHaveAttribute("data-longitude", "46.675300");
    expect(stub).toHaveAttribute("data-radius", "100");
  });

  it("writes a map pick into the latitude and longitude fields at six decimals", async () => {
    renderPage();
    await screen.findByText("Riyadh Main Office", {}, FIND);

    const dialog = await openCreateDialog();
    fireEvent.click(screen.getByTestId("map-picker-stub"));

    await waitFor(() => {
      expect(within(dialog).getByLabelText("Latitude")).toHaveValue(
        "26.333333",
      );
      expect(within(dialog).getByLabelText("Longitude")).toHaveValue(
        "43.977778",
      );
    }, FIND);
  });

  it("keeps the create request to the exact four-field contract after a map pick", async () => {
    create.mockResolvedValue({ status: "success", data: makeLocation() });

    renderPage();
    await screen.findByText("Riyadh Main Office", {}, FIND);

    const dialog = await openCreateDialog();
    fillField(dialog, "Site name", "Mapped Site");
    fillField(dialog, "Radius", "150");
    fireEvent.click(screen.getByTestId("map-picker-stub"));

    await waitFor(() => {
      expect(within(dialog).getByLabelText("Latitude")).toHaveValue(
        "26.333333",
      );
    }, FIND);

    fireEvent.click(within(dialog).getByRole("button", { name: /^Create$/i }));

    await waitFor(() => expect(create).toHaveBeenCalled(), FIND);
    const payload = create.mock.calls[0][0];
    expect(payload).toEqual({
      name: "Mapped Site",
      latitude: "26.333333",
      longitude: "43.977778",
      radius_meters: 150,
    });
    // No map viewport, zoom, address label, provider metadata, or ids.
    expect(Object.keys(payload)).toEqual([
      "name",
      "latitude",
      "longitude",
      "radius_meters",
    ]);
  });

  it("passes the typed radius straight through to the map", async () => {
    renderPage();
    await screen.findByText("Riyadh Main Office", {}, FIND);

    const dialog = await openCreateDialog();
    fillField(dialog, "Radius", "250");

    await waitFor(() => {
      expect(screen.getByTestId("map-picker-stub")).toHaveAttribute(
        "data-radius",
        "250",
      );
    }, FIND);
  });

  it("shows the privacy hint next to the map", async () => {
    renderPage();
    await screen.findByText("Riyadh Main Office", {}, FIND);

    const dialog = await openCreateDialog();

    expect(
      within(dialog).getByText(/Only the final coordinates and the chosen/i),
    ).toBeInTheDocument();
  });
});

describe("location picker", () => {
  it("populates the exact latitude and longitude fields from the browser location", async () => {
    const getCurrentPosition = vi.fn((success: PositionCallback) =>
      success({
        coords: { latitude: 24.7136, longitude: 46.6753 },
      } as GeolocationPosition),
    );
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: { getCurrentPosition },
    });

    renderPage();
    await screen.findByText("Riyadh Main Office", {}, FIND);

    const dialog = await openCreateDialog();
    fireEvent.click(
      within(dialog).getByRole("button", { name: /Use my current location/i }),
    );

    await waitFor(() => {
      expect(within(dialog).getByLabelText("Latitude")).toHaveValue(
        "24.713600",
      );
      expect(within(dialog).getByLabelText("Longitude")).toHaveValue(
        "46.675300",
      );
    }, FIND);
  });

  it("parses the coordinate shapes people paste", () => {
    expect(parseCoordinatePair("24.7136, 46.6753")).toEqual({
      latitude: 24.7136,
      longitude: 46.6753,
    });
    expect(parseCoordinatePair("24.7136 46.6753")).toEqual({
      latitude: 24.7136,
      longitude: 46.6753,
    });
    expect(
      parseCoordinatePair("https://maps.google.com/@24.7136,46.6753,17z"),
    ).toEqual({ latitude: 24.7136, longitude: 46.6753 });
  });

  it("rejects out-of-range and unparsable coordinate text", () => {
    expect(parseCoordinatePair("95.0, 46.6753")).toBeNull();
    expect(parseCoordinatePair("24.7136, 200.0")).toBeNull();
    expect(parseCoordinatePair("not coordinates")).toBeNull();
    expect(parseCoordinatePair("")).toBeNull();
  });
});
