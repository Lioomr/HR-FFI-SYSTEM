import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import HeadOfficeCompanyPicker from "./HeadOfficeCompanyPicker";
import { useI18nStore } from "../../i18n/i18nStore";
import type { OrganizationNodeDto } from "../../services/api/apiTypes";

const org = (
  id: number,
  name: string,
  node_type: OrganizationNodeDto["node_type"],
  is_active = true,
): OrganizationNodeDto => ({
  id,
  code: name.toUpperCase(),
  name,
  node_type,
  parent_id: null,
  is_active,
});

beforeEach(() => {
  useI18nStore.setState({ language: "en" });
});

describe("HeadOfficeCompanyPicker", () => {
  it("lists only active companies and switches to the chosen one", () => {
    const onSelect = vi.fn();
    render(
      <HeadOfficeCompanyPicker
        organizations={[
          org(1, "Main Head Office", "head_office"),
          org(2, "FFI", "company"),
          org(3, "Aseco Pro", "company"),
          org(9, "Closed Co", "company", false),
        ]}
        onSelect={onSelect}
      />,
    );

    expect(
      screen.getByText("Choose a company to continue"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Main Head Office/ }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: /Closed Co/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Aseco Pro/ }));
    expect(onSelect).toHaveBeenCalledWith(3);
  });

  it("explains missing company access when there is nothing to pick", () => {
    render(
      <HeadOfficeCompanyPicker
        organizations={[org(1, "Main Head Office", "head_office")]}
        onSelect={vi.fn()}
      />,
    );

    expect(
      screen.getByText(/your account is not assigned to a company yet/),
    ).toBeInTheDocument();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});
