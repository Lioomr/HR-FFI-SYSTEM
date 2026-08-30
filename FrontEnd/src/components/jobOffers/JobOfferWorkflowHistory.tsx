import { Timeline, Typography } from "antd";

import type {
  JobOfferWorkflowActor,
  JobOfferWorkflowHistoryEntry,
} from "../../services/api/jobOffersApi";
import { useI18n } from "../../i18n/useI18n";
import { formatDateTimeShort } from "../../utils/dateTime";

const { Text } = Typography;

/** Timeline colour per workflow action; anything unmapped stays neutral. */
const TONE: Record<string, string> = {
  submit: "blue",
  approve: "green",
  request_changes: "orange",
  reject: "red",
  cancel: "gray",
};

function actorName(actor: JobOfferWorkflowActor | null | undefined): string {
  if (!actor) return "";
  return (actor.full_name || actor.email || "").trim();
}

/**
 * The approval trail exactly as the backend recorded it.
 *
 * Action names are translated when known and fall back to the raw action, so a
 * workflow step added later still shows up as a dated entry instead of
 * vanishing from the history.
 */
export default function JobOfferWorkflowHistory({
  history,
}: {
  history?: JobOfferWorkflowHistoryEntry[] | null;
}) {
  const { t } = useI18n();
  const entries = history || [];

  if (entries.length === 0) {
    return <Text type="secondary">{t("jobOffers.workflow.empty")}</Text>;
  }

  return (
    <Timeline
      items={entries.map((entry, index) => {
        const who = actorName(entry.actor);
        return {
          key: entry.id ?? index,
          color: TONE[entry.action] || "gray",
          children: (
            <>
              <div style={{ fontWeight: 600 }}>
                {t(`jobOffers.workflow.action.${entry.action}`, entry.action)}
              </div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {formatDateTimeShort(entry.at, "—")}
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
