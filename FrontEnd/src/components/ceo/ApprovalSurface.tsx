import type { CSSProperties, ReactNode } from "react";

/**
 * The single white surface CEO screens put content on.
 *
 * Pages compose one surface per block instead of nesting cards, so the whole
 * area keeps one elevation level and one corner radius.
 */
export default function ApprovalSurface({
  children,
  padding = 0,
  style,
}: {
  children: ReactNode;
  padding?: number | string;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        background: "white",
        borderRadius: 16,
        border: "1px solid #eef2f7",
        boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
        padding,
        overflow: "hidden",
        ...style,
      }}
    >
      {children}
    </div>
  );
}
