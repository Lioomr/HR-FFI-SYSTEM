import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Progress,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";

import PageHeader from "../../../components/ui/PageHeader";
import LoadingState from "../../../components/ui/LoadingState";
import { useI18n } from "../../../i18n/useI18n";
import {
  getMyLeaveBalance,
  type LeaveBalance,
} from "../../../services/api/leaveApi";
import { isApiError } from "../../../services/api/apiTypes";
import AnnualLeavePaymentCard from "./AnnualLeavePaymentCard";
import { readLeaveBalanceFigures } from "./leaveRequestValidation";

/** Renders a day count without inventing precision the backend did not send. */
function formatDays(value: number | string | undefined): string {
  const numeric = Number(value || 0);
  return Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(2);
}

export default function MyLeaveBalancePage() {
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [balances, setBalances] = useState<LeaveBalance[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Bumped on every manual refresh so the settlement panel re-reads its
  // eligibility, which depends on pending Annual Leave requests.
  const [refreshToken, setRefreshToken] = useState(0);

  const loadBalances = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getMyLeaveBalance();
      if (isApiError(res)) {
        setError(res.message);
      } else {
        setBalances(res.data || []);
      }
    } catch (err: any) {
      setError(err.message || t("common.tryAgain"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadBalances();
  }, [loadBalances]);

  const columns: ColumnsType<LeaveBalance> = [
    {
      title: t("leave.type"),
      dataIndex: "leave_type",
      key: "leave_type",
      render: (text) => {
        const translationKey = `leave.balance.${text.toLowerCase().replace(/\s+/g, ".")}`;
        const translated = t(translationKey, text);
        return <Typography.Text strong>{translated}</Typography.Text>;
      },
    },
    {
      title: t("leave.allowed"),
      dataIndex: "total_days",
      key: "total_days",
      align: "center",
      render: (val) => formatDays(val),
    },
    {
      title: t("leave.used"),
      dataIndex: "used_days",
      key: "used_days",
      align: "center",
      render: (val) => formatDays(val),
    },
    {
      // Days already held by requests that are submitted but not decided.
      title: t("leave.reservedDays"),
      dataIndex: "pending_days",
      key: "pending_days",
      align: "center",
      render: (_, record) => {
        const { pending } = readLeaveBalanceFigures(record);
        return pending > 0 ? (
          <Tag color="gold">{formatDays(pending)}</Tag>
        ) : (
          <span>0</span>
        );
      },
    },
    {
      // The only figure the employee may request against.
      title: t("leave.requestableDays"),
      dataIndex: "requestable_days",
      key: "requestable_days",
      align: "center",
      render: (_, record) => {
        const { requestable, hasRequestableDays } =
          readLeaveBalanceFigures(record);
        if (!hasRequestableDays) return <span>—</span>;
        return (
          <Tag color={requestable > 0 ? "green" : "red"}>
            {formatDays(requestable)}
          </Tag>
        );
      },
    },
    {
      title: t("leave.fractionalDays"),
      dataIndex: "fractional_days",
      key: "fractional_days",
      align: "center",
      render: (_, record) => {
        const { fractional } = readLeaveBalanceFigures(record);
        if (fractional <= 0) return <span>0</span>;
        return (
          <Tooltip
            title={t("leave.fractionalBalanceHint", {
              days: formatDays(fractional),
            })}
          >
            <Tag color="blue">{formatDays(fractional)}</Tag>
          </Tooltip>
        );
      },
    },
    {
      title: t("leave.remaining"),
      key: "remaining_days",
      align: "center",
      render: (_, record) => {
        const { remaining, total } = readLeaveBalanceFigures(record);
        const percent = total > 0 ? Math.round((remaining / total) * 100) : 0;

        let color = "#52c41a";
        if (percent < 20) color = "#ff4d4f";
        else if (percent < 50) color = "#faad14";

        return (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
            }}
          >
            <span style={{ fontWeight: "bold" }}>{formatDays(remaining)}</span>
            <Tooltip title={`${percent}% ${t("leave.remaining")}`}>
              <Progress
                percent={percent}
                steps={5}
                size="small"
                strokeColor={color}
                showInfo={false}
                style={{ width: 60 }}
              />
            </Tooltip>
          </div>
        );
      },
    },
  ];

  if (loading) return <LoadingState title={t("loading.generic")} />;

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto" }}>
      <PageHeader
        title={t("leave.balanceTitle")}
        subtitle={`${t("leave.currentYear")}: ${new Date().getFullYear()}`}
        actions={
          <Button
            icon={<ReloadOutlined aria-hidden />}
            onClick={() => {
              void loadBalances();
              setRefreshToken((token) => token + 1);
            }}
          >
            {t("common.refresh")}
          </Button>
        }
      />

      {error && (
        <Alert
          type="error"
          message={t("common.error")}
          description={error}
          showIcon
          style={{ marginBottom: 16 }}
        />
      )}

      <Card style={{ borderRadius: 16 }}>
        <Table
          dataSource={balances}
          columns={columns}
          rowKey="leave_type_id"
          pagination={false}
          size="small"
          scroll={{ x: "max-content" }}
          locale={{ emptyText: t("common.noData") }}
        />
        <Typography.Paragraph
          type="secondary"
          style={{ marginTop: 12, marginBottom: 0 }}
        >
          {t("leave.requestableDaysHint")}
        </Typography.Paragraph>
      </Card>

      <AnnualLeavePaymentCard
        refreshToken={refreshToken}
        onSubmitted={() => void loadBalances()}
      />
    </div>
  );
}
