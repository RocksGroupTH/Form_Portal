"use client";

import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { PageContainer } from "@/components/layout/PageContainer";
import { DashboardLayout } from "@/features/intelligence/components/DashboardLayout";
import { ProductByHour } from "@/features/intelligence/components/ProductByHour";
import { useBranches } from "@/features/intelligence/hooks/useBranches";
import { LayoutGrid } from "lucide-react";
import { getDateRange, getVsLabel } from "@/features/intelligence/constants";
import { useVsData } from "@/features/intelligence/hooks/useVsData";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function ProductByHourPage() {
  return <Suspense><ProductByHourContent /></Suspense>;
}

function ProductByHourContent() {
  const searchParams = useSearchParams();
  const [brand, setBrand] = useState(searchParams.get("brand") ?? "UNO");
  const [period, setPeriod] = useState("yesterday");
  const [branch, setBranch] = useState("");
  const [vs, setVs] = useState(true);
  const branches = useBranches(brand);

  const [from, to] = getDateRange(period, "yesterday");

  const params = new URLSearchParams({ brand, from, to });
  if (branch) params.set("branch", branch);
  const { data: apiData, isLoading } = useSWR(
    `/api/intelligence/dashboards/product-by-hour?${params}`, fetcher,
  );
  const data = apiData?.data ?? null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vsData = useVsData(vs, period, from, to, brand, "/api/intelligence/dashboards/product-by-hour", branch) as any;

  const { data: freshnessData } = useSWR<{ ok: boolean; data: Record<string, { lastDate: string | null }> }>(
    "/api/intelligence/data-freshness", fetcher,
  );

  return (
    <PageContainer className="py-6 px-3 sm:px-0" maxWidth="2k">
      <DashboardLayout
        title="Product by Hour"
        description="All product sales by hour of day"
        icon={<LayoutGrid size={18} />}
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
          <p><strong>Heatmap:</strong> Rows are products, columns are hours. Each cell shows the quantity sold. Color intensity represents the value relative to the maximum.</p>
          <p><strong>Sorting:</strong> Products are sorted by total quantity (highest first).</p>
          <p><strong>Revenue:</strong> Net revenue after discounts. Voided items and non-revenue items are excluded.</p>
          <p><strong>Totals:</strong> Row totals show per-product quantity and revenue. Column totals show per-hour quantity across all products.</p>
        </>}
      >
        <ProductByHour data={data} isLoading={isLoading} vsData={vs ? vsData : null} />
      </DashboardLayout>
    </PageContainer>
  );
}
