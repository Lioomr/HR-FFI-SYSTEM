import { Avatar, Button, Tag } from "antd";
import { CheckCircleOutlined, UserOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import { useI18n } from "../../../i18n/useI18n";
import type { HrPendingApprovalItem } from "../../../services/api/hrSummaryApi";
import { formatDateTime } from "../../../utils/dateTime";
import { PENDING_TYPE_COLORS, PENDING_TYPE_LABEL_KEYS } from "../../../utils/pendingRequests";

interface PendingApprovalsListProps {
    items: HrPendingApprovalItem[];
    /** Head office is read-only; company tags are only meaningful there */
    showCompany?: boolean;
    isMobile?: boolean;
}

/**
 * The queue of requests waiting on this HR user. Each row keeps its review
 * action visible so approvals never need a second navigation step.
 */
export default function PendingApprovalsList({ items, showCompany, isMobile }: PendingApprovalsListProps) {
    const navigate = useNavigate();
    const { t } = useI18n();

    if (items.length === 0) {
        return (
            <div style={{ padding: "28px 12px", textAlign: "center" }}>
                <CheckCircleOutlined aria-hidden style={{ fontSize: 26, color: "#10b981" }} />
                <div style={{ marginTop: 10, color: "#0f172a", fontWeight: 600, fontSize: 14 }}>
                    {t("common.noPendingApprovals")}
                </div>
                <div style={{ marginTop: 2, color: "#94a3b8", fontSize: 13 }}>
                    {t("pendingInbox.emptyDesc")}
                </div>
            </div>
        );
    }

    return (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
            {items.map((item) => (
                <li
                    key={`${item.request_type}-${item.id}`}
                    style={{
                        display: "flex",
                        alignItems: isMobile ? "stretch" : "center",
                        flexDirection: isMobile ? "column" : "row",
                        gap: isMobile ? 10 : 12,
                        padding: 12,
                        borderRadius: 12,
                        border: "1px solid #eef2f7",
                        background: "#fcfdff",
                    }}
                >
                    <div style={{ display: "flex", gap: 10, alignItems: "flex-start", flex: 1, minWidth: 0 }}>
                        <Avatar
                            src={item.avatar || undefined}
                            size={36}
                            icon={<UserOutlined />}
                            style={{
                                flexShrink: 0,
                                background: item.avatar ? undefined : "#f97316",
                                fontWeight: 700,
                            }}
                        >
                            {!item.avatar ? item.name?.charAt(0).toUpperCase() : undefined}
                        </Avatar>

                        <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                                <span style={{ fontWeight: 600, fontSize: 13.5, color: "#0f172a" }}>{item.name}</span>
                                <Tag
                                    color={PENDING_TYPE_COLORS[item.request_type] ?? "default"}
                                    style={{ margin: 0, borderRadius: 20, fontSize: 11, fontWeight: 600 }}
                                >
                                    {t(PENDING_TYPE_LABEL_KEYS[item.request_type], item.request_type_label)}
                                </Tag>
                                {showCompany && item.company_name ? (
                                    <Tag style={{ margin: 0, borderRadius: 20, fontSize: 11 }}>{item.company_name}</Tag>
                                ) : null}
                            </div>
                            <div
                                style={{
                                    fontSize: 12.5,
                                    color: "#64748b",
                                    marginTop: 3,
                                    overflowWrap: "anywhere",
                                }}
                            >
                                {item.action}
                            </div>
                            <div className="tabular-nums" style={{ fontSize: 11.5, color: "#94a3b8", marginTop: 2 }}>
                                {t("pendingInbox.col.time")}: {formatDateTime(item.time)}
                            </div>
                        </div>
                    </div>

                    <Button
                        type="primary"
                        size="middle"
                        block={isMobile}
                        className="press-scale"
                        style={{ borderRadius: 8, minHeight: 40, flexShrink: 0 }}
                        onClick={() => navigate(item.review_path)}
                        aria-label={`${t("common.review")}: ${item.name} — ${item.action}`}
                    >
                        {t("common.review")}
                    </Button>
                </li>
            ))}
        </ul>
    );
}
