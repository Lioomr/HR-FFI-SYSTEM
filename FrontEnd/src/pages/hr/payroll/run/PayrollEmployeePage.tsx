import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Link,
  useBlocker,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import { Alert, Breadcrumb, Button, Modal, Space, Typography } from "antd";
import PageHeader from "../../../../components/ui/PageHeader";
import BackButton from "../../../../components/ui/BackButton";
import LoadingState from "../../../../components/ui/LoadingState";
import ErrorState from "../../../../components/ui/ErrorState";
import Unauthorized403Page from "../../../Unauthorized403Page";
import PayrollTheme from "../../../../components/payroll/PayrollTheme";
import PayrollItemEditor from "../../../../components/payroll/PayrollItemEditor";
import { PayrollStatusTag } from "../../../../components/payroll/payrollDisplay";
import {
  formatPayrollPeriod,
  useCanManagePayrollHrData,
} from "../../../../components/payroll/payrollFormat";
import { readPayrollIndex } from "../../../../components/payroll/payrollIndex";
import {
  employeePath,
  filterPayrollItems,
  type PayrollEmployeeSession,
} from "../../../../components/payroll/payrollNavigation";
import {
  getRun,
  getValidationReport,
} from "../../../../services/api/payrollApi";
import { isForbidden, isNotFound } from "../../../../services/api/httpErrors";
import type {
  PayrollRunDto,
  PayrollRunItemDto,
  ValidationReport,
} from "../../../../services/api/payrollTypes";
import { useI18n } from "../../../../i18n/useI18n";

export default function PayrollEmployeePage() {
  const { run_id } = useParams();
  return <EmployeeRunSession key={run_id} />;
}

function EmployeeRunSession() {
  const { run_id: runId = "", item_id: itemId = "" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { t, language } = useI18n();
  const profiles = useCanManagePayrollHrData();
  const session = useMemo(
    () => (location.state ?? {}) as PayrollEmployeeSession,
    [location.state],
  );
  const [run, setRun] = useState<PayrollRunDto | null>(null);
  const [loadedItem, setItem] = useState<PayrollRunItemDto | null>(null);
  const item = loadedItem?.id === Number(itemId) ? loadedItem : null;
  const [report, setReport] = useState<ValidationReport | null>(null);
  // Freeze the filtered order for this confirmation session, even after a save
  // changes a record's filter membership. The record index itself still refreshes.
  const [order, setOrder] = useState<number[] | null>(session.order ?? null);
  const [indexNotice, setIndexNotice] = useState<string>();
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [forbidden, setForbidden] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const blocker = useBlocker(dirty || saving);
  const onDirtyChange = useCallback((changed: boolean, busy: boolean) => {
    setDirty(changed);
    setSaving(busy);
  }, []);
  const refresh = useCallback(async () => {
    const loaded = await getRun(runId);
    setRun(loaded);
    const results = await Promise.allSettled([
      getValidationReport(runId),
      readPayrollIndex(runId),
    ]);
    const validation =
      results[0].status === "fulfilled" ? results[0].value : null;
    setReport(validation);
    if (results[1].status === "fulfilled" && !results[1].value.limited) {
      const items = results[1].value.items;
      const current =
        validation?.revision === (items[0]?.run_revision ?? loaded.revision)
          ? validation
          : null;
      const list = session.list ?? {
        search: "",
        status: "all",
        attention: false,
      };
      if (
        !current &&
        (list.attention ||
          ["blocking", "warning", "clear"].includes(list.status))
      ) {
        setIndexNotice(t("payroll.ui.validationUnavailable"));
        return;
      }
      const filtered = filterPayrollItems(items, current, list);
      setOrder((previous) => previous ?? filtered.map((record) => record.id));
      setIndexNotice(undefined);
    } else {
      setIndexNotice(
        t(
          results[1].status === "fulfilled"
            ? "payroll.ux.indexLimited"
            : "payroll.ux.indexUnavailable",
        ),
      );
    }
    // Navigation state remains frozen; updates to the server do not alter it.
  }, [runId, session.list, t]);
  useEffect(() => {
    let active = true;
    void refresh().catch((err) => {
      if (!active) return;
      if (isForbidden(err)) setForbidden(true);
      else if (isNotFound(err)) setNotFound(true);
      else setError(t("payroll.ui.itemLoadFailed"));
    });
    return () => {
      active = false;
    };
  }, [refresh, t]);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if (dirty || saving) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  }, [dirty, saving]);
  const position = indexNotice ? -1 : (order?.indexOf(Number(itemId)) ?? -1);
  const previous = position > 0 ? order?.[position - 1] : undefined;
  const next = position >= 0 ? order?.[position + 1] : undefined;
  const go = useCallback(
    (id: number) =>
      navigate(employeePath(runId, id), { state: { ...session, order } }),
    [navigate, runId, session, order],
  );
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.defaultPrevented ||
        saving ||
        blocker.state === "blocked" ||
        target.closest(
          'input,textarea,select,[contenteditable="true"],[role="combobox"],[role="dialog"]',
        )
      )
        return;
      const id =
        event.key.toLowerCase() === "j"
          ? next
          : event.key.toLowerCase() === "k"
            ? previous
            : undefined;
      if (id !== undefined) {
        event.preventDefault();
        go(id);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [previous, next, go, saving, blocker.state]);
  const issues = useMemo(
    () =>
      report && item && report.revision === item.run_revision
        ? [...report.errors, ...report.warnings].filter(
            (issue) => issue.employee?.item_id === Number(itemId),
          )
        : [],
    [report, item, itemId],
  );
  if (forbidden) return <Unauthorized403Page />;
  if (error || notFound)
    return (
      <ErrorState
        title={notFound ? t("payroll.runDetails.notFound") : error!}
        onRetry={() => void refresh()}
      />
    );
  if (!run) return <LoadingState />;
  const period = formatPayrollPeriod(run.year, run.month, language);
  return (
    <PayrollTheme>
      <Breadcrumb
        items={[
          { title: <Link to="/hr/payroll">{t("payroll.title")}</Link> },
          {
            title: (
              <Link
                to={`/hr/payroll/${runId}`}
                state={{ payrollList: session.list }}
              >
                {t("payroll.ui.runTitle", { period })}
              </Link>
            ),
          },
          { title: item?.employee_name ?? t("payroll.ui.employee") },
        ]}
      />
      <PageHeader
        title={
          item && profiles ? (
            <Link to={`/hr/employees/${item.employee_profile_id}`}>
              {item.employee_name}
            </Link>
          ) : (
            (item?.employee_name ?? t("payroll.ui.employee"))
          )
        }
        subtitle={
          <Space wrap>
            <bdi dir="ltr">{item?.employee_id}</bdi>
            <span>{item?.department}</span>
            <span>{item?.position}</span>
            <Typography.Text type="secondary">
              {t("payroll.ui.revisionTag", {
                revision: item?.run_revision ?? run.revision,
              })}
            </Typography.Text>
          </Space>
        }
        tags={<PayrollStatusTag status={run.status} />}
        actions={
          <Space wrap>
            <Button
              disabled={previous === undefined || saving}
              onClick={() => previous !== undefined && go(previous)}
            >
              {t("payroll.employee.previous")} · K
            </Button>
            <Button
              disabled={next === undefined || saving}
              onClick={() => next !== undefined && go(next)}
            >
              {t("common.next")} · J
            </Button>
            <BackButton
              disabled={saving}
              onClick={() =>
                navigate(`/hr/payroll/${runId}${session.listSearch ?? ""}`, {
                  state: { payrollList: session.list },
                })
              }
            >
              {t("hr.employees.backToList")}
            </BackButton>
          </Space>
        }
      />
      {indexNotice && <Alert type="info" message={indexNotice} />}
      {!report && (
        <Alert type="warning" message={t("payroll.ui.validationUnavailable")} />
      )}
      <PayrollItemEditor
        initialTab={
          new URLSearchParams(location.search).get("tab") ?? undefined
        }
        initialField={
          new URLSearchParams(location.search).get("field") ?? undefined
        }
        key={itemId}
        runId={runId}
        itemId={Number(itemId)}
        runStatus={run.status}
        open
        onChanged={refresh}
        reportIssues={issues}
        issuesAvailable={
          !!report && !!item && report.revision === item.run_revision
        }
        onDirtyChange={onDirtyChange}
        onItemLoaded={setItem}
      />
      <Modal
        open={blocker.state === "blocked"}
        title={t("payroll.ui.discardChanges")}
        onCancel={() => blocker.state === "blocked" && blocker.reset()}
        footer={
          <Space>
            <Button
              onClick={() => blocker.state === "blocked" && blocker.reset()}
            >
              {t("common.cancel")}
            </Button>
            <Button
              danger
              disabled={saving}
              onClick={() => blocker.state === "blocked" && blocker.proceed()}
            >
              {t("payroll.ui.discardChanges")}
            </Button>
          </Space>
        }
      ></Modal>
    </PayrollTheme>
  );
}
