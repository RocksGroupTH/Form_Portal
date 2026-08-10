"use client";

import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { PageContainer } from "@/components/layout/PageContainer";
import { DashboardLayout } from "@/features/intelligence/components/DashboardLayout";
import { HourlyProducts } from "@/features/intelligence/components/HourlyProducts";
import { useBranches } from "@/features/intelligence/hooks/useBranches";
import { Clock } from "lucide-react";
import { getDateRange, getVsLabel } from "@/features/intelligence/constants";
import { useVsData } from "@/features/intelligence/hooks/useVsData";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function HourlyProductsPage() {
  return <Suspense><HourlyProductsContent /></Suspense>;
}

function HourlyProductsContent() {
  const searchParams = useSearchParams();
  const [brand, setBrand] = useState(searchParams.get("brand") ?? "UNO");
  const [period, setPeriod] = useState("yesterday");
  const [branch, setBranch] = useState("");
  const [vs, setVs] = useState(true);
  const branches = useBranches(brand);

  const [from, to] = getDateRange(period, "yesterday");

  const params = new URLSearchParams({ brand, from, to });
  if (branch) params.set("branch", branch);
  const { data: hourlyData, isLoading } = useSWR(
    `/api/intelligence/dashboards/hourly-products?${params}`, fetcher,
  );
  const data = hourlyData?.data ?? null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vsData = useVsData(vs, period, from, to, brand, "/api/intelligence/dashboards/hourly-products", branch) as any;

  const { data: freshnessData } = useSWR<{ ok: boolean; data: Record<string, { lastDate: string | null }> }>(
    "/api/intelligence/data-freshness", fetcher,
  );

  return (
    <PageContainer className="py-6 px-3 sm:px-0" maxWidth="2k">
      <DashboardLayout
        title="Hourly Products"
        description="Revenue and top products by hour of day"
        icon={<Clock size={18} />}
        brand={brand}
        onBrandChange={setBrand}
        period={period}
        onPeriodChange={setPeriod}
        branch={branch}
        onBranchChange={setBranch}
        branches={branches}
        freshness={freshnessData?.data}
        vs={vs}
        onVsChange={setVs}
        vsLabel={vs ? getVsLabel(period) : undefined}
        helpContent={<>
          <p><strong>Data Source:</strong> Foodstory POS (FS_BillDetail)</p>
          <p><strong>Hourly Revenue:</strong> Revenue aggregated by hour of day (e.g. 07:00-07:59). Voided items and non-revenue items are excluded.</p>
          <p><strong>Top 5 per Hour:</strong> Shows the 5 best-selling products for each hour by quantity.</p>
          <p><strong>Peak Hour:</strong> The hour with the highest total revenue across the selected period.</p>
          <p><strong>Average Hourly Revenue:</strong> Total revenue divided by the number of hours that have data.</p>
        </>}
      >
        <HourlyProducts data={data} isLoading={isLoading} vsData={vs ? vsData : null} />
      </DashboardLayout>
    </PageContainer>
  );
}
