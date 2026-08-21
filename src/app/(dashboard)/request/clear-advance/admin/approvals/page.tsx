"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { ClipboardCheck } from "lucide-react";
import { backTo } from "@/lib/request-hub-nav";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeaderBar } from "@/components/layout/PageHeaderBar";
import { ClrApprovalsQueue } from "@/features/clear-advance/components/admin/ClrApprovalsQueue";
import { AdminCard } from "@/features/clear-advance/components/admin/shared";

function ApprovalsContent() {
  const from = useSearchParams().get("from");
  return (
    <PageContainer className="acc-theme py-6 px-3 sm:px-0">
      <PageHeaderBar
        icon={ClipboardCheck}
        title="รออนุมัติ AP-3"
        subtitle="คำขอเคลียร์เงินทดรองที่รออนุมัติ — เปิดรายการเพื่ออนุมัติ/ปฏิเสธ"
        backHref={backTo("/request/clear-advance/admin", from)}
      />
      <AdminCard className="p-5">
        <ClrApprovalsQueue from={from} />
      </AdminCard>
    </PageContainer>
  );
}

export default function ClearAdvanceApprovalsPage() {
  return (
    <Suspense
      fallback={
        <PageContainer className="acc-theme py-6 px-3 sm:px-0">
          <div className="flex items-center justify-center py-20">
            <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>
              กำลังโหลด...
            </p>
          </div>
        </PageContainer>
      }
    >
      <ApprovalsContent />
    </Suspense>
  );
}
