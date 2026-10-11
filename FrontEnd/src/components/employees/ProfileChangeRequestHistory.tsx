import { Button, Drawer, Grid, Space, Typography } from "antd";

import EmptyState from "../ui/EmptyState";
import {
  ProfileChangeRequestDetails,
  ProfileChangeStatusTag,
} from "./ProfileChangeRequestStatus";
import type { ProfileChangeRequest } from "../../services/api/employeeProfileChangeRequestsApi";
import { useI18n } from "../../i18n/useI18n";

const { Text } = Typography;

/** Every profile change request the employee has sent, newest first. */
export default function ProfileChangeRequestHistory({
  open,
  onClose,
  requests,
  hasMore,
  loadingMore,
  onLoadMore,
}: {
  open: boolean;
  onClose: () => void;
  requests: ProfileChangeRequest[];
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}) {
  const { t, direction } = useI18n();
  const screens = Grid.useBreakpoint();
  const isPhone = screens.md === false;
  const ordered = [...requests].sort(
    (a, b) =>
      (b.submitted_at ?? "").localeCompare(a.submitted_at ?? "") || b.id - a.id,
  );

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={t("profileChange.historyTitle")}
      placement={direction === "rtl" ? "left" : "right"}
      size={560}
      styles={{
        wrapper: { maxWidth: "100vw" },
        body: { padding: isPhone ? 16 : 24, background: "#f8fafc" },
      }}
      destroyOnHidden
    >
      {ordered.length === 0 ? (
        <EmptyState
          title={t("profileChange.historyEmptyTitle")}
          description={t("profileChange.historyEmpty")}
        />
      ) : (
        <Space orientation="vertical" size={16} style={{ width: "100%" }}>
          <ol
            aria-label={t("profileChange.historyTitle")}
            style={{ listStyle: "none", margin: 0, padding: 0 }}
          >
            {ordered.map((request) => (
              <li
                key={request.id}
                aria-labelledby={`profile-change-history-${request.id}`}
                style={{
                  background: "#fff",
                  borderRadius: 12,
                  border: "1px solid #f0f0f0",
                  padding: isPhone ? 12 : 16,
                  marginBottom: 12,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    flexWrap: "wrap",
                    marginBottom: 8,
                  }}
                >
                  <Text strong id={`profile-change-history-${request.id}`}>
                    <bdi>{request.reference_no || `#${request.id}`}</bdi>
                  </Text>
                  <ProfileChangeStatusTag status={request.status} />
                </div>
                <ProfileChangeRequestDetails
                  request={request}
                  showReference={false}
                />
              </li>
            ))}
          </ol>
          {hasMore ? (
            <div style={{ textAlign: "center" }}>
              <Button loading={loadingMore} onClick={onLoadMore}>
                {t("profileChange.historyLoadMore")}
              </Button>
            </div>
          ) : null}
        </Space>
      )}
    </Drawer>
  );
}
