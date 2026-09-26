import { ReloadOutlined } from "@ant-design/icons";
import { Button, Tag } from "antd";
import type { ReactNode } from "react";

import EmptyState from "../ui/EmptyState";
import ErrorState from "../ui/ErrorState";
import LoadingState from "../ui/LoadingState";
import PageHeader from "../ui/PageHeader";
import { WorkspaceCard, WorkspaceViews } from "../ui/workspace/Workspace";
import { useI18n } from "../../i18n/useI18n";

/**
 * Page chrome shared by every approval queue (HR, manager, CFO and CEO).
 *
 * It owns the four screen states (loading, error, empty, populated) so each
 * queue only supplies its own table, and it puts the outstanding count next to
 * the title so the size of the backlog is visible before scrolling. The list
 * uses the shared workspace layout: optional quick-filter chips above one card
 * holding the filter toolbar, a results heading with a count, and the table.
 */
export default function ApprovalQueuePage({
  title,
  subtitle,
  pendingCount,
  loading,
  error,
  isEmpty,
  emptyTitle,
  emptyDescription,
  onRetry,
  onRefresh,
  refreshing = false,
  filters,
  chips,
  resultsTitle,
  resultsCount,
  extraActions,
  embedded = false,
  children,
}: {
  title: string;
  subtitle: string;
  /** Outstanding items; rendered as a badge beside the title when > 0. */
  pendingCount?: number;
  loading: boolean;
  error: string | null;
  isEmpty: boolean;
  emptyTitle: string;
  emptyDescription: string;
  onRetry: () => void;
  onRefresh?: () => void;
  refreshing?: boolean;
  /** Filter controls, rendered as the list card's toolbar. */
  filters?: ReactNode;
  /** Quick-filter chips (`FilterChips`) shown above the list card. */
  chips?: ReactNode;
  /** Heading of the list card; defaults to the page title. */
  resultsTitle?: ReactNode;
  /** Count text beside the list heading, e.g. "12 requests". */
  resultsCount?: ReactNode;
  /** Buttons placed before the refresh control in the header. */
  extraActions?: ReactNode;
  /** Rendered inside another page (e.g. a tab), which owns the header. */
  embedded?: boolean;
  children: ReactNode;
}) {
  const { t } = useI18n();

  const countTag =
    typeof pendingCount === "number" && pendingCount > 0 ? (
      <Tag
        color="orange"
        style={{ margin: 0, borderRadius: 999, fontWeight: 700 }}
        aria-label={t("ceo.approvals.awaitingCount", {
          count: String(pendingCount),
        })}
      >
        {t("ceo.approvals.awaitingCount", { count: String(pendingCount) })}
      </Tag>
    ) : undefined;

  const body = loading ? (
    <div style={{ padding: "32px 24px" }}>
      <LoadingState title={t("loading.generic")} />
    </div>
  ) : error ? (
    <div style={{ padding: "32px 24px" }}>
      <ErrorState
        title={t("common.error")}
        description={error}
        onRetry={onRetry}
      />
    </div>
  ) : isEmpty ? (
    <div style={{ padding: "24px" }}>
      <EmptyState title={emptyTitle} description={emptyDescription} />
    </div>
  ) : (
    children
  );

  return (
    <div style={{ paddingBottom: 24 }}>
      {!embedded && (
        <PageHeader
          title={title}
          subtitle={subtitle}
          tags={countTag}
          actions={
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {extraActions}
              {onRefresh && (
                <Button
                  icon={<ReloadOutlined aria-hidden />}
                  loading={refreshing}
                  onClick={onRefresh}
                  aria-label={t("common.refresh")}
                  style={{ borderRadius: 10, minHeight: 40 }}
                >
                  {t("common.refresh")}
                </Button>
              )}
            </div>
          }
        />
      )}

      {chips && <WorkspaceViews>{chips}</WorkspaceViews>}

      <WorkspaceCard
        toolbar={filters}
        title={resultsTitle ?? title}
        count={resultsCount}
        busy={refreshing}
      >
        {body}
      </WorkspaceCard>
    </div>
  );
}
