import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";
import {
  Alert,
  Avatar,
  Button,
  Card,
  Col,
  Collapse,
  DatePicker,
  Empty,
  Form,
  Input,
  Modal,
  Row,
  Select,
  Space,
  Switch,
  Tabs,
  Tag,
  notification,
  theme,
} from "antd";
import {
  BookOutlined,
  ClearOutlined,
  ClockCircleOutlined,
  ExclamationCircleOutlined,
  EyeOutlined,
  MessageOutlined,
  PlusOutlined,
  ProfileOutlined,
} from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import dayjs from "dayjs";
import PageHeader from "../../../components/ui/PageHeader";
import ResponsiveTable from "../../../components/ui/ResponsiveTable";
import StatCard from "../../../components/ui/StatCard";
import { isApiError } from "../../../services/api/apiTypes";
import { listEmployees } from "../../../services/api/employeesApi";
import {
  createPenalty,
  getPenaltyCatalog,
  listPenalties,
  type PenaltyCatalogItem,
  type PenaltyCatalogLevel,
  type PenaltyFilters,
  type PenaltyRecord,
  type PenaltyStatus,
} from "../../../services/api/penaltiesApi";
import { formatDateOnly } from "../../../utils/dateTime";
import { useI18n } from "../../../i18n/useI18n";
import PenaltyStatusTag from "./PenaltyStatusTag";
import PenaltyCategoryTag from "./PenaltyCategoryTag";
import PenaltyAmount from "./PenaltyAmount";
import { penaltyErrorMessage } from "./penaltyErrors";

type CreateValues = {
  employee_profile_id: number;
  catalog_code: string;
  occurred_on: dayjs.Dayjs;
  note: string;
};

// Backend PenaltyRecord.Status values accepted by the list filter.
const STATUS_OPTIONS: PenaltyStatus[] = [
  "pending_hr_mark",
  "issued",
  "disputed",
  "waived",
  "applied",
];

type StatKey = "pending_hr_mark" | "issued" | "disputed" | "all";
const STAT_KEYS: StatKey[] = ["pending_hr_mark", "issued", "disputed", "all"];

type EmployeeOption = { value: number; label: string };

/**
 * Server-searched employee picker. Each instance keeps its own search text and
 * remembers the chosen option so its label survives a new search result.
 */
function EmployeeSearchSelect({
  value,
  onChange,
  ...rest
}: {
  value?: number;
  onChange?: (value: number | undefined) => void;
  allowClear?: boolean;
  placeholder?: string;
  style?: CSSProperties;
  id?: string;
  "aria-label"?: string;
}) {
  const { t, language } = useI18n();
  const [search, setSearch] = useState("");
  const [options, setOptions] = useState<EmployeeOption[]>([]);
  const [selected, setSelected] = useState<EmployeeOption | null>(null);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(
      () => {
        void listEmployees({ page_size: 100, search: search || undefined })
          .then((result) => {
            if (!active || isApiError(result)) return;
            setOptions(
              result.data.results.map((employee) => ({
                value: employee.id,
                label:
                  language === "ar"
                    ? employee.full_name_ar || employee.full_name
                    : employee.full_name_en || employee.full_name,
              })),
            );
          })
          .catch(() => {
            if (active)
              notification.error({ message: t("penalties.employeesFailed") });
          });
      },
      search ? 250 : 0,
    );
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [search, language, t]);

  const merged =
    selected &&
    selected.value === value &&
    !options.some((option) => option.value === selected.value)
      ? [selected, ...options]
      : options;

  return (
    <Select
      {...rest}
      showSearch
      filterOption={false}
      value={value}
      onSearch={setSearch}
      onChange={(next: number | undefined) => {
        setSelected(merged.find((option) => option.value === next) ?? null);
        setSearch("");
        onChange?.(next);
      }}
      options={merged}
    />
  );
}

export default function PenaltiesListPage({
  role,
}: {
  role: "hr" | "employee";
}) {
  const { t, language } = useI18n();
  const { token } = theme.useToken();
  const navigate = useNavigate();
  const [items, setItems] = useState<PenaltyRecord[]>([]);
  const [catalog, setCatalog] = useState<PenaltyCatalogItem[]>([]);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<PenaltyFilters>({});
  const [searchText, setSearchText] = useState("");
  const [filterEmployee, setFilterEmployee] = useState<number>();
  const [stats, setStats] = useState<Partial<Record<StatKey, number>>>({});
  const [createOpen, setCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [form] = Form.useForm<CreateValues>();
  const requestSeq = useRef(0);
  const scope = useMemo(
    () => (role === "employee" ? { mine: true } : {}),
    [role],
  );

  const dateRangeInvalid =
    !!filters.date_from &&
    !!filters.date_to &&
    filters.date_from > filters.date_to;
  const hasFilters =
    Object.values(filters).some((value) => value != null && value !== "") ||
    !!searchText;
  const includeAutomated = role === "hr" && !!filters.include_automated;

  const load = useCallback(async () => {
    const seq = ++requestSeq.current;
    if (dateRangeInvalid) {
      setItems([]);
      setTotal(0);
      setLoadError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const result = await listPenalties({
        ...filters,
        page,
        page_size: 10,
        ...scope,
      });
      if (seq !== requestSeq.current) return;
      if (isApiError(result)) {
        setItems([]);
        setTotal(0);
        setLoadError(penaltyErrorMessage(t, result.message));
        return;
      }
      setItems(result.data.items);
      setTotal(result.data.count ?? 0);
    } catch (error) {
      if (seq !== requestSeq.current) return;
      setItems([]);
      setTotal(0);
      setLoadError(penaltyErrorMessage(t, error));
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [dateRangeInvalid, filters, page, scope, t]);

  useEffect(() => {
    void load();
  }, [load]);

  // Summary counts come from the list endpoint's pagination count (one
  // single-row request per status), so they stay within the user's scope.
  useEffect(() => {
    let active = true;
    STAT_KEYS.forEach((key) => {
      void listPenalties({
        ...scope,
        // Counts follow the list: automatic warnings only when HR shows them.
        ...(includeAutomated ? { include_automated: true } : {}),
        ...(key === "all" ? {} : { status: key }),
        page: 1,
        page_size: 1,
      })
        .then((result) => {
          if (active && !isApiError(result))
            setStats((current) => ({
              ...current,
              [key]: result.data.count ?? 0,
            }));
        })
        .catch(() => undefined); // The card shows "—".
    });
    return () => {
      active = false;
    };
  }, [scope, includeAutomated]);

  useEffect(() => {
    let active = true;
    void getPenaltyCatalog()
      .then((result) => {
        if (!active) return;
        if (isApiError(result)) {
          setCatalogError(penaltyErrorMessage(t, result.message));
        } else {
          setCatalog(result.data);
          setCatalogError(null);
        }
      })
      .catch((error) => {
        if (active) setCatalogError(penaltyErrorMessage(t, error));
      });
    return () => {
      active = false;
    };
  }, [role, t]);

  const categories = useMemo(
    () => Array.from(new Set(catalog.map((item) => item.category))),
    [catalog],
  );
  const manualCatalog = useMemo(
    () => catalog.filter((item) => !item.automatic),
    [catalog],
  );
  const catalogTitle = (item: PenaltyRecord) => {
    const match = catalog.find((entry) => entry.code === item.catalog_code);
    return match
      ? language === "ar"
        ? match.title_ar
        : match.title_en
      : item.catalog_code;
  };
  const secondaryText: CSSProperties = {
    color: token.colorTextSecondary,
    fontSize: 12,
  };

  const columns: ColumnsType<PenaltyRecord> = [
    ...(role === "hr"
      ? [
          {
            title: t("penalties.employee"),
            key: "employee",
            render: (_: unknown, item: PenaltyRecord) => {
              const name =
                language === "ar"
                  ? item.employee_name_ar || item.employee_name_en
                  : item.employee_name_en || item.employee_name_ar;
              return (
                <Space size={8}>
                  <Avatar
                    size="small"
                    style={{
                      background: token.colorPrimaryBg,
                      color: token.colorPrimary,
                      flexShrink: 0,
                    }}
                    aria-hidden
                  >
                    {name?.trim().charAt(0).toUpperCase()}
                  </Avatar>
                  <span>{name}</span>
                </Space>
              );
            },
          },
        ]
      : []),
    {
      title: t("penalties.catalogItem"),
      key: "catalog",
      render: (_, item) => (
        <div>
          <div style={{ fontWeight: 500 }}>{catalogTitle(item)}</div>
          <Space size={4} wrap style={{ marginTop: 4 }}>
            <Tag bordered={false} style={{ marginInlineEnd: 0 }}>
              {item.catalog_code}
            </Tag>
            <PenaltyCategoryTag category={item.category} />
            {item.automation && (
              <Tag bordered={false} color="processing">
                {t("penalties.autoWarning")}
              </Tag>
            )}
          </Space>
        </div>
      ),
    },
    {
      title: t("penalties.occurredOn"),
      dataIndex: "occurred_on",
      key: "occurred_on",
      render: (value: string) => (
        <span style={{ fontVariantNumeric: "tabular-nums" }}>
          {formatDateOnly(value, "—")}
        </span>
      ),
    },
    {
      title: t("penalties.action"),
      key: "penalty_action",
      render: (_, item) => (
        <span style={secondaryText}>
          {t(`penalties.action.${item.action}`, undefined, item.action)}
        </span>
      ),
    },
    {
      title: t("common.status"),
      dataIndex: "status",
      key: "status",
      render: (value: PenaltyRecord["status"]) => (
        <PenaltyStatusTag status={value} />
      ),
    },
    {
      title: t("penalties.deduction"),
      key: "amount",
      align: "end",
      render: (_, item) => (
        <PenaltyAmount
          value={item.total_deduction_amount ?? item.amount}
          fontWeight={600}
        />
      ),
    },
    {
      title: t("common.view"),
      key: "actions",
      align: "end",
      render: (_, item) => (
        <Button
          type="link"
          icon={<EyeOutlined aria-hidden />}
          aria-label={t("penalties.viewRecord", {
            id: item.id,
            title: catalogTitle(item),
          })}
          onClick={() => navigate(`/${role}/penalties/${item.id}`)}
        >
          {t("common.view")}
        </Button>
      ),
    },
  ];

  const updateFilter = (next: Partial<PenaltyFilters>) => {
    setPage(1);
    setFilters((current) => ({ ...current, ...next }));
  };
  const clearFilters = () => {
    setPage(1);
    setFilters({});
    setSearchText("");
    setFilterEmployee(undefined);
  };

  async function submit(values: CreateValues) {
    setSaving(true);
    setCreateError(null);
    try {
      const result = await createPenalty({
        ...values,
        occurred_on: values.occurred_on.format("YYYY-MM-DD"),
        note: values.note ?? "",
      });
      if (isApiError(result)) {
        setCreateError(penaltyErrorMessage(t, result.message));
        return;
      }
      setCreateOpen(false);
      form.resetFields();
      notification.success({ message: t("penalties.created") });
      navigate(`/hr/penalties/${result.data.id}`);
    } catch (error) {
      setCreateError(penaltyErrorMessage(t, error));
    } finally {
      setSaving(false);
    }
  }

  const catalogAlert = catalogError && (
    <Alert
      type="error"
      showIcon
      title={t("penalties.catalogFailed")}
      description={catalogError}
      style={{ marginBottom: 12 }}
    />
  );

  const statCards: Array<{
    key: StatKey;
    icon: ReactNode;
    color: string;
  }> = [
    { key: "pending_hr_mark", icon: <ClockCircleOutlined />, color: "#d97706" },
    { key: "issued", icon: <ExclamationCircleOutlined />, color: "#2563eb" },
    { key: "disputed", icon: <MessageOutlined />, color: "#ea580c" },
    { key: "all", icon: <ProfileOutlined />, color: "#475569" },
  ];

  const levelLabel = (level: PenaltyCatalogLevel) => {
    const action = t(
      `penalties.action.${level.action}`,
      undefined,
      level.action,
    );
    if (!level.amount_value) return action;
    const basis = t(
      `penalties.basis.${level.amount_basis}`,
      undefined,
      level.amount_basis ?? "",
    );
    return `${action} · ${level.amount_value} ${basis}`;
  };
  // Automatic warnings repeat the first printed level before the printed fines.
  const ladder = (item: PenaltyCatalogItem): PenaltyCatalogLevel[] => {
    const extra = item.auto_warning_extra_levels ?? 0;
    const [first, ...rest] = item.levels;
    if (!extra || !first) return item.levels;
    return [
      ...Array.from({ length: extra + 1 }, (_, index) => ({
        ...first,
        occurrence: first.occurrence + index,
      })),
      ...rest.map((level) => ({
        ...level,
        occurrence: level.occurrence + extra,
      })),
    ];
  };
  const scheduleColumns: ColumnsType<PenaltyCatalogItem> = [
    {
      title: t("penalties.catalogItem"),
      key: "title",
      render: (_, item) => (
        <div>
          <div style={{ fontWeight: 500 }}>
            {language === "ar" ? item.title_ar : item.title_en}
          </div>
          <Space size={4} wrap style={{ marginTop: 4 }}>
            <Tag bordered={false} style={{ marginInlineEnd: 0 }}>
              {item.code}
            </Tag>
            {item.automatic && (
              <Tag bordered={false} color="processing">
                {t("penalties.automatic")}
              </Tag>
            )}
          </Space>
        </div>
      ),
    },
    {
      title: t("penalties.countPeriod"),
      key: "count_period",
      render: (_, item) =>
        t(
          `penalties.period.${item.count_period}`,
          undefined,
          item.count_period,
        ),
    },
    {
      title: t("penalties.levels"),
      key: "levels",
      render: (_, item) => (
        <Space size={[4, 4]} wrap>
          {ladder(item).map((level) => (
            <Tag key={level.occurrence} style={{ marginInlineEnd: 0 }}>
              <strong>
                {t("penalties.occurrenceShort", { n: level.occurrence })}
              </strong>{" "}
              {levelLabel(level)}
            </Tag>
          ))}
        </Space>
      ),
    },
  ];
  const scheduleTable = (rows: PenaltyCatalogItem[]) => (
    <ResponsiveTable
      rowKey="code"
      size="small"
      columns={scheduleColumns}
      dataSource={rows}
      pagination={rows.length > 10 ? { pageSize: 10 } : false}
      expandable={{
        expandedRowRender: (item) => (
          <div style={{ maxWidth: 760 }}>
            <p style={{ marginTop: 0 }}>
              {language === "ar" ? item.description_ar : item.description_en}
            </p>
            {!!item.auto_warning_extra_levels && (
              <p>
                {t("penalties.autoWarningLevels", {
                  count: item.auto_warning_extra_levels + 1,
                })}
              </p>
            )}
            {item.extra_wage_deduction && (
              <p>
                {t("penalties.extraWageRule")}:{" "}
                {t(
                  `penalties.extraWage.${item.extra_wage_deduction}`,
                  undefined,
                  item.extra_wage_deduction,
                )}
              </p>
            )}
            <small style={secondaryText}>
              {t("penalties.sourceReference")} {item.source_page}/
              {item.source_row}
            </small>
          </div>
        ),
      }}
      mobileCard={{ titleKey: "title" }}
    />
  );

  return (
    <div>
      <PageHeader
        title={t(role === "hr" ? "penalties.hrTitle" : "penalties.myTitle")}
        subtitle={t(
          role === "hr" ? "penalties.hrSubtitle" : "penalties.mySubtitle",
        )}
        actions={
          role === "hr" ? (
            <Button
              type="primary"
              icon={<PlusOutlined aria-hidden />}
              onClick={() => setCreateOpen(true)}
            >
              {t("penalties.create")}
            </Button>
          ) : undefined
        }
      />
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        {statCards.map((card) => {
          const count = stats[card.key];
          const active =
            card.key === "all" ? !filters.status : filters.status === card.key;
          return (
            <Col key={card.key} xs={12} lg={6}>
              <StatCard
                compact
                title={t(`penalties.stats.${card.key}`)}
                value={count ?? "—"}
                icon={card.icon}
                color={card.color}
                ariaLabel={t("penalties.stats.show", {
                  label: t(`penalties.stats.${card.key}`),
                  count: count ?? "—",
                })}
                note={
                  active && hasFilters
                    ? { label: t("penalties.stats.filtered"), tone: "info" }
                    : undefined
                }
                onClick={() =>
                  updateFilter({
                    status: card.key === "all" ? undefined : card.key,
                  })
                }
              />
            </Col>
          );
        })}
      </Row>
      <Card styles={{ body: { paddingTop: 16 } }}>
        <Row gutter={[12, 12]} align="middle" style={{ marginBottom: 16 }}>
          <Col xs={24} md={12} xl={role === "hr" ? 6 : 8}>
            <Input.Search
              aria-label={t("common.search")}
              placeholder={t("penalties.searchPlaceholder")}
              allowClear
              value={searchText}
              onChange={(event) => {
                setSearchText(event.target.value);
                if (!event.target.value) updateFilter({ search: undefined });
              }}
              onSearch={(search) =>
                updateFilter({ search: search || undefined })
              }
            />
          </Col>
          <Col xs={12} md={6} xl={3}>
            <Select
              allowClear
              aria-label={t("common.status")}
              placeholder={t("common.status")}
              style={{ width: "100%" }}
              value={filters.status}
              onChange={(status) => updateFilter({ status })}
              options={STATUS_OPTIONS.map((value) => ({
                value,
                label: t(`penalties.status.${value}`),
              }))}
            />
          </Col>
          <Col xs={12} md={6} xl={3}>
            <Select
              allowClear
              aria-label={t("penalties.category")}
              placeholder={t("penalties.category")}
              style={{ width: "100%" }}
              value={filters.category}
              onChange={(category) => updateFilter({ category })}
              options={categories.map((value) => ({
                value,
                label: t(`penalties.category.${value}`, undefined, value),
              }))}
            />
          </Col>
          <Col xs={12} md={6} xl={3}>
            <DatePicker
              aria-label={t("penalties.dateFrom")}
              placeholder={t("penalties.dateFrom")}
              style={{ width: "100%" }}
              value={filters.date_from ? dayjs(filters.date_from) : null}
              maxDate={filters.date_to ? dayjs(filters.date_to) : undefined}
              status={dateRangeInvalid ? "error" : undefined}
              onChange={(date) =>
                updateFilter({ date_from: date?.format("YYYY-MM-DD") })
              }
            />
          </Col>
          <Col xs={12} md={6} xl={3}>
            <DatePicker
              aria-label={t("penalties.dateTo")}
              placeholder={t("penalties.dateTo")}
              style={{ width: "100%" }}
              value={filters.date_to ? dayjs(filters.date_to) : null}
              minDate={filters.date_from ? dayjs(filters.date_from) : undefined}
              status={dateRangeInvalid ? "error" : undefined}
              onChange={(date) =>
                updateFilter({ date_to: date?.format("YYYY-MM-DD") })
              }
            />
          </Col>
          {role === "hr" && (
            <Col xs={24} md={12} xl={4}>
              <EmployeeSearchSelect
                allowClear
                aria-label={t("penalties.employee")}
                placeholder={t("penalties.employee")}
                style={{ width: "100%" }}
                value={filterEmployee}
                onChange={(employee_profile_id) => {
                  setFilterEmployee(employee_profile_id);
                  updateFilter({ employee_profile_id });
                }}
              />
            </Col>
          )}
          <Col xs={24} md={12} xl={role === "hr" ? 2 : 4}>
            <Button
              icon={<ClearOutlined aria-hidden />}
              disabled={!hasFilters}
              onClick={clearFilters}
              block
            >
              {t("penalties.filters.clear")}
            </Button>
          </Col>
          {role === "hr" && (
            <Col xs={24}>
              <Space size={8}>
                <Switch
                  size="small"
                  checked={includeAutomated}
                  aria-label={t("penalties.filters.includeAutomated")}
                  onChange={(checked) =>
                    updateFilter({ include_automated: checked || undefined })
                  }
                />
                <span>{t("penalties.filters.includeAutomated")}</span>
              </Space>
            </Col>
          )}
        </Row>
        {dateRangeInvalid && (
          <Alert
            type="warning"
            showIcon
            title={t("penalties.dateRangeInvalid")}
            style={{ marginBottom: 16 }}
          />
        )}
        {loadError && (
          <Alert
            type="error"
            showIcon
            title={t("penalties.loadFailed")}
            description={loadError}
            action={
              <Button onClick={() => void load()}>
                {t("penalties.retry")}
              </Button>
            }
            style={{ marginBottom: 16 }}
          />
        )}
        <ResponsiveTable
          rowKey="id"
          columns={columns}
          dataSource={items}
          loading={loading}
          locale={{
            emptyText: loadError ? (
              <span />
            ) : (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  <span>
                    <strong style={{ display: "block" }}>
                      {t("penalties.empty.title")}
                    </strong>
                    <span style={secondaryText}>
                      {t(
                        hasFilters
                          ? "penalties.empty.filtered"
                          : role === "hr"
                            ? "penalties.empty.hr"
                            : "penalties.empty.mine",
                      )}
                    </span>
                  </span>
                }
              >
                {hasFilters && (
                  <Button onClick={clearFilters}>
                    {t("penalties.filters.clear")}
                  </Button>
                )}
              </Empty>
            ),
          }}
          pagination={{
            current: page,
            pageSize: 10,
            total,
            onChange: setPage,
            showSizeChanger: false,
            hideOnSinglePage: true,
          }}
          mobileCard={{
            titleKey: "catalog",
            extraKey: "status",
            actionsKey: "actions",
          }}
        />
      </Card>
      <Collapse
        style={{ marginTop: 16, background: token.colorBgContainer }}
        items={[
          {
            key: "schedule",
            label: (
              <Space size={8}>
                <BookOutlined aria-hidden />
                <span style={{ fontWeight: 600 }}>
                  {t("penalties.catalogTitle")}
                </span>
              </Space>
            ),
            extra: (
              <span style={secondaryText}>
                {t("penalties.scheduleCount", { count: catalog.length })}
              </span>
            ),
            children: (
              <div>
                <p style={{ ...secondaryText, fontSize: 13, marginTop: 0 }}>
                  {t("penalties.scheduleHint")}
                </p>
                {catalogAlert}
                <Tabs
                  items={categories.map((category) => ({
                    key: category,
                    label: t(
                      `penalties.category.${category}`,
                      undefined,
                      category,
                    ),
                    children: scheduleTable(
                      catalog.filter((item) => item.category === category),
                    ),
                  }))}
                />
              </div>
            ),
          },
        ]}
      />
      {role === "hr" && (
        <Modal
          title={t("penalties.create")}
          open={createOpen}
          onCancel={() => {
            setCreateOpen(false);
            setCreateError(null);
          }}
          footer={null}
          destroyOnHidden
        >
          <p style={{ ...secondaryText, fontSize: 13, marginTop: 0 }}>
            {t("penalties.createHint")}
          </p>
          {createError && (
            <Alert
              type="error"
              showIcon
              title={createError}
              style={{ marginBottom: 12 }}
            />
          )}
          {catalogAlert}
          <Form form={form} layout="vertical" onFinish={submit}>
            <Form.Item
              name="employee_profile_id"
              label={t("penalties.employee")}
              rules={[{ required: true }]}
            >
              <EmployeeSearchSelect />
            </Form.Item>
            <Form.Item
              name="catalog_code"
              label={t("penalties.catalogItem")}
              rules={[{ required: true }]}
            >
              <Select
                showSearch
                optionFilterProp="label"
                options={categories
                  .map((category) => ({
                    label: t(
                      `penalties.category.${category}`,
                      undefined,
                      category,
                    ),
                    options: manualCatalog
                      .filter((item) => item.category === category)
                      .map((item) => ({
                        value: item.code,
                        label: `${language === "ar" ? item.title_ar : item.title_en} (${item.code})`,
                      })),
                  }))
                  .filter((group) => group.options.length > 0)}
              />
            </Form.Item>
            <Form.Item
              name="occurred_on"
              label={t("penalties.occurredOn")}
              rules={[{ required: true }]}
            >
              <DatePicker style={{ width: "100%" }} maxDate={dayjs()} />
            </Form.Item>
            <Form.Item
              name="note"
              label={t("penalties.note")}
              rules={[{ required: true, whitespace: true }]}
            >
              <Input.TextArea rows={3} maxLength={1000} showCount />
            </Form.Item>
            <div
              style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}
            >
              <Button
                onClick={() => {
                  setCreateOpen(false);
                  setCreateError(null);
                }}
              >
                {t("common.cancel")}
              </Button>
              <Button type="primary" htmlType="submit" loading={saving}>
                {t("common.submit")}
              </Button>
            </div>
          </Form>
        </Modal>
      )}
    </div>
  );
}
