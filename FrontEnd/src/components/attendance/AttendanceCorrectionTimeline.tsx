import { Card, Timeline, Typography } from "antd";
import dayjs from "dayjs";
import type {
  AttendanceCorrectionRequest,
  AttendanceCorrectionWorkflowHistoryEntry,
} from "../../services/api/attendanceCorrectionsApi";
import { useI18n } from "../../i18n/useI18n";

const { Text } = Typography;

function formatActor(entry: AttendanceCorrectionWorkflowHistoryEntry) {
  const actor = entry.actor;
  if (!actor) return "";
  return actor.full_name || actor.email || "";
}

function actionColor(action: string): string {
  const value = (action || "").toLowerCase();
  if (value.includes("reject")) return "red";
  if (value.includes("approve")) return "green";
  if (value.includes("cancel")) return "gray";
  if (value.includes("submit")) return "blue";
  return "orange";
}

export default function AttendanceCorrectionTimeline({
  request,
}: {
  request: AttendanceCorrectionRequest;
}) {
  const { t } = useI18n();
  const history = request.workflow?.history || [];

  if (!history.length) {
    return (
      <Card
        size="small"
        style={{ background: "#f8fafc", borderRadius: 12, border: "1px dashed #cbd5e1" }}
      >
        <Text type="secondary">{t("attendanceCorrections.timeline.empty", "No workflow history yet.")}</Text>
      </Card>
    );
  }

  return (
    <Card
      size="small"
      title={t("attendanceCorrections.timeline.title", "Workflow history")}
      style={{ borderRadius: 12 }}
    >
      <Timeline
        items={history.map((entry) => {
          const actor = formatActor(entry);
          const at = entry.at ? dayjs(entry.at).format("YYYY-MM-DD HH:mm") : "";
          const stageLabel = entry.approver_role || entry.stage || "";
          return {
            color: actionColor(entry.action),
            children: (
              <div>
                <div style={{ fontWeight: 600, color: "#0f172a" }}>
                  {entry.action.replace(/_/g, " ")}
                  {stageLabel ? (
                    <Text type="secondary" style={{ marginInlineStart: 8, fontWeight: 400 }}>
                      ({stageLabel})
                    </Text>
                  ) : null}
                </div>
                {actor || at ? (
                  <div style={{ color: "#64748b", fontSize: 12, marginTop: 2 }}>
                    {actor} {at ? `· ${at}` : ""}
                  </div>
                ) : null}
                {entry.note ? (
                  <div style={{ marginTop: 4, color: "#334155", fontSize: 13 }}>{entry.note}</div>
                ) : null}
              </div>
            ),
          };
        })}
      />
    </Card>
  );
}
