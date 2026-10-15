import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Button,
  Card,
  DatePicker,
  Input,
  Select,
  Space,
  Switch,
  Tag,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  DeleteOutlined,
  EditOutlined,
  HistoryOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import type { Dayjs } from "dayjs";
import PageHeader from "../../../../components/ui/PageHeader";
import ResponsiveTable from "../../../../components/ui/ResponsiveTable";
import ErrorState from "../../../../components/ui/ErrorState";
import EmptyState from "../../../../components/ui/EmptyState";
import Unauthorized403Page from "../../../Unauthorized403Page";
import PayrollTheme from "../../../../components/payroll/PayrollTheme";
import ReasonModal from "../../../../components/payroll/ReasonModal";
import PayrollHistoryDrawer from "../../../../components/payroll/PayrollHistoryDrawer";
import { useCanManagePayrollHrData } from "../../../../components/payroll/payrollFormat";
import { useI18n } from "../../../../i18n/useI18n";
import { usePayrollEnums } from "../../../../hooks/usePayrollEnums";
import { formatDateTime } from "../../../../utils/dateTime";
import { isForbidden } from "../../../../services/api/httpErrors";
import {
  deleteAssignment,
  listAssignmentHistory,
  listAssignments,
} from "../../../../services/api/accommodationApi";
import {
  parsePayrollError,
  payrollErrorSummary,
} from "../../../../services/api/payrollErrors";
import type {
  AccommodationAssignment,
  AccommodationStatus,
} from "../../../../services/api/payrollTypes";
import AssignmentFormModal from "./AssignmentFormModal";

const { Text } = Typography;
const STATUS_COLORS: Record<AccommodationStatus, string> = {
  assigned: "blue",
  none: "default",
  unknown: "gold",
};

/**
 * H: payroll accommodation assignments (contract 7.5). HR and Admin create,
 * edit and delete (with a reason); CFO sees the list and history read-only
 * (verifier CQ3). UX only: the backend enforces every permission.
 */
export default function AccommodationAssignmentsPage() {
  const { t } = useI18n();
  const { label } = usePayrollEnums();
  const canEdit = useCanManagePayrollHrData();
  const [rows, setRows] = useState<AccommodationAssignment[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [query] = useSearchParams();
  const [search, setSearch] = useState("");
  const [rentId, setRentId] = useState<number>();
  const employeeFilter = Number(query.get("employee_profile_id")) || undefined;
  const [status, setStatus] = useState<AccommodationStatus | undefined>();
  const [activeOn, setActiveOn] = useState<Dayjs | null>(null);
  const [showDeleted, setShowDeleted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AccommodationAssignment | null>(null);
  const [deleting, setDeleting] = useState<AccommodationAssignment | null>(
    null,
  );
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string>();
  const [historyFor, setHistoryFor] = useState<AccommodationAssignment | null>(
    null,
  );

  const generation = useRef(0);
  const load = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    setError(null);
    try {
      const data = await listAssignments({
        page: 1,
        page_size: 1000,
        status,
        employee_profile_id: employeeFilter,
        rent_id: rentId,
        active_on: activeOn ? activeOn.format("YYYY-MM-DD") : undefined,
        is_active: showDeleted ? false : undefined,
      });
      const all = [...data.items];
      for (let next = 2; next <= data.total_pages; next++) {
        const extra = await listAssignments({
          page: next,
          page_size: 1000,
          status,
          employee_profile_id: employeeFilter,
          rent_id: rentId,
          active_on: activeOn ? activeOn.format("YYYY-MM-DD") : undefined,
          is_active: showDeleted ? false : undefined,
        });
        if (extra.count !== data.count) throw new Error("changed");
        all.push(...extra.items);
      }
      if (
        all.length !== data.count ||
        new Set(all.map((row) => row.id)).size !== data.count
      )
        throw new Error("incomplete");
      if (current !== generation.current) return;
      setRows(all);
    } catch (err) {
      if (current !== generation.current) return;
      if (isForbidden(err)) setForbidden(true);
      else
        setError(
          payrollErrorSummary(
            parsePayrollError(err),
            t("payroll.ui.assignmentsLoadFailed"),
          ),
        );
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, [status, activeOn, showDeleted, t, employeeFilter, rentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadHistory = useCallback(
    (historyPage: number, historySize: number) =>
      listAssignmentHistory(historyFor?.id ?? 0, {
        page: historyPage,
        page_size: historySize,
      }),
    [historyFor],
  );

  const confirmDelete = async (reason: string) => {
    if (!deleting) return;
    setDeleteBusy(true);
    setDeleteError(undefined);
    try {
      await deleteAssignment(deleting.id, reason);
      setDeleting(null);
      message.success(t("payroll.ui.assignmentDeleted"));
      await load();
    } catch (err) {
      setDeleteError(
        payrollErrorSummary(
          parsePayrollError(err),
          t("payroll.ui.actionFailed"),
        ),
      );
    } finally {
      setDeleteBusy(false);
    }
  };

  if (forbidden) return <Unauthorized403Page />;

  const columns: ColumnsType<AccommodationAssignment> = [
    {
      title: t("payroll.ui.employee"),
      key: "employee",
      render: (_, row) => (
        <Space orientation="vertical" size={0}>
          {canEdit ? (
            <Link to={`/hr/employees/${row.employee_profile_id}`}>
              {row.employee_name}
            </Link>
          ) : (
            <Text>{row.employee_name}</Text>
          )}
          <Text type="secondary" style={{ fontSize: 12 }} dir="ltr">
            {row.employee_id}
          </Text>
        </Space>
      ),
    },
    {
      title: t("payroll.ui.accommodationStatus"),
      key: "status",
      render: (_, row) => (
        <Tag color={STATUS_COLORS[row.status]}>
          {label(
            "accommodation_status",
            row.status,
            `payroll.accommodation_status.${row.status}`,
          )}
        </Tag>
      ),
    },
    {
      title: t("payroll.ui.property"),
      key: "rent",
      render: (_, row) => row.rent_name ?? "—",
    },
    {
      title: t("payroll.ui.startDate"),
      dataIndex: "start_date",
      key: "start_date",
      render: (value: string) => <bdi dir="ltr">{value}</bdi>,
    },
    {
      title: t("payroll.ui.endDate"),
      dataIndex: "end_date",
      key: "end_date",
      render: (value: string) => <bdi dir="ltr">{value}</bdi>,
    },
    {
      title: t("payroll.ui.lastChange"),
      key: "updated",
      render: (_, row) => (
        <Space orientation="vertical" size={0}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            <bdi dir="ltr">{formatDateTime(row.updated_at)}</bdi>
          </Text>
          {row.updated_by && <Text>{row.updated_by.name}</Text>}
        </Space>
      ),
    },
    {
      title: t("payroll.ui.actions"),
      key: "actions",
      render: (_, row) => (
        <Space size={4}>
          <Button
            size="small"
            icon={<HistoryOutlined />}
            aria-label={t("payroll.ui.history")}
            onClick={() => setHistoryFor(row)}
          />
          {canEdit && row.is_active && (
            <>
              <Button
                size="small"
                icon={<EditOutlined />}
                aria-label={t("payroll.ui.editAssignment")}
                onClick={() => {
                  setEditing(row);
                  setFormOpen(true);
                }}
              />
              <Button
                size="small"
                danger
                icon={<DeleteOutlined />}
                aria-label={t("payroll.ui.deleteAssignment")}
                onClick={() => {
                  setDeleteError(undefined);
                  setDeleting(row);
                }}
              />
            </>
          )}
        </Space>
      ),
    },
  ];

  return (
    <PayrollTheme>
      <PageHeader
        title={t("payroll.ui.assignmentsTitle")}
        subtitle={
          canEdit
            ? t("payroll.ui.assignmentsSubtitle")
            : t("payroll.ui.assignmentsReadOnly")
        }
        actions={
          canEdit ? (
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              {t("payroll.ui.newAssignment")}
            </Button>
          ) : undefined
        }
      />
      <Card style={{ borderRadius: 16 }}>
        <div className="payroll-finance-toolbar">
          <Input.Search
            allowClear
            value={search}
            aria-label={t("payroll.ui.searchEmployees")}
            placeholder={t("payroll.ui.searchEmployees")}
            onChange={(event) => setSearch(event.target.value)}
            style={{ width: 240 }}
          />
          <Select
            allowClear
            aria-label={t("payroll.ui.property")}
            placeholder={t("payroll.ui.property")}
            value={rentId}
            onChange={(value) => {
              setRentId(value);
              setPage(1);
            }}
            style={{ minWidth: 160 }}
            options={[
              ...new Map(
                rows
                  .filter((row) => row.rent_id !== null)
                  .map((row) => [
                    row.rent_id,
                    { value: row.rent_id, label: row.rent_name },
                  ]),
              ).values(),
            ]}
          />
          <Select
            allowClear
            placeholder={t("payroll.ui.accommodationStatus")}
            aria-label={t("payroll.ui.accommodationStatus")}
            style={{ minWidth: 200 }}
            value={status}
            onChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
            options={(["assigned", "none", "unknown"] as const).map(
              (value) => ({
                value,
                label: label(
                  "accommodation_status",
                  value,
                  `payroll.accommodation_status.${value}`,
                ),
              }),
            )}
          />
          <DatePicker
            placeholder={t("payroll.ui.activeOn")}
            aria-label={t("payroll.ui.activeOn")}
            value={activeOn}
            onChange={(value) => {
              setActiveOn(value);
              setPage(1);
            }}
          />
          <Space>
            <Switch
              checked={showDeleted}
              onChange={(value) => {
                setShowDeleted(value);
                setPage(1);
              }}
              aria-label={t("payroll.ui.showDeleted")}
            />
            <Text>{t("payroll.ui.showDeleted")}</Text>
          </Space>
        </div>
        {error ? (
          <ErrorState
            title={t("payroll.ui.assignmentsLoadFailed")}
            description={error}
            onRetry={() => void load()}
          />
        ) : !loading && rows.length === 0 ? (
          <EmptyState
            title={t("payroll.ui.assignmentsEmptyTitle")}
            description={t("payroll.ui.assignmentsEmpty")}
            actionText={canEdit ? t("payroll.ui.newAssignment") : undefined}
            onAction={
              canEdit
                ? () => {
                    setEditing(null);
                    setFormOpen(true);
                  }
                : undefined
            }
          />
        ) : (
          <ResponsiveTable<AccommodationAssignment>
            size="small"
            rowKey="id"
            loading={loading}
            columns={
              canEdit
                ? columns
                : columns.filter((column) => column.key !== "actions")
            }
            dataSource={rows.filter((row) =>
              `${row.employee_name} ${row.employee_id}`
                .toLocaleLowerCase()
                .includes(search.toLocaleLowerCase()),
            )}
            pagination={{
              current: page,
              pageSize,
              total: rows.filter((row) =>
                `${row.employee_name} ${row.employee_id}`
                  .toLocaleLowerCase()
                  .includes(search.toLocaleLowerCase()),
              ).length,
              showSizeChanger: true,
              onChange: (nextPage, nextSize) => {
                setPage(nextPage);
                setPageSize(nextSize);
              },
            }}
          />
        )}
      </Card>

      {canEdit && (
        <AssignmentFormModal
          open={formOpen}
          assignment={editing}
          onClose={() => setFormOpen(false)}
          onSaved={() => {
            setFormOpen(false);
            message.success(t("payroll.ui.assignmentSaved"));
            void load();
          }}
        />
      )}

      <ReasonModal
        open={deleting !== null}
        title={t("payroll.ui.deleteAssignment")}
        description={t("payroll.ui.deleteAssignmentHelp")}
        okText={t("payroll.ui.deleteAssignment")}
        okDanger
        submitting={deleteBusy}
        formError={deleteError}
        onSubmit={(reason) => void confirmDelete(reason)}
        onCancel={() => setDeleting(null)}
      />

      <PayrollHistoryDrawer
        open={historyFor !== null}
        title={t("payroll.ui.assignmentHistory")}
        onClose={() => setHistoryFor(null)}
        load={loadHistory}
      />
    </PayrollTheme>
  );
}
