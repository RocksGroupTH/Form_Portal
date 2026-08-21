"use client";

import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeaderBar } from "@/components/layout/PageHeaderBar";
import { ClrDetailReport } from "@/features/clear-advance/components/report/ClrDetailReport";
import { clearAdvanceBackHref } from "@/features/clear-advance/lib/navigation";
import { ReceiptText } from "lucide-react";

/** AP-3-Detail — line-level report for Approved (complete) clearings only. */
export default function ClearAdvanceDetailReportPage() {
  return (
    <PageContainer className="acc-theme py-6 px-3 sm:px-0" maxWidth="2k">
      <PageHeaderBar
        icon={ReceiptText}
        title="รายงานรายบรรทัด (Detail)"
        subtitle="AP-3-Detail · เฉพาะที่อนุมัติครบ"
        backHref={clearAdvanceBackHref()}
      />
      <ClrDetailReport />
    </PageContainer>
  );
}
