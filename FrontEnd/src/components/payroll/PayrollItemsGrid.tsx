import ExecutiveExemptMarker from "./ExecutiveExemptMarker";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Link } from "react-router-dom";
import {
  Alert,
  Button,
  Space,
  Table,
  Typography,
  Tooltip,
  type InputRef,
} from "antd";
import type { ColumnType, ColumnsType } from "antd/es/table";
import { useI18n } from "../../i18n/useI18n";
import { useAuthStore } from "../../auth/authStore";
import {
  filterPayrollItems,
  type PayrollEmployeeSession,
  type PayrollListState,
} from "./payrollNavigation";
import MoneyText from "./MoneyText";
import PayrollGridToolbar from "./PayrollGridToolbar";
import { useMoneyColumnGroups, type MoneyColumn } from "./payrollGridColumns";
import AbsenceQuickEdit from "./AbsenceQuickEdit";
import {
  readPayrollIndex,
  IncompletePayrollIndex,
  needsConfirmation,
  itemStatus,
  readColumns,
  writeColumns,
  type PayrollColumns,
} from "./payrollIndex";
import { useCanManagePayrollHrData } from "./payrollFormat";
import { listRunItems, patchRunItem } from "../../services/api/payrollApi";
import {
  parsePayrollError,
  payrollErrorSummary,
} from "../../services/api/payrollErrors";
import type {
  Money,
  PayrollRunItemDto,
  PayrollRunSummaryDto,
  ValidationReport,
  PayrollStatus,
} from "../../services/api/payrollTypes";
const { Text } = Typography;
type Item = PayrollRunItemDto;

export default function PayrollItemsGrid({
  runId,
  summary,
  report,
  runStatus,
  legacy = false,
  revision,
  refreshKey,
  onOpenItem,
  onChanged,
  initialState,
  onIndexLoaded,
}: {
  runId: number | string;
  summary: PayrollRunSummaryDto | null;
  report: ValidationReport | null;
  runStatus: PayrollStatus;
  legacy?: boolean;
  revision: number;
  refreshKey: number;
  initialState?: PayrollListState;
  onIndexLoaded?: (items: Item[] | null) => void;
  onOpenItem: (item: Item, session: PayrollEmployeeSession) => void;
  onChanged: () => Promise<void>;
}) {
  const { t } = useI18n();

  const canOpenProfiles = useCanManagePayrollHrData();
  const userId = useAuthStore((state) => state.user?.id ?? "anonymous");
  const storageKey = `ffi.payroll.columns.v1.${userId}`;
  const [columnsState, setColumnsState] = useState(
    () => initialState?.columns ?? readColumns(storageKey),
  );
  const [index, setIndex] = useState<Item[]>([]);
  const [limited, setLimited] = useState(false);
  const [serverItems, setServerItems] = useState<Item[]>([]);
  const [serverCount, setServerCount] = useState(0);
  const [serverPage, setServerPage] = useState(0);
  const [page, setPage] = useState(initialState?.page ?? 1);
  const [pageSize, setPageSize] = useState(initialState?.pageSize ?? 25);
  const [search, setSearch] = useState(initialState?.search ?? "");
  const [hasWarnings, setHasWarnings] = useState<boolean | undefined>(
    initialState?.hasWarnings,
  );
  const [attention, setAttention] = useState(initialState?.attention ?? false);
  const [status, setStatus] = useState(initialState?.status ?? "all");
  const [loading, setLoading] = useState(true);
  const [serverLoading, setServerLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState<number | null>(null);
  const [conflict, setConflict] = useState(false);
  const revisionRef = useRef(revision);
  const savingRef = useRef(false);
  const generation = useRef(0);
  const inputs = useRef(new Map<number, InputRef>());
  const nextFocus = useRef<number | null>(null);
  useEffect(() => {
    revisionRef.current = revision;
  }, [revision]);
  useEffect(() => {
    setColumnsState(initialState?.columns ?? readColumns(storageKey));
  }, [storageKey, initialState?.columns]);
  const setColumn = (key: keyof PayrollColumns, checked: boolean) => {
    setColumnsState((previous) => {
      const next = { ...previous, [key]: checked };
      writeColumns(storageKey, next);
      return next;
    });
  };
  const load = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    onIndexLoaded?.(null);
    setServerPage(0);
    setError(null);
    try {
      const data = await readPayrollIndex(runId);
      if (current !== generation.current) return;
      setLimited(data.limited);
      setIndex(data.items);
      onIndexLoaded?.(data.limited ? null : data.items);
      if (data.items[0]) revisionRef.current = data.items[0].run_revision;
    } catch (err) {
      if (current !== generation.current) return;
      setIndex([]);
      setError(
        err instanceof IncompletePayrollIndex
          ? t("payroll.ux.indexChanged")
          : payrollErrorSummary(
              parsePayrollError(err),
              t("payroll.ui.itemsLoadFailed"),
            ),
      );
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, [runId, t, onIndexLoaded]);
  useEffect(() => {
    const guard = generation;
    void load();
    return () => {
      guard.current++;
    };
  }, [load, refreshKey]);
  useEffect(() => {
    if (!limited || loading) return;
    let cancelled = false;
    setServerLoading(true);
    setError(null);
    void listRunItems(runId, {
      page,
      page_size: pageSize,
      search: search || undefined,
      has_warnings: hasWarnings,
    })
      .then((data) => {
        if (!cancelled) {
          setServerItems(data.items);
          setServerPage(data.page);
          setServerCount(data.count);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setServerItems([]);
          setError(
            payrollErrorSummary(
              parsePayrollError(err),
              t("payroll.ui.itemsLoadFailed"),
            ),
          );
        }
      })
      .finally(() => {
        if (!cancelled) setServerLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    limited,
    loading,
    runId,
    page,
    pageSize,
    search,
    hasWarnings,
    refreshKey,
    t,
  ]);
  const currentReport =
    report &&
    (limited || !index.length || report.revision === index[0]?.run_revision)
      ? report
      : null;
  const filtered = useMemo(
    () =>
      filterPayrollItems(index, currentReport, {
        search,
        hasWarnings,
        attention,
        status,
      }),
    [index, currentReport, search, hasWarnings, attention, status],
  );
  const openEmployee = (item: Item) =>
    onOpenItem(item, {
      list: {
        page: currentPage,
        pageSize,
        search,
        hasWarnings,
        attention,
        status,
        columns: columnsState,
        scroll: window.scrollY,
      },
      order:
        limited || loading || error
          ? undefined
          : filtered.map((record) => record.id),
    });
  const restored = useRef(false);
  useEffect(() => {
    if (
      !loading &&
      !serverLoading &&
      (!limited || serverPage > 0) &&
      !restored.current &&
      initialState
    ) {
      restored.current = true;
      requestAnimationFrame(() => window.scrollTo(0, initialState.scroll));
    }
  }, [loading, serverLoading, limited, serverPage, initialState]);
  const count = limited ? serverCount : filtered.length;
  const currentPage = Math.min(page, Math.max(1, Math.ceil(count / pageSize)));
  const items = limited
    ? serverItems
    : filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  useEffect(() => {
    if (
      loading ||
      serverLoading ||
      saving !== null ||
      nextFocus.current === null
    )
      return;
    if (limited) {
      if (serverPage !== currentPage) return;
      const target =
        nextFocus.current === -1
          ? serverItems.find(needsConfirmation)?.id
          : nextFocus.current;
      if (target !== undefined) {
        const input = inputs.current.get(target);
        input?.focus();
        input?.input?.scrollIntoView?.({ block: "nearest" });
      }
      nextFocus.current = null;
      return;
    }
    const nextId = nextFocus.current;
    const at = filtered.findIndex((item) => item.id === nextId);
    if (at < 0) {
      nextFocus.current = null;
      return;
    }
    const targetPage = Math.floor(at / pageSize) + 1;
    if (currentPage !== targetPage) {
      setPage(targetPage);
      return;
    }
    const input = inputs.current.get(nextId);
    if (input) {
      input.focus();
      input.input?.scrollIntoView?.({ block: "nearest" });
      nextFocus.current = null;
    }
  }, [
    filtered,
    loading,
    serverLoading,
    saving,
    pageSize,
    currentPage,
    limited,
    serverItems,
    serverPage,
  ]);
  const saveAbsence = async (item: Item, days: string, reason: string) => {
    if (savingRef.current || loading || serverLoading || conflict) return;
    savingRef.current = true;
    setSaving(item.id);
    setSaveMessage(null);
    const order = limited ? serverItems : filtered;
    const at = order.findIndex((row) => row.id === item.id);
    const following = order.slice(at + 1).find(needsConfirmation);
    const advancePage =
      limited && !following && currentPage * pageSize < serverCount;
    try {
      const updated = await patchRunItem(runId, item.id, {
        expected_revision: revisionRef.current,
        changes: { absence_days_override: days },
        reason,
      });
      revisionRef.current = updated.run_revision;
      nextFocus.current = following?.id ?? (advancePage ? -1 : null);
      await onChanged();
      await load();
      if (advancePage) setPage(currentPage + 1);
      setSaveMessage(
        t(
          limited || following
            ? "payroll.ui.itemSaved"
            : "payroll.ux.confirmationDone",
        ),
      );
    } catch (err) {
      const parsed = parsePayrollError(err);
      nextFocus.current = null;
      setSaveMessage(payrollErrorSummary(parsed, t("payroll.ui.saveFailed")));
      if (parsed.isStaleRevision) {
        setConflict(true);
        await onChanged();
        await load();
      }
    } finally {
      savingRef.current = false;
      setSaving(null);
    }
  };
  const groups = useMoneyColumnGroups();

  const moneyLeaf = (column: MoneyColumn): ColumnType<Item> => ({
    title: t(column.titleKey),
    key: column.key,
    align: "right",
    width: 112,
    render: (_, item) => (
      <MoneyText
        amount={item[column.key] as Money | null}
        strong={column.strong}
      />
    ),
  });
  const selectedSalary = columnsState.details
    ? groups.salary
    : [
        {
          key: "gross_salary",
          titleKey: "payroll.field.gross_salary",
          total: (s: PayrollRunSummaryDto) => s.total_gross_salary,
          strong: true,
        } as MoneyColumn,
      ];
  const selectedAdditions = columnsState.details
    ? groups.additions
    : [
        {
          key: "total_additions",
          titleKey: "payroll.field.total_additions",
          total: (s: PayrollRunSummaryDto) => s.total_additions,
        } as MoneyColumn,
      ];
  const selectedDeductions = columnsState.details
    ? groups.deductions
    : [
        {
          key: "total_deductions",
          titleKey: "payroll.field.total_deductions",
          total: (s: PayrollRunSummaryDto) => s.total_deductions,
        } as MoneyColumn,
      ];
  const shownGroups = [
    ...(columnsState.salary
      ? [
          {
            title: t("payroll.ux.columns.salary"),
            key: "salary",
            leaves: selectedSalary,
          },
        ]
      : []),
    ...(columnsState.additions
      ? [
          {
            title: t("payroll.pdf.additions"),
            key: "additions",
            leaves: selectedAdditions,
          },
        ]
      : []),
    ...(columnsState.deductions
      ? [
          {
            title: t("payroll.pdf.deductions"),
            key: "deductions",
            leaves: selectedDeductions,
          },
        ]
      : []),
  ];
  const columns: ColumnsType<Item> = [
    {
      title: t("payroll.ui.employee"),
      key: "employee",
      fixed: "start",
      width: 220,
      render: (_, item) => (
        <div
          className="payroll-employee"
          data-status={itemStatus(item, currentReport)}
        >
          <div>
            <div>
              {canOpenProfiles ? (
                <Link
                  to={`/hr/employees/${item.employee_profile_id}`}
                  onClick={(event) => event.stopPropagation()}
                >
                  {item.employee_name}
                </Link>
              ) : (
                <Text>{item.employee_name}</Text>
              )}
            </div>
            <Text type="secondary" style={{ fontSize: 12 }} dir="ltr">
              {item.employee_id}
            </Text>
            <Text type="secondary" style={{ fontSize: 11 }}>
              {" "}
              · {t(`payroll.ux.status.${itemStatus(item, currentReport)}`)}
            </Text>
            {item.executive_exempt && <ExecutiveExemptMarker />}
            <Button
              className="payroll-row-details"
              type="text"
              size="small"
              style={{ fontSize: 12, paddingInline: 4 }}
              aria-label={t("payroll.ui.openItem", {
                name: item.employee_name,
              })}
              onClick={(event) => {
                event.stopPropagation();
                openEmployee(item);
              }}
            >
              {t("payroll.ux.details")}
            </Button>
          </div>
        </div>
      ),
    },
    ...shownGroups.map((group) => ({
      title: group.title,
      key: group.key,
      children: group.leaves.map(moneyLeaf),
    })),
    {
      title: t("payroll.ui.absenceOverride"),
      key: "absence-confirmation",
      width: 252,
      render: (_, item) =>
        runStatus === "DRAFT" && needsConfirmation(item) ? (
          <AbsenceQuickEdit
            key={item.id}
            item={item}
            disabled={loading || serverLoading || saving !== null || conflict}
            saving={saving === item.id}
            inputRef={(input) => {
              if (input) inputs.current.set(item.id, input);
              else inputs.current.delete(item.id);
            }}
            onSave={(days, reason) => saveAbsence(item, days, reason)}
          />
        ) : (
          <Text type="secondary">
            {item.absence.manual_confirmed
              ? t("payroll.ux.confirmedDays", {
                  days:
                    item.manual_inputs.absence_days_override ??
                    item.absence.override_days,
                })
              : t("payroll.ux.noConfirmationNeeded")}
          </Text>
        ),
    },
    {
      title: t("payroll.field.net_salary"),
      key: "net_salary",
      align: "right",
      width: 112,
      render: (_, item) => <MoneyText amount={item.net_salary} strong />,
    },
    ...(columnsState.provisions
      ? [
          {
            title: t("payroll.pdf.provisions"),
            key: "provisions",
            children: groups.provisions.map(moneyLeaf),
          },
        ]
      : []),
    {
      title: t("payroll.field.total_company_cost"),
      key: "total_company_cost",
      align: "right",
      width: 136,
      render: (_, item) => (
        <Space
          orientation="vertical"
          size={0}
          style={{ alignItems: "flex-end" }}
        >
          <MoneyText amount={item.total_company_cost} strong />
          {item.cost_incomplete && (
            <Tooltip title={t("payroll.field.cost_incomplete")}>
              <span
                className="payroll-cost-marker"
                tabIndex={0}
                aria-label={t("payroll.field.cost_incomplete")}
              >
                *
              </span>
            </Tooltip>
          )}
        </Space>
      ),
    },
  ];
  const totals: ReactNode[] = summary
    ? [
        <Text strong key="total">
          {t("payroll.ui.totalsRow", { count: summary.total_employees })}
        </Text>,
        ...shownGroups.flatMap((group) =>
          group.leaves.map((column) => column.total(summary)),
        ),
        <Text type="secondary" key="absence">
          {t("payroll.ux.runTotals")}
        </Text>,
        summary.total_net_salary,
        ...(columnsState.provisions
          ? groups.provisions.map((column) => column.total(summary))
          : []),
        summary.total_company_cost,
      ]
    : [];
  const unavailable =
    loading ||
    serverLoading ||
    !!error ||
    (limited && serverPage !== currentPage) ||
    (!currentReport && (attention || status !== "all"));
  return (
    <Space orientation="vertical" size={12} style={{ width: "100%" }}>
      <PayrollGridToolbar
        limited={limited}
        loading={loading}
        hasReport={!!currentReport}
        attention={attention}
        status={status}
        hasWarnings={hasWarnings}
        columnsState={columnsState}
        onSearch={(value) => {
          setSearch(value.trim());
          setPage(1);
        }}
        onAttentionChange={(checked) => {
          setAttention(checked);
          setPage(1);
        }}
        onStatusChange={(value) => {
          setStatus(value);
          setPage(1);
        }}
        onHasWarningsChange={(value) => {
          setHasWarnings(value);
          setPage(1);
        }}
        onColumnChange={setColumn}
      />
      {limited && <Alert type="info" message={t("payroll.ux.indexLimited")} />}
      {!currentReport && (
        <Text type="secondary">{t("payroll.ui.validationUnavailable")}</Text>
      )}
      {error && (
        <Alert
          type="error"
          message={error}
          action={
            <Button onClick={() => void load()}>
              {t("payroll.ui.reload")}
            </Button>
          }
        />
      )}
      {saveMessage && (
        <div role={conflict ? "alert" : "status"}>
          <Text type={conflict ? "danger" : undefined}>{saveMessage}</Text>
          {conflict && (
            <Button
              onClick={() => {
                setConflict(false);
                setSaveMessage(null);
              }}
            >
              {t("payroll.ux.retryAfterReview")}
            </Button>
          )}
        </div>
      )}
      <Table<Item>
        className="payroll-items-table"
        rowKey="id"
        size="small"
        sticky
        loading={loading || serverLoading}
        columns={columns}
        dataSource={error ? [] : items}
        style={{ minHeight: 480 }}
        tableLayout="fixed"
        scroll={{
          x:
            columnsState.details || columnsState.provisions
              ? "max-content"
              : undefined,
        }}
        onRow={(item) => ({ onClick: () => openEmployee(item) })}
        locale={{
          emptyText: t(
            unavailable ? "payroll.ux.unavailable" : "payroll.ux.noMatches",
          ),
        }}
        pagination={
          unavailable
            ? false
            : {
                current: currentPage,
                pageSize,
                total: unavailable ? 0 : count,
                showSizeChanger: true,
                showTotal: (total) =>
                  t("payroll.ux.resultCount", { count: total }),
                onChange: (next, size) => {
                  setPage(next);
                  setPageSize(size);
                },
              }
        }
        summary={() =>
          summary ? (
            <Table.Summary fixed="bottom">
              <Table.Summary.Row>
                {totals.map((node, i) => (
                  <Table.Summary.Cell
                    key={i}
                    index={i}
                    align={
                      i === 0 ||
                      i ===
                        1 + shownGroups.reduce((n, g) => n + g.leaves.length, 0)
                        ? undefined
                        : "right"
                    }
                  >
                    {node === null && legacy ? (
                      <Text type="secondary">
                        {t("payroll.ux.legacyUnavailable")}
                      </Text>
                    ) : typeof node === "string" ? (
                      <MoneyText amount={node} strong />
                    ) : (
                      node
                    )}
                  </Table.Summary.Cell>
                ))}
              </Table.Summary.Row>
            </Table.Summary>
          ) : null
        }
      />
      <Text type="secondary" role="status" style={{ fontSize: 12 }}>
        {t(
          unavailable || limited
            ? "payroll.ux.indexUnavailable"
            : "payroll.ux.indexComplete",
          { count: index.length },
        )}
      </Text>
    </Space>
  );
}
