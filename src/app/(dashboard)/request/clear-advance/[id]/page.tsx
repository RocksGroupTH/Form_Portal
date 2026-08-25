"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ReceiptText } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeaderBar } from "@/components/layout/PageHeaderBar";
import { Button } from "@/components/ui/Button";
import { ClearAdvanceDetail } from "@/features/clear-advance/components/ClearAdvanceDetail";
import { TravelExpenseLoadingPopup } from "@/features/accounting/components/TravelExpenseLoadingPopup";
import { statusLabelDisplay } from "@/features/accounting/constants";
import { clearAdvanceFormHref } from "@/features/clear-advance/lib/navigation";
import type { ClearAdvanceRequest } from "@/features/clear-advance/types";

export default function ClearAdvanceDetailPage() {
  return (
    <Suspense fallback={null}>
      <ClearAdvanceDetailContent />
    </Suspense>
  );
}

function ClearAdvanceDetailContent() {
  const params = useParams();
  const router = useRouter();
  const requestId = params?.id ? Number(String(params.id)) : null;

  const [request, setRequest] = useState<ClearAdvanceRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const fetchRequest = useCallback(() => {
    if (requestId == null || Number.isNaN(requestId)) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch(`/api/request/clear-advance/requests/${requestId}`)
      .then((r) => r.json())
      .then((json: { ok: boolean; data?: ClearAdvanceRequest }) => {
        if (cancelled) return;
        if (json.ok && json.data) setRequest(json.data);
        else setNotFound(true);
      })
      .catch(() => { if (!cancelled) setNotFound(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [requestId]);

  useEffect(() => fetchRequest(), [fetchRequest]);

  if (loading) {
    return <TravelExpenseLoadingPopup label="กำลังโหลดคำขอ..." subtitle="แบบฟอร์มเคลียร์คืนเงินทดรองจ่าย (AP-3)" />;
  }
  if (notFound || !request) {
    return (
      <PageContainer className="acc-theme py-6 px-3 sm:px-0">
        <PageHeaderBar icon={ReceiptText} title="ไม่พบคำขอ" subtitle="รายการนี้อาจถูกลบหรือคุณไม่มีสิทธิ์เข้าถึง"
          onBack={() => router.back()} backLabel="กลับ" />
      </PageContainer>
    );
  }

  const isEditable = request.status === "Draft" || request.status === "Returned";

  return (
    <PageContainer className="acc-theme py-6 px-3 sm:px-0 flex flex-col gap-4">
      <PageHeaderBar
        icon={ReceiptText}
        title={request.requestNo ?? "ฉบับร่าง"}
        subtitle="แบบฟอร์มเคลียร์คืนเงินทดรองจ่าย (AP-3)"
        onBack={() => router.back()}
        backLabel="กลับ"
        titleExtra={
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0"
            style={{ background: "var(--nav-active-bg)", color: "var(--nav-active-text)" }}>
            {statusLabelDisplay(request.status)}
          </span>
        }
      />

      {isEditable && (
        <div className="flex justify-end">
          <Button variant="secondary" onClick={() => router.push(clearAdvanceFormHref(request.id))}>
            แก้ไขแบบร่าง
          </Button>
        </div>
      )}

      <ClearAdvanceDetail request={request} onChanged={fetchRequest} />
    </PageContainer>
  );
}
