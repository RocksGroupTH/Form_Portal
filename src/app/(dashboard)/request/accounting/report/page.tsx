"use client";

import { useSearchParams } from "next/navigation";
import { backTo } from "@/lib/request-hub-nav";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeaderBar } from "@/components/layout/PageHeaderBar";
import { AccountingReport } from "@/features/accounting/components/AccountingReport";
import { ErpEnvironmentBanner } from "@/features/accounting/components/ErpEnvironmentBanner";
import { FileSpreadsheet } from "lucide-react";

export default function AccountingReportPage() {
  const searchParams = useSearchParams();
  return (
    <PageContainer className="acc-theme py-6 px-3 sm:px-0">
      {/* Page heading */}
      <PageHeaderBar
        icon={FileSpreadsheet}
        title="รายงานเบิกค่าเดินทาง"
        subtitle="ค้นหาและส่งออกรายการเบิกค่าเดินทางทั้งหมด"
        backHref={backTo("/request/accounting", searchParams.get("from"))}
      />

      <ErpEnvironmentBanner />
      <AccountingReport />
    </PageContainer>
  );
}
