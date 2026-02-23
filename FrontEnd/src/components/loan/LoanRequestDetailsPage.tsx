import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button, Card, Descriptions, Input, Space, Tag, Timeline, Typography, notification } from "antd";
import { ArrowLeftOutlined, ArrowRightOutlined } from "@ant-design/icons";

import PageHeader from "../ui/PageHeader";
import { isApiError } from "../../services/api/apiTypes";
import type { LoanRequest } from "../../services/api/loanApi";
import { formatNumber } from "../../utils/currency";
import { useI18n } from "../../i18n/useI18n";

type Props = {
  title: string;
  backPath: string;
  fetchOne: (id: string | number) => Promise<any>;
  approve: (id: string | number, comment?: string) => Promise<any>;
  reject: (id: string | number, comment: string) => Promise<any>;
  canActWhenStatus: string;
};

export default function LoanRequestDetailsPage({
  title,
  backPath,
  fetchOne,
  approve,
  reject,
  canActWhenStatus,
}: Props) {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { t, language } = useI18n();
  const isRtl = language === 'ar';
  const [item, setItem] = useState<LoanRequest | null>(null);
  const [loading, setLoading] = useState(false);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    async function load() {
      if (!id) return;
      setLoading(true);
      try {
        const res = await fetchOne(id);
        if (isApiError(res)) {
          notification.error({ message: t("loans.myRequests.failedLoad"), description: res.message });
          return;
        }
        const payload = (res as any)?.data ?? res;
        setItem(payload as LoanRequest);
      } catch {
        notification.error({ message: t("loans.myRequests.failedLoad") });
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [fetchOne, id, t]);

  async function handleApprove() {
    if (!id) return;
    setSubmitting(true);
    try {
      const res = await approve(id, comment || undefined);
      if (isApiError(res)) {
        notification.error({ message: t("loans.inbox.approveFailed"), description: res.message });
        return;
      }
      const payload = (res as any)?.data ?? res;
      setItem(payload as LoanRequest);
      notification.success({ message: t("loans.inbox.requestApproved") });
    } catch {
      notification.error({ message: t("loans.inbox.approveFailed") });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReject() {
    if (!id) return;
    if (!comment.trim()) {
      notification.warning({ message: t("loans.inbox.commentRequired") });
      return;
    }
    setSubmitting(true);
    try {
      const res = await reject(id, comment.trim());
      if (isApiError(res)) {
        notification.error({ message: t("loans.inbox.rejectFailed"), description: res.message });
        return;
      }
      const payload = (res as any)?.data ?? res;
      setItem(payload as LoanRequest);
      notification.success({ message: t("loans.inbox.requestRejected") });
    } catch {
      notification.error({ message: t("loans.inbox.rejectFailed") });
    } finally {
      setSubmitting(false);
    }
  }

  const getStatusLabel = (status: string) => {
    if (!status) return "";
    return status.split('_').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
  };

  const canAct = item?.status === canActWhenStatus;

  return (
    <div>
      <Button icon={isRtl ? <ArrowRightOutlined /> : <ArrowLeftOutlined />} type="link" onClick={() => navigate(backPath)} style={{ paddingInlineStart: 0 }}>
        {t("loans.details.back")}
      </Button>
      <PageHeader title={title} subtitle={t("loans.inbox.reviewSubtitle")} />
      <Card loading={loading} style={{ borderRadius: 16 }}>
        {!item ? null : (
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <Descriptions column={1} bordered>
              <Descriptions.Item label={t("payroll.runDetails.colEmployee")}>{item.employee?.full_name || "-"}</Descriptions.Item>
              <Descriptions.Item label={t("settings.editProfile.lblEmail")}>{item.employee?.email || "-"}</Descriptions.Item>
              <Descriptions.Item label={t("loans.list.colAmount")}>
                {formatNumber(item.requested_amount || 0)}
              </Descriptions.Item>
              <Descriptions.Item label={t("loans.list.colStatus")}>
                <Tag>{getStatusLabel(item.status as string)}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label={t("loans.list.colReason")}>{item.reason || "-"}</Descriptions.Item>
            </Descriptions>
            <div>
              <Typography.Title level={5}>{t("loans.details.historyTitle")}</Typography.Title>
              <Timeline
                style={{ marginTop: 12 }}
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
            </div>
            <div>
              <Typography.Title level={5}>{t("loans.inbox.decisionComment")}</Typography.Title>
              <Input.TextArea rows={4} value={comment} onChange={(e) => setComment(e.target.value)} />
            </div>
            <Space>
              <Button type="primary" onClick={handleApprove} loading={submitting} disabled={!canAct}>
                {t("loans.inbox.btnApprove")}
              </Button>
              <Button danger onClick={handleReject} loading={submitting} disabled={!canAct}>
                {t("loans.inbox.btnReject")}
              </Button>
            </Space>
          </Space>
        )}
      </Card>
    </div>
  );
}
