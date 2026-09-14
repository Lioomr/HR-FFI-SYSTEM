import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { Button, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";

import ResponsiveTable from "./ResponsiveTable";
import { useI18nStore } from "../../i18n/i18nStore";

interface Row {
  id: number;
  name: string;
  status: string;
  amount: number;
  note: string | null;
}

const rows: Row[] = [
  { id: 1, name: "Laptop", status: "Assigned", amount: 1200, note: null },
  {
    id: 2,
    name: "Phone",
    status: "Returned",
    amount: 300,
    note: "Screen cracked",
  },
];

const onAction = vi.fn();

const columns: ColumnsType<Row> = [
  { title: "Name", dataIndex: "name", key: "name" },
  {
    title: "Status",
    dataIndex: "status",
    key: "status",
    render: (value: string) => <Tag>{value}</Tag>,
  },
  { title: "Amount", dataIndex: "amount", key: "amount" },
  {
    title: "Note",
    dataIndex: "note",
    key: "note",
    render: (value: string | null) => value || "-",
  },
  {
    title: "Actions",
    key: "actions",
    render: (_, record) => (
      <Button
        onClick={(event) => {
          event.stopPropagation();
          onAction(record.id);
        }}
      >
        Open {record.name}
      </Button>
    ),
  },
];

const originalMatchMedia = window.matchMedia;

/** `matches: true` satisfies every min-width query, i.e. a desktop screen. */
function setViewport(matches: boolean) {
  window.matchMedia = ((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  useI18nStore.getState().setLanguage("en");
  onAction.mockReset();
  setViewport(false);
});

afterEach(() => {
  window.matchMedia = originalMatchMedia;
});

describe("ResponsiveTable", () => {
  it("keeps the antd table on desktop", () => {
    setViewport(true);
    render(
      <ResponsiveTable
        rowKey="id"
        columns={columns}
        dataSource={rows}
        pagination={false}
      />,
    );

    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
  });

  it("renders one card per row on phones", () => {
    render(
      <ResponsiveTable
        rowKey="id"
        columns={columns}
        dataSource={rows}
        pagination={false}
        mobileCard={{ extraKey: "status" }}
      />,
    );

    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    const [laptop, phone] = screen.getAllByRole("listitem");
    expect(within(laptop).getByText("Laptop")).toBeInTheDocument();
    expect(within(laptop).getByText("Assigned")).toBeInTheDocument();
    expect(within(laptop).getByText("Amount")).toBeInTheDocument();
    expect(within(laptop).getByText("1200")).toBeInTheDocument();
    // The "-" placeholder is table filler, so the empty field is left out.
    expect(within(laptop).queryByText("Note")).not.toBeInTheDocument();
    expect(within(phone).getByText("Screen cracked")).toBeInTheDocument();
    // The actions column becomes the footer rather than a labelled field.
    expect(
      within(laptop).getByRole("button", { name: "Open Laptop" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Actions")).not.toBeInTheDocument();
  });

  it("opens the row from a tap or the keyboard, but not from its actions", () => {
    const onRowClick = vi.fn();
    render(
      <ResponsiveTable
        rowKey="id"
        columns={columns}
        dataSource={rows}
        onRow={(record) => ({ onClick: () => onRowClick(record.id) })}
      />,
    );

    const [laptop] = screen.getAllByRole("listitem");
    fireEvent.click(laptop);
    expect(onRowClick).toHaveBeenCalledWith(1);
    fireEvent.keyDown(laptop, { key: "Enter" });
    expect(onRowClick).toHaveBeenCalledTimes(2);

    fireEvent.click(
      within(laptop).getByRole("button", { name: "Open Laptop" }),
    );
    expect(onAction).toHaveBeenCalledWith(1);
    expect(onRowClick).toHaveBeenCalledTimes(2);
  });

  it("reveals expandable content behind a toggle", () => {
    const onRowClick = vi.fn();
    render(
      <ResponsiveTable
        rowKey="id"
        columns={columns}
        dataSource={rows}
        onRow={(record) => ({ onClick: () => onRowClick(record.id) })}
        expandable={{
          expandedRowRender: (record) => <p>Progress for {record.name}</p>,
          rowExpandable: (record) => record.id === 1,
        }}
      />,
    );

    const [laptop, phone] = screen.getAllByRole("listitem");
    expect(
      within(phone).queryByRole("button", { name: /Show more/ }),
    ).not.toBeInTheDocument();

    const toggle = within(laptop).getByRole("button", { name: /Show more/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);

    expect(within(laptop).getByText("Progress for Laptop")).toBeInTheDocument();
    expect(
      within(laptop).getByRole("button", { name: /Show less/ }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it("hands page changes to a server-paged list", () => {
    const onChange = vi.fn();
    render(
      <ResponsiveTable
        rowKey="id"
        columns={columns}
        dataSource={rows}
        pagination={{ current: 1, pageSize: 2, total: 5, onChange }}
      />,
    );

    expect(screen.getByText("Laptop")).toBeInTheDocument();
    expect(screen.getByText("Phone")).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("2"));
    expect(onChange).toHaveBeenCalledWith(2, 2);
  });

  it("pages local data itself", () => {
    render(
      <ResponsiveTable
        rowKey="id"
        columns={columns}
        dataSource={[
          ...rows,
          {
            id: 3,
            name: "Tablet",
            status: "Assigned",
            amount: 500,
            note: null,
          },
        ]}
        pagination={{ pageSize: 2 }}
      />,
    );

    expect(screen.getByText("Laptop")).toBeInTheDocument();
    expect(screen.queryByText("Tablet")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTitle("2"));
    expect(screen.getByText("Tablet")).toBeInTheDocument();
    expect(screen.queryByText("Laptop")).not.toBeInTheDocument();
  });

  it("reports page changes through the table's onChange as well", () => {
    const onTableChange = vi.fn();
    render(
      <ResponsiveTable
        rowKey="id"
        columns={columns}
        dataSource={rows}
        pagination={{ current: 1, pageSize: 2, total: 5 }}
        onChange={onTableChange}
      />,
    );

    fireEvent.click(screen.getByTitle("2"));
    expect(onTableChange).toHaveBeenCalledWith(
      expect.objectContaining({ current: 2, pageSize: 2 }),
      {},
      [],
      expect.objectContaining({ action: "paginate" }),
    );
  });

  it("shows the table's empty text when there are no rows", () => {
    render(
      <ResponsiveTable
        rowKey="id"
        columns={columns}
        dataSource={[]}
        locale={{ emptyText: "Nothing assigned" }}
      />,
    );

    expect(screen.getByText("Nothing assigned")).toBeInTheDocument();
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
  });
});
