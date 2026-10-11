import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./apiClient", () => ({ api: { get: vi.fn() } }));

import { api } from "./apiClient";
import { getEmployee } from "./employeesApi";

const get = vi.mocked(api.get);

describe("getEmployee", () => {
  beforeEach(() => {
    get.mockReset();
    get.mockImplementation(() =>
      Promise.resolve({ data: { data: { id: 1 } } }),
    );
  });

  it("shares one request between concurrent reads of the signed-in employee", async () => {
    const [first, second] = await Promise.all([
      getEmployee("me"),
      getEmployee("me"),
    ]);

    expect(get).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
  });

  it("fetches again once the earlier read has finished", async () => {
    await getEmployee("me");
    await getEmployee("me");

    expect(get).toHaveBeenCalledTimes(2);
  });

  it("never shares reads of other employees", async () => {
    await Promise.all([getEmployee(7), getEmployee(7)]);

    expect(get).toHaveBeenCalledTimes(2);
  });
});
