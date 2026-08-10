"use client";

import { Check, X, Clock, ArrowLeft, SkipForward } from "lucide-react";
import { Avatar } from "@/components/ui";
import { format } from "date-fns";

interface ApprovalStep {
  id: number;
  stepName: string;
  stepOrder: number;
  assignedToName?: string | null;
  status: string;
  comment?: string | null;
  actionAt?: string | null;
  createdAt: string;
}

const STATUS_ICON: Record<string, { Icon: React.ComponentType<{ size?: number; className?: string }>; color: string }> = {
  Pending:  { Icon: Clock, color: "var(--color-warning)" },
  Approved: { Icon: Check, color: "var(--color-success)" },
  Rejected: { Icon: X, color: "var(--color-danger)" },
  Returned: { Icon: ArrowLeft, color: "var(--color-warning)" },
  Skipped:  { Icon: SkipForward, color: "var(--text-muted)" },
};

export function ApprovalTimeline({ steps }: { steps: ApprovalStep[] }) {
  if (steps.length === 0) return null;

  return (
    <div>
      <h2 className="text-[14px] font-bold mb-3" style={{ color: "var(--text-heading)" }}>
        Approval Flow
      </h2>
      <div className="flex flex-col gap-0">
        {steps.map((step, i) => {
          const { Icon, color } = STATUS_ICON[step.status] ?? STATUS_ICON.Pending;
          const isLast = i === steps.length - 1;

          return (
            <div key={step.id} className="flex gap-3">
              {/* Timeline line + icon */}
              <div className="flex flex-col items-center">
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
                  style={{ background: `${color}18`, border: `2px solid ${color}` }}
                >
                  <span style={{ color }}><Icon size={14} /></span>
                </div>
                {!isLast && (
                  <div className="w-0.5 flex-1 min-h-6" style={{ background: "var(--border-main)" }} />
                )}
              </div>

              {/* Content */}
              <div className="pb-4 min-w-0">
                <p className="text-[13px] font-medium" style={{ color: "var(--text-primary)" }}>
                  {step.stepName}
                </p>
                <div className="flex items-center gap-2 mt-0.5">
                  {step.assignedToName && (
                    <div className="flex items-center gap-1">
                      <Avatar name={step.assignedToName} size={16} />
                      <span className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
                        {step.assignedToName}
                      </span>
                    </div>
                  )}
                  <span
                    className="text-[11px] font-medium px-1.5 py-0.5 rounded"
                    style={{ color, background: `${color}12` }}
                  >
                    {step.status}
                  </span>
                </div>
                {step.comment && (
                  <p className="text-[12px] mt-1" style={{ color: "var(--text-secondary)" }}>
                    &ldquo;{step.comment}&rdquo;
                  </p>
                )}
                {step.actionAt && (
                  <p className="text-[10px] mt-0.5" style={{ color: "var(--text-faint)" }}>
                    {format(new Date(step.actionAt), "dd MMM yyyy HH:mm")}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
