"use client";

import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeaderBar } from "@/components/layout/PageHeaderBar";
import { ClrControlReport } from "@/features/clear-advance/components/report/ClrControlReport";
import { clearAdvanceBackHref } from "@/features/clear-advance/lib/navigation";
import { FileSpreadsheet } from "lucide-react";

/** AP-3-Control — one row per AP-3 clearing, linked to its AP-2 advance. */
export default function ClearAdvanceControlReportPage() {
  return (
    <PageContainer className="acc-theme py-6 px-3 sm:px-0" maxWidth="2k">
      <PageHeaderBar
        icon={FileSpreadsheet}
        title="รายงานเคลียร์เงินทดรองจ่าย (Control)"
        subtitle="AP-3-Control · เชื่อมกับ AP-2"
        backHref={clearAdvanceBackHref()}
      />
      <ClrControlReport />
    </PageContainer>
  );
}
