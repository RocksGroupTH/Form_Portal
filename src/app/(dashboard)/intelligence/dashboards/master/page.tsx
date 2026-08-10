"use client";

import { Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { BarChart3 } from "lucide-react";
import useSWR from "swr";
import Link from "next/link";
import { PageContainer } from "@/components/layout/PageContainer";
import { DashboardLayout } from "@/features/intelligence/components/DashboardLayout";
import { MasterDashboard } from "@/features/intelligence/master/components/MasterDashboard";
import { useRole } from "@/lib/hooks/useRole";
import { useBrand } from "@/components/BrandProvider";
import { getBrandFromSearchParams } from "@/lib/brand-url";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function MasterDashboardPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm" style={{ color: "var(--text-muted)" }}>Loading…</div>}>
      <Inner />
    </Suspense>
  );
}

function Inner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { brand: ctxBrand, setBrand: setCtxBrand } = useBrand();
  const brand = getBrandFromSearchParams(new URLSearchParams(searchParams.toString())) ?? ctxBrand ?? "UNO";

  const { data: readiness } = useSWR<{ ok: boolean; data: Record<string, boolean> }>(
    "/api/intelligence/dashboards/master/readiness",
    fetcher,
  );

  const isReady = readiness?.data?.[brand];
  const { isITAdmin, isSystemAdmin } = useRole();
  const isAdmin = isITAdmin || isSystemAdmin;

  const { data: freshnessData } = useSWR<{
    ok: boolean;
    data: Record<string, { lastDate: string | null }>;
  }>("/api/intelligence/data-freshness", fetcher);

  const onBrandChange = (next: string) => {
    const sp = new URLSearchParams(searchParams.toString());
    sp.set("brand", next);
    router.replace(`?${sp.toString()}`, { scroll: false });
    // Keep the cookie/context aligned immediately (URL sync layer will also enforce this).
    void setCtxBrand(next, { syncUrl: false, refresh: true });
  };

  return (
    <PageContainer className="py-4 px-3 sm:px-4" maxWidth="2k">
      <DashboardLayout
        title="Master Dashboard"
        description="Executive overview — revenue, branches, hourly trends, full-data export"
        brand={brand}
        onBrandChange={onBrandChange}
        period="custom"
        onPeriodChange={() => {}}
        hideBrandLogo
        hideFiltersRow
        freshness={freshnessData?.data}
        helpContent={
          <>
            <p><strong>Data Source:</strong> Foodstory POS (vw_Foodstory_Clean per brand)</p>
            <p><strong>Period:</strong> Multi-select ym (year-month) in RightRail. Default = last 3 months with data.</p>
            <p><strong>View Switcher:</strong> 8 views drive the main NetSales chart (Sale Channel, Sale Mode, Tender, Hourly, Category, Menu, Ticket Count, Ticket Avg).</p>
          </>
        }
      >
        {isReady === false ? (
          <EmptyState brand={brand} isAdmin={isAdmin} />
        ) : (
          <MasterDashboard brand={brand} />
        )}
      </DashboardLayout>
    </PageContainer>
  );
}

function EmptyState({ brand, isAdmin }: { brand: string; isAdmin: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-24 gap-4">
      <BarChart3 size={48} style={{ color: "var(--text-muted)" }} />
      <div>
        <h2 className="text-base font-semibold mb-1" style={{ color: "var(--text-heading)" }}>
          Dashboard ของ {brand} ยังไม่พร้อมใช้งาน
        </h2>
        <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>
          ยังไม่ได้กำหนด SQL Server / Database สำหรับแบรนด์นี้
        </p>
      </div>
      {isAdmin && (
        <Link
          href="/settings/brand-config"
          className="text-[12px] font-medium px-4 py-2 rounded-lg"
          style={{ background: "var(--nav-active-bg)", color: "var(--nav-active-text)" }}
        >
          ไปตั้งค่า Brand Configuration →
        </Link>
      )}
    </div>
  );
}
