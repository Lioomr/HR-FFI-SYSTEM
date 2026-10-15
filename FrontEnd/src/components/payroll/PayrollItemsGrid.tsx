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
  Checkbox,
  Dropdown,
  Input,
  Select,
  Space,
  Switch,
  Table,
  Tag,
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
  ProvisionLineType,
  ValidationReport,
  PayrollStatus,
} from "../../services/api/payrollTypes";
const { Text } = Typography;
type Item = PayrollRunItemDto;
type ItemMoneyKey = {
  [K in keyof Item]: Item[K] extends Money | null ? K : never;
}[keyof Item];
interface MoneyColumn {
  key: ItemMoneyKey;
  titleKey: string;
  total: (summary: PayrollRunSummaryDto) => ReactNode;
  strong?: boolean;
}
const unknownCount = (summary: PayrollRunSummaryDto, type: ProvisionLineType) =>
  summary.unknown_provision_counts?.[type] ?? 0;

export default function PayrollItemsGrid({
  runId,
  summary,
  report,
  runStatus,
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
  const groups = useMemo(() => {
    const salary: MoneyColumn[] = [
      {
        key: "basic_salary",
        titleKey: "payroll.line.basic_salary",
        total: (s) => s.salary_components.basic_salary,
      },
      {
        key: "accommodation_allowance",
        titleKey: "payroll.line.accommodation_allowance",
        total: (s) => s.salary_components.accommodation_allowance,
      },
      {
        key: "transportation_allowance",
        titleKey: "payroll.line.transportation_allowance",
        total: (s) => s.salary_components.transportation_allowance,
      },
      {
        key: "telephone_allowance",
        titleKey: "payroll.line.telephone_allowance",
        total: (s) => s.salary_components.telephone_allowance,
      },
      {
        key: "petrol_allowance",
        titleKey: "payroll.line.petrol_allowance",
        total: (s) => s.salary_components.petrol_allowance,
      },
      {
        key: "other_allowance",
        titleKey: "payroll.line.other_allowance",
        total: (s) => s.salary_components.other_allowance,
      },
      {
        key: "gross_salary",
        titleKey: "payroll.field.gross_salary",
        total: (s) => s.total_gross_salary,
        strong: true,
      },
    ];
    const additions: MoneyColumn[] = [
      {
        key: "overtime_normal",
        titleKey: "payroll.line.overtime_normal",
        total: (s) => s.additions.overtime_normal,
      },
      {
        key: "weekly_rest_work",
        titleKey: "payroll.line.weekly_rest_work",
        total: (s) => s.additions.weekly_rest_work,
      },
      {
        key: "official_holiday_work",
        titleKey: "payroll.line.official_holiday_work",
        total: (s) => s.additions.official_holiday_work,
      },
      {
        key: "bonus",
        titleKey: "payroll.line.bonus",
        total: (s) => s.additions.bonus,
      },
      {
        key: "incentive",
        titleKey: "payroll.line.incentive",
        total: (s) => s.additions.incentive,
      },
      {
        key: "other_addition",
        titleKey: "payroll.line.other_addition",
        total: (s) => s.additions.other_addition,
      },
    ];
    const deductions: MoneyColumn[] = [
      {
        key: "absence_deduction",
        titleKey: "payroll.line.absence",
        total: (s) => s.deductions.absence,
      },
      {
        key: "gosi_employee_deduction",
        titleKey: "payroll.line.gosi_employee",
        total: (s) => s.deductions.gosi_employee,
      },
      {
        key: "loan_deduction",
        titleKey: "payroll.line.loan",
        total: (s) => s.deductions.loan,
      },
      {
        key: "penalty_deduction",
        titleKey: "payroll.ui.penalties",
        // The summary splits penalties by source and has no combined total
        // (open contract question); show the three API values as sent.
        total: (s) => (
          <Space orientation="vertical" size={0} style={{ fontSize: 12 }}>
            {(
              [
                [
                  "payroll.line.attendance_penalty",
                  s.deductions.attendance_penalty,
                ],
                ["payroll.line.penalty_fine", s.deductions.penalty_fine],
                [
                  "payroll.line.penalty_wage_withholding",
                  s.deductions.penalty_wage_withholding,
                ],
              ] as const
            ).map(([key, amount]) => (
              <span key={key}>
                {t(key)}: <MoneyText amount={amount} size={11} />
              </span>
            ))}
          </Space>
        ),
      },
      {
        key: "other_deduction",
        titleKey: "payroll.line.other_deduction",
        total: (s) => s.deductions.other_deduction,
      },
      {
        key: "total_deductions",
        titleKey: "payroll.field.total_deductions",
        total: (s) => s.total_deductions,
        strong: true,
      },
    ];
    const provision = (
      key: ItemMoneyKey,
      titleKey: string,
      summaryKey: keyof PayrollRunSummaryDto["provisions"],
      type: ProvisionLineType,
    ): MoneyColumn => ({
      key,
      titleKey,
      total: (s) => (
        <Space orientation="vertical" size={0}>
          <MoneyText amount={s.provisions[summaryKey]} strong />
          {unknownCount(s, type) > 0 && (
            <Tag color="gold" style={{ marginInlineEnd: 0 }}>
              {t("payroll.ui.unknownCount", { count: unknownCount(s, type) })}
            </Tag>
          )}
        </Space>
      ),
    });
    const provisions: MoneyColumn[] = [
      provision(
        "medical_provision",
        "payroll.line.medical",
        "medical",
        "MEDICAL",
      ),
      provision(
        "id_cost_provision",
        "payroll.line.id_cost",
        "id_cost",
        "ID_COST",
      ),
      provision(
        "air_ticket_provision",
        "payroll.line.air_ticket",
        "air_ticket",
        "AIR_TICKET",
      ),
      provision(
        "leave_provision",
        "payroll.line.leave_provision",
        "leave",
        "LEAVE_PROVISION",
      ),
      provision(
        "eos_provision",
        "payroll.line.eos_provision",
        "eos",
        "EOS_PROVISION",
      ),
      provision(
        "accommodation_cost",
        "payroll.line.accommodation_cost",
        "accommodation_cost",
        "ACCOMMODATION_COST",
      ),
      provision(
        "gosi_company_provision",
        "payroll.line.gosi_company",
        "gosi_company",
        "GOSI_COMPANY",
      ),
    ];
    return { salary, additions, deductions, provisions };
  }, [t]);

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
      <div className="payroll-grid-toolbar">
        <Input.Search
          allowClear
          placeholder={t("payroll.ui.searchEmployees")}
          aria-label={t("payroll.ui.searchEmployees")}
          style={{ width: 230 }}
          onSearch={(value) => {
            setSearch(value.trim());
            setPage(1);
          }}
        />
        <Checkbox
          disabled={limited || !currentReport || loading}
          checked={!limited && attention}
          onChange={(event) => {
            setAttention(event.target.checked);
            setPage(1);
          }}
        >
          {t("payroll.ux.needsAttention")}
        </Checkbox>
        <Select
          aria-label={t("payroll.ux.statusFilter")}
          disabled={limited || !currentReport || loading}
          style={{ minWidth: 155 }}
          value={limited ? "all" : status}
          onChange={(value) => {
            setStatus(value);
            setPage(1);
          }}
          options={["all", "blocking", "warning", "clear", "confirmation"].map(
            (value) => ({ value, label: t(`payroll.ux.status.${value}`) }),
          )}
        />
        <Select
          aria-label={t("payroll.ui.warningsFilter")}
          style={{ minWidth: 150 }}
          value={hasWarnings === undefined ? "all" : String(hasWarnings)}
          onChange={(value) => {
            setHasWarnings(value === "all" ? undefined : value === "true");
            setPage(1);
          }}
          options={[
            { value: "all", label: t("payroll.ui.allEmployees") },
            { value: "true", label: t("payroll.ui.withWarnings") },
            { value: "false", label: t("payroll.ui.withoutWarnings") },
          ]}
        />
        <Dropdown
          trigger={["click"]}
          menu={{
            items: (
              [
                "salary",
                "additions",
                "deductions",
                "provisions",
                "details",
              ] as const
            ).map((key) => ({
              key,
              label: (
                <Checkbox
                  checked={columnsState[key]}
                  onChange={(event) => setColumn(key, event.target.checked)}
                >
                  {t(`payroll.ux.columns.${key}`)}
                </Checkbox>
              ),
            })),
          }}
        >
          <Button>{t("payroll.ux.columns")}</Button>
        </Dropdown>
        <Switch
          size="small"
          checked={columnsState.provisions}
          onChange={(value) => setColumn("provisions", value)}
          aria-label={t("payroll.ui.showProvisions")}
        />
        <Text style={{ fontSize: 12 }}>{t("payroll.ui.showProvisions")}</Text>
      </div>
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
                    {typeof node === "string" ? (
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
