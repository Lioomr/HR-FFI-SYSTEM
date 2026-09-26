import type { CSSProperties, ReactNode } from "react";
import { Spin } from "antd";

import "./Workspace.css";

/**
 * Shared list-page building blocks (request inboxes, queues): quick filter
 * chips above one card that holds the toolbar, a results heading with a count,
 * and the table. Same visual language as the attendance and employees pages.
 */

export type ChipTone =
  | "neutral"
  | "positive"
  | "informational"
  | "warning"
  | "severe"
  | "critical"
  | "pending";

export type FilterChipOption = {
  key: string;
  label: ReactNode;
  icon?: ReactNode;
  /** Colour family; `accentColor` overrides it with any CSS colour. */
  tone?: ChipTone;
  accentColor?: string;
  count?: number;
  active: boolean;
  onSelect: () => void;
};

export function FilterChips({
  label,
  options,
  extra,
}: {
  /** Accessible name of the chip group. */
  label: string;
  options: FilterChipOption[];
  /** Controls placed after the chips (e.g. a window picker). */
  extra?: ReactNode;
}) {
  return (
    <div className="ffi-chips" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          className={`ffi-chip ffi-chip--${option.tone ?? "neutral"}`}
          style={
            option.accentColor
              ? ({
                  "--chip-accent": option.accentColor,
                  "--chip-soft": `color-mix(in srgb, ${option.accentColor} 10%, #fff)`,
                } as CSSProperties)
              : undefined
          }
          aria-pressed={option.active}
          onClick={option.onSelect}
        >
          {option.icon ? (
            <span className="ffi-chip__icon" aria-hidden="true">
              {option.icon}
            </span>
          ) : (
            <span className="ffi-chip__dot" aria-hidden="true" />
          )}
          {option.label}
          {option.count !== undefined && (
            <span className="ffi-chip__count">{option.count}</span>
          )}
        </button>
      ))}
      {extra}
    </div>
  );
}

/** Row above the workspace card: chips on one side, view switches on the other. */
export function WorkspaceViews({ children }: { children: ReactNode }) {
  return <div className="ffi-views">{children}</div>;
}

export function WorkspaceCard({
  toolbar,
  title,
  count,
  busy = false,
  headingExtra,
  children,
  className,
}: {
  /** Filters row (search first, then selects, then reset / tools). */
  toolbar?: ReactNode;
  title: ReactNode;
  /** Short count text such as "12 requests". */
  count?: ReactNode;
  /** Shows a small spinner next to the count while a refetch runs. */
  busy?: boolean;
  headingExtra?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`ffi-workspace${className ? ` ${className}` : ""}`}>
      {toolbar ? <div className="ffi-toolbar">{toolbar}</div> : null}
      <div className="ffi-results__heading">
        <span className="ffi-results__title">{title}</span>
        <span className="ffi-results__side">
          {headingExtra}
          {count !== undefined && (
            <span className="ffi-results__count">
              {busy && <Spin size="small" />}
              {count}
            </span>
          )}
        </span>
      </div>
      <div className="ffi-table">{children}</div>
    </section>
  );
}
