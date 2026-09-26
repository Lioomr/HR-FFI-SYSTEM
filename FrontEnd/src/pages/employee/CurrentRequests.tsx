import { useEffect, useState } from "react";
import { Alert, Button, Empty, Pagination, Skeleton, Tag } from "antd";
import { ArrowRightOutlined, ReloadOutlined } from "@ant-design/icons";
import { Link } from "react-router-dom";
import { useI18n } from "../../i18n/useI18n";
import {
  resolveAuthorizedActiveOrganizationId,
  useAuthStore,
} from "../../auth/authStore";
import {
  getEmployeeCurrentRequests,
  type CurrentRequestKind,
} from "../../services/api/employeeCurrentRequestsApi";
import { formatDateOnly } from "../../utils/dateTime";
import { EMPLOYEE_PREFERENCE_LABEL_KEYS } from "../../components/leaves/annualLeaveSettlement";

const kindKeys: Record<CurrentRequestKind, string> = {
  leave: "employee.dashboard.myLeaves",
  permission: "employee.dashboard.permissionTitle",
  loan: "employee.dashboard.loans",
  settlement: "employee.dashboard.annualSettlement",
};
const statusKeys: Record<string, string> = {
  submitted: "status.submitted",
  pending_delegate: "leave.status.pending_delegate",
  pending_manager: "status.pendingManager",
  pending_hr: "status.pendingHr",
  pending_hr_completion: "employee.dashboard.pendingCompletion",
  pending_finance: "status.pendingFinance",
  pending_cfo: "status.pendingCfo",
  pending_ceo: "status.pendingCeo",
  pending_disbursement: "status.pendingDisbursement",
};

export default function CurrentRequests() {
  const user = useAuthStore((state) => state.user);
  const scope = `${user?.id ?? ""}:${user ? resolveAuthorizedActiveOrganizationId(user) : ""}`;
  return <CurrentRequestsContent key={scope} />;
}

function CurrentRequestsContent() {
  const { t } = useI18n();
  const [result, setResult] = useState<Awaited<
    ReturnType<typeof getEmployeeCurrentRequests>
  > | null>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [page, setPage] = useState(1);
  useEffect(() => {
    let active = true;
    getEmployeeCurrentRequests(() => active).then((data) => {
      if (active) {
        setResult(data);
        setLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, [revision]);
  const refresh = () => {
    setLoading(true);
    setResult(null);
    setPage(1);
    setRevision((value) => value + 1);
  };
  return (
    <section
      className="ed-current ed-services"
      aria-labelledby="ed-current-title"
      aria-busy={loading}
    >
      <div className="ed-current-heading">
        <div>
          <h2 id="ed-current-title">
            {t("employee.dashboard.currentTitle")}
            {!loading && result && !result.failed.length && (
              <Tag>{result.requests.length}</Tag>
            )}
          </h2>
          <p>{t("employee.dashboard.currentHint")}</p>
        </div>
        <Button
          icon={<ReloadOutlined aria-hidden="true" />}
          onClick={refresh}
          loading={loading}
        >
          {t("employee.dashboard.refresh")}
        </Button>
      </div>
      {loading ? (
        <Skeleton active paragraph={{ rows: 3 }} />
      ) : (
        <>
          {!!result?.failed.length && (
            <Alert
              showIcon
              type="warning"
              title={`${t("employee.dashboard.currentError")} ${result.failed.map((kind) => t(kindKeys[kind])).join(" / ")}`}
            />
          )}
          {!!result?.requests.length && (
            <ul className="ed-current-list">
              {result.requests
                .slice((page - 1) * 5, page * 5)
                .map((request) => (
                  <li key={`${request.kind}-${request.id}`}>
                    <Link className="ed-current-link" to={request.path}>
                      <span className="ed-current-info">
                        <strong>
                          {t(kindKeys[request.kind])}{" "}
                          <bdi>{request.reference}</bdi>
                        </strong>
                        <span className="ed-service-description">
                          {t("employee.dashboard.submittedOn")}{" "}
                          {formatDateOnly(request.createdAt)}
                        </span>
                        {request.cycle && (
                          <span className="ed-service-description">
                            {t("annualPayment.contractYear")}{" "}
                            <bdi>
                              {request.cycle.start} → {request.cycle.end}
                            </bdi>
                            {request.preference &&
                              ` · ${t("annualPayment.yourPreference")}: ${t(
                                EMPLOYEE_PREFERENCE_LABEL_KEYS[
                                  request.preference
                                ],
                              )}`}
                          </span>
                        )}
                      </span>
                      <Tag color="orange">
                        {t(statusKeys[request.status] || "status.pending")}
                      </Tag>
                      <ArrowRightOutlined className="ed-arrow" />
                    </Link>
                  </li>
                ))}
            </ul>
          )}
          {result && !result.requests.length && !result.failed.length && (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={t("employee.dashboard.currentEmpty")}
            />
          )}
          {result && result.requests.length > 5 && (
            <Pagination
              current={page}
              pageSize={5}
              total={result.requests.length}
              onChange={setPage}
              showSizeChanger={false}
            />
          )}
        </>
      )}
    </section>
  );
}
