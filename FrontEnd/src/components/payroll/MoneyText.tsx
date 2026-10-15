import { Tag, Tooltip } from "antd";
import { SARIcon } from "../../utils/currency";
import { useI18n } from "../../i18n/useI18n";
import {
  formatExactShare,
  formatMoney,
  isExactShareTruncated,
} from "../../utils/payrollMoney";
import type { ExactShare, Money } from "../../services/api/payrollTypes";

/**
 * Payroll money as sent by the API. A null amount means unknown/incomplete and
 * renders an explicit "Unknown" tag, never 0. No arithmetic happens here.
 */
export function MoneyText({
  amount,
  strong,
  size = 13,
}: {
  amount: Money | null | undefined;
  strong?: boolean;
  size?: number;
}) {
  const { t } = useI18n();
  const formatted = formatMoney(amount);
  if (formatted === null) {
    return (
      <Tag color="gold" style={{ marginInlineEnd: 0 }}>
        {t("payroll.ui.unknown")}
      </Tag>
    );
  }
  return (
    <bdi
      dir="ltr"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        whiteSpace: "nowrap",
        fontWeight: strong ? 600 : undefined,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {formatted}
      <span style={{ color: "var(--payroll-muted, inherit)" }}>
        <SARIcon size={size} color="currentColor" />
      </span>
    </bdi>
  );
}

/**
 * ExactShare display: its decimal approximation, always labelled approximate.
 * The full decimal is in the tooltip; numerator/denominator stay authoritative.
 */
export function ExactShareText({
  share,
}: {
  share: ExactShare | null | undefined;
}) {
  const { t } = useI18n();
  const formatted = formatExactShare(share);
  if (!share || formatted === null) {
    return <Tag color="gold">{t("payroll.ui.unknown")}</Tag>;
  }
  const approximate = isExactShareTruncated(share);
  return (
    <Tooltip
      title={t("payroll.ui.exactShareTooltip", {
        decimal: share.decimal,
        numerator: share.numerator,
        denominator: share.denominator,
      })}
    >
      <bdi
        dir="ltr"
        style={{ whiteSpace: "nowrap" }}
        aria-label={
          approximate
            ? t("payroll.ui.approximateValue", { value: formatted })
            : undefined
        }
      >
        {approximate ? "≈ " : ""}
        {formatted}
      </bdi>
    </Tooltip>
  );
}

export default MoneyText;
