import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./apiClient", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

import { api } from "./apiClient";
import {
  createWorkLocation,
  deleteWorkLocation,
  formatCoordinate,
  getWorkLocation,
  listWorkLocations,
  patchWorkLocation,
  toPatchPayload,
  toWritePayload,
  updateWorkLocation,
} from "./workLocationsApi";

const get = api.get as unknown as ReturnType<typeof vi.fn>;
const post = api.post as unknown as ReturnType<typeof vi.fn>;
const put = api.put as unknown as ReturnType<typeof vi.fn>;
const patch = api.patch as unknown as ReturnType<typeof vi.fn>;
const del = api.delete as unknown as ReturnType<typeof vi.fn>;

const location = {
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
};

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  put.mockReset();
  patch.mockReset();
  del.mockReset();
});

describe("list", () => {
  it("reads the canonical route and returns the paginated envelope untouched", async () => {
    const payload = {
      items: [location],
      page: 1,
      page_size: 25,
      count: 1,
      total_pages: 1,
    };
    get.mockResolvedValue({ data: { status: "success", data: payload } });

    const res = await listWorkLocations({ page: 1, page_size: 25 });

    expect(get).toHaveBeenCalledWith("/api/work-locations/", {
      params: { page: 1, page_size: 25 },
    });
    expect(res).toEqual({ status: "success", data: payload });
  });

  it("never sends a company selector — scoping is the x-active-company-id header alone", async () => {
    get.mockResolvedValue({
      data: { status: "success", data: { items: [], count: 0 } },
    });

    await listWorkLocations({ page: 2 });

    const [url, config] = get.mock.calls[0];
    expect(url).toBe("/api/work-locations/");
    expect(JSON.stringify(config)).not.toContain("company");
  });

  it("passes an error envelope straight through", async () => {
    get.mockResolvedValue({
      data: {
        status: "error",
        message: "Select an active company for this request.",
      },
    });

    const res = await listWorkLocations();

    expect(res).toEqual({
      status: "error",
      message: "Select an active company for this request.",
    });
  });
});

describe("retrieve", () => {
  it("requests the detail route by id", async () => {
    get.mockResolvedValue({ data: { status: "success", data: location } });

    const res = await getWorkLocation(7);

    expect(get).toHaveBeenCalledWith("/api/work-locations/7/");
    expect(res).toEqual({ status: "success", data: location });
  });
});

describe("create", () => {
  it("posts exactly the contract payload and returns the success envelope", async () => {
    post.mockResolvedValue({ data: { status: "success", data: location } });

    const res = await createWorkLocation({
      name: "Riyadh Main Office",
      latitude: "24.713600",
      longitude: "46.675300",
      radius_meters: 100,
    });

    expect(post).toHaveBeenCalledWith("/api/work-locations/", {
      name: "Riyadh Main Office",
      latitude: "24.713600",
      longitude: "46.675300",
      radius_meters: 100,
    });
    expect(res).toEqual({ status: "success", data: location });
  });

  it("renders a backend 422 field error envelope without rewriting it", async () => {
    post.mockResolvedValue({
      data: {
        status: "error",
        message: "Latitude must be between -90 and 90.",
        errors: [
          {
            field: "latitude",
            message: "Latitude must be between -90 and 90.",
          },
        ],
      },
    });

    const res = await createWorkLocation({
      name: "Bad site",
      latitude: "95.000000",
      longitude: "46.675300",
      radius_meters: 100,
    });

    expect(res).toEqual({
      status: "error",
      message: "Latitude must be between -90 and 90.",
      errors: [
        { field: "latitude", message: "Latitude must be between -90 and 90." },
      ],
    });
  });
});

describe("update", () => {
  it("PUTs every writable field to the detail route", async () => {
    put.mockResolvedValue({
      data: { status: "success", data: { ...location, radius_meters: 125 } },
    });

    await updateWorkLocation(7, {
      name: "Riyadh Main Office",
      latitude: "24.713600",
      longitude: "46.675300",
      radius_meters: 125,
    });

    expect(put).toHaveBeenCalledWith("/api/work-locations/7/", {
      name: "Riyadh Main Office",
      latitude: "24.713600",
      longitude: "46.675300",
      radius_meters: 125,
    });
  });

  it("PATCHes only the supplied subset", async () => {
    patch.mockResolvedValue({
      data: { status: "success", data: { ...location, radius_meters: 125 } },
    });

    await patchWorkLocation(7, { radius_meters: 125 });

    expect(patch).toHaveBeenCalledWith("/api/work-locations/7/", {
      radius_meters: 125,
    });
  });
});

describe("soft delete", () => {
  it("DELETEs the detail route and returns the empty success envelope", async () => {
    del.mockResolvedValue({ data: { status: "success", data: {} } });

    const res = await deleteWorkLocation(7);

    expect(del).toHaveBeenCalledWith("/api/work-locations/7/");
    expect(res).toEqual({ status: "success", data: {} });
  });

  it("surfaces the 404 envelope for a cross-company or inactive row", async () => {
    del.mockResolvedValue({ data: { status: "error", message: "Not found" } });

    const res = await deleteWorkLocation(999);

    expect(res).toEqual({ status: "error", message: "Not found" });
  });
});

describe("payload builders", () => {
  it("formats coordinates to the contract's six decimal places", () => {
    expect(formatCoordinate(24.7136)).toBe("24.713600");
    expect(formatCoordinate("46.6753")).toBe("46.675300");
    expect(formatCoordinate(-0.5)).toBe("-0.500000");
  });

  it("drops company and company_id even when a caller supplies them", () => {
    const payload = toWritePayload({
      name: "  Riyadh Main Office  ",
      latitude: 24.7136,
      longitude: 46.6753,
      radius_meters: 100,
      company: 3,
      company_id: 3,
    });

    expect(payload).toEqual({
      name: "Riyadh Main Office",
      latitude: "24.713600",
      longitude: "46.675300",
      radius_meters: 100,
    });
    expect(Object.keys(payload)).toEqual([
      "name",
      "latitude",
      "longitude",
      "radius_meters",
    ]);
  });

  it("keeps company fields out of a partial payload too", () => {
    const payload = toPatchPayload({ radius_meters: 125, company_id: 3 });

    expect(payload).toEqual({ radius_meters: 125 });
    expect(Object.keys(payload)).not.toContain("company_id");
  });

  it("coerces a numeric radius so metres reach the API as an integer", () => {
    const payload = toWritePayload({
      name: "Site",
      latitude: "1",
      longitude: "2",
      radius_meters: "150",
    });

    expect(payload.radius_meters).toBe(150);
  });
});
