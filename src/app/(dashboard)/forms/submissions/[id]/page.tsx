"use client";

import { use } from "react";
import { useSession } from "next-auth/react";
import { format } from "date-fns";
import { FileText } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeaderBar } from "@/components/layout/PageHeaderBar";
import { useSubmission } from "@/features/forms/hooks/useSubmission";
import { SubmissionDetail } from "@/features/forms/components/SubmissionDetail";
import { StatusBadge } from "@/features/forms/components/StatusBadge";
import { ApprovalTimeline } from "@/features/forms/components/ApprovalTimeline";
import { ApprovalActions } from "@/features/forms/components/ApprovalActions";

export default function SubmissionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const subId = Number(id);
  const { submission, fields, files, logs, approvals, isLoading, mutate } = useSubmission(isNaN(subId) ? null : subId);
  const { data: session } = useSession();
  const userId = session?.user?.id ? Number(session.user.id) : null;

  // Find if current user has a pending approval for this submission
  const myPendingApproval = approvals.find(
    (a) => a.assignedTo === userId && a.status === "Pending"
  );

  if (isLoading) {
    return (
      <PageContainer className="py-6 px-3 sm:px-0">
        <PageHeaderBar icon={FileText} title="Submission" backHref="/forms" />
        <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>Loading...</p>
      </PageContainer>
    );
  }

  if (!submission) {
    return (
      <PageContainer className="py-6 px-3 sm:px-0">
        <PageHeaderBar icon={FileText} title="Submission not found" backHref="/forms" />
        <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>Submission not found.</p>
      </PageContainer>
    );
  }

  const subtitle = `#${submission.id} · Submitted by ${submission.submittedByName ?? "Unknown"}${
    submission.submittedAt ? ` · ${format(new Date(submission.submittedAt), "dd MMM yyyy HH:mm")}` : ""
  }`;

  return (
    <PageContainer className="py-6 px-3 sm:px-0">
      <PageHeaderBar
        icon={FileText}
        title={submission.formName ?? "Submission"}
        subtitle={subtitle}
        backHref="/forms"
        titleExtra={<StatusBadge status={submission.status} />}
      />
      <div className="flex flex-col lg:flex-row gap-6">
        {/* Left: Form data */}
        <div className="flex-1 min-w-0">
          <SubmissionDetail
            submission={submission}
            fields={fields}
            files={files}
            logs={logs}
          />
        </div>

        {/* Right: Approval flow */}
        {approvals.length > 0 && (
          <div className="w-full lg:w-80 shrink-0">
            {/* Approval actions (if I'm the current approver) */}
            {myPendingApproval && (
              <div className="mb-4">
                <ApprovalActions
                  approvalId={myPendingApproval.id}
                  onActionComplete={() => mutate()}
                />
              </div>
            )}

            <div
              className="rounded-xl p-4"
              style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}
            >
              <ApprovalTimeline steps={approvals} />
            </div>
          </div>
        )}
      </div>
    </PageContainer>
  );
}
