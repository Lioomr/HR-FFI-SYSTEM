import { Timeline, Typography } from "antd";

import {
  historyEntryActorName,
  historyEntryTimestamp,
  type StartingWorkWorkflowHistoryEntry,
} from "../../services/api/startingWorkAcknowledgmentsApi";
import { useI18n } from "../../i18n/useI18n";
import { formatDateTimeShort } from "../../utils/dateTime";

const { Text } = Typography;

/** Timeline colour per workflow action; anything unmapped stays neutral. */
const TONE: Record<string, string> = {
  submit: "blue",
  approve: "green",
  reject: "red",
};

/**
 * The HR verification trail exactly as the backend recorded it.
 *
 * Action names are translated when known and fall back to the raw action, so a
 * workflow step added later still shows up as a dated entry instead of
 * vanishing from the history.
 */
export default function StartingWorkWorkflowHistory({
  history,
}: {
  history?: StartingWorkWorkflowHistoryEntry[] | null;
}) {
  const { t } = useI18n();
  const entries = history || [];

  if (entries.length === 0) {
    return <Text type="secondary">{t("startingWork.workflow.empty")}</Text>;
  }

  return (
    <Timeline
      items={entries.map((entry, index) => {
        const who = historyEntryActorName(entry);
        return {
          key: entry.id ?? index,
          color: TONE[entry.action] || "gray",
          children: (
            <>
              <div style={{ fontWeight: 600 }}>
                {t(
                  `startingWork.workflow.action.${entry.action}`,
                  entry.action,
                )}
              </div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {formatDateTimeShort(historyEntryTimestamp(entry), "—")}
                {who ? ` · ${who}` : ""}
              </Text>
              {entry.note ? (
                <div style={{ marginTop: 4, fontSize: 13 }}>{entry.note}</div>
              ) : null}
            </>
          ),
        };
      })}
    />
  );
}
