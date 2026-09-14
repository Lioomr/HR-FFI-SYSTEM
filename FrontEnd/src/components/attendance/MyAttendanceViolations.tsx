import { useCallback, useEffect, useState } from "react";
import { Alert, Card, Empty, Flex, Select, Typography } from "antd";
import AttendanceViolationsTable from "./AttendanceViolationsTable";
import { useI18n } from "../../i18n/useI18n";
import { getAttendanceViolations } from "../../services/api/attendanceApi";
import { isApiError } from "../../services/api/apiTypes";
import { getHttpErrorMessage } from "../../services/api/httpErrors";
import {
  VIOLATION_LIFECYCLES,
  type AttendanceLateViolation,
} from "../../types/attendancePolicy";
import {
  classifyAttendanceAccessError,
  lifecycleLabel,
} from "../../utils/attendancePolicy";

const PAGE_SIZE = 10;

type Problem = { kind: "company" } | { kind: "error"; message: string };

/** The employee's own late violations, newest first, filtered on the server. */
export default function MyAttendanceViolations() {
  const { t } = useI18n();
  const [lifecycle, setLifecycle] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<AttendanceLateViolation[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await getAttendanceViolations({
        page,
        page_size: PAGE_SIZE,
        lifecycle,
      });
      if (isApiError(response)) {
        setItems([]);
        setTotal(0);
        setProblem({ kind: "error", message: response.message });
        return;
      }
      setItems(response.data.items ?? []);
      setTotal(response.data.count ?? 0);
      setProblem(null);
    } catch (error) {
      setItems([]);
      setTotal(0);
      const access = classifyAttendanceAccessError(error);
      if (access === "notFound") setProblem(null);
      else if (access === "company" || access === "unmapped")
        setProblem({ kind: "company" });
      else setProblem({ kind: "error", message: getHttpErrorMessage(error) });
    } finally {
      setLoading(false);
    }
  }, [lifecycle, page]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Card
      title={t("attendancePolicy.history.title")}
      style={{ marginTop: 16, borderRadius: 12 }}
    >
      <Flex vertical gap={12}>
        <Typography.Text type="secondary">
          {t("attendancePolicy.history.hint")}
        </Typography.Text>
        <Select
          mode="multiple"
          allowClear
          aria-label={t("attendancePolicy.history.filterLifecycle")}
          placeholder={t("attendancePolicy.history.filterLifecycle")}
          value={lifecycle}
          onChange={(value: string[]) => {
            setLifecycle(value);
            setPage(1);
          }}
          options={VIOLATION_LIFECYCLES.map((value) => ({
            value,
            label: lifecycleLabel(t, value),
          }))}
          style={{ width: "100%", maxWidth: 360 }}
        />
        {problem?.kind === "company" ? (
          <Alert
            type="warning"
            showIcon
            title={t("attendancePolicy.history.companyRequired")}
            description={t("attendancePolicy.companyRequiredHint")}
          />
        ) : problem?.kind === "error" ? (
          <Alert
            type="error"
            showIcon
            title={t("attendancePolicy.history.loadFailed")}
            description={problem.message}
          />
        ) : (
          <AttendanceViolationsTable
            items={items}
            loading={loading}
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
            onPageChange={(nextPage) => setPage(nextPage)}
            emptyText={
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={t("attendancePolicy.history.empty")}
              />
            }
          />
        )}
      </Flex>
    </Card>
  );
}
