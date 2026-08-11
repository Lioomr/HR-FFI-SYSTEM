import { ReloadOutlined } from "@ant-design/icons";
import { Button, Tag } from "antd";
import type { ReactNode } from "react";

import EmptyState from "../ui/EmptyState";
import ErrorState from "../ui/ErrorState";
import LoadingState from "../ui/LoadingState";
import PageHeader from "../ui/PageHeader";
import { useI18n } from "../../i18n/useI18n";
import ApprovalSurface from "./ApprovalSurface";

/**
 * Page chrome shared by every CEO approval queue.
 *
 * It owns the four screen states (loading, error, empty, populated) so each
 * queue only supplies its own table, and it puts the outstanding count next to
 * the title so the size of the backlog is visible before scrolling.
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
  extraActions,
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
  /** Filter row rendered above the table, inside its own surface. */
  filters?: ReactNode;
  /** Buttons placed before the refresh control in the header. */
  extraActions?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useI18n();

  const countTag =
    typeof pendingCount === "number" && pendingCount > 0 ? (
      <Tag
        color="orange"
        style={{ margin: 0, borderRadius: 999, fontWeight: 700 }}
        aria-label={t("ceo.approvals.awaitingCount", { count: String(pendingCount) })}
      >
        {t("ceo.approvals.awaitingCount", { count: String(pendingCount) })}
      </Tag>
    ) : undefined;

  return (
    <div style={{ maxWidth: 1600, margin: "0 auto", paddingBottom: 24 }}>
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

      {filters && (
        <ApprovalSurface padding={16} style={{ marginBottom: 16 }}>
          {filters}
        </ApprovalSurface>
      )}

      {loading ? (
        <LoadingState title={t("loading.generic")} />
      ) : error ? (
        <ErrorState title={t("common.error")} description={error} onRetry={onRetry} />
      ) : isEmpty ? (
        <EmptyState title={emptyTitle} description={emptyDescription} />
      ) : (
        <ApprovalSurface>{children}</ApprovalSurface>
      )}
    </div>
  );
}
