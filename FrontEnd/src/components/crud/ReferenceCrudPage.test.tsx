import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Form, Input } from "antd";

import { ReferenceCrudPage } from "./ReferenceCrudPage";

vi.mock("../../i18n/useI18n", () => {
  const t = (key: string) => key;
  return { useI18n: () => ({ t }) };
});
vi.mock("../../auth/authStore", () => ({
  useAuthStore: (selector: (state: { user: null }) => unknown) =>
    selector({ user: null }),
}));

describe("ReferenceCrudPage", () => {
  it("allows creating the first record from an empty list", async () => {
    const fetchList = vi
      .fn()
      .mockResolvedValue({ status: "success", data: [] });
    render(
      <ReferenceCrudPage
        title="Departments"
        entityName="Department"
        columns={[]}
        rowKey="id"
        fetchList={fetchList}
        createItem={vi.fn()}
        updateItem={vi.fn()}
        createForm={
          <Form.Item name="name" label="Name">
            <Input />
          </Form.Item>
        }
      />,
    );

    expect(
      await screen.findByText("reference.noItemsFound"),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /common\.create Department/ }),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
