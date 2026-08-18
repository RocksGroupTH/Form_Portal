"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeaderBar } from "@/components/layout/PageHeaderBar";
import { AdvanceForm } from "@/features/advance/components/AdvanceForm";
import { TravelExpenseLoadingPopup } from "@/features/accounting/components/TravelExpenseLoadingPopup";
import { Wallet } from "lucide-react";
import type { AdvanceRequest } from "@/features/advance/types";

export default function AdvancePage() {
  return (
    <Suspense fallback={<TravelExpenseLoadingPopup label="กำลังเตรียมแบบฟอร์ม..." subtitle="แบบฟอร์มขอเบิกเงินทดรองจ่าย (AP-2)" />}>
      <AdvanceContent />
    </Suspense>
  );
}

function AdvanceContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const idParam = searchParams.get("id");
  const requestId = idParam ? Number(idParam) : null;

  const [initial, setInitial] = useState<AdvanceRequest | null>(null);
  const [loading, setLoading] = useState(requestId !== null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (requestId === null) return;
    let cancelled = false;
    setLoading(true);
    setNotFound(false);
    fetch(`/api/request/advance/requests/${requestId}`)
      .then((r) => r.json())
      .then((json: { ok: boolean; data?: AdvanceRequest }) => {
        if (cancelled) return;
        if (json.ok && json.data) setInitial(json.data);
        else setNotFound(true);
      })
      .catch(() => {
        if (!cancelled) setNotFound(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [requestId]);

  function handleSaved(id: number) {
    if (!requestId) router.replace(`/request/advance?id=${id}`);
  }
  function handleSubmitted(id: number) {
    router.push(`/request/advance/${id}`);
  }

  return (
    <PageContainer className="acc-theme py-6 px-3 sm:px-0">
      <PageHeaderBar
        icon={Wallet}
        title="ขอเบิกเงินทดรองจ่าย (Advance)"
        subtitle="AP-2 · กรอกข้อมูลให้ครบถ้วนก่อนส่งคำขอ"
        onBack={() => router.back()}
        backLabel="กลับ"
      />
      {loading ? (
        <TravelExpenseLoadingPopup label="กำลังโหลดแบบร่าง..." subtitle="แบบฟอร์มขอเบิกเงินทดรองจ่าย (AP-2)" />
      ) : notFound ? (
        <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>ไม่พบคำขอนี้</p>
      ) : (
        <AdvanceForm initial={initial} onSaved={handleSaved} onSubmitted={handleSubmitted} />
      )}
    </PageContainer>
  );
}
