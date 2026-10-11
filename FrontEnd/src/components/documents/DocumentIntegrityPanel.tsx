import {
  ReloadOutlined,
  SafetyCertificateOutlined,
  SyncOutlined,
} from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Collapse,
  Skeleton,
  Tag,
  Typography,
  notification,
  theme,
} from "antd";
import { useCallback, useEffect, useState } from "react";

import { useI18n } from "../../i18n/useI18n";
import {
  getDocumentIntegrity,
  hasIntegrityEndpoints,
  retryDocumentSeal,
  verifyDocumentIntegrity,
  type DocumentIntegrity,
  type DocumentIntegrityType,
  type IntegrityEvent,
} from "../../services/api/documentIntegrityApi";
import { getHttpStatus } from "../../services/api/httpErrors";
import { getDetailedHttpErrorMessage } from "../../services/api/userErrorMessages";
import { formatDateTime } from "../../utils/dateTime";
import IntegrityDetails, {
  IntegrityStatusTag,
  PersonName,
} from "./IntegrityDetails";
import {
  canRetrySealFor,
  integrityPresentation,
} from "./integrityPresentation";

const { Text } = Typography;

const ALERT_TYPE = {
  success: "success",
  warning: "warning",
  error: "error",
  neutral: "info",
} as const;

function EventHistory({
  events,
  profilePath,
}: {
  events: IntegrityEvent[];
  profilePath?: (profileId: number) => string;
}) {
  const { t } = useI18n();
  const { token } = theme.useToken();
  if (!events.length) return null;
  return (
    <Collapse
      ghost
      size="small"
      data-testid="integrity-history"
      items={[
        {
          key: "history",
          label: (
            <Text strong>
              {t("documentIntegrity.history")} ({events.length})
            </Text>
          ),
          children: (
            <ol
              aria-label={t("documentIntegrity.history")}
              style={{
                listStyle: "none",
                margin: 0,
                padding: 0,
                display: "grid",
                gap: 0,
              }}
            >
              {events.map((ev, index) => (
                <li
                  key={`${ev.event}-${ev.at ?? index}-${index}`}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "110px 150px minmax(0, 1fr)",
                    gap: 12,
                    alignItems: "center",
                    padding: "8px 4px",
                    borderBottom:
                      index === events.length - 1
                        ? "none"
                        : `1px solid ${token.colorBorderSecondary}`,
                  }}
                >
                  <Tag
                    color="orange"
                    style={{ marginInlineEnd: 0, justifySelf: "start" }}
                  >
                    {t(`documentIntegrity.event.${ev.event}`, ev.event || "-")}
                  </Tag>
                  <Text type="secondary">{formatDateTime(ev.at)}</Text>
                  <PersonName
                    name={ev.by || t("workflow.systemActor")}
                    profileId={ev.by_profile_id}
                    profilePath={profilePath}
                  />
                </li>
              ))}
            </ol>
          ),
        },
      ]}
    />
  );
}

/**
 * "Document integrity" card on the approval-workflow detail pages (leave,
 * loan, ...). Only finally approved records have a frozen PDF, so other
 * statuses show the neutral state without calling the API. A type whose
 * backend endpoints are not rolled out yet renders nothing.
 */
export default function DocumentIntegrityPanel({
  documentType = "leave",
  requestId,
  isFinal,
  canRetrySeal = false,
  profilePath,
}: {
  /** Which module's integrity endpoints to use; defaults to leave. */
  documentType?: DocumentIntegrityType;
  requestId: number | string;
  /** Builds a profile URL for a person; omit when the viewer has none. */
  profilePath?: (profileId: number) => string;
  /** True once the request reached final approval (status "approved"). */
  isFinal: boolean;
  /** HR-only action; the backend enforces the permission as well. */
  canRetrySeal?: boolean;
}) {
  const { t } = useI18n();
  const { token } = theme.useToken();
  const supported = hasIntegrityEndpoints(documentType);
  const active = isFinal && supported;
  const [integrity, setIntegrity] = useState<DocumentIntegrity | null>(null);
  const [loading, setLoading] = useState(active);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const load = useCallback(async () => {
    if (!active) return;
    setLoading(true);
    setError(null);
    setUnavailable(false);
    try {
      setIntegrity(await getDocumentIntegrity(documentType, requestId));
    } catch (err) {
      // The backend answers 404 to viewers outside the document's audience.
      const status = getHttpStatus(err);
      if (status === 403 || status === 404) setUnavailable(true);
      else
        setError(
          getDetailedHttpErrorMessage(t, err, "documentIntegrity.loadFailed"),
        );
    } finally {
      setLoading(false);
    }
  }, [active, documentType, requestId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const runAction = async (
    action: (
      type: DocumentIntegrityType,
      id: number | string,
    ) => Promise<DocumentIntegrity>,
    setBusy: (busy: boolean) => void,
    successKey: string,
    failKey: string,
  ) => {
    setBusy(true);
    try {
      const next = await action(documentType, requestId);
      setIntegrity(next);
      notification.success({ message: t(successKey) });
    } catch (err) {
      notification.error({
        message: t("common.error"),
        description: getDetailedHttpErrorMessage(t, err, failKey),
      });
    } finally {
      setBusy(false);
    }
  };

  const title = (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <SafetyCertificateOutlined
        aria-hidden
        style={{ color: token.colorPrimary }}
      />
      {t("documentIntegrity.title")}
    </span>
  );

  const frozen = integrity && integrity.status !== "not_frozen";

  const extra =
    integrity && frozen ? (
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <Button
          size="small"
          icon={<ReloadOutlined aria-hidden />}
          loading={verifying}
          onClick={() =>
            runAction(
              verifyDocumentIntegrity,
              setVerifying,
              "documentIntegrity.verifyDone",
              "documentIntegrity.verifyFailed",
            )
          }
        >
          {t("documentIntegrity.verifyNow")}
        </Button>
        {canRetrySeal && canRetrySealFor(integrity.status) ? (
          <Button
            size="small"
            icon={<SyncOutlined aria-hidden />}
            loading={retrying}
            onClick={() =>
              runAction(
                retryDocumentSeal,
                setRetrying,
                "documentIntegrity.retrySealDone",
                "documentIntegrity.retrySealFailed",
              )
            }
          >
            {t("documentIntegrity.retrySeal")}
          </Button>
        ) : null}
      </div>
    ) : null;

  if (!supported) return null;

  let body;
  if (!isFinal || (integrity && !frozen)) {
    body = (
      <Text type="secondary" data-testid="integrity-not-frozen">
        {t(
          isFinal
            ? "documentIntegrity.notFrozenLegacy"
            : "documentIntegrity.notFrozenYet",
        )}
      </Text>
    );
  } else if (unavailable && !loading) {
    body = (
      <Text type="secondary" data-testid="integrity-unavailable">
        {t("documentIntegrity.unavailable")}
      </Text>
    );
  } else if (loading) {
    body = (
      <div aria-busy="true" aria-label={t("common.loading")}>
        <Skeleton active paragraph={{ rows: 3 }} title={false} />
      </div>
    );
  } else if (error) {
    body = (
      <Alert
        type="error"
        showIcon
        title={t("documentIntegrity.loadFailed")}
        description={error}
        action={
          <Button size="small" onClick={() => void load()}>
            {t("common.retry")}
          </Button>
        }
      />
    );
  } else if (integrity) {
    const view = integrityPresentation(
      integrity.status,
      integrity.signing_mode,
    );
    body = (
      <div style={{ display: "grid", gap: 12 }}>
        <Alert
          type={ALERT_TYPE[view.tone]}
          showIcon
          role={view.tone === "error" ? "alert" : "status"}
          title={
            <span
              style={{
                display: "inline-flex",
                flexWrap: "wrap",
                gap: 8,
                alignItems: "center",
              }}
            >
              <IntegrityStatusTag integrity={integrity} />
            </span>
          }
          description={t(view.helpKey)}
        />
        <IntegrityDetails integrity={integrity} profilePath={profilePath} />
        <EventHistory events={integrity.events} profilePath={profilePath} />
      </div>
    );
  }

  return (
    <Card
      style={{ borderRadius: 16 }}
      title={title}
      extra={extra}
      data-testid="document-integrity-panel"
      data-document-type={documentType}
    >
      {body}
    </Card>
  );
}
