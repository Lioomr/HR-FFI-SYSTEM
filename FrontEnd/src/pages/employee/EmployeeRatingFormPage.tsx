import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Alert, Button, Card, Form, Space, Typography, message } from "antd";
import { ArrowLeftOutlined, ReloadOutlined } from "@ant-design/icons";

import PageHeader from "../../components/ui/PageHeader";
import ErrorState from "../../components/ui/ErrorState";
import LoadingState from "../../components/ui/LoadingState";
import RatingCriteriaForm from "../../components/ratings/RatingCriteriaForm";
import {
  RatingHeaderDetails,
  RatingResponseDetails,
} from "../../components/ratings/RatingResponseDetails";
import {
  useRatingCriteria,
  criterionDraftsFrom,
  toCriterionRatings,
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
import {
  RESPONSE_STATUSES,
  getContractRating,
  isEmployeeRatingView,
  submitEmployeeRatingResponse,
  type EmployeeContractRatingView,
  type EmployeeResponsePayload,
} from "../../services/api/contractRatingsApi";

const BLOCKING_SELF_RATING_STATUSES = new Set([
  "PENDING_RESPONSES",
  "WAITING_EMPLOYEE",
]);

/**
 * The employee's self-evaluation. The API gives the employee the header and
 * their own response only; there is no recommendation block, and the payload
 * carries nothing but the criteria and an optional overall remark.
 */
export default function EmployeeRatingFormPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const {
    criteria,
    error: criteriaError,
    loading: criteriaLoading,
    reload: reloadCriteria,
  } = useRatingCriteria();
  const [rating, setRating] = useState<EmployeeContractRatingView | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [form] = Form.useForm<RatingFormValues>();
  const [messageApi, messageContext] = message.useMessage();

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setLoadError(null);
    try {
      const response = await getContractRating(id);
      if (isApiError(response)) throw new Error(response.message);
      if (!isEmployeeRatingView(response.data)) {
        setRating(null);
        setLoadError(t("contractRatings.notEmployeeRating"));
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

  const own = rating?.employee_response ?? null;
  const editable = Boolean(
    rating &&
    RESPONSE_STATUSES.includes(rating.status) &&
    (!own || own.status === "RETURNED"),
  );
  const isBlockingSelfRating = BLOCKING_SELF_RATING_STATUSES.has(
    rating?.status ?? "",
  );

  const submit = async (values: RatingFormValues) => {
    if (!rating || !criteria) return;
    setErrors([]);
    // Built field by field: any manager key, even empty, makes the backend
    // reject the whole submission.
    const payload: EmployeeResponsePayload = {
      criterion_ratings: toCriterionRatings(
        criteria.criteria,
        values.criterion_ratings,
      ),
      overall_remark: (values.overall_remark ?? "").trim(),
    };
    setSubmitting(true);
    try {
      const response = await submitEmployeeRatingResponse(rating.id, payload);
      if (isApiError(response)) throw new Error(response.message);
      if (isEmployeeRatingView(response.data)) setRating(response.data);
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
        title={t("contractRatings.employeeTitle")}
        subtitle={t("contractRatings.employeeSubtitle")}
        actions={
          <Space wrap>
            <Button icon={<ReloadOutlined />} onClick={() => void load()}>
              {t("common.refresh")}
            </Button>
            <Button
              icon={<ArrowLeftOutlined />}
              onClick={() => navigate("/employee/dashboard")}
            >
              {t("common.back")}
            </Button>
          </Space>
        }
      />
      <Card style={{ marginBottom: 16 }}>
        <RatingHeaderDetails rating={rating} />
      </Card>

      {isBlockingSelfRating ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={t("contractRatings.requiredSelfRatingTitle")}
          description={t("contractRatings.requiredSelfRatingDescription")}
        />
      ) : null}

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message={t("contractRatings.confidentialEmployee")}
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
        <Card title={t("contractRatings.yourSelfEvaluation")}>
          <RatingCriteriaForm
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
        <Card title={t("contractRatings.yourSelfEvaluation")}>
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
