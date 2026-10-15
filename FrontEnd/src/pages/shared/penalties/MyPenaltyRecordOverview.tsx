import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "antd";
import { BookOutlined } from "@ant-design/icons";
import dayjs from "dayjs";

import { useI18n } from "../../../i18n/useI18n";
import { isApiError } from "../../../services/api/apiTypes";
import {
  listPenalties,
  type PenaltyCatalogItem,
  type PenaltyRecord,
} from "../../../services/api/penaltiesApi";
import PenaltyAmount from "./PenaltyAmount";
import PenaltyStatusTag from "./PenaltyStatusTag";
import "./MyPenaltyRecordOverview.css";

/** How many recent calendar months the "clean record" ring covers. */
const CLEAN_WINDOW = 6;
const RING_RADIUS = 72;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
const WARNING_ACTIONS = new Set(["warning", "written_warning"]);
const CATEGORY_COLORS: Record<string, string> = {
  work_time: "#f59e0b",
  work_organization: "#0ea5e9",
  worker_conduct: "#8b5cf6",
};

/** Same rule as the detail page's Acknowledge/Dispute buttons. */
function needsResponse(record: PenaltyRecord) {
  const attendance = record.source === "automatic";
  return (
    (!attendance || record.automation === "warning_issued") &&
    record.status === "issued" &&
    !record.employee_response
  );
}

function penaltyAmount(record: PenaltyRecord) {
  return Number(record.total_deduction_amount ?? record.amount ?? 0) || 0;
}

export type PolicyExample = { title: string; steps: string[] };

/**
 * The employee's own record at a glance: clean months, this year's totals,
 * the latest penalties and how the policy escalates. Read-only: every action
 * opens the penalty's own page.
 */
export default function MyPenaltyRecordOverview({
  catalog,
  disputedCount,
  policyExample,
  onOpenPolicy,
}: {
  catalog: PenaltyCatalogItem[];
  disputedCount?: number;
  policyExample: PolicyExample | null;
  onOpenPolicy: () => void;
}) {
  const { t, language } = useI18n();
  const navigate = useNavigate();
  const [records, setRecords] = useState<PenaltyRecord[] | null>(null);
  // A failed load must not read as a clean record: the overview shows "—".
  const [failed, setFailed] = useState(false);

  const today = dayjs();
  const windowStart = today
    .subtract(CLEAN_WINDOW - 1, "month")
    .startOf("month");
  const yearStart = today.startOf("year");
  const since = (
    windowStart.isBefore(yearStart) ? windowStart : yearStart
  ).format("YYYY-MM-DD");

  useEffect(() => {
    let active = true;
    // One newest-first page covers both the clean-month window and this year.
    void listPenalties({
      mine: true,
      date_from: since,
      page: 1,
      page_size: 200,
    })
      .then((result) => {
        if (!active) return;
        if (isApiError(result)) {
          setFailed(true);
        } else {
          setFailed(false);
          setRecords(result.data.items);
        }
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [since]);

  const summary = useMemo(() => {
    const now = dayjs();
    const list = records ?? [];
    // A waived penalty does not count against the record.
    const counted = list.filter((record) => record.status !== "waived");
    const penaltyMonths = new Set(
      counted.map((record) => record.occurred_on.slice(0, 7)),
    );
    let cleanMonths = 0;
    for (let offset = 0; offset < CLEAN_WINDOW; offset += 1) {
      const key = now.subtract(offset, "month").format("YYYY-MM");
      if (!penaltyMonths.has(key)) cleanMonths += 1;
    }
    const year = now.format("YYYY");
    const thisYear = counted.filter((record) =>
      record.occurred_on.startsWith(year),
    );
    const deducted = thisYear
      .filter((record) => record.status === "applied")
      .reduce((sum, record) => sum + penaltyAmount(record), 0);
    return {
      cleanMonths,
      thisYear: thisYear.length,
      warnings: thisYear.filter((record) => WARNING_ACTIONS.has(record.action))
        .length,
      deducted,
      waiting: list.filter(needsResponse).length,
      recent: list.slice(0, 4),
    };
  }, [records]);

  const loaded = records !== null && !failed;
  const tone =
    summary.cleanMonths === CLEAN_WINDOW
      ? "good"
      : summary.cleanMonths >= CLEAN_WINDOW / 2
        ? "fair"
        : "low";
  const headline =
    tone === "good"
      ? t("penalties.record.spotless")
      : tone === "fair"
        ? t("penalties.record.good")
        : t("penalties.record.attention");
  const detail =
    summary.waiting > 0
      ? t("penalties.record.waiting", { count: summary.waiting })
      : summary.cleanMonths === CLEAN_WINDOW
        ? t("penalties.record.noneRecent")
        : t("penalties.record.someMonths", {
            count: CLEAN_WINDOW - summary.cleanMonths,
          });

  const title = (record: PenaltyRecord) => {
    const match = catalog.find((entry) => entry.code === record.catalog_code);
    if (!match) return record.catalog_code;
    return language === "ar" ? match.title_ar : match.title_en;
  };
  const categories = Array.from(new Set(catalog.map((item) => item.category)));
  const categoryCount = (category: string) =>
    catalog.filter((item) => item.category === category).length;
  const monthShort = (date: string) =>
    new Date(`${date}T00:00:00`).toLocaleString(
      language === "ar" ? "ar-EG" : "en-US",
      { month: "short" },
    );

  return (
    <section className="prec" aria-label={t("penalties.record.label")}>
      <div className="prec-health">
        <div className="prec-ring" aria-hidden="true">
          <svg width="100%" height="100%" viewBox="0 0 170 170">
            <circle
              className="prec-ring-track"
              cx="85"
              cy="85"
              r={RING_RADIUS}
              fill="none"
              strokeWidth="12"
            />
            <circle
              className={`prec-ring-value prec-tone-${tone}`}
              cx="85"
              cy="85"
              r={RING_RADIUS}
              fill="none"
              strokeWidth="12"
              strokeLinecap="round"
              strokeDasharray={RING_CIRCUMFERENCE}
              strokeDashoffset={
                RING_CIRCUMFERENCE *
                (1 - (loaded ? summary.cleanMonths : 0) / CLEAN_WINDOW)
              }
            />
          </svg>
          <div className="prec-ring-mid">
            <b>{loaded ? summary.cleanMonths : "—"}</b>
            <small>
              {t("penalties.record.cleanMonths", { count: CLEAN_WINDOW })}
            </small>
          </div>
        </div>
        <h3 className="prec-headline">{loaded ? headline : " "}</h3>
        <p className="prec-detail">
          {loaded ? detail : failed ? t("penalties.record.loadFailed") : " "}
        </p>
        <dl className="prec-stats">
          <div>
            <dt>{t("penalties.record.thisYear")}</dt>
            <dd>{loaded ? summary.thisYear : "—"}</dd>
          </div>
          <div>
            <dt>{t("penalties.record.deductedThisYear")}</dt>
            <dd>
              {loaded ? (
                summary.deducted > 0 ? (
                  <PenaltyAmount
                    value={summary.deducted.toFixed(2)}
                    fontWeight={700}
                  />
                ) : (
                  0
                )
              ) : (
                "—"
              )}
            </dd>
          </div>
          <div>
            <dt>{t("penalties.record.warnings")}</dt>
            <dd>{loaded ? summary.warnings : "—"}</dd>
          </div>
          <div>
            <dt>{t("penalties.record.disputed")}</dt>
            <dd>{disputedCount ?? "—"}</dd>
          </div>
        </dl>
      </div>

      <div className="prec-side">
        <div className="prec-card">
          <h3 className="prec-card-title">{t("penalties.record.recent")}</h3>
          {failed ? (
            <p className="prec-empty">{t("penalties.record.loadFailed")}</p>
          ) : loaded && summary.recent.length === 0 ? (
            <p className="prec-empty">{t("penalties.record.recentEmpty")}</p>
          ) : (
            <ul className="prec-recent">
              {summary.recent.map((record) => (
                <li key={record.id}>
                  <span className="prec-date" aria-hidden="true">
                    <b>{Number(record.occurred_on.slice(8, 10))}</b>
                    <small>{monthShort(record.occurred_on)}</small>
                  </span>
                  <span className="prec-recent-main">
                    <span className="prec-recent-title">{title(record)}</span>
                    <span className="prec-recent-meta">
                      {t(
                        `penalties.category.${record.category}`,
                        undefined,
                        record.category,
                      )}
                      {" · "}
                      {t(
                        `penalties.action.${record.action}`,
                        undefined,
                        record.action,
                      )}
                    </span>
                  </span>
                  <span className="prec-recent-end">
                    {penaltyAmount(record) > 0 ? (
                      <b>
                        <PenaltyAmount
                          value={record.total_deduction_amount ?? record.amount}
                          fontWeight={700}
                        />
                      </b>
                    ) : null}
                    {needsResponse(record) ? (
                      <Button
                        type="primary"
                        size="small"
                        onClick={() =>
                          navigate(`/employee/penalties/${record.id}`)
                        }
                      >
                        {t("penalties.record.respond")}
                      </Button>
                    ) : (
                      <PenaltyStatusTag status={record.status} />
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="prec-card">
          <div className="prec-card-head">
            <h3 className="prec-card-title">
              {t("penalties.record.howItWorks")}
            </h3>
            <Button
              size="small"
              icon={<BookOutlined aria-hidden />}
              onClick={onOpenPolicy}
            >
              {t("penalties.record.allViolations", { count: catalog.length })}
            </Button>
          </div>
          <div className="prec-cats">
            {categories.map((category) => (
              <div
                key={category}
                style={{
                  borderTopColor: CATEGORY_COLORS[category] ?? "#94a3b8",
                }}
              >
                <b>
                  {t(`penalties.category.${category}`, undefined, category)}
                </b>
                <small>
                  {categoryCount(category) === 1
                    ? t("penalties.record.oneViolation")
                    : t("penalties.scheduleCount", {
                        count: categoryCount(category),
                      })}
                </small>
              </div>
            ))}
          </div>
          {policyExample ? (
            <div className="prec-ladder">
              <div className="prec-ladder-title">
                {t("penalties.record.example", { title: policyExample.title })}
              </div>
              <ol className="prec-steps">
                {policyExample.steps.map((step, index) => (
                  <li key={index} className={`prec-step-${index}`}>
                    <b>{t("penalties.occurrenceShort", { n: index + 1 })}</b>
                    <small>{step}</small>
                  </li>
                ))}
              </ol>
              <p className="prec-ladder-hint">
                {t("penalties.record.exampleHint")}
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
