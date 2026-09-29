import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Form,
  Input,
  Modal,
  Select,
  Space,
  notification,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs from "dayjs";
import PageHeader from "../../../components/ui/PageHeader";
import ResponsiveTable from "../../../components/ui/ResponsiveTable";
import { isApiError } from "../../../services/api/apiTypes";
import {
  listEmployees,
  type Employee,
} from "../../../services/api/employeesApi";
import {
  createPenalty,
  getPenaltyCatalog,
  listPenalties,
  type PenaltyCatalogItem,
  type PenaltyFilters,
  type PenaltyRecord,
} from "../../../services/api/penaltiesApi";
import { getDetailedHttpErrorMessage } from "../../../services/api/userErrorMessages";
import { useI18n } from "../../../i18n/useI18n";
import PenaltyStatusTag from "./PenaltyStatusTag";

type CreateValues = {
  employee_profile_id: number;
  catalog_code: string;
  occurred_on: dayjs.Dayjs;
  note: string;
};

export default function PenaltiesListPage({
  role,
}: {
  role: "hr" | "employee";
}) {
  const { t, language } = useI18n();
  const navigate = useNavigate();
  const [items, setItems] = useState<PenaltyRecord[]>([]);
  const [catalog, setCatalog] = useState<PenaltyCatalogItem[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<PenaltyFilters>({});
  const [createOpen, setCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [form] = Form.useForm<CreateValues>();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listPenalties({
        ...filters,
        page,
        page_size: 10,
        ...(role === "employee" ? { mine: true } : {}),
      });
      if (isApiError(result)) throw new Error(result.message);
      setItems(result.data.items);
      setTotal(result.data.count ?? 0);
    } catch (error) {
      notification.error({
        message: t("penalties.loadFailed"),
        description: getDetailedHttpErrorMessage(t, error),
      });
    } finally {
      setLoading(false);
    }
  }, [filters, page, role, t]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    void getPenaltyCatalog()
      .then((result) => {
        if (isApiError(result)) {
          notification.error({
            message: t("penalties.catalogFailed"),
            description: result.message,
          });
        } else {
          setCatalog(result.data);
        }
      })
      .catch(() =>
        notification.error({ message: t("penalties.catalogFailed") }),
      );
  }, [role, t]);
  useEffect(() => {
    if (role !== "hr") return;
    let active = true;
    const timer = window.setTimeout(
      () => {
        void listEmployees({
          page_size: 100,
          search: employeeSearch || undefined,
        })
          .then((result) => {
            if (active && !isApiError(result))
              setEmployees(result.data.results);
          })
          .catch(() => {
            if (active)
              notification.error({ message: t("penalties.employeesFailed") });
          });
      },
      employeeSearch ? 250 : 0,
    );
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [employeeSearch, role, t]);

  const categories = useMemo(
    () => Array.from(new Set(catalog.map((item) => item.category))),
    [catalog],
  );
  const manualCatalog = useMemo(
    () => catalog.filter((item) => !item.automatic),
    [catalog],
  );
  const columns: ColumnsType<PenaltyRecord> = [
    {
      title: t("penalties.employee"),
      key: "employee",
      render: (_, item) =>
        language === "ar" ? item.employee_name_ar : item.employee_name_en,
    },
    {
      title: t("penalties.category"),
      dataIndex: "category",
      key: "category",
      render: (value: string) =>
        t(`penalties.category.${value}`, undefined, value),
    },
    {
      title: t("penalties.catalogItem"),
      key: "catalog",
      render: (_, item) => {
        const match = catalog.find((entry) => entry.code === item.catalog_code);
        return match
          ? language === "ar"
            ? match.title_ar
            : match.title_en
          : item.catalog_code;
      },
    },
    {
      title: t("penalties.occurredOn"),
      dataIndex: "occurred_on",
      key: "occurred_on",
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
      title: t("penalties.totalDeductionAmount"),
      key: "amount",
      render: (_, item) => item.total_deduction_amount ?? item.amount ?? "—",
    },
    {
      title: t("common.view"),
      key: "actions",
      render: (_, item) => (
        <Button onClick={() => navigate(`/${role}/penalties/${item.id}`)}>
          {t("common.view")}
        </Button>
      ),
    },
  ];
  const catalogColumns: ColumnsType<PenaltyCatalogItem> = [
    {
      title: t("penalties.catalogItem"),
      key: "title",
      render: (_, item) => (language === "ar" ? item.title_ar : item.title_en),
    },
    {
      title: t("penalties.category"),
      key: "category",
      render: (_, item) =>
        t(`penalties.category.${item.category}`, undefined, item.category),
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
  ];

  const updateFilter = (next: Partial<PenaltyFilters>) => {
    setPage(1);
    setFilters((current) => ({ ...current, ...next }));
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
        setCreateError(result.message);
        return;
      }
      setCreateOpen(false);
      form.resetFields();
      notification.success({ message: t("penalties.created") });
      navigate(`/hr/penalties/${result.data.id}`);
    } catch (error) {
      setCreateError(getDetailedHttpErrorMessage(t, error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader
        title={t(role === "hr" ? "penalties.hrTitle" : "penalties.myTitle")}
        subtitle={t(
          role === "hr" ? "penalties.hrSubtitle" : "penalties.mySubtitle",
        )}
        actions={
          role === "hr" ? (
            <Button type="primary" onClick={() => setCreateOpen(true)}>
              {t("penalties.create")}
            </Button>
          ) : undefined
        }
      />
      <Card>
        <Space wrap style={{ marginBottom: 16 }}>
          <Input.Search
            aria-label={t("common.search")}
            placeholder={t("common.search")}
            allowClear
            onSearch={(search) => updateFilter({ search })}
            style={{ width: 230 }}
          />
          <Select
            allowClear
            placeholder={t("common.status")}
            style={{ width: 180 }}
            onChange={(status) => updateFilter({ status })}
            options={[
              "pending_hr_mark",
              "issued",
              "disputed",
              "upheld",
              "waived",
              "applied",
            ].map((value) => ({
              value,
              label: t(`penalties.status.${value}`),
            }))}
          />
          <Select
            allowClear
            placeholder={t("penalties.category")}
            style={{ width: 180 }}
            onChange={(category) => updateFilter({ category })}
            options={categories.map((value) => ({
              value,
              label: t(`penalties.category.${value}`, undefined, value),
            }))}
          />
          <DatePicker
            placeholder={t("penalties.dateFrom")}
            onChange={(date) =>
              updateFilter({ date_from: date?.format("YYYY-MM-DD") })
            }
          />
          <DatePicker
            placeholder={t("penalties.dateTo")}
            onChange={(date) =>
              updateFilter({ date_to: date?.format("YYYY-MM-DD") })
            }
          />
          {role === "hr" && (
            <Select
              showSearch
              allowClear
              filterOption={false}
              onSearch={setEmployeeSearch}
              placeholder={t("penalties.employee")}
              style={{ width: 240 }}
              onChange={(employee_profile_id) =>
                updateFilter({ employee_profile_id })
              }
              options={employees.map((employee) => ({
                value: employee.id,
                label:
                  language === "ar"
                    ? employee.full_name_ar || employee.full_name
                    : employee.full_name_en || employee.full_name,
              }))}
            />
          )}
        </Space>
        <ResponsiveTable
          rowKey="id"
          columns={columns}
          dataSource={items}
          loading={loading}
          pagination={{ current: page, pageSize: 10, total, onChange: setPage }}
          mobileCard={{
            titleKey: "catalog",
            extraKey: "status",
            actionsKey: "actions",
          }}
        />
      </Card>
      <Card title={t("penalties.catalogTitle")} style={{ marginTop: 16 }}>
        <ResponsiveTable
          rowKey="code"
          columns={catalogColumns}
          dataSource={catalog}
          pagination={{ pageSize: 10 }}
          expandable={{
            expandedRowRender: (item) => (
              <div>
                <p>
                  {language === "ar"
                    ? item.description_ar
                    : item.description_en}
                </p>
                <div>
                  {item.levels.map((level) => (
                    <p key={level.occurrence}>
                      {t("penalties.occurrence")} {level.occurrence}:{" "}
                      {t(
                        `penalties.action.${level.action}`,
                        undefined,
                        level.action,
                      )}
                      {level.amount_value
                        ? ` · ${level.amount_value} ${t(`penalties.basis.${level.amount_basis}`, undefined, level.amount_basis ?? "")}`
                        : ""}
                    </p>
                  ))}
                </div>
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
                <small>
                  {t("penalties.sourceReference")} {item.source_page}/
                  {item.source_row}
                </small>
              </div>
            ),
          }}
          mobileCard={{ titleKey: "title" }}
        />
      </Card>
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
          {createError && (
            <Alert
              type="error"
              title={createError}
              style={{ marginBottom: 12 }}
            />
          )}
          <Form form={form} layout="vertical" onFinish={submit}>
            <Form.Item
              name="employee_profile_id"
              label={t("penalties.employee")}
              rules={[{ required: true }]}
            >
              <Select
                showSearch
                filterOption={false}
                onSearch={setEmployeeSearch}
                options={employees.map((employee) => ({
                  value: employee.id,
                  label:
                    language === "ar"
                      ? employee.full_name_ar || employee.full_name
                      : employee.full_name_en || employee.full_name,
                }))}
              />
            </Form.Item>
            <Form.Item
              name="catalog_code"
              label={t("penalties.catalogItem")}
              rules={[{ required: true }]}
            >
              <Select
                showSearch
                optionFilterProp="label"
                options={manualCatalog.map((item) => ({
                  value: item.code,
                  label: language === "ar" ? item.title_ar : item.title_en,
                }))}
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
            <Button type="primary" htmlType="submit" loading={saving}>
              {t("common.submit")}
            </Button>
          </Form>
        </Modal>
      )}
    </div>
  );
}
