"use client";

import { useState, Suspense, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { PageContainer } from "@/components/layout/PageContainer";
import { DashboardLayout } from "@/features/intelligence/components/DashboardLayout";
import { DailySalesDashboard } from "@/features/intelligence/components/DailySalesDashboard";
import { useBranches } from "@/features/intelligence/hooks/useBranches";
import { useVsData } from "@/features/intelligence/hooks/useVsData";
import { TrendingUp } from "lucide-react";
import { getDateRange, getVsLabel } from "@/features/intelligence/constants";
import { dailySalesInsights } from "@/features/intelligence/codex-insight";
import type { DailySalesData } from "@/features/intelligence/types";
import { buildDailySalesInsightPayload } from "@/features/intelligence/insight-payload";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function DailySalesPage() {
  return <Suspense><DailySalesContent /></Suspense>;
}

function DailySalesContent() {
  const searchParams = useSearchParams();
  const [brand, setBrand] = useState(searchParams.get("brand") ?? "UNO");
  const [period, setPeriod] = useState(() => new Date().getDate() === 1 ? "lmth" : "mtd");
  const [branch, setBranch] = useState("");
  const [vs, setVs] = useState(true);
  const branches = useBranches(brand);

  const [from, to] = getDateRange(period);

  const params = new URLSearchParams({ brand, from, to });
  if (branch) params.set("branch", branch);
  const { data: salesData, isLoading } = useSWR<{ ok: boolean; data: DailySalesData }>(
    `/api/intelligence/dashboards/daily-sales?${params}`, fetcher,
  );
  const data = salesData?.data ?? null;

  const vsData = useVsData(vs, period, from, to, brand, "/api/intelligence/dashboards/daily-sales", branch) as DailySalesData | null;

  const { data: holidayData } = useSWR<{ ok: boolean; data: { date: string; name: string }[] }>(
    `/api/intelligence/holidays?year=${new Date().getFullYear()}`, fetcher,
  );
  const holidays = holidayData?.data ?? [];

  const { data: freshnessData } = useSWR<{ ok: boolean; data: Record<string, { lastDate: string | null }> }>(
    "/api/intelligence/data-freshness", fetcher,
  );

  const codexInsights = useMemo(
    () => data ? dailySalesInsights(data, vsData, holidays) : null,
    [data, vsData, holidays],
  );

  const insightData = useMemo(
    () => data ? buildDailySalesInsightPayload(data, vsData, holidays, from, to) : null,
    [data, vsData, holidays, from, to],
  );

  return (
    <PageContainer className="py-6 px-3 sm:px-0" maxWidth="2k">
      <DashboardLayout
        title="Daily Sales Pulse"
        description="Revenue trends, bill count, and average ticket size"
        icon={<TrendingUp size={18} />}
        brand={brand}
        onBrandChange={setBrand}
        freshness={freshnessData?.data}
        period={period}
        onPeriodChange={setPeriod}
        branch={branch}
        onBranchChange={setBranch}
        branches={branches}
        vs={vs}
        onVsChange={setVs}
        vsLabel={vs ? getVsLabel(period) : undefined}
        codexInsights={codexInsights}
        insightData={insightData}
        helpContent={<>
          <p><strong>Data Source:</strong> Foodstory POS (FS_BillDetail)</p>
          <p><strong>Revenue:</strong> Net revenue after discounts (discounted_price). Voided items and non-revenue items are excluded.</p>
          <p><strong>Channel:</strong> Revenue is split by sales channel (Dine-In, Takeaway/Storefront) based on menu group.</p>
          <p><strong>Average Ticket:</strong> Total revenue divided by total number of bills (transactions).</p>
          <p><strong>Average Daily Revenue:</strong> Total revenue divided by the number of days in the selected period.</p>
        </>}
      >
        <DailySalesDashboard data={data} isLoading={isLoading} holidays={holidays} vsData={vs ? vsData : null} codexInsights={codexInsights} />
      </DashboardLayout>
    </PageContainer>
  );
}
