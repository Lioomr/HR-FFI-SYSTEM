import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Alert, Button, Card, Form, Space, Typography, message } from "antd";
import {
  ArrowLeftOutlined,
  EyeOutlined,
  FilePdfOutlined,
  ReloadOutlined,
} from "@ant-design/icons";

import PageHeader from "../ui/PageHeader";
import ErrorState from "../ui/ErrorState";
import LoadingState from "../ui/LoadingState";
import RatingCriteriaForm from "./RatingCriteriaForm";
import {
  RatingHeaderDetails,
  RatingResponseDetails,
} from "./RatingResponseDetails";
import {
  criterionDraftsFrom,
  toCriterionRatings,
  useRatingCriteria,
  type RatingFormValues,
} from "./ratingHelpers";
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
  RESPONSE_STATUSES,
  downloadContractRatingPdf,
  getContractRating,
  submitEmployeeRatingResponse,
  submitManagerRatingResponse,
  type EmployeeContractRatingView,
  type ManagerContractRatingView,
  type RatingResponse,
} from "../../services/api/contractRatingsApi";

type Rater = "manager" | "employee";
type RaterView = ManagerContractRatingView | EmployeeContractRatingView;

/** The rater's own response. Each view type carries only its own side. */
function ownResponse(view: RaterView): RatingResponse | null {
  return view.viewer === "manager"
    ? view.manager_response
    : view.employee_response;
}

const COPY = {
  manager: {
    title: "contractRatings.managerTitle",
    subtitle: "contractRatings.managerSubtitle",
    card: "contractRatings.yourEvaluation",
    confidential: "contractRatings.confidentialManager",
    notOwn: "contractRatings.notManagerRating",
    requiredTitle: "contractRatings.requiredManagerRatingTitle",
    requiredBody: "contractRatings.requiredManagerRatingDescription",
    back: "/manager/dashboard",
    submit: submitManagerRatingResponse,
  },
  employee: {
    title: "contractRatings.employeeTitle",
    subtitle: "contractRatings.employeeSubtitle",
    card: "contractRatings.yourSelfEvaluation",
    confidential: "contractRatings.confidentialEmployee",
    notOwn: "contractRatings.notEmployeeRating",
    requiredTitle: "contractRatings.requiredSelfRatingTitle",
    requiredBody: "contractRatings.requiredSelfRatingDescription",
    back: "/employee/dashboard",
    submit: submitEmployeeRatingResponse,
  },
} as const;

/**
 * One rater's side of a contract rating. The manager and employee routes both
 * mount this with only `rater` differing: same header, same decision-free
 * RatingCriteriaForm, same payload shape — only the endpoint changes. The
 * backend sends each rater their own response and nothing about the other
 * side, and this page never requests anything else.
 */
export default function RaterEvaluationPage({ rater }: { rater: Rater }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const copy = COPY[rater];
  const {
    criteria,
    error: criteriaError,
    loading: criteriaLoading,
    reload: reloadCriteria,
  } = useRatingCriteria();
  const [rating, setRating] = useState<RaterView | null>(null);
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
      if (response.data.viewer !== rater) {
        setRating(null);
        setLoadError(t(copy.notOwn));
        return;
      }
      setRating(response.data);
    } catch (error) {
      setRating(null);
      setLoadError(
        isNotFound(error)
          ? t("contractRatings.notFound")
          : getHttpErrorMessage(error),
      );
    } finally {
      setLoading(false);
    }
  }, [id, rater, copy.notOwn, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const own = rating ? ownResponse(rating) : null;
  const editable = Boolean(
    rating &&
    rating.rating_mode === "RATE" &&
    RESPONSE_STATUSES.includes(rating.status) &&
    (!own || own.status === "RETURNED"),
  );

  const runPdf = async (action: "preview" | "download") => {
    if (!id) return;
    const tab = action === "preview" ? window.open("about:blank", "_blank") : null;
    setPdfAction(action);
    try {
      const blob = await downloadContractRatingPdf(id);
      if (action === "download") {
        triggerBlobDownload(blob, `contract_rating_${id}.pdf`);
      } else if (!(await previewBlob(blob, tab))) {
        messageApi.error(t("contractRatings.pdfPreviewFailed"));
      }
    } catch {
      tab?.close();
      messageApi.error(
        t(
          action === "preview"
            ? "contractRatings.pdfPreviewFailed"
            : "contractRatings.pdfFailed",
        ),
      );
    } finally {
      setPdfAction(null);
    }
  };

  const submit = async (values: RatingFormValues) => {
    if (!rating || !criteria) return;
    setErrors([]);
    setSubmitting(true);
    try {
      const response = await copy.submit(rating.id, {
        criterion_ratings: toCriterionRatings(
          criteria.criteria,
          values.criterion_ratings,
        ),
        overall_remark: (values.overall_remark ?? "").trim(),
      });
      if (isApiError(response)) throw new Error(response.message);
      if (response.data?.viewer === rater) setRating(response.data);
      else await load();
      if (response.data?.status === "MANUAL_RESOLUTION_REQUIRED") {
        messageApi.warning(t("contractRatings.manualResolutionNotice"));
      } else {
        messageApi.success(t("contractRatings.submitted"));
      }
    } catch (error) {
      if (isValidationError(error)) {
        const messages = collectApiErrorMessages(error);
        setErrors(messages.length ? messages : [getHttpErrorMessage(error)]);
      } else if (isForbidden(error)) {
        // Surface the server's reason (e.g. no longer this employee's manager).
        setErrors([getHttpErrorMessage(error), t("contractRatings.staleAction")]);
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
        description={loadError ?? criteriaError ?? t("contractRatings.notFound")}
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
        title={t(copy.title)}
        subtitle={t(copy.subtitle)}
        actions={
          <Space wrap>
            <Button icon={<ReloadOutlined />} onClick={() => void load()}>
              {t("common.refresh")}
            </Button>
            {own ? (
              <>
                <Button
                  icon={<EyeOutlined />}
                  loading={pdfAction === "preview"}
                  onClick={() => void runPdf("preview")}
                >
                  {t("contractRatings.previewPdf")}
                </Button>
                <Button
                  icon={<FilePdfOutlined />}
                  loading={pdfAction === "download"}
                  onClick={() => void runPdf("download")}
                >
                  {t("contractRatings.downloadPdf")}
                </Button>
              </>
            ) : null}
            <Button
              icon={<ArrowLeftOutlined />}
              onClick={() => navigate(copy.back)}
            >
              {t("common.back")}
            </Button>
          </Space>
        }
      />
      <Card style={{ marginBottom: 16 }}>
        <RatingHeaderDetails rating={rating} />
      </Card>

      {editable ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={t(copy.requiredTitle)}
          description={t(copy.requiredBody)}
        />
      ) : null}

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message={t(copy.confidential)}
      />

      {editable && own?.status === "RETURNED" ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={t("contractRatings.returnedNotice")}
          description={
            own.return_reason
              ? t("contractRatings.returnReasonValue", {
                  reason: own.return_reason,
                })
              : undefined
          }
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
        <Card title={t(copy.card)}>
          <RatingCriteriaForm
            key={`${rating.id}-${own?.updated_at ?? "new"}`}
            form={form}
            criteria={criteria.criteria}
            gradeRanges={criteria.grade_ranges}
            initialValues={{
              criterion_ratings: criterionDraftsFrom(own),
              overall_remark: own?.overall_remark,
            }}
            submitting={submitting}
            submitLabel={
              own ? t("contractRatings.resubmit") : t("contractRatings.submit")
            }
            onFinish={submit}
            errors={
              errors.length ? (
                <Alert
                  type="error"
                  showIcon
                  style={{ marginBottom: 16 }}
                  message={t("contractRatings.validationTitle")}
                  description={
                    <ul style={{ margin: 0, paddingInlineStart: 18 }}>
                      {errors.map((text, index) => (
                        <li key={`${text}-${index}`}>
                          <Typography.Text>{text}</Typography.Text>
                        </li>
                      ))}
                    </ul>
                  }
                />
              ) : null
            }
          />
        </Card>
      ) : own ? (
        <Card title={t(copy.card)}>
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <Alert
              type="success"
              showIcon
              message={t("contractRatings.lockedNotice")}
            />
            <RatingResponseDetails response={own} criteria={criteria.criteria} />
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
}
