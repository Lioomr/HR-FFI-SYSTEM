import type { ReactNode } from "react";

export type QuickFilterOption = {
  key: string;
  label: string;
  icon: ReactNode;
  /** Matches the `attendance-metric--*` tones on the records tab. */
  tone:
    | "neutral"
    | "positive"
    | "informational"
    | "warning"
    | "severe"
    | "critical"
    | "pending";
  active: boolean;
  onSelect: () => void;
};

/** One-click filter pills shared by the HR violation and notice tabs. */
export default function AttendanceQuickFilters({
  label,
  options,
}: {
  label: string;
  options: QuickFilterOption[];
}) {
  return (
    <div className="attendance-quick" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          className={`attendance-chip attendance-chip--${option.tone}`}
          aria-pressed={option.active}
          onClick={option.onSelect}
        >
          <span className="attendance-chip__icon" aria-hidden="true">
            {option.icon}
          </span>
          {option.label}
        </button>
      ))}
    </div>
  );
}
