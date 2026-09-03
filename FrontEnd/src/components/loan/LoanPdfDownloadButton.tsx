import { useState } from "react";
import { Button, message } from "antd";
import { FilePdfOutlined } from "@ant-design/icons";

import { downloadLoanRequestPdf } from "../../services/api/loanApi";
import { triggerBlobDownload } from "../../services/api/downloads";
import {
  getHttpErrorMessage,
  isForbidden,
  isNotFound,
  isUnauthorized,
} from "../../services/api/httpErrors";
import { useI18n } from "../../i18n/useI18n";

/**
 * Downloads a loan request PDF through the authenticated API client.
 *
 * The backend allows the route only for the loan's own employee, an HRManager
 * or a SystemAdmin, so callers render this for those viewers only. That is a
 * usability guard, not a security one — the backend permission stays
 * authoritative, which is why a 403 is surfaced plainly rather than hidden.
 *
 * The bytes never leave the blob: no object URL is put in the page, and no
 * token or storage path ever reaches a query string.
 */
export default function LoanPdfDownloadButton({
  loanId,
  block,
}: {
  loanId: number | string;
  block?: boolean;
}) {
  const { t } = useI18n();
  const [downloading, setDownloading] = useState(false);
  const [messageApi, messageContext] = message.useMessage();

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const blob = await downloadLoanRequestPdf(loanId);
      triggerBlobDownload(blob, `loan_request_${loanId}.pdf`);
    } catch (error) {
      // A blob request returns its error body as a Blob, so the HTTP status is
      // the only reliable signal here.
      if (isUnauthorized(error)) {
        messageApi.error(t("loans.pdf.unauthorized"));
      } else if (isForbidden(error)) {
        messageApi.error(t("loans.pdf.forbidden"));
      } else if (isNotFound(error)) {
        messageApi.error(t("loans.pdf.notFound"));
      } else {
        messageApi.error(getHttpErrorMessage(error) || t("loans.pdf.failed"));
      }
    } finally {
      setDownloading(false);
    }
  };

  return (
    <>
      {messageContext}
      <Button
        icon={<FilePdfOutlined aria-hidden />}
        loading={downloading}
        block={block}
        onClick={() => void handleDownload()}
      >
        {t("loans.pdf.download")}
      </Button>
    </>
  );
}
