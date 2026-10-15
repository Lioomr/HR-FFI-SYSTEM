import { beforeEach, describe, expect, it, vi } from "vitest";
import { listRunItems } from "../../services/api/payrollApi";
import {
  readPayrollIndex,
  readColumns,
  writeColumns,
  DEFAULT_COLUMNS,
} from "./payrollIndex";
import * as examples from "../../services/api/payrollMocks/contractExamples";
import type { PayrollRunItemDto } from "../../services/api/payrollTypes";
vi.mock("../../services/api/payrollApi", () => ({ listRunItems: vi.fn() }));
const item = examples.item.data as unknown as PayrollRunItemDto;
beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
});
describe("payroll record index", () => {
  it("reads sequential pages at the cap, honors smaller server pages and retains server order", async () => {
    vi.mocked(listRunItems)
      .mockResolvedValueOnce({
        items: [item],
        count: 2,
        page: 1,
        page_size: 1,
        total_pages: 2,
      })
      .mockResolvedValueOnce({
        items: [{ ...item, id: 72 }],
        count: 2,
        page: 2,
        page_size: 1,
        total_pages: 2,
      });
    expect((await readPayrollIndex(7)).items.map((row) => row.id)).toEqual([
      item.id,
      72,
    ]);
    expect(listRunItems).toHaveBeenNthCalledWith(2, 7, {
      page: 2,
      page_size: 1000,
    });
  });
  it("does not retain or fetch more records above 1000", async () => {
    vi.mocked(listRunItems).mockResolvedValue({
      items: [item],
      count: 1001,
      page: 1,
      page_size: 1000,
      total_pages: 2,
    });
    expect(await readPayrollIndex(7)).toEqual({ limited: true, items: [] });
    expect(listRunItems).toHaveBeenCalledTimes(1);
  });
  it("rejects partial, duplicate or mixed-revision results", async () => {
    vi.mocked(listRunItems).mockResolvedValue({
      items: [item],
      count: 2,
      page: 1,
      page_size: 1000,
      total_pages: 1,
    });
    await expect(readPayrollIndex(7)).rejects.toThrow();
    vi.mocked(listRunItems).mockResolvedValue({
      items: [item, { ...item, id: 72, run_revision: item.run_revision + 1 }],
      count: 2,
      page: 1,
      page_size: 1000,
      total_pages: 1,
    });
    await expect(readPayrollIndex(7)).rejects.toThrow();
  });
  it("restores only supported booleans from user-scoped preferences", () => {
    writeColumns("user-1", { ...DEFAULT_COLUMNS, provisions: true });
    expect(readColumns("user-1").provisions).toBe(true);
    expect(readColumns("user-2").provisions).toBe(false);
    localStorage.setItem("invalid", '{"salary":"false"}');
    expect(readColumns("invalid")).toEqual(DEFAULT_COLUMNS);
  });
  it("survives read and write storage failures", () => {
    const read = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("unavailable");
      });
    const write = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("quota");
      });
    expect(readColumns("user")).toEqual(DEFAULT_COLUMNS);
    expect(() => writeColumns("user", DEFAULT_COLUMNS)).not.toThrow();
    read.mockRestore();
    write.mockRestore();
  });
});
