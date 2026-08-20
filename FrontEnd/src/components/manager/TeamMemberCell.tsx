import { Avatar } from "antd";
import { UserOutlined } from "@ant-design/icons";

/** First letter of the name, or an icon when there is nothing to show. */
function initial(name?: string) {
    const trimmed = (name || "").trim();
    return trimmed ? trimmed.charAt(0).toUpperCase() : null;
}

/**
 * The employee cell shared by every manager table.
 *
 * One person is always presented the same way — initial, name, then a quieter
 * secondary line — so leave, loan, attendance and asset queues scan alike.
 */
export default function TeamMemberCell({
    name,
    secondary,
    size = 34,
}: {
    name?: string;
    /** Email, employee number or any single supporting detail. */
    secondary?: string;
    size?: number;
}) {
    const letter = initial(name);

    return (
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <Avatar
                size={size}
                aria-hidden
                icon={letter ? undefined : <UserOutlined />}
                style={{
                    background: "#fff2e8",
                    color: "#c2410c",
                    fontWeight: 700,
                    flexShrink: 0,
                }}
            >
                {letter}
            </Avatar>
            <div style={{ minWidth: 0 }}>
                <div
                    style={{
                        fontWeight: 600,
                        color: "#0f172a",
                        lineHeight: 1.3,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                    }}
                >
                    {name || "—"}
                </div>
                {secondary && (
                    <div
                        style={{
                            fontSize: 12,
                            color: "#64748b",
                            lineHeight: 1.3,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                        }}
                    >
                        {secondary}
                    </div>
                )}
            </div>
        </div>
    );
}
