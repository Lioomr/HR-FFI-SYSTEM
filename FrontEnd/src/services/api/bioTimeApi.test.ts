import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("./apiClient", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

import { api } from "./apiClient";
import {
  bioTimeApi,
  normalizeBioTimePage,
  DEFAULT_SYNC_DAYS_BACK,
} from "./bioTimeApi";
import type { BioTimeEmployeeMap } from "./bioTimeApi";

const get = api.get as unknown as ReturnType<typeof vi.fn>;
const post = api.post as unknown as ReturnType<typeof vi.fn>;
const put = api.put as unknown as ReturnType<typeof vi.fn>;
const del = api.delete as unknown as ReturnType<typeof vi.fn>;

const envelope = <T>(data: T, message?: string) => ({
  data: { status: "success" as const, data, ...(message ? { message } : {}) },
});

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  put.mockReset();
  del.mockReset();
});

describe("bioTimeApi envelope parsing", () => {
  it("unwraps the config payload from data", async () => {
    get.mockResolvedValue(
      envelope({
        server_ip: "192.168.1.250",
        server_port: "80",
        username: "admin",
        is_active: true,
        last_sync_time: "2026-08-12T06:00:00Z",
      }),
    );

    const config = await bioTimeApi.getConfig();

    expect(get).toHaveBeenCalledWith("/api/biotime/config/");
    expect(config).toEqual({
      server_ip: "192.168.1.250",
      server_port: "80",
      username: "admin",
      is_active: true,
      last_sync_time: "2026-08-12T06:00:00Z",
    });
  });

  it("throws the envelope message when the API reports an error", async () => {
    get.mockResolvedValue({
      data: { status: "error", message: "Validation error" },
    });

    await expect(bioTimeApi.getConfig()).rejects.toThrow("Validation error");
  });

  it("sends the config payload verbatim on update", async () => {
    put.mockResolvedValue(
      envelope({
        server_ip: "10.0.0.5",
        server_port: "80",
        username: "admin",
        is_active: false,
      }),
    );

    const saved = await bioTimeApi.updateConfig({
      server_ip: "10.0.0.5",
      server_port: "80",
      username: "admin",
      is_active: false,
      password: "secret",
    });

    expect(put).toHaveBeenCalledWith("/api/biotime/config/", {
      server_ip: "10.0.0.5",
      server_port: "80",
      username: "admin",
      is_active: false,
      password: "secret",
    });
    expect(saved.server_ip).toBe("10.0.0.5");
  });
});

describe("bioTimeApi mapping pagination", () => {
  it("returns items plus page metadata from the paginated envelope", async () => {
    get.mockResolvedValue(
      envelope({
        items: [
          {
            id: 1,
            employee_profile: 42,
            employee_name: "Sara Ali",
            department: "Finance",
            biotime_emp_code: "100001",
            created_at: "2026-08-01T09:00:00Z",
          },
        ],
        page: 2,
        page_size: 25,
        count: 30,
        total_pages: 2,
      }),
    );

    const result = await bioTimeApi.getMappings({ page: 2, page_size: 25 });

    expect(get).toHaveBeenCalledWith("/api/biotime-mappings/", {
      params: { page: 2, page_size: 25 },
    });
    expect(result.items).toHaveLength(1);
    expect(result.page).toBe(2);
    expect(result.page_size).toBe(25);
    expect(result.count).toBe(30);
    expect(result.total_pages).toBe(2);
  });

  it("derives page metadata when the backend skips pagination", () => {
    const page = normalizeBioTimePage<BioTimeEmployeeMap>(
      { items: [{ id: 1 }, { id: 2 }], count: 2 },
      { page: 1, page_size: 25 },
    );

    expect(page.items).toHaveLength(2);
    expect(page.page).toBe(1);
    expect(page.page_size).toBe(25);
    expect(page.count).toBe(2);
    expect(page.total_pages).toBe(1);
  });

  it("returns an empty page for an unexpected payload shape", () => {
    const page = normalizeBioTimePage<BioTimeEmployeeMap>(null);

    expect(page.items).toEqual([]);
    expect(page.count).toBe(0);
  });

  it("posts the mapping payload and unwraps the created mapping", async () => {
    post.mockResolvedValue(
      envelope({
        id: 7,
        employee_profile: 42,
        employee_name: "Sara Ali",
        department: "Finance",
        biotime_emp_code: "100001",
        created_at: "2026-08-12T09:00:00Z",
      }),
    );

    const created = await bioTimeApi.createMapping({
      employee_profile: 42,
      biotime_emp_code: "100001",
    });

    expect(post).toHaveBeenCalledWith("/api/biotime-mappings/", {
      employee_profile: 42,
      biotime_emp_code: "100001",
    });
    expect(created.id).toBe(7);
  });

  it("deletes a mapping by id", async () => {
    del.mockResolvedValue({ data: { status: "success", data: {} } });

    await bioTimeApi.deleteMapping(7);

    expect(del).toHaveBeenCalledWith("/api/biotime-mappings/7/");
  });
});

describe("bioTimeApi unmapped users", () => {
  it("unwraps device users from the paginated envelope", async () => {
    get.mockResolvedValue(
      envelope({
        items: [
          {
            emp_code: "100001",
            first_name: "Sara",
            last_name: "Ali",
            department: "Finance",
          },
        ],
        page: 1,
        page_size: 25,
        count: 1,
        total_pages: 1,
      }),
    );

    const result = await bioTimeApi.getUnmappedUsers({
      page: 1,
      page_size: 25,
    });

    expect(get).toHaveBeenCalledWith("/api/biotime-mappings/unmapped/", {
      params: { page: 1, page_size: 25 },
    });
    expect(result.items[0]).toEqual({
      emp_code: "100001",
      first_name: "Sara",
      last_name: "Ali",
      department: "Finance",
    });
    expect(result.count).toBe(1);
  });
});

describe("bioTimeApi sync", () => {
  it("sends days_back and returns the counts summary with the message", async () => {
    post.mockResolvedValue(
      envelope(
        {
          processed: 12,
          created: 4,
          updated: 3,
          skipped: 2,
          unmapped: 2,
          invalid: 1,
        },
        "BioTime sync completed.",
      ),
    );

    const result = await bioTimeApi.syncNow(14);

    expect(post).toHaveBeenCalledWith("/api/biotime/actions/sync-now/", {
      days_back: 14,
    });
    expect(result.message).toBe("BioTime sync completed.");
    expect(result.summary).toEqual({
      processed: 12,
      created: 4,
      updated: 3,
      skipped: 2,
      unmapped: 2,
      invalid: 1,
    });
  });

  it("defaults days_back to 7 and fills missing counts with zero", async () => {
    post.mockResolvedValue(
      envelope({ processed: 3 }, "BioTime sync completed."),
    );

    const result = await bioTimeApi.syncNow();

    expect(DEFAULT_SYNC_DAYS_BACK).toBe(7);
    expect(post).toHaveBeenCalledWith("/api/biotime/actions/sync-now/", {
      days_back: 7,
    });
    expect(result.summary).toEqual({
      processed: 3,
      created: 0,
      updated: 0,
      skipped: 0,
      unmapped: 0,
      invalid: 0,
    });
  });
});
