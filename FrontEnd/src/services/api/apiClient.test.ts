import { describe, expect, it } from "vitest";

import { assertCompanySelectorsMatchActive } from "./apiClient";

describe("assertCompanySelectorsMatchActive", () => {
  it("allows an omitted selector or a selector matching the active header", () => {
    expect(() =>
      assertCompanySelectorsMatchActive({ url: "/api/employees/" }, 4),
    ).not.toThrow();
    expect(() =>
      assertCompanySelectorsMatchActive(
        { url: "/api/employees/?company_id=4" },
        4,
      ),
    ).not.toThrow();
  });

  it("rejects conflicting, malformed, zero, negative, and duplicate URL selectors", () => {
    expect(() =>
      assertCompanySelectorsMatchActive(
        { url: "/api/employees/?company_id=7" },
        4,
      ),
    ).toThrow();
    expect(() =>
      assertCompanySelectorsMatchActive({ params: { company_id: "bad" } }, 4),
    ).toThrow();
    expect(() =>
      assertCompanySelectorsMatchActive({ params: { company_id: 0 } }, 4),
    ).toThrow();
    expect(() =>
      assertCompanySelectorsMatchActive({ params: { company_id: -4 } }, 4),
    ).toThrow();
    expect(() =>
      assertCompanySelectorsMatchActive(
        { url: "/api/employees/?company_id=4&company_id=4" },
        4,
      ),
    ).toThrow();
  });

  it("rejects a selector duplicated between a URL and Axios params", () => {
    expect(() =>
      assertCompanySelectorsMatchActive(
        { url: "/api/employees/?company_id=4", params: { company_id: 4 } },
        4,
      ),
    ).toThrow();
  });
});
