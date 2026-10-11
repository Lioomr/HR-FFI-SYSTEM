import {
  CheckCircleFilled,
  CloseCircleFilled,
  InfoCircleOutlined,
  MinusCircleOutlined,
} from "@ant-design/icons";
import { Descriptions, Tag, Tooltip, Typography, theme } from "antd";
import { Link } from "react-router-dom";

import { useI18n } from "../../i18n/useI18n";
import type {
  DocumentIntegrity,
  IntegritySignature,
} from "../../services/api/documentIntegrityApi";
import { formatDateTime } from "../../utils/dateTime";
import {
  hasUntrustedRoot,
  integrityPresentation,
} from "./integrityPresentation";

const { Text } = Typography;

/** Status chip; the help sentence is exposed as its tooltip and aria label. */
export function IntegrityStatusTag({
  integrity,
}: {
  integrity: DocumentIntegrity;
}) {
  const { t } = useI18n();
  const view = integrityPresentation(integrity.status, integrity.signing_mode);
  return (
    <Tag
      color={view.tagColor}
      data-testid="integrity-status"
      data-tone={view.tone}
      style={{ marginInlineEnd: 0, fontWeight: 600 }}
    >
      {t(view.labelKey)}
    </Tag>
  );
}

/** Amber note shown when the seal only chains to the internal CA. */
export function UntrustedRootTag() {
  const { t } = useI18n();
  return (
    <Tooltip
      title={t("documentIntegrity.untrustedRootHelp")}
      trigger={["hover", "focus"]}
    >
      <Tag
        color="warning"
        icon={<InfoCircleOutlined aria-hidden />}
        tabIndex={0}
        aria-label={`${t("documentIntegrity.untrustedRoot")}: ${t(
          "documentIntegrity.untrustedRootHelp",
        )}`}
        style={{ marginInlineEnd: 0, cursor: "help" }}
      >
        {t("documentIntegrity.untrustedRoot")}
      </Tag>
    </Tooltip>
  );
}

function ValidityMark({ valid }: { valid: boolean | null }) {
  const { t } = useI18n();
  if (valid === true)
    return (
      <Tag color="success" icon={<CheckCircleFilled aria-hidden />}>
        {t("documentIntegrity.valid")}
      </Tag>
    );
  if (valid === false)
    return (
      <Tag color="error" icon={<CloseCircleFilled aria-hidden />}>
        {t("documentIntegrity.invalid")}
      </Tag>
    );
  return (
    <Tag icon={<MinusCircleOutlined aria-hidden />}>
      {t("documentIntegrity.notChecked")}
    </Tag>
  );
}

const SIGNER_ROLES = new Set([
  "employee",
  "alternative_employee",
  "line_manager",
  "hr",
  "ceo",
  "hr_completion",
  "hr_manual",
  "cfo",
  "disbursement",
  // Job offers (candidate answers without an account), starting work
  // (system-generated form) and asset returns (HR receives the asset).
  "candidate",
  "system",
  "asset_received",
]);

function roleLabel(t: ReturnType<typeof useI18n>["t"], role: string) {
  if (!role) return "-";
  if (SIGNER_ROLES.has(role)) return t(`documentIntegrity.role.${role}`);
  return t(`workflow.role.${role}`, role);
}

/** A person's name: an orange profile link when the viewer can open one. */
export function PersonName({
  name,
  profileId,
  profilePath,
}: {
  name: string;
  profileId?: number | null;
  profilePath?: (profileId: number) => string;
}) {
  if (profileId && profilePath)
    return <Link to={profilePath(profileId)}>{name}</Link>;
  return <Text style={{ color: "#0f172a" }}>{name}</Text>;
}

function SignerList({
  signatures,
  profilePath,
}: {
  signatures: IntegritySignature[];
  profilePath?: (profileId: number) => string;
}) {
  const { t } = useI18n();
  const { token } = theme.useToken();
  if (!signatures.length)
    return <Text type="secondary">{t("documentIntegrity.noSigners")}</Text>;

  return (
    <ul
      aria-label={t("documentIntegrity.signers")}
      style={{
        listStyle: "none",
        margin: 0,
        padding: 0,
        display: "grid",
        gap: 8,
      }}
    >
      {signatures.map((sig, index) => (
        <li
          key={`${sig.role}-${sig.certificate_serial ?? index}`}
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 8,
            padding: "8px 12px",
            border: `1px solid ${token.colorBorderSecondary}`,
            borderRadius: 10,
          }}
        >
          <Text strong>
            <PersonName
              name={sig.signer_name || "-"}
              profileId={sig.profile_id}
              profilePath={profilePath}
            />
          </Text>
          <Tag style={{ marginInlineEnd: 0 }}>{roleLabel(t, sig.role)}</Tag>
          <Text type="secondary">{formatDateTime(sig.signed_at)}</Text>
          <span
            style={{
              marginInlineStart: "auto",
              display: "inline-flex",
              flexWrap: "wrap",
              gap: 6,
            }}
          >
            {sig.revoked ? (
              <Tooltip
                title={t("documentIntegrity.revokedHelp")}
                trigger={["hover", "focus"]}
              >
                <Tag
                  color={sig.valid === false ? "error" : "default"}
                  tabIndex={0}
                  style={{ marginInlineEnd: 0, cursor: "help" }}
                >
                  {t("documentIntegrity.revoked")}
                </Tag>
              </Tooltip>
            ) : null}
            {sig.valid !== false && sig.trust === "untrusted_root" ? (
              <UntrustedRootTag />
            ) : null}
            <ValidityMark valid={sig.valid} />
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Read-only description of a document's frozen/sealed/signed state. Shared by
 * the detail-page integrity panel and the HR "Verify a PDF" page.
 */
export default function IntegrityDetails({
  integrity,
  profilePath,
}: {
  integrity: DocumentIntegrity;
  /** Builds the profile URL for a signer; omit when the viewer has none. */
  profilePath?: (profileId: number) => string;
}) {
  const { t } = useI18n();
  const { seal } = integrity;

  return (
    <Descriptions
      bordered
      size="small"
      column={1}
      styles={{ label: { width: 180 } }}
    >
      <Descriptions.Item label={t("documentIntegrity.frozenAt")}>
        {formatDateTime(integrity.frozen_at)}
      </Descriptions.Item>
      <Descriptions.Item label={t("documentIntegrity.seal")}>
        {seal.present ? (
          <div style={{ display: "grid", gap: 6 }}>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
                alignItems: "center",
              }}
            >
              <ValidityMark valid={seal.valid} />
              {hasUntrustedRoot(integrity) ? <UntrustedRootTag /> : null}
            </div>
            {seal.signer ? (
              <Text>
                {t("documentIntegrity.sealSigner")}: {seal.signer}
              </Text>
            ) : null}
            <Text type="secondary">
              {seal.timestamped
                ? t("documentIntegrity.timestampedAt", {
                    time: formatDateTime(seal.timestamp),
                  })
                : t("documentIntegrity.noTimestamp")}
            </Text>
          </div>
        ) : (
          <Text type="secondary">{t("documentIntegrity.noSeal")}</Text>
        )}
      </Descriptions.Item>
      <Descriptions.Item label={t("documentIntegrity.signers")}>
        <SignerList
          signatures={integrity.signatures}
          profilePath={profilePath}
        />
      </Descriptions.Item>
    </Descriptions>
  );
}
