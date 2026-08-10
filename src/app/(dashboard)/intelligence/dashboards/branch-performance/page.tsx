"use client";

import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { PageContainer } from "@/components/layout/PageContainer";
import { DashboardLayout } from "@/features/intelligence/components/DashboardLayout";
import { BranchPerformance } from "@/features/intelligence/components/BranchPerformance";
import { useBranches } from "@/features/intelligence/hooks/useBranches";
import { Building2 } from "lucide-react";
import { getDateRange, getVsLabel } from "@/features/intelligence/constants";
import { useVsData } from "@/features/intelligence/hooks/useVsData";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function BranchPerformancePage() {
  return <Suspense><BranchPerformanceContent /></Suspense>;
}

function BranchPerformanceContent() {
  const searchParams = useSearchParams();
  const [brand, setBrand] = useState(searchParams.get("brand") ?? "UNO");
  const [period, setPeriod] = useState(() => new Date().getDate() === 1 ? "lmth" : "mtd");
  const [vs, setVs] = useState(true);

  const [from, to] = getDateRange(period);

  const params = new URLSearchParams({ brand, from, to });
  const { data: perfData, isLoading } = useSWR<{ ok: boolean; data: import("@/features/intelligence/types").BranchData }>(
    `/api/intelligence/dashboards/branch-performance?${params}`, fetcher,
  );
  const data = perfData?.data ?? null;

  const vsData = useVsData(vs, period, from, to, brand, "/api/intelligence/dashboards/branch-performance") as import("@/features/intelligence/types").BranchData | null;

  const { data: freshnessData } = useSWR<{ ok: boolean; data: Record<string, { lastDate: string | null }> }>(
    "/api/intelligence/data-freshness", fetcher,
  );

  return (
    <PageContainer className="py-6 px-3 sm:px-0" maxWidth="2k">
      <DashboardLayout
        title="Branch Performance"
        description="Revenue ranking and comparison across all branches"
        icon={<Building2 size={18} />}
        brand={brand}
        onBrandChange={setBrand}
        period={period}
        onPeriodChange={setPeriod}
        freshness={freshnessData?.data}
        vs={vs}
        onVsChange={setVs}
        vsLabel={vs ? getVsLabel(period) : undefined}
        helpContent={<>
          <p><strong>Data Source:</strong> Foodstory POS (FS_BillDetail + FS_MasterBranch)</p>
          <p><strong>Revenue:</strong> Net revenue after discounts per branch. Voided items and non-revenue items are excluded.</p>
          <p><strong>Ranking:</strong> Branches are ranked by total revenue in descending order.</p>
          <p><strong>Average Ticket:</strong> Total revenue divided by total number of bills per branch.</p>
          <p><strong>Note:</strong> All branches are shown (no branch filter). Branch names are de-duplicated from master data.</p>
        </>}
      >
        <BranchPerformance data={data} isLoading={isLoading} vsData={vs ? vsData : null} />
      </DashboardLayout>
    </PageContainer>
  );
}
