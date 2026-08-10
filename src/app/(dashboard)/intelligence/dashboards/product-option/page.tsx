"use client";

import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { PageContainer } from "@/components/layout/PageContainer";
import { DashboardLayout } from "@/features/intelligence/components/DashboardLayout";
import { ProductOptionAnalysis } from "@/features/intelligence/components/ProductOptionAnalysis";
import { useBranches } from "@/features/intelligence/hooks/useBranches";
import { Settings2 } from "lucide-react";
import { getDateRange, getVsLabel } from "@/features/intelligence/constants";
import { useVsData } from "@/features/intelligence/hooks/useVsData";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function ProductOptionPage() {
  return <Suspense><ProductOptionContent /></Suspense>;
}

function ProductOptionContent() {
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
    `/api/intelligence/dashboards/product-option?${params}`, fetcher,
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vsData = useVsData(vs, period, from, to, brand, "/api/intelligence/dashboards/product-option", branch) as any;

  const { data: freshnessData } = useSWR<{ ok: boolean; data: Record<string, { lastDate: string | null }> }>(
    "/api/intelligence/data-freshness", fetcher,
  );

  return (
    <PageContainer className="py-6 px-3 sm:px-0" maxWidth="2k">
      <DashboardLayout
        title="Product & Option Analysis"
        description="Blend, sweetness, milk preferences by product"
        icon={<Settings2 size={18} />}
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
          <p><strong>Data Source:</strong> Foodstory POS (FS_BillDetail + FS_BillDetailOption)</p>
          <p><strong>Option Groups:</strong> Customization categories (e.g. Size, Sweetness, Milk Type) and their popularity breakdown.</p>
          <p><strong>Top 30 Combos:</strong> Most popular product + option combinations ranked by quantity.</p>
          <p><strong>Option Rate:</strong> Percentage of items that have at least one option selected (items with options / total items).</p>
          <p><strong>Revenue:</strong> Net revenue after discounts. Voided items and non-revenue items are excluded.</p>
        </>}
      >
        <ProductOptionAnalysis data={apiData?.data ?? null} isLoading={isLoading} vsData={vs ? vsData : null} />
      </DashboardLayout>
    </PageContainer>
  );
}
