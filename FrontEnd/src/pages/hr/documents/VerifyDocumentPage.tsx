import {
  FilePdfOutlined,
  InboxOutlined,
  SafetyCertificateOutlined,
} from "@ant-design/icons";
import { Alert, Button, Card, Tag, Typography, Upload, theme } from "antd";
import type { UploadProps } from "antd";
import { useState } from "react";
import { Link } from "react-router-dom";

import IntegrityDetails, {
  IntegrityStatusTag,
} from "../../../components/documents/IntegrityDetails";
import {
  matchedRecordLabelKey,
  matchedRecordPath,
} from "../../../components/documents/documentTypes";
import { integrityPresentation } from "../../../components/documents/integrityPresentation";
import PageHeader from "../../../components/ui/PageHeader";
import { useI18n } from "../../../i18n/useI18n";
import {
  verifyDocumentUpload,
  type VerifyUploadResult,
} from "../../../services/api/documentIntegrityApi";
import { getDetailedHttpErrorMessage } from "../../../services/api/userErrorMessages";

const { Dragger } = Upload;
const { Text } = Typography;

/** Matches the backend upload limit for verification uploads. */
const MAX_BYTES = 20 * 1024 * 1024;

const ALERT_TYPE = {
  success: "success",
  warning: "warning",
  error: "error",
  neutral: "info",
} as const;

function isPdf(file: File) {
  return (
    file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
  );
}

export default function VerifyDocumentPage() {
  const { t } = useI18n();
  const { token } = theme.useToken();
  const [file, setFile] = useState<File | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<VerifyUploadResult | null>(null);

  const selectFile = (next: File | null) => {
    setResult(null);
    setError(null);
    if (next && !isPdf(next)) {
      setFile(null);
      setError(t("documentIntegrity.verify.notPdf"));
      return;
    }
    if (next && next.size > MAX_BYTES) {
      setFile(null);
      setError(t("documentIntegrity.verify.tooLarge"));
      return;
    }
    setFile(next);
  };

  const uploadProps: UploadProps = {
    accept: ".pdf,application/pdf",
    multiple: false,
    maxCount: 1,
    showUploadList: false,
    beforeUpload: (picked) => {
      selectFile(picked as File);
      return false;
    },
  };

  const runCheck = async () => {
    if (!file) return;
    setChecking(true);
    setError(null);
    setResult(null);
    try {
      setResult(await verifyDocumentUpload(file));
    } catch (err) {
      setError(
        getDetailedHttpErrorMessage(t, err, "documentIntegrity.verify.failed"),
      );
    } finally {
      setChecking(false);
    }
  };

  const view = result
    ? integrityPresentation(
        result.integrity.status,
        result.integrity.signing_mode,
      )
    : null;
  // Warning/late notices are compared with the hash stored at issuance only.
  const hashVerified =
    view?.labelKey === "documentIntegrity.status.hash_verified";
  // An unrecognised upload is not a "pending" document: say plainly that
  // nothing matched, and style it as a warning rather than neutral info.
  const noMatch = result?.integrity.status === "not_frozen";
  // This page is HR/admin only, so a match opens the HR detail route.
  const matchedPath = result?.matched_record
    ? matchedRecordPath(result.matched_record, "hr")
    : null;
  const matchedLabelKey = result?.matched_record
    ? matchedRecordLabelKey(result.matched_record)
    : null;

  return (
    <div style={{ maxWidth: 880, margin: "0 auto" }}>
      <PageHeader
        title={t("documentIntegrity.verify.title")}
        subtitle={t("documentIntegrity.verify.subtitle")}
      />

      <div style={{ display: "grid", gap: 18 }}>
        <Card style={{ borderRadius: 16 }}>
          <Dragger
            {...uploadProps}
            disabled={checking}
            aria-label={t("documentIntegrity.verify.dropLabel")}
            style={{ padding: 16 }}
          >
            <p className="ant-upload-drag-icon">
              <InboxOutlined
                aria-hidden
                style={{ color: token.colorPrimary }}
              />
            </p>
            <p className="ant-upload-text">
              {t("documentIntegrity.verify.dropLabel")}
            </p>
            <p className="ant-upload-hint">
              {t("documentIntegrity.verify.dropHint")}
            </p>
          </Dragger>

          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 12,
              alignItems: "center",
              justifyContent: "space-between",
              marginTop: 16,
            }}
          >
            <Text type={file ? undefined : "secondary"} style={{ minWidth: 0 }}>
              {file ? (
                <span
                  style={{
                    display: "inline-flex",
                    gap: 8,
                    alignItems: "center",
                  }}
                >
                  <FilePdfOutlined aria-hidden />
                  <bdi style={{ overflowWrap: "anywhere" }}>{file.name}</bdi>
                </span>
              ) : (
                t("documentIntegrity.verify.noFile")
              )}
            </Text>
            <Button
              type="primary"
              icon={<SafetyCertificateOutlined aria-hidden />}
              disabled={!file}
              loading={checking}
              onClick={runCheck}
            >
              {t("documentIntegrity.verify.submit")}
            </Button>
          </div>
        </Card>

        {error ? (
          <Alert
            type="error"
            showIcon
            role="alert"
            title={t("documentIntegrity.verify.failedTitle")}
            description={error}
          />
        ) : null}

        {result && view ? (
          <Card
            style={{ borderRadius: 16 }}
            title={t("documentIntegrity.verify.resultTitle")}
            data-testid="verify-result"
          >
            <div style={{ display: "grid", gap: 12 }}>
              <Alert
                type={noMatch ? "warning" : ALERT_TYPE[view.tone]}
                showIcon
                role={view.tone === "error" ? "alert" : "status"}
                title={
                  noMatch ? (
                    <Text strong>
                      {t("documentIntegrity.verify.noMatchFound")}
                    </Text>
                  ) : (
                    <IntegrityStatusTag integrity={result.integrity} />
                  )
                }
                description={t(
                  hashVerified
                    ? "documentIntegrity.verifyHelp.hash_verified"
                    : `documentIntegrity.verifyHelp.${result.integrity.status}`,
                )}
              />
              <div
                data-testid="verify-matched-record"
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 8,
                  alignItems: "center",
                }}
              >
                <Text strong>
                  {t("documentIntegrity.verify.matchedRecord")}:
                </Text>
                {result.matched_record ? (
                  <>
                    {matchedLabelKey ? (
                      <Tag
                        data-testid="verify-matched-type"
                        style={{ marginInlineEnd: 0 }}
                      >
                        {t(matchedLabelKey)}
                      </Tag>
                    ) : null}
                    {matchedPath ? (
                      <Link to={matchedPath}>
                        {result.matched_record.reference ||
                          `#${result.matched_record.id}`}
                      </Link>
                    ) : (
                      <Text>
                        {result.matched_record.reference ||
                          `#${result.matched_record.id}`}
                      </Text>
                    )}
                  </>
                ) : (
                  <Text type="secondary">
                    {t("documentIntegrity.verify.noMatch")}
                  </Text>
                )}
              </div>
              {result.matched_record?.superseded_version ? (
                // A genuine copy of an earlier version (e.g. the job offer
                // as sent, before the candidate answered): not an error.
                <Alert
                  type="info"
                  showIcon
                  role="status"
                  data-testid="verify-superseded"
                  title={t("documentIntegrity.verify.superseded", {
                    version: result.matched_record.superseded_version,
                  })}
                />
              ) : null}
              {result.integrity.status !== "not_frozen" ? (
                <IntegrityDetails integrity={result.integrity} />
              ) : null}
            </div>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
