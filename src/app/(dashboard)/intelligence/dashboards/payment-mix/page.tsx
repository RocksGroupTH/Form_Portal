"use client";

import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { PageContainer } from "@/components/layout/PageContainer";
import { DashboardLayout } from "@/features/intelligence/components/DashboardLayout";
import { PaymentMix } from "@/features/intelligence/components/PaymentMix";
import { useBranches } from "@/features/intelligence/hooks/useBranches";
import { Wallet } from "lucide-react";
import { getDateRange, getVsLabel } from "@/features/intelligence/constants";
import { useVsData } from "@/features/intelligence/hooks/useVsData";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function PaymentMixPage() {
  return <Suspense><PaymentMixContent /></Suspense>;
}

function PaymentMixContent() {
  const searchParams = useSearchParams();
  const [brand, setBrand] = useState(searchParams.get("brand") ?? "UNO");
  const [period, setPeriod] = useState(() => new Date().getDate() === 1 ? "lmth" : "mtd");
  const [branch, setBranch] = useState("");
  const [vs, setVs] = useState(true);
  const branches = useBranches(brand);

  const [from, to] = getDateRange(period);

  const params = new URLSearchParams({ brand, from, to });
  if (branch) params.set("branch", branch);
  const { data: mixData, isLoading } = useSWR<{ ok: boolean; data: import("@/features/intelligence/types").PaymentMixData }>(
    `/api/intelligence/dashboards/payment-mix?${params}`, fetcher,
  );
  const data = mixData?.data ?? null;

  const vsData = useVsData(vs, period, from, to, brand, "/api/intelligence/dashboards/payment-mix", branch) as import("@/features/intelligence/types").PaymentMixData | null;

  const { data: freshnessData } = useSWR<{ ok: boolean; data: Record<string, { lastDate: string | null }> }>(
    "/api/intelligence/data-freshness", fetcher,
  );

  return (
    <PageContainer className="py-6 px-3 sm:px-0" maxWidth="2k">
      <DashboardLayout
        title="Payment Mix"
        description="Cash vs digital payments, method breakdown, and adoption trends"
        icon={<Wallet size={18} />}
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
        helpContent={<>
          <p><strong>Data Source:</strong> Foodstory POS (FS_BillDetail, payment_type field)</p>
          <p><strong>Revenue:</strong> Net revenue after discounts. Voided items and non-revenue items are excluded.</p>
          <p><strong>Tender Groups:</strong> Raw payment types are normalized into groups (Cash, Credit Card, QR Code, PromptPay, Grab Pay, LINE Pay, TrueMoney, etc.).</p>
          <p><strong>Cash vs Digital:</strong> Digital Revenue = Total Revenue - Cash Revenue. The percentage shows each side{"'"}s share.</p>
          <p><strong>Daily Trend:</strong> Stacked area chart showing how each payment method{"'"}s revenue changes over time.</p>
        </>}
      >
        <PaymentMix data={data} isLoading={isLoading} vsData={vs ? vsData : null} />
      </DashboardLayout>
    </PageContainer>
  );
}
