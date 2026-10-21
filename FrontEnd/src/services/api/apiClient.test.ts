import { describe, expect, it } from "vitest";

import {
  assertCompanySelectorsMatchActive,
  getLoginRedirectPath,
} from "./apiClient";

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

describe("getLoginRedirectPath", () => {
  it("preserves an internal destination when authentication expires", () => {
    expect(
      getLoginRedirectPath("/hr/employees", "?status=active", "#table"),
    ).toBe("/login?next=%2Fhr%2Femployees%3Fstatus%3Dactive%23table");
  });

  it("does not create a login-to-login redirect loop", () => {
    expect(getLoginRedirectPath("/login", "?next=%2Fhr", "")).toBe("/login");
  });
});

describe("response error messages", () => {
  const failWith = async (
    adapter: (config: any) => Promise<never>,
  ): Promise<Error> => {
    const { api } = await import("./apiClient");
    try {
      await api.get("/x", { adapter });
    } catch (err) {
      return err as Error;
    }
    throw new Error("expected the request to fail");
  };

  const httpError = (status: number, data: unknown) => (config: any) =>
    Promise.reject(
      Object.assign(new Error(`Request failed with status code ${status}`), {
        config,
        response: { status, data, headers: {}, config },
        request: {},
      }),
    );

  it("replaces Axios wording for a dropped connection", async () => {
    const err = await failWith((config) =>
      Promise.reject(
        Object.assign(new Error("Network Error"), { config, request: {} }),
      ),
    );
    expect(err.message).toBe(
      "We could not reach the server. Please check your internet connection and try again.",
    );
  });

  it("replaces Axios wording for a timeout", async () => {
    const err = await failWith((config) =>
      Promise.reject(
        Object.assign(new Error("timeout of 20000ms exceeded"), {
          config,
          code: "ECONNABORTED",
          request: {},
        }),
      ),
    );
    expect(err.message).toBe(
      "The server is taking too long to respond. Please try again.",
    );
  });

  it("never shows a proxy HTML error page", async () => {
    const err = await failWith(
      httpError(502, "<html><body>502 Bad Gateway</body></html>"),
    );
    expect(err.message).not.toMatch(/<html|status code/i);
    expect(err.message).toMatch(/temporary server issue/);
  });

  it("keeps the message the server sent", async () => {
    const err = await failWith(
      httpError(400, { status: "error", message: "Leave dates overlap." }),
    );
    expect(err.message).toBe("Leave dates overlap.");
  });
});
