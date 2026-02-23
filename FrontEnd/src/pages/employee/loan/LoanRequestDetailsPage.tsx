import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button, Card, Descriptions, Tag, Timeline, Typography, notification } from "antd";
import { ArrowLeftOutlined, ArrowRightOutlined } from "@ant-design/icons";

import PageHeader from "../../../components/ui/PageHeader";
import { isApiError } from "../../../services/api/apiTypes";
import { getMyLoanRequest, type LoanRequest, type LoanStatus } from "../../../services/api/loanApi";
import { formatNumber } from "../../../utils/currency";
import { useI18n } from "../../../i18n/useI18n";

function statusColor(status: LoanStatus) {
  switch (status) {
    case "approved":
      return "green";
    case "rejected":
      return "red";
    case "pending_manager":
      return "orange";
    case "pending_finance":
      return "gold";
    case "pending_cfo":
      return "purple";
    case "pending_ceo":
      return "volcano";
    case "deducted":
      return "cyan";
    case "cancelled":
      return "default";
    default:
      return "blue";
  }
}

export default function EmployeeLoanRequestDetailsPage() {
  const navigate = useNavigate();
  const { t, language } = useI18n();
  const isRtl = language === 'ar';
  const { id = "" } = useParams();
  const [loading, setLoading] = useState(false);
  const [item, setItem] = useState<LoanRequest | null>(null);

  useEffect(() => {
    async function load() {
      if (!id) return;
      setLoading(true);
      try {
        const res = await getMyLoanRequest(id);
        if (isApiError(res)) {
          notification.error({ message: t("loans.myRequests.failedLoad"), description: res.message });
          return;
        }
        setItem(res.data);
      } catch {
        notification.error({ message: t("loans.myRequests.failedLoad") });
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id, t]);

  const getStatusLabel = (status: LoanStatus) => {
    if (!status) return "";
    return status.split('_').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
  };

  return (
    <div style={{ maxWidth: 960, margin: "0 auto" }}>
      <Button type="link" icon={isRtl ? <ArrowRightOutlined /> : <ArrowLeftOutlined />} onClick={() => navigate("/employee/loans")} style={{ paddingInlineStart: 0 }}>
        {t("loans.details.back")}
      </Button>
      <PageHeader title={t("loans.details.titlePrefix")} subtitle={t("loans.details.subtitle")} />
      <Card loading={loading} style={{ borderRadius: 16 }}>
        {!item ? null : (
          <>
            <Descriptions column={1} bordered>
              <Descriptions.Item label={t("loans.list.colAmount")}>{formatNumber(item.requested_amount || 0)}</Descriptions.Item>
              <Descriptions.Item label={t("loans.list.colStatus")}>
                <Tag color={statusColor(item.status)}>{getStatusLabel(item.status)}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label={t("loans.list.colReason")}>{item.reason || "-"}</Descriptions.Item>
              <Descriptions.Item label={t("loans.list.colCreated")}>
                {item.created_at ? new Date(item.created_at).toLocaleString() : "-"}
              </Descriptions.Item>
            </Descriptions>

            <Typography.Title level={5} style={{ marginTop: 20 }}>
              {t("loans.details.historyTitle")}
            </Typography.Title>
            <Timeline
              items={(item.decision_history || []).map((entry) => ({
                children: (
                  <div>
                    <div style={{ fontWeight: 600 }}>
                      {entry.stage.toUpperCase()} {entry.at ? `- ${new Date(entry.at).toLocaleString()}` : ""}
                    </div>
                    <div style={{ color: "#595959" }}>{entry.actor_email || "System"}</div>
                    {entry.note ? <div>{entry.note}</div> : null}
                  </div>
                ),
              }))}
            />
          </>
        )}
      </Card>
    </div>
  );
}
