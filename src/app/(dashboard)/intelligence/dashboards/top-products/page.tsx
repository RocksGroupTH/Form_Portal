"use client";

import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { PageContainer } from "@/components/layout/PageContainer";
import { DashboardLayout } from "@/features/intelligence/components/DashboardLayout";
import { TopProducts } from "@/features/intelligence/components/TopProducts";
import { useBranches } from "@/features/intelligence/hooks/useBranches";
import { Coffee } from "lucide-react";
import { getDateRange, getVsLabel } from "@/features/intelligence/constants";
import { useVsData } from "@/features/intelligence/hooks/useVsData";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function TopProductsPage() {
  return <Suspense><TopProductsContent /></Suspense>;
}

function TopProductsContent() {
  const searchParams = useSearchParams();
  const [brand, setBrand] = useState(searchParams.get("brand") ?? "UNO");
  const [period, setPeriod] = useState(() => new Date().getDate() === 1 ? "lmth" : "mtd");
  const [branch, setBranch] = useState("");
  const [vs, setVs] = useState(true);
  const branches = useBranches(brand);

  const [from, to] = getDateRange(period);

  const params = new URLSearchParams({ brand, from, to });
  if (branch) params.set("branch", branch);
  const { data: prodData, isLoading } = useSWR<{ ok: boolean; data: import("@/features/intelligence/types").TopProductsData }>(
    `/api/intelligence/dashboards/top-products?${params}`, fetcher,
  );
  const data = prodData?.data ?? null;

  const vsData = useVsData(vs, period, from, to, brand, "/api/intelligence/dashboards/top-products", branch) as import("@/features/intelligence/types").TopProductsData | null;

  const { data: freshnessData } = useSWR<{ ok: boolean; data: Record<string, { lastDate: string | null }> }>(
    "/api/intelligence/data-freshness", fetcher,
  );

  return (
    <PageContainer className="py-6 px-3 sm:px-0" maxWidth="2k">
      <DashboardLayout
        title="Top Products"
        description="Best sellers, category mix, and product analytics"
        icon={<Coffee size={18} />}
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
          <p><strong>Top 50:</strong> Shows the top 50 products ranked by revenue. Category totals cover all products (not just top 50).</p>
          <p><strong>Revenue:</strong> Net revenue after discounts. Voided items and non-revenue items are excluded.</p>
          <p><strong>Average Price:</strong> Total revenue divided by total quantity sold for each product.</p>
          <p><strong>Category Mix:</strong> Revenue breakdown by product category, shown as pie chart and table.</p>
        </>}
      >
        <TopProducts data={data} isLoading={isLoading} vsData={vs ? vsData : null} />
      </DashboardLayout>
    </PageContainer>
  );
}
