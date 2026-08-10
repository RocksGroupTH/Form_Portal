import type { CSSProperties, ReactNode } from "react";

/**
 * Card container for a page header row (surface + border + soft shadow), matching
 * PageHeaderBar's card. Use it to wrap dense/custom header rows (reports,
 * dashboards) that keep their own inline content (title, KPIs, filters).
 * Pass flex/gap/margin via `className`.
 */
export function PageHeaderCard({
  children,
  className = "",
  style,
  dataTour,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  dataTour?: string;
}) {
  return (
    <div
      data-tour={dataTour}
      className={`rounded-2xl px-4 py-3 min-w-0 ${className}`}
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border-card)",
        boxShadow: "var(--shadow-sm)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}
