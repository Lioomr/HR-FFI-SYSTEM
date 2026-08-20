import { CheckCircleFilled, CloseCircleFilled, FileTextOutlined } from "@ant-design/icons";
import { Typography } from "antd";
import type { ReactNode } from "react";

import { formatDateTimeShort } from "../../utils/dateTime";

const { Text } = Typography;

type TranslateFn = (key: string, params?: Record<string, unknown> | string, fallback?: string) => string;

export type LoanDecisionEntry = {
    stage: string;
    actor_email?: string | null;
    at?: string | null;
    note?: string | null;
};

/** Colour and glyph for a stage, so the outcome is never colour-only. */
function markerFor(stage: string, note: string): { color: string; icon: ReactNode } {
    const stageLower = stage.toLowerCase();
    const noteLower = note.toLowerCase();

    if (stageLower.includes("submit")) return { color: "#3b82f6", icon: <FileTextOutlined aria-hidden /> };
    if (stageLower.includes("reject") || noteLower.includes("reject")) {
        return { color: "#ef4444", icon: <CloseCircleFilled aria-hidden /> };
    }
    if (stageLower.includes("cancel")) return { color: "#6b7280", icon: <CloseCircleFilled aria-hidden /> };
    if (stageLower.includes("deduct")) return { color: "#06b6d4", icon: <CheckCircleFilled aria-hidden /> };
    if (stageLower.includes("approve") || noteLower.includes("approv")) {
        return { color: "#10b981", icon: <CheckCircleFilled aria-hidden /> };
    }
    return { color: "#94a3b8", icon: <CheckCircleFilled aria-hidden /> };
}

/**
 * Decision history of a loan request, newest first.
 *
 * Extracted from the loan detail screen so the manager, HR, CFO and CEO reviews
 * all read the same trail.
 */
export default function LoanDecisionTimeline({
    entries,
    t,
}: {
    entries?: LoanDecisionEntry[] | null;
    t: TranslateFn;
}) {
    const rows = entries ?? [];

    if (rows.length === 0) {
        return (
            <Text type="secondary" style={{ fontSize: 13 }}>
                {t("loans.details.historyEmpty")}
            </Text>
        );
    }

    const stageLabel = (stage: string) => {
        const key = `loans.history.stage.${stage}`;
        const translated = t(key);
        return translated === key ? stage.replace(/_/g, " ") : translated;
    };

    return (
        <ol style={{ listStyle: "none", margin: 0, padding: 0, position: "relative" }}>
            {/* The spine stops short of the last marker so it does not dangle. */}
            <span
                aria-hidden
                style={{
                    position: "absolute",
                    insetInlineStart: 13,
                    top: 10,
                    bottom: 14,
                    width: 2,
                    background: "#e2e8f0",
                    borderRadius: 2,
                }}
            />
            {rows.map((entry, index) => {
                const note = entry.note || "";
                const marker = markerFor(entry.stage || "", note);
                return (
                    <li
                        key={`${entry.stage}-${entry.at ?? index}`}
                        style={{
                            display: "flex",
                            gap: 12,
                            marginBottom: index === rows.length - 1 ? 0 : 14,
                            position: "relative",
                        }}
                    >
                        <span
                            aria-hidden
                            style={{
                                width: 28,
                                height: 28,
                                borderRadius: "50%",
                                background: "#fff",
                                border: `2px solid ${marker.color}`,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                color: marker.color,
                                fontSize: 12,
                                flexShrink: 0,
                                zIndex: 1,
                            }}
                        >
                            {marker.icon}
                        </span>

                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div
                                style={{
                                    display: "flex",
                                    justifyContent: "space-between",
                                    gap: 8,
                                    flexWrap: "wrap",
                                    alignItems: "baseline",
                                }}
                            >
                                <Text strong style={{ fontSize: 13, color: "#0f172a" }}>
                                    {stageLabel(entry.stage || "")}
                                </Text>
                                <Text type="secondary" style={{ fontSize: 11.5, whiteSpace: "nowrap" }}>
                                    {formatDateTimeShort(entry.at, "—")}
                                </Text>
                            </div>
                            <div style={{ fontSize: 12, color: "#64748b" }}>
                                {entry.actor_email || t("loans.details.systemActor")}
                            </div>
                            {note && (
                                <div
                                    style={{
                                        marginTop: 6,
                                        padding: "6px 10px",
                                        background: "#f8fafc",
                                        borderInlineStart: "2px solid #e2e8f0",
                                        borderRadius: 6,
                                        fontSize: 12.5,
                                        color: "#475569",
                                        overflowWrap: "anywhere",
                                    }}
                                >
                                    {note}
                                </div>
                            )}
                        </div>
                    </li>
                );
            })}
        </ol>
    );
}
