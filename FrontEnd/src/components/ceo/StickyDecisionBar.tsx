import type { ReactNode } from "react";
import { Grid, Typography } from "antd";

import { useI18n } from "../../i18n/useI18n";

/**
 * Keeps a request's decision controls pinned to the bottom of the screen while
 * the reviewer scrolls through the details and approval trail.
 *
 * Render it as the last child of the page's root element: `position: sticky`
 * holds it at the viewport's bottom edge until the page reaches its natural
 * place. On phones the buttons stretch to share the full width.
 */
export default function StickyDecisionBar({
  hint,
  children,
}: {
  /**
   * Short context shown beside the buttons. Defaults to "Awaiting your
   * decision"; pass `null` to show the buttons alone.
   */
  hint?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const isMobile = !Grid.useBreakpoint().md;
  const label = hint === undefined ? t("ceo.approvals.awaitingDecision") : hint;

  return (
    <div
      role="region"
      aria-label={t("ceo.approvals.decisionBarLabel")}
      className="ffi-sticky-decision-bar"
      style={{
        position: "sticky",
        bottom: 0,
        zIndex: 40,
        marginTop: 20,
        padding: isMobile
          ? "10px 12px calc(10px + env(safe-area-inset-bottom))"
          : "12px 18px",
        display: "flex",
        flexDirection: isMobile ? "column" : "row",
        alignItems: isMobile ? "stretch" : "center",
        justifyContent: label ? "space-between" : "flex-end",
        gap: isMobile ? 8 : 16,
        background: "rgba(255, 255, 255, 0.94)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        border: "1px solid #fed7aa",
        borderRadius: isMobile ? "16px 16px 0 0" : 16,
        boxShadow: "0 -10px 28px rgba(15, 23, 42, 0.10)",
      }}
    >
      {label ? (
        <Typography.Text
          strong
          style={{ color: "#9a3412", fontSize: isMobile ? 13 : 14 }}
        >
          {label}
        </Typography.Text>
      ) : null}
      <div className="ffi-sticky-decision-bar__actions">{children}</div>
    </div>
  );
}
