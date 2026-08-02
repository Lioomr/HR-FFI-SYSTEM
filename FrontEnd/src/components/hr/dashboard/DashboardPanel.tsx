import { useId } from "react";
import type { ReactNode } from "react";

interface DashboardPanelProps {
    title: string;
    /** Rendered right after the heading, e.g. a count badge */
    titleSuffix?: ReactNode;
    /** One short line explaining what the panel shows */
    description?: string;
    /** Link or button aligned to the end of the header row */
    action?: ReactNode;
    bodyPadding?: number | string;
    animDelay?: number;
    children: ReactNode;
}

/**
 * Card chrome shared by every HR dashboard panel: a labelled <section> with a
 * consistent header, so headings stay in one visual rhythm and screen readers
 * get a real landmark per block.
 */
export default function DashboardPanel({
    title,
    titleSuffix,
    description,
    action,
    bodyPadding = 16,
    animDelay = 0,
    children,
}: DashboardPanelProps) {
    const headingId = useId();

    return (
        <section
            aria-labelledby={headingId}
            className="animate-fade-in-up"
            style={{
                background: "white",
                borderRadius: 16,
                border: "1px solid #eef2f7",
                boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
                animationDelay: `${animDelay}ms`,
                display: "flex",
                flexDirection: "column",
                height: "100%",
                overflow: "hidden",
            }}
        >
            <div
                style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 12,
                    flexWrap: "wrap",
                    padding: "14px 18px",
                    borderBottom: "1px solid #f1f5f9",
                }}
            >
                <div style={{ minWidth: 0 }}>
                    <h2
                        id={headingId}
                        style={{
                            margin: 0,
                            fontWeight: 700,
                            fontSize: 15,
                            color: "#0f172a",
                            letterSpacing: "-0.01em",
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            flexWrap: "wrap",
                        }}
                    >
                        {title}
                        {titleSuffix}
                    </h2>
                    {description && (
                        <p style={{ margin: "2px 0 0", fontSize: 12.5, color: "#94a3b8" }}>{description}</p>
                    )}
                </div>
                {action}
            </div>

            <div style={{ padding: bodyPadding, flex: 1, minWidth: 0 }}>{children}</div>
        </section>
    );
}
