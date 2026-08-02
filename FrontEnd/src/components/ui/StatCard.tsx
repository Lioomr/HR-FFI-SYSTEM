import type { CSSProperties, ReactNode } from "react";
import { ArrowUpOutlined, ArrowDownOutlined } from "@ant-design/icons";

export type StatCardNoteTone = "warning" | "info";

/** Icon + text, so a status is never communicated by colour alone. */
export interface StatCardNote {
    label: string;
    icon?: ReactNode;
    tone?: StatCardNoteTone;
}

interface StatCardProps {
    title: string;
    value: ReactNode;
    icon: ReactNode;
    /** Hex color for the icon tint */
    color: string;
    /** Factual supporting line under the value, e.g. "128 active" or "Next 30 days" */
    caption?: ReactNode;
    /** e.g. "+5%" or "-3.2%" — prefix with "-" for a decrease */
    trend?: string | null;
    /** What the trend is measured against, so the number carries units */
    trendLabel?: string;
    note?: StatCardNote;
    onClick?: () => void;
    /** Sentence read by screen readers; falls back to the visible title */
    ariaLabel?: string;
    /** Tighter paddings and type scale for narrow viewports */
    compact?: boolean;
    animDelay?: number;
}

const NOTE_TONES: Record<StatCardNoteTone, { color: string; background: string; border: string }> = {
    // Both pairs clear 4.5:1 against their background.
    warning: { color: "#92400e", background: "#fef3c7", border: "#fcd34d" },
    info: { color: "#3730a3", background: "#e0e7ff", border: "#c7d2fe" },
};

/**
 * Dashboard stat card. Renders as a real <button> when clickable so it is
 * reachable by keyboard and announced as an action.
 */
export default function StatCard({
    title,
    value,
    icon,
    color,
    caption,
    trend,
    trendLabel,
    note,
    onClick,
    ariaLabel,
    compact = false,
    animDelay = 0,
}: StatCardProps) {
    const isNegativeTrend = typeof trend === "string" && trend.startsWith("-");
    const trendColors = isNegativeTrend
        ? { color: "#b91c1c", background: "#fee2e2" }
        : { color: "#047857", background: "#d1fae5" };
    const noteTone = NOTE_TONES[note?.tone ?? "info"];

    const containerStyle: CSSProperties = {
        background: "white",
        borderRadius: 16,
        padding: compact ? 16 : 22,
        boxShadow: "0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)",
        animationDelay: `${animDelay}ms`,
        height: "100%",
        width: "100%",
        // Explicit column flex: a <button> would otherwise centre its content
        // vertically, so shorter cards in a row would not align with taller ones.
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        justifyContent: "flex-start",
        textAlign: "start",
        border: "1px solid #eef2f7",
        font: "inherit",
        color: "inherit",
    };

    // Spans (not divs) so the markup stays valid when the card renders as a <button>.
    const content = (
        <span style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
            <span style={{ display: "block", flex: 1, minWidth: 0 }}>
                <span
                    style={{
                        display: "block",
                        color: "#64748b",
                        fontSize: 12,
                        fontWeight: 600,
                        marginBottom: 8,
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                        // Two lines are reserved so values stay on one baseline
                        // across a row, whatever the label length or language.
                        minHeight: compact ? undefined : 34,
                    }}
                >
                    {title}
                </span>
                <span
                    className="tabular-nums"
                    style={{
                        display: "block",
                        fontSize: compact ? 24 : 28,
                        fontWeight: 800,
                        color: "#0f172a",
                        letterSpacing: "-0.03em",
                        lineHeight: 1.1,
                        overflowWrap: "anywhere",
                    }}
                >
                    {value}
                </span>

                {caption && (
                    <span style={{ display: "block", marginTop: 6, fontSize: 12.5, color: "#64748b", lineHeight: 1.35 }}>
                        {caption}
                    </span>
                )}

                {(trend || note) && (
                    <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 10 }}>
                        {trend && (
                            <span
                                className="tabular-nums"
                                style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 4,
                                    fontSize: 12,
                                    fontWeight: 700,
                                    color: trendColors.color,
                                    background: trendColors.background,
                                    padding: "2px 8px",
                                    borderRadius: 20,
                                }}
                            >
                                {isNegativeTrend ? <ArrowDownOutlined aria-hidden /> : <ArrowUpOutlined aria-hidden />}
                                {trend}
                            </span>
                        )}
                        {trend && trendLabel && (
                            <span style={{ fontSize: 12, color: "#94a3b8" }}>{trendLabel}</span>
                        )}
                        {note && (
                            <span
                                style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 5,
                                    fontSize: 12,
                                    fontWeight: 600,
                                    color: noteTone.color,
                                    background: noteTone.background,
                                    border: `1px solid ${noteTone.border}`,
                                    padding: "1px 8px",
                                    borderRadius: 20,
                                    whiteSpace: "nowrap",
                                }}
                            >
                                {note.icon}
                                {note.label}
                            </span>
                        )}
                    </span>
                )}
            </span>

            <span
                aria-hidden
                style={{
                    width: compact ? 42 : 48,
                    height: compact ? 42 : 48,
                    borderRadius: 12,
                    background: `${color}1a`,
                    border: `1px solid ${color}33`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color,
                    fontSize: compact ? 18 : 20,
                    flexShrink: 0,
                }}
            >
                {icon}
            </span>
        </span>
    );

    if (onClick) {
        return (
            <button
                type="button"
                className="hover-lift animate-fade-in-up press-scale focus-ring"
                onClick={onClick}
                aria-label={ariaLabel || title}
                style={{ ...containerStyle, cursor: "pointer" }}
            >
                {content}
            </button>
        );
    }

    return (
        <div className="animate-fade-in-up" style={containerStyle}>
            {content}
        </div>
    );
}
