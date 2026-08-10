"use client";

interface ReportEmptyStateProps {
  branch?: string;
  from: string;
  to: string;
}

export function ReportEmptyState({ branch, from, to }: ReportEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3">
      <span className="text-[32px]">📭</span>
      <p className="text-[14px] font-medium" style={{ color: "var(--text-heading)" }}>
        No data found
      </p>
      <p className="text-[12px] text-center max-w-xs" style={{ color: "var(--text-muted)" }}>
        {branch ? `No results for selected branch` : "No results"} from{" "}
        <span style={{ color: "var(--text-primary)" }}>{from}</span> to{" "}
        <span style={{ color: "var(--text-primary)" }}>{to}</span>.
        Try adjusting your date range or filters.
      </p>
    </div>
  );
}
