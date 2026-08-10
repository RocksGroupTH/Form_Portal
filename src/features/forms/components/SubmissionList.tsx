"use client";

import Link from "next/link";
import { StatusBadge } from "./StatusBadge";
import type { OfficeFormSubmission } from "../types";
import { format } from "date-fns";

interface SubmissionListProps {
  submissions: OfficeFormSubmission[];
  showFormName?: boolean;
}

export function SubmissionList({ submissions, showFormName = true }: SubmissionListProps) {
  if (submissions.length === 0) {
    return (
      <div className="rounded-xl p-8 text-center" style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}>
        <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>No submissions yet.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}>
      {submissions.map((sub, i) => (
        <Link
          key={sub.id}
          href={`/forms/submissions/${sub.id}`}
          className="flex items-center gap-3 px-4 py-3 no-underline transition-colors"
          style={{
            borderBottom: i < submissions.length - 1 ? "1px solid var(--border-light)" : undefined,
            color: "inherit",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-card-hover)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = ""; }}
        >
          <div className="flex-1 min-w-0">
            {showFormName && (
              <p className="text-[13px] font-medium truncate" style={{ color: "var(--text-primary)" }}>
                {sub.formName ?? `Form #${sub.formId}`}
              </p>
            )}
            <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
              #{sub.id}
              {sub.submittedByName && ` · ${sub.submittedByName}`}
              {sub.submittedAt && ` · ${format(new Date(sub.submittedAt), "dd MMM yyyy HH:mm")}`}
            </p>
          </div>
          <StatusBadge status={sub.status} small />
        </Link>
      ))}
    </div>
  );
}
