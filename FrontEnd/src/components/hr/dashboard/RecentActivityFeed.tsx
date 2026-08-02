import { Avatar, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useI18n } from "../../../i18n/useI18n";
import type { HrRecentActivityItem } from "../../../services/api/hrSummaryApi";

interface RecentActivityFeedProps {
    items: HrRecentActivityItem[];
    showCompany?: boolean;
    /** Below the table's comfortable width, rows stack instead of scrolling sideways */
    stacked?: boolean;
}

/** Audit rows arrive as "EntityName (#12)"; only the entity part is translatable. */
function translateEntity(raw: string, t: (key: string, fallback?: string) => string) {
    const match = raw.match(/^(.*?)( \(#.*\))?$/);
    if (!match) return raw;
    return t(`audit.entity.${match[1]}`, match[1]) + (match[2] || "");
}

function actorColor(name: string) {
    return `hsl(${((name?.charCodeAt(0) || 0) * 13) % 360}, 55%, 42%)`;
}

export default function RecentActivityFeed({ items, showCompany, stacked }: RecentActivityFeedProps) {
    const { t } = useI18n();

    if (items.length === 0) {
        return (
            <div style={{ padding: "28px 12px", textAlign: "center", color: "#94a3b8", fontSize: 13.5 }}>
                {t("hr.dashboard.noActivity")}
            </div>
        );
    }

    if (stacked) {
        return (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                {items.map((item) => (
                    <li
                        key={item.key}
                        style={{
                            display: "flex",
                            gap: 10,
                            padding: 12,
                            border: "1px solid #eef2f7",
                            borderRadius: 12,
                            background: "#fcfdff",
                        }}
                    >
                        <Avatar
                            size={30}
                            style={{ background: actorColor(item.employee), fontWeight: 700, fontSize: 12, flexShrink: 0 }}
                        >
                            {item.employee?.[0]?.toUpperCase()}
                        </Avatar>
                        <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontWeight: 600, fontSize: 13, color: "#0f172a", overflowWrap: "anywhere" }}>
                                {item.employee}
                            </div>
                            <div style={{ fontSize: 12.5, color: "#64748b", marginTop: 2, overflowWrap: "anywhere" }}>
                                {t(`audit.action.${item.action}`, item.action.replace(/_/g, " "))}
                            </div>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginTop: 6 }}>
                                <Tag
                                    color={item.statusColor}
                                    style={{ margin: 0, borderRadius: 20, fontSize: 11, fontWeight: 600 }}
                                >
                                    {translateEntity(item.status, t)}
                                </Tag>
                                {showCompany && item.company_name ? (
                                    <Tag style={{ margin: 0, borderRadius: 20, fontSize: 11 }}>{item.company_name}</Tag>
                                ) : null}
                                <span className="tabular-nums" style={{ fontSize: 11.5, color: "#94a3b8" }}>
                                    {item.date}
                                </span>
                            </div>
                        </div>
                    </li>
                ))}
            </ul>
        );
    }

    const columns: ColumnsType<HrRecentActivityItem> = [
        {
            title: t("hr.dashboard.actor", "Actor"),
            dataIndex: "employee",
            key: "employee",
            render: (text: string) => (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Avatar
                        size={28}
                        style={{ background: actorColor(text), fontWeight: 700, fontSize: 12, flexShrink: 0 }}
                    >
                        {text?.[0]?.toUpperCase()}
                    </Avatar>
                    <span style={{ fontWeight: 500, color: "#0f172a", fontSize: 13 }}>{text}</span>
                </div>
            ),
        },
        {
            title: t("hr.dashboard.actionType"),
            dataIndex: "action",
            key: "action",
            render: (text: string) => (
                <span style={{ color: "#64748b", fontSize: 13 }}>
                    {t(`audit.action.${text}`, text.replace(/_/g, " "))}
                </span>
            ),
        },
        {
            title: t("hr.dashboard.record"),
            dataIndex: "status",
            key: "status",
            render: (text: string, record) => (
                <Tag color={record.statusColor} style={{ borderRadius: 20, border: 0, fontWeight: 600, fontSize: 11 }}>
                    {translateEntity(text, t)}
                </Tag>
            ),
        },
        ...(showCompany
            ? [
                  {
                      title: t("common.company", "Company"),
                      dataIndex: "company_name",
                      key: "company_name",
                      render: (value?: string | null) =>
                          value ? (
                              <Tag color="blue" style={{ borderRadius: 20, fontWeight: 600, fontSize: 11 }}>
                                  {value}
                              </Tag>
                          ) : (
                              "-"
                          ),
                  },
              ]
            : []),
        {
            title: t("hr.dashboard.dateTime"),
            dataIndex: "date",
            key: "date",
            align: "end",
            render: (text: string) => (
                <span className="tabular-nums" style={{ color: "#94a3b8", fontSize: 12.5, whiteSpace: "nowrap" }}>
                    {text}
                </span>
            ),
        },
    ];

    return (
        <Table
            dataSource={items}
            rowKey="key"
            columns={columns}
            pagination={false}
            size="small"
            scroll={{ x: "max-content" }}
        />
    );
}
