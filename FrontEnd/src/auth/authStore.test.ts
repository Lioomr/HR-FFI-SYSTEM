import { describe, expect, it } from "vitest";

import type { OrganizationNodeDto } from "../services/api/apiTypes";
import { resolveAuthorizedActiveOrganizationId } from "./authStore";

const company = (id: number, code: string): OrganizationNodeDto => ({
  id,
  code,
  name: code,
  node_type: "company",
  parent_id: null,
  is_active: true,
});

describe("resolveAuthorizedActiveOrganizationId", () => {
  const organizations = [company(4, "ATHROYA"), company(7, "ASECO_PRO")];

  it("keeps an active organization supplied by the authenticated server response", () => {
    expect(
      resolveAuthorizedActiveOrganizationId({
        accessible_organizations: organizations,
        active_organization_id: 7,
        default_organization_id: 4,
      }),
    ).toBe(7);
  });

  it("rejects a tampered stored organization and falls back to an accessible default", () => {
    expect(
      resolveAuthorizedActiveOrganizationId({
        accessible_organizations: organizations,
        active_organization_id: 999,
        default_organization_id: 4,
      }),
    ).toBe(4);
  });

  it("returns null when the authenticated user has no accessible organizations", () => {
    expect(
      resolveAuthorizedActiveOrganizationId({
        accessible_organizations: [],
        active_organization_id: 999,
        default_organization_id: null,
      }),
    ).toBeNull();
  });
});
