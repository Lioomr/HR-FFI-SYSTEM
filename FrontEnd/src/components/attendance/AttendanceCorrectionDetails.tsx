import { Card, Col, Descriptions, Row, Space, Typography } from "antd";

import { useI18n } from "../../i18n/useI18n";
import type { AttendanceCorrectionRequest } from "../../services/api/attendanceCorrectionsApi";
import { formatDateTime as formatAppDateTime, formatTimeOnly } from "../../utils/dateTime";
import AttendanceCorrectionStatusTag from "./AttendanceCorrectionStatusTag";
import AttendanceCorrectionTimeline from "./AttendanceCorrectionTimeline";

const { Text } = Typography;

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  return formatAppDateTime(value, "â€”");
}

function formatTime(value: string | null): string {
  if (!value) return "—";
  return formatTimeOnly(value, "â€”");
}

function translateStatusValue(value: string | null | undefined, t: (k: string, f?: string) => string): string {
  if (!value) return "—";
  const upper = String(value).toUpperCase();
  const key = `attendanceCorrections.statusValue.${upper}`;
  const translated = t(key, upper);
  return translated;
}

export default function AttendanceCorrectionDetails({
  request,
}: {
  request: AttendanceCorrectionRequest;
}) {
  const { t } = useI18n();

  return (
    <div style={{ background: "#f8fafc", padding: 16, borderRadius: 12 }}>
      <Row gutter={[16, 16]}>
        <Col xs={24} md={12}>
          <Card
            size="small"
            title={t("attendanceCorrections.details.currentTitle", "Current attendance")}
            style={{ borderRadius: 12, height: "100%" }}
          >
            <Descriptions size="small" column={1} colon>
              <Descriptions.Item label={t("attendanceCorrections.fields.currentCheckIn", "Current check-in")}>
                {formatTime(request.current_check_in_at)}
              </Descriptions.Item>
              <Descriptions.Item label={t("attendanceCorrections.fields.currentCheckOut", "Current check-out")}>
                {formatTime(request.current_check_out_at)}
              </Descriptions.Item>
              <Descriptions.Item label={t("attendanceCorrections.fields.currentStatus", "Current status")}>
                {translateStatusValue(request.current_status, t)}
              </Descriptions.Item>
              <Descriptions.Item label={t("attendanceCorrections.fields.attendanceRecord", "Linked record")}>
                {request.attendance_record ?? (
                  <Text type="secondary">
                    {t("attendanceCorrections.fields.missingRecord", "No record exists for this date.")}
                  </Text>
                )}
              </Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>

        <Col xs={24} md={12}>
          <Card
            size="small"
            title={t("attendanceCorrections.details.requestedTitle", "Requested changes")}
            style={{ borderRadius: 12, height: "100%" }}
          >
            <Descriptions size="small" column={1} colon>
              <Descriptions.Item label={t("attendanceCorrections.fields.requestedCheckIn", "Requested check-in")}>
                {formatTime(request.requested_check_in_at)}
              </Descriptions.Item>
              <Descriptions.Item label={t("attendanceCorrections.fields.requestedCheckOut", "Requested check-out")}>
                {formatTime(request.requested_check_out_at)}
              </Descriptions.Item>
              <Descriptions.Item label={t("attendanceCorrections.fields.requestedStatus", "Requested status")}>
                {translateStatusValue(request.requested_status, t)}
              </Descriptions.Item>
              <Descriptions.Item label={t("common.status", "Status")}>
                <AttendanceCorrectionStatusTag status={request.status} />
              </Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>

        <Col span={24}>
          <Card size="small" title={t("common.reason", "Reason")} style={{ borderRadius: 12 }}>
            <Text>{request.reason || "—"}</Text>
            {(request.manager_decision_note || request.hr_decision_note) && (
              <Space direction="vertical" size={6} style={{ marginTop: 12, width: "100%" }}>
                {request.manager_decision_note ? (
                  <div>
                    <Text strong>
                      {t("attendanceCorrections.fields.managerNote", "Manager note")}:{" "}
                    </Text>
                    <Text>{request.manager_decision_note}</Text>
                    {request.manager_decision_at ? (
                      <Text type="secondary" style={{ marginInlineStart: 6 }}>
                        ({formatDateTime(request.manager_decision_at)})
                      </Text>
                    ) : null}
                  </div>
                ) : null}
                {request.hr_decision_note ? (
                  <div>
                    <Text strong>{t("attendanceCorrections.fields.hrNote", "HR note")}: </Text>
                    <Text>{request.hr_decision_note}</Text>
                    {request.hr_decision_at ? (
                      <Text type="secondary" style={{ marginInlineStart: 6 }}>
                        ({formatDateTime(request.hr_decision_at)})
                      </Text>
                    ) : null}
                  </div>
                ) : null}
              </Space>
            )}
          </Card>
        </Col>

        <Col span={24}>
          <AttendanceCorrectionTimeline request={request} />
        </Col>
      </Row>
    </div>
  );
}
