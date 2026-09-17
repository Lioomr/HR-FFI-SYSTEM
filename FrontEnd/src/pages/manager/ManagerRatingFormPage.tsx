import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Alert, Button, Card, Form, Space, Typography, message } from "antd";
import {
  ArrowLeftOutlined,
  EyeOutlined,
  FilePdfOutlined,
  ReloadOutlined,
} from "@ant-design/icons";

import PageHeader from "../../components/ui/PageHeader";
import ErrorState from "../../components/ui/ErrorState";
import LoadingState from "../../components/ui/LoadingState";
import RatingCriteriaForm, {
  ManagerRecommendationFields,
} from "../../components/ratings/RatingCriteriaForm";
import {
  RatingHeaderDetails,
  RatingResponseDetails,
  RecommendationSummary,
} from "../../components/ratings/RatingResponseDetails";
import {
  useRatingCriteria,
  criterionDraftsFrom,
  toCriterionRatings,
  toProposedTerms,
  type RatingFormValues,
} from "../../components/ratings/ratingHelpers";
import { useI18n } from "../../i18n/useI18n";
import { isApiError } from "../../services/api/apiTypes";
import {
  getHttpErrorMessage,
  isForbidden,
  isNotFound,
  isValidationError,
} from "../../services/api/httpErrors";
import { collectApiErrorMessages } from "../../utils/formErrors";
import { triggerBlobDownload } from "../../services/api/downloads";
import { previewBlob } from "../../utils/download";
import {
  CONTRACT_SALARY_COMPONENTS,
  type ContractSalaryComponent,
} from "../../services/api/contractDecisionsApi";
import {
  RESPONSE_STATUSES,
  downloadContractRatingPdf,
  getContractRating,
  isManagerRatingView,
  submitManagerRatingResponse,
  type ManagerContractRatingView,
  type ManagerRatingResponse,
  type ManagerResponsePayload,
} from "../../services/api/contractRatingsApi";

const BLOCKING_MANAGER_RATING_STATUSES = new Set([
  "PENDING_RESPONSES",
  "WAITING_MANAGER",
]);

function initialValuesFrom(
  response: ManagerRatingResponse | null,
): Partial<RatingFormValues> {
  if (!response) return { criterion_ratings: {} };
  const proposed: Partial<Record<ContractSalaryComponent, string>> = {};
  for (const field of CONTRACT_SALARY_COMPONENTS) {
    const value = response.proposed_terms?.[field];
    if (value != null && value !== "") proposed[field] = String(value);
  }
  return {
    criterion_ratings: criterionDraftsFrom(response),
    overall_remark: response.overall_remark,
    recommendation: response.recommendation || undefined,
    recommended_change_types: response.recommended_change_types ?? [],
    proposed_terms: proposed,
    proposed_job_title: response.proposed_job_title || undefined,
    proposed_position_id: response.proposed_position_id ?? undefined,
    other_change_notes: response.other_change_notes || undefined,
  };
}

/**
 * The manager's own evaluation of a direct report. The API gives a manager the
 * header and their own response only; this page never reads or requests the
 * employee's self-rating.
 */
export default function ManagerRatingFormPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const {
    criteria,
    error: criteriaError,
    loading: criteriaLoading,
    reload: reloadCriteria,
  } = useRatingCriteria();
  const [rating, setRating] = useState<ManagerContractRatingView | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [form] = Form.useForm<RatingFormValues>();
  const [messageApi, messageContext] = message.useMessage();
  const [pdfAction, setPdfAction] = useState<"preview" | "download" | null>(
    null,
  );

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setLoadError(null);
    try {
      const response = await getContractRating(id);
      if (isApiError(response)) throw new Error(response.message);
      if (!isManagerRatingView(response.data)) {
        setRating(null);
        setLoadError(t("contractRatings.notManagerRating"));
        return;
      }
      setRating(response.data);
    } catch (error) {
      setRating(null);
      if (isNotFound(error)) setLoadError(t("contractRatings.notFound"));
      else if (isForbidden(error)) setLoadError(t("contractRatings.forbidden"));
      else setLoadError(getHttpErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [id, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const own = rating?.manager_response ?? null;
  const editable = Boolean(
    rating &&
    RESPONSE_STATUSES.includes(rating.status) &&
    (!own || own.status === "RETURNED"),
  );
  const isBlockingManagerRating = BLOCKING_MANAGER_RATING_STATUSES.has(
    rating?.status ?? "",
  );

  const downloadPdf = async () => {
    if (!id) return;
    setPdfAction("download");
    try {
      triggerBlobDownload(
        await downloadContractRatingPdf(id),
        `contract_rating_${id}.pdf`,
      );
    } catch {
      messageApi.error(t("contractRatings.pdfFailed"));
    } finally {
      setPdfAction(null);
    }
  };

  const previewPdf = async () => {
    if (!id) return;
    const tab = window.open("about:blank", "_blank");
    setPdfAction("preview");
    try {
      if (!(await previewBlob(await downloadContractRatingPdf(id), tab))) {
        messageApi.error(t("contractRatings.pdfPreviewFailed"));
      }
    } catch {
      tab?.close();
      messageApi.error(t("contractRatings.pdfPreviewFailed"));
    } finally {
      setPdfAction(null);
    }
  };

  const submit = async (values: RatingFormValues) => {
    if (!rating || !criteria) return;
    setErrors([]);
    const payload: ManagerResponsePayload = {
      criterion_ratings: toCriterionRatings(
        criteria.criteria,
        values.criterion_ratings,
      ),
      overall_remark: (values.overall_remark ?? "").trim(),
      recommendation: values.recommendation!,
    };
    if (values.recommendation === "CONTINUE_WITH_CHANGES") {
      const types = values.recommended_change_types ?? [];
      payload.recommended_change_types = types;
      // Each detail field is sent only with its change type; the backend
      // rejects a non-empty detail whose type is not selected.
      if (types.includes("SALARY_INCREASE")) {
        const terms = toProposedTerms(values.proposed_terms);
        if (!Object.keys(terms).length) {
          setErrors([t("contractRatings.salaryProposalRequired")]);
          return;
        }
        payload.proposed_terms = terms;
        if (values.salary_effective_date) {
          payload.salary_effective_date =
            values.salary_effective_date.format("YYYY-MM-DD");
        }
      }
      if (types.includes("JOB_TITLE_CHANGE")) {
        payload.proposed_job_title = (values.proposed_job_title ?? "").trim();
      }
      if (types.includes("POSITION_CHANGE") && values.proposed_position_id) {
        payload.proposed_position_id = values.proposed_position_id;
      }
      if (types.includes("OTHER")) {
        payload.other_change_notes = (values.other_change_notes ?? "").trim();
      }
    }

    setSubmitting(true);
    try {
      const response = await submitManagerRatingResponse(rating.id, payload);
      if (isApiError(response)) throw new Error(response.message);
      if (isManagerRatingView(response.data)) setRating(response.data);
      else await load();
      if (response.data.status === "MANUAL_RESOLUTION_REQUIRED") {
        messageApi.warning(t("contractRatings.manualResolutionNotice"));
      } else {
        messageApi.success(t("contractRatings.submitted"));
      }
    } catch (error) {
      if (isValidationError(error)) {
        setErrors(collectApiErrorMessages(error));
      } else if (isForbidden(error)) {
        setErrors([t("contractRatings.staleAction")]);
        await load();
      } else {
        setErrors([getHttpErrorMessage(error)]);
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loading || criteriaLoading) {
    return <LoadingState title={t("contractRatings.loading")} />;
  }
  if (loadError || criteriaError || !rating || !criteria) {
    return (
      <ErrorState
        title={t("common.error")}
        description={
          loadError ?? criteriaError ?? t("contractRatings.notFound")
        }
        onRetry={() => {
          void load();
          void reloadCriteria();
        }}
      />
    );
  }

  return (
    <>
      {messageContext}
      <PageHeader
        title={t("contractRatings.managerTitle")}
        subtitle={t("contractRatings.managerSubtitle")}
        actions={
          <Space wrap>
            <Button icon={<ReloadOutlined />} onClick={() => void load()}>
              {t("common.refresh")}
            </Button>
            <Button
              icon={<EyeOutlined />}
              loading={pdfAction === "preview"}
              onClick={() => void previewPdf()}
            >
              {t("contractRatings.previewPdf")}
            </Button>
            <Button
              icon={<FilePdfOutlined />}
              loading={pdfAction === "download"}
              onClick={() => void downloadPdf()}
            >
              {t("contractRatings.downloadPdf")}
            </Button>
            <Button
              icon={<ArrowLeftOutlined />}
              onClick={() => navigate("/manager/dashboard")}
            >
              {t("common.back")}
            </Button>
          </Space>
        }
      />
      <Card style={{ marginBottom: 16 }}>
        <RatingHeaderDetails rating={rating} />
      </Card>

      {isBlockingManagerRating ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={t("contractRatings.requiredManagerRatingTitle")}
          description={t("contractRatings.requiredManagerRatingDescription")}
        />
      ) : null}

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message={t("contractRatings.confidentialManager")}
      />

      {own?.status === "RETURNED" ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={t("contractRatings.returnedNotice")}
          description={own.return_reason || undefined}
        />
      ) : null}
      {rating.status === "MANUAL_RESOLUTION_REQUIRED" ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={t("contractRatings.manualResolutionNotice")}
        />
      ) : null}

      {editable ? (
        <Card title={t("contractRatings.yourEvaluation")}>
          <RatingCriteriaForm
            form={form}
            criteria={criteria.criteria}
            gradeRanges={criteria.grade_ranges}
            initialValues={initialValuesFrom(own)}
            submitting={submitting}
            submitLabel={
              own ? t("contractRatings.resubmit") : t("contractRatings.submit")
            }
            onFinish={submit}
            errors={renderErrors(errors)}
          >
            <ManagerRecommendationFields
              key={rating.id}
              ratingId={rating.id}
              form={form}
              contractExpiry={rating.contract_expiry}
            />
          </RatingCriteriaForm>
        </Card>
      ) : own ? (
        <Card title={t("contractRatings.yourEvaluation")}>
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <Alert
              type="success"
              showIcon
              message={t("contractRatings.lockedNotice")}
            />
            <RatingResponseDetails
              response={own}
              criteria={criteria.criteria}
            />
            <RecommendationSummary response={own} />
          </Space>
        </Card>
      ) : (
        <Alert
          type="info"
          showIcon
          message={t("contractRatings.closedNoResponse")}
        />
      )}
    </>
  );

  function renderErrors(messages: string[]) {
    if (!messages.length) return null;
    return (
      <Alert
        type="error"
        showIcon
        style={{ marginBottom: 16 }}
        message={t("contractRatings.validationTitle")}
        description={
          <ul style={{ margin: 0, paddingInlineStart: 18 }}>
            {messages.map((text, index) => (
              <li key={`${text}-${index}`}>
                <Typography.Text>{text}</Typography.Text>
              </li>
            ))}
          </ul>
        }
      />
    );
  }
}
