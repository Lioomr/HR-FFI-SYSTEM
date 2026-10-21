import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Button,
  Drawer,
  Grid,
  Space,
  Tag,
  Table,
  Typography,
  theme,
} from "antd";
import EmptyState from "../ui/EmptyState";
import LoadingState from "../ui/LoadingState";
import { useI18n } from "../../i18n/useI18n";
import { humanizeCode } from "../../utils/humanizeCode";
import { formatDateTime } from "../../utils/dateTime";
import { usePayrollEnums } from "../../hooks/usePayrollEnums";
import {
  parsePayrollError,
  payrollErrorSummary,
} from "../../services/api/payrollErrors";
import type {
  PayrollHistoryEntry,
  PayrollPage,
} from "../../services/api/payrollTypes";

const { Text } = Typography;
const PAGE_SIZE = 25;

/** Renders an audited original/new value as plain text (data, never HTML). */
function renderValue(value: unknown, emptyLabel: string): string {
  if (value === null || value === undefined) return emptyLabel;
  if (Array.isArray(value))
    return value.map((entry) => renderValue(entry, emptyLabel)).join(" · ");
  if (typeof value === "object")
    return Object.values(value)
      .map((entry) => renderValue(entry, emptyLabel))
      .join(" · ");
  return String(value);
}

/**
 * Immutable payroll history (contract DTO H): settings changes, employee GOSI
 * changes, item adjustments and assignment changes all share this drawer.
 * Each entry shows the original and new values, the reason and the actor.
 */
export default function PayrollHistoryDrawer({
  embedded = false,
  fullWidth = false,
  tableView = false,
  open,
  title,
  onClose,
  load,
}: {
  embedded?: boolean;
  fullWidth?: boolean;
  tableView?: boolean;
  open: boolean;
  title: string;
  onClose: () => void;
  load: (
    page: number,
    pageSize: number,
  ) => Promise<PayrollPage<PayrollHistoryEntry>>;
}) {
  const { token } = theme.useToken();
  const { t, direction } = useI18n();
  const { label } = usePayrollEnums();
  const screens = Grid.useBreakpoint();
  const isPhone = screens.md === false;
  const [entries, setEntries] = useState<PayrollHistoryEntry[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPage = useCallback(
    async (target: number) => {
      setLoading(true);
      setError(null);
      try {
        const data = await load(target, PAGE_SIZE);
        setEntries((current) =>
          target === 1 ? data.items : [...current, ...data.items],
        );
        setPage(data.page);
        setTotalPages(data.total_pages);
      } catch (err) {
        setError(
          payrollErrorSummary(
            parsePayrollError(err),
            t("payroll.ui.historyLoadFailed"),
          ),
        );
      } finally {
        setLoading(false);
      }
    },
    [load, t],
  );

  useEffect(() => {
    if (open) void fetchPage(1);
  }, [open, fetchPage]);

  const empty = t("payroll.ui.emptyValue");
  const valueAt = (value: unknown, field: string) =>
    (value && typeof value === "object"
      ? (value as Record<string, unknown>)[field]
      : undefined) ??
    field
      .split(".")
      .reduce<unknown>(
        (current, key) =>
          current && typeof current === "object"
            ? (current as Record<string, unknown>)[key]
            : undefined,
        value,
      );
  const rows = entries.flatMap((entry) =>
    entry.changed_fields.map((field) => ({
      key: `${entry.id}:${field}`,
      entry,
      field,
    })),
  );
  const historyTable = (
    <Table
      size="small"
      rowKey="key"
      dataSource={rows}
      pagination={false}
      scroll={{ x: 800 }}
      columns={[
        {
          title: t("payroll.ui.historyBy", { name: "" }),
          key: "who",
          render: (_, row) => row.entry.actor?.name ?? t("payroll.ui.unknown"),
        },
        {
          title: t("payroll.ui.date"),
          key: "when",
          render: (_, row) => (
            <bdi dir="ltr">{formatDateTime(row.entry.created_at)}</bdi>
          ),
        },
        {
          title: t("payroll.ui.historyField"),
          key: "field",
          render: (_, row) =>
            t(
              `payroll.field.${row.field}`,
              undefined,
              humanizeCode(row.field),
            ),
        },
        {
          title: t("payroll.ui.historyOriginal"),
          key: "old",
          render: (_, row) => (
            <bdi dir="ltr">
              {renderValue(valueAt(row.entry.original_value, row.field), empty)}
            </bdi>
          ),
        },
        {
          title: t("payroll.ui.historyNew"),
          key: "new",
          render: (_, row) => (
            <bdi dir="ltr">
              {renderValue(valueAt(row.entry.new_value, row.field), empty)}
            </bdi>
          ),
        },
        {
          title: t("payroll.ui.reasonLabel"),
          key: "reason",
          render: (_, row) => row.entry.reason,
        },
      ]}
    />
  );

  const body = (
    <>
      {" "}
      {error && (
        <Alert
          type="error"
          showIcon
          message={error}
          action={
            <Button onClick={() => void fetchPage(1)}>
              {t("common.retry")}
            </Button>
          }
          style={{ marginBottom: 16 }}
        />
      )}
      {loading && entries.length === 0 ? (
        <LoadingState />
      ) : entries.length === 0 && !error ? (
        <EmptyState
          title={t("payroll.ui.historyEmptyTitle")}
          description={t("payroll.ui.historyEmpty")}
        />
      ) : (
        <Space orientation="vertical" size={12} style={{ width: "100%" }}>
          {tableView ? (
            historyTable
          ) : (
            <ol
              aria-label={title}
              style={{ listStyle: "none", margin: 0, padding: 0 }}
            >
              {entries.map((entry) => (
                <li
                  key={entry.id}
                  style={{
                    background: token.colorBgContainer,
                    borderRadius: 12,
                    border: `1px solid ${token.colorBorderSecondary}`,
                    padding: isPhone ? 12 : 16,
                    marginBottom: 12,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      flexWrap: "wrap",
                      gap: 8,
                      marginBottom: 8,
                    }}
                  >
                    <Tag color="blue">
                      {label(
                        entry.type.endsWith("_CHANGE")
                          ? "history_type"
                          : "adjustment_type",
                        entry.type,
                        entry.type.endsWith("_CHANGE")
                          ? `payroll.history.${entry.type.toLowerCase()}`
                          : `payroll.adjustment.${entry.type.toLowerCase()}`,
                      )}
                    </Tag>
                    <Text type="secondary">
                      <bdi dir="ltr">{formatDateTime(entry.created_at)}</bdi>
                    </Text>
                  </div>
                  <Text>
                    {t("payroll.ui.historyBy", {
                      name: entry.actor?.name ?? t("payroll.ui.unknown"),
                    })}
                  </Text>
                  <table
                    style={{
                      width: "100%",
                      marginTop: 8,
                      borderCollapse: "collapse",
                      fontSize: 13,
                    }}
                  >
                    <thead>
                      <tr>
                        <th style={{ textAlign: "start" }}>
                          {t("payroll.ui.historyField")}
                        </th>
                        <th style={{ textAlign: "start" }}>
                          {t("payroll.ui.historyOriginal")}
                        </th>
                        <th style={{ textAlign: "start" }}>
                          {t("payroll.ui.historyNew")}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {entry.changed_fields.map((field) => (
                        <tr key={field}>
                          <td style={{ paddingInlineEnd: 8 }}>
                            <code>{field}</code>
                          </td>
                          <td dir="ltr" style={{ textAlign: "start" }}>
                            {renderValue(entry.original_value?.[field], empty)}
                          </td>
                          <td dir="ltr" style={{ textAlign: "start" }}>
                            {renderValue(entry.new_value?.[field], empty)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div style={{ marginTop: 8 }}>
                    <Text type="secondary">
                      {t("payroll.ui.reasonLabel")}:{" "}
                    </Text>
                    <Text>{entry.reason}</Text>
                  </div>
                </li>
              ))}
            </ol>
          )}
          {page < totalPages && (
            <Button
              block
              loading={loading}
              onClick={() => void fetchPage(page + 1)}
            >
              {t("payroll.ui.loadMore")}
            </Button>
          )}
        </Space>
      )}
    </>
  );
  if (embedded) return body;
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={title}
      placement={direction === "rtl" ? "left" : "right"}
      size={fullWidth ? window.innerWidth : 560}
      styles={{
        wrapper: { maxWidth: "100vw", width: fullWidth ? "100vw" : undefined },
        body: { padding: isPhone ? 16 : 24 },
      }}
      destroyOnHidden
    >
      {body}
    </Drawer>
  );
}
