"use client";

import Link from "next/link";
import { Clock, FileText } from "lucide-react";
import { Avatar } from "@/components/ui";
import { format } from "date-fns";

interface PendingApproval {
  Id: number;
  SubmissionId: number;
  StepName: string;
  FormName: string;
  SubmitterName: string;
  SubmittedAt: string;
  DueAt: string | null;
  CreatedAt: string;
}

export function ApprovalQueue({ approvals }: { approvals: PendingApproval[] }) {
  if (approvals.length === 0) {
    return (
      <div className="rounded-xl p-8 text-center" style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}>
        <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>
          No pending approvals.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}>
      {approvals.map((ap, i) => {
        const isOverdue = ap.DueAt && new Date(ap.DueAt) < new Date();
        return (
          <Link
            key={ap.Id}
            href={`/forms/submissions/${ap.SubmissionId}`}
            className="flex items-center gap-3 px-4 py-3 no-underline transition-colors"
            style={{
              borderBottom: i < approvals.length - 1 ? "1px solid var(--border-light)" : undefined,
              color: "inherit",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-card-hover)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = ""; }}
          >
            <FileText size={16} style={{ color: "var(--text-muted)" }} className="shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-medium truncate" style={{ color: "var(--text-primary)" }}>
                {ap.FormName}
              </p>
              <div className="flex items-center gap-2 mt-0.5">
                <Avatar name={ap.SubmitterName} size={16} />
                <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                  {ap.SubmitterName} · {ap.StepName}
                </span>
              </div>
            </div>
            <div className="text-right shrink-0">
              <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                {format(new Date(ap.SubmittedAt || ap.CreatedAt), "dd MMM")}
              </p>
              {ap.DueAt && (
                <div className="flex items-center gap-1 mt-0.5">
                  <Clock size={10} style={{ color: isOverdue ? "var(--color-danger)" : "var(--text-faint)" }} />
                  <span
                    className="text-[10px] font-medium"
                    style={{ color: isOverdue ? "var(--color-danger)" : "var(--text-faint)" }}
                  >
                    {isOverdue ? "Overdue" : format(new Date(ap.DueAt), "dd MMM")}
                  </span>
                </div>
              )}
            </div>
          </Link>
        );
      })}
    </div>
  );
}
