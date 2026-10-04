import AmountWithSAR from "../../../components/ui/AmountWithSAR";

/** Currency amount, or "—" when there is no deduction (null or zero). */
export default function PenaltyAmount({
  value,
  size = 14,
  fontWeight,
}: {
  value: string | number | null | undefined;
  /** Riyal symbol size in px; the number inherits the surrounding font size. */
  size?: number;
  fontWeight?: number;
}) {
  if (value == null || value === "" || !Number(value)) return <>—</>;
  return (
    <AmountWithSAR
      amount={value}
      size={size}
      color="currentColor"
      fontWeight={fontWeight}
      style={{ fontVariantNumeric: "tabular-nums" }}
    />
  );
}
