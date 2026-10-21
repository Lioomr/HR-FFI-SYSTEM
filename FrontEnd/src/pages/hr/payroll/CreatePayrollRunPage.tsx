import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Form,
  Grid,
  notification,
} from "antd";
import dayjs, { type Dayjs } from "dayjs";
import PageHeader from "../../../components/ui/PageHeader";
import {
  createPayrollRun,
  getPayrollRuns,
} from "../../../services/api/payrollApi";
import { isApiError } from "../../../services/api/apiTypes";
import { useI18n } from "../../../i18n/useI18n";
import { useAuthStore } from "../../../auth/authStore";
import { isHeadOfficeOrganization } from "../../../utils/organizationContext";
import {
  formatPayrollDateWindow,
  formatPayrollWindowSummary,
} from "../../../components/payroll/payrollFormat";
import type {
  CreatePayrollRunRequest,
  PayrollRun,
} from "../../../services/api/payrollApi";

const { useBreakpoint } = Grid;
const { RangePicker } = DatePicker;

type PayrollPeriod = [Dayjs, Dayjs];

interface CreatePayrollRunFormValues {
  period_range?: PayrollPeriod;
}

async function findOverlappingPayrollRun(
  payload: CreatePayrollRunRequest,
): Promise<PayrollRun | undefined> {
  const firstAnchorMonth = dayjs(payload.period_start).startOf("month");
  const lastAnchorMonth = dayjs(payload.period_end)
    .add(29, "day")
    .startOf("month");
  const anchorMonths: Dayjs[] = [];

  for (
    let cursor = firstAnchorMonth;
    !cursor.isAfter(lastAnchorMonth, "month");
    cursor = cursor.add(1, "month")
  ) {
    anchorMonths.push(cursor);
  }

  const responses = await Promise.allSettled(
    anchorMonths.map((anchor) =>
      getPayrollRuns({
        year: anchor.year(),
        month: anchor.month() + 1,
        page_size: 100,
      }),
    ),
  );

  return responses
    .flatMap((result) => {
      if (result.status !== "fulfilled" || isApiError(result.value)) return [];
      return result.value.data.items;
    })
    .find(
      (run) =>
        run.status !== "CANCELLED" &&
        !!run.period_start &&
        !!run.period_end &&
        run.period_start <= payload.period_end &&
        run.period_end >= payload.period_start,
    );
}

export default function CreatePayrollRunPage() {
  const navigate = useNavigate();
  const [form] = Form.useForm<CreatePayrollRunFormValues>();
  const { t, language } = useI18n();
  const user = useAuthStore((state) => state.user);
  const [submitting, setSubmitting] = useState(false);
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const isHeadOffice = isHeadOfficeOrganization(user);
  const selectedPeriod = Form.useWatch("period_range", form);
  const selectedStart = selectedPeriod?.[0];
  const selectedEnd = selectedPeriod?.[1];
  const windowPreview =
    selectedStart && selectedEnd
      ? formatPayrollWindowSummary(
          selectedStart.format("YYYY-MM-DD"),
          selectedEnd.format("YYYY-MM-DD"),
          null,
          language,
          t,
        )
      : null;

  const handleSubmit = async (values: CreatePayrollRunFormValues) => {
    if (isHeadOffice) {
      notification.info({
        message: t("organization.headOffice.readOnlyTitle"),
        description: t("organization.headOffice.createPayrollDescription"),
      });
      return;
    }
    setSubmitting(true);

    const [start, end] = values.period_range!;
    const payload: CreatePayrollRunRequest = {
      period_start: start.format("YYYY-MM-DD"),
      period_end: end.format("YYYY-MM-DD"),
    };
    const localizedWindow = formatPayrollDateWindow(
      payload.period_start,
      payload.period_end,
      language,
    );

    try {
      notification.open({
        key: "payroll_processing",
        message: t("payroll.processingTitle"),
        description: t("payroll.processingDesc"),
        icon: (
          <div className="ant-spin ant-spin-spinning">
            <span className="ant-spin-dot ant-spin-dot-spin">
              <i className="ant-spin-dot-item"></i>
              <i className="ant-spin-dot-item"></i>
              <i className="ant-spin-dot-item"></i>
              <i className="ant-spin-dot-item"></i>
            </span>
          </div>
        ),
        duration: 0,
      });

      const response = await createPayrollRun(payload);

      notification.destroy("payroll_processing");

      if (isApiError(response)) {
        // Handle 409 Conflict (Already Exists)
        // Standard axios error with response.status could be checked if we had the raw error object,
        // but our api wrapper often swallows it into 'errors'.
        // We often see "status": "error", "message": "..." in the body.
        // If the message suggests "already exists" or similar, we can try to recover.
        const msg = response.message?.toLowerCase() || "";

        if (
          msg.includes("already exists") ||
          msg.includes("unique constraint") ||
          msg.includes("duplicate")
        ) {
          // Try to find the existing run
          try {
            const existing = await findOverlappingPayrollRun(payload);
            if (existing) {
              notification.info({
                message: t("payroll.runExists"),
                description: t("payroll.runExistsRangeDesc", {
                  range: localizedWindow,
                }),
                duration: 3,
              });
              navigate(`/hr/payroll/${existing.id}`);
              return;
            }
          } catch {
            // Failed to find it silently, rely on manual error
          }

          notification.warning({
            message: t("payroll.alreadyExists"),
            description: t("payroll.alreadyExistsDesc"),
          });
          setSubmitting(false);
          return;
        }

        notification.error({
          message: t("payroll.creationFail"),
          description: response.message || t("payroll.creationFailDesc"),
        });
        setSubmitting(false);
        return;
      }

      notification.success({
        message: t("common.success"),
        description: t("payroll.creationSuccess"),
      });

      navigate(`/hr/payroll/${response.data.id}`);
    } catch (err: any) {
      const apiData = err?.apiData;
      const backendMessage = (
        apiData?.message ||
        err?.message ||
        ""
      ).toLowerCase();
      const backendErrors = Array.isArray(apiData?.errors)
        ? apiData.errors
            .map((e: any) => (typeof e === "string" ? e : e?.message || ""))
            .join(" ")
            .toLowerCase()
        : "";
      const duplicateDetected =
        err.response?.status === 409 ||
        err.message?.includes("409") ||
        (err.response?.status === 422 &&
          (backendMessage.includes("already exists") ||
            backendErrors.includes("already exists") ||
            backendErrors.includes("unique")));

      // Check for duplicate period and recover by opening existing run.
      if (duplicateDetected) {
        // Same recovery logic
        try {
          const existing = await findOverlappingPayrollRun(payload);
          if (existing) {
            notification.info({
              message: t("payroll.runExists"),
              description: t("payroll.runExistsRangeDesc", {
                range: localizedWindow,
              }),
              duration: 3,
            });
            navigate(`/hr/payroll/${existing.id}`);
            return;
          }
        } catch {
          // Best-effort lookup of an existing run; ignore failures.
        }

        notification.warning({
          message: t("payroll.alreadyExists"),
          description: t("payroll.alreadyExistsDesc2"),
        });
      } else {
        notification.error({
          message: t("common.error"),
          description: err.message || t("payroll.unexpectedError"),
        });
      }
      setSubmitting(false);
    }
  };

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", width: "100%" }}>
      <PageHeader
        title={t("payroll.createTitle")}
        subtitle={t("payroll.createDesc")}
      />

      {isHeadOffice && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16, borderRadius: 14 }}
          message={t("organization.headOffice.readOnlyTitle")}
          description={t("organization.headOffice.selectCompanyBeforePayroll")}
        />
      )}

      <Card style={{ borderRadius: 16 }}>
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item
            name="period_range"
            label={t("payroll.periodRange")}
            extra={t("payroll.periodRangeHelp")}
            rules={[
              { required: true, message: t("payroll.periodRangeReq") },
              {
                validator: async (_, value?: PayrollPeriod) => {
                  if (!value?.[0] || !value?.[1]) return;
                  const inclusiveDays =
                    value[1]
                      .startOf("day")
                      .diff(value[0].startOf("day"), "day") + 1;
                  if (inclusiveDays < 1) {
                    throw new Error(t("payroll.periodRangeInvalid"));
                  }
                  if (inclusiveDays > 30) {
                    throw new Error(t("payroll.periodRangeTooLong"));
                  }
                },
              },
            ]}
          >
            <RangePicker
              format="YYYY-MM-DD"
              placeholder={[t("common.startDate"), t("common.endDate")]}
              aria-label={t("payroll.periodRange")}
              style={{ width: "100%" }}
              allowClear
              disabledDate={(current, info) => {
                if (!info.from) return false;
                return (
                  current.isBefore(
                    dayjs(info.from).subtract(29, "day"),
                    "day",
                  ) || current.isAfter(dayjs(info.from).add(29, "day"), "day")
                );
              }}
            />
          </Form.Item>

          {windowPreview && (
            <Alert
              type="info"
              showIcon
              title={t("payroll.windowPreview")}
              description={windowPreview}
            />
          )}

          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              flexDirection: isMobile ? "column-reverse" : "row",
              gap: 12,
              marginTop: 24,
            }}
          >
            <Button onClick={() => navigate("/hr/payroll")} block={isMobile}>
              {t("common.cancel")}
            </Button>
            <Button
              type="primary"
              htmlType="submit"
              loading={submitting}
              disabled={isHeadOffice}
              block={isMobile}
            >
              {t("payroll.createTitle")}
            </Button>
          </div>
        </Form>
      </Card>
    </div>
  );
}
