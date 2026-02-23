import type { ReactNode } from "react";
import { ArrowUpOutlined, ArrowDownOutlined } from "@ant-design/icons";

interface StatCardProps {
    title: string;
    value: ReactNode;
    icon: ReactNode;
    /** HSL/hex color for the icon background tint */
    color: string;
    /** e.g. "+5%" or "+3.2k" — shown in green; prefix with "-" for red */
    trend?: string | null;
    onClick?: () => void;
    animDelay?: number;
}

/**
 * Reusable dashboard stat card — extracted and enhanced from HRDashboardPage.
 * Features: gradient icon, animated trend indicator, hover lift, stagger delay.
 */
export default function StatCard({
    title,
    value,
    icon,
    color,
    trend,
    onClick,
    animDelay = 0,
}: StatCardProps) {
    const isNegativeTrend = typeof trend === "string" && trend.startsWith("-");

    return (
        <div
            className="hover-lift animate-fade-in-up"
            onClick={onClick}
            style={{
                background: "white",
                borderRadius: 16,
                padding: 24,
                cursor: onClick ? "pointer" : "default",
                boxShadow: "0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)",
                animationDelay: `${animDelay}ms`,
                height: "100%",
            }}
        >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                {/* Text content */}
                <div style={{ flex: 1 }}>
                    <div
                        style={{
                            color: "#64748b",
                            fontSize: 13,
                            fontWeight: 500,
                            marginBottom: 8,
                            textTransform: "uppercase",
                            letterSpacing: "0.05em",
                        }}
                    >
                        {title}
                    </div>
                    <div
                        style={{
                            fontSize: 28,
                            fontWeight: 800,
                            color: "#0f172a",
                            letterSpacing: "-0.03em",
                            lineHeight: 1,
                            marginBottom: 10,
                        }}
                    >
                        {value}
                    </div>
                    {trend && (
                        <div
                            style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 4,
                                fontSize: 12,
                                fontWeight: 600,
                                color: isNegativeTrend ? "#ef4444" : "#10b981",
                                background: isNegativeTrend ? "#fee2e2" : "#d1fae5",
                                padding: "2px 8px",
                                borderRadius: 20,
                            }}
                        >
                            {isNegativeTrend ? <ArrowDownOutlined /> : <ArrowUpOutlined />}
                            {trend}
                        </div>
                    )}
                </div>

                {/* Icon */}
                <div
                    style={{
                        width: 52,
                        height: 52,
                        borderRadius: 14,
                        background: `linear-gradient(135deg, ${color}22, ${color}11)`,
                        border: `1px solid ${color}22`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: color,
                        fontSize: 22,
                        flexShrink: 0,
                    }}
                >
                    {icon}
                </div>
            </div>
        </div>
    );
}
