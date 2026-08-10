"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { MasterDashboard } from "@/features/intelligence/master/components/MasterDashboard";

export default function MasterPrintPage() {
  return (
    <Suspense fallback={<div className="p-6">Loading…</div>}>
      <Inner />
    </Suspense>
  );
}

function Inner() {
  const searchParams = useSearchParams();
  const brand = searchParams.get("brand") ?? "UNO";
  return (
    <div className="p-6">
      <MasterDashboard brand={brand} />
    </div>
  );
}
