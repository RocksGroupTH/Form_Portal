"use client";

import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeaderBar } from "@/components/layout/PageHeaderBar";
import { ApprovalQueue } from "@/features/forms/components/ApprovalQueue";
import { useMyApprovals } from "@/features/forms/hooks/useApprovals";
import { CheckSquare } from "lucide-react";

export default function ApprovalsPage() {
  const { approvals, isLoading } = useMyApprovals();

  return (
    <PageContainer className="py-6 px-3 sm:px-0">
      <PageHeaderBar
        icon={CheckSquare}
        title="My Approvals"
        subtitle="Pending items that need your review"
      />

      {isLoading ? (
        <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>Loading...</p>
      ) : (
        <ApprovalQueue approvals={approvals as never[]} />
      )}
    </PageContainer>
  );
}
