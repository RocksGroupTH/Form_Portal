"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { Luggage } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeaderBar } from "@/components/layout/PageHeaderBar";
import { TravelExpenseLoadingPopup } from "@/features/accounting/components/TravelExpenseLoadingPopup";
import { TravelBookingDetail } from "@/features/travel-booking/components/TravelBookingDetail";
import { TravelBookingStatusBadge } from "@/features/travel-booking/components/TravelBookingStatusBadge";
import type { TravelBookingRequest } from "@/features/travel-booking/types";
import { createTravelBookingBackAction } from "@/features/travel-booking/lib/navigation";

const LOADING_SUBTITLE = "แบบฟอร์มขอจองที่พัก/ตั๋วโดยสาร (AP-17)";

export default function TravelBookingDetailPage() {
  return (
    <Suspense fallback={<TravelExpenseLoadingPopup label="กำลังโหลดคำขอ..." subtitle={LOADING_SUBTITLE} />}>
      <TravelBookingDetailContent />
    </Suspense>
  );
}

function TravelBookingDetailContent() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const rawId = params?.id;
  const requestId = rawId ? Number(String(rawId)) : null;
  const returnPath = searchParams.get("from") || undefined;
  // Detail page's "back" defaults to the AP-17 entry page (not the Accounting hub) per the brief.
  const handleBack = useCallback(
    () => createTravelBookingBackAction(router, returnPath, "/request/travel-booking")(),
    [router, returnPath],
  );

  const [request, setRequest] = useState<TravelBookingRequest | null>(null);
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
    setNotFound(false);

    fetch(`/api/request/travel-booking/requests/${requestId}`)
      .then((r) => r.json())
      .then((json: { ok: boolean; data?: TravelBookingRequest }) => {
        if (cancelled) return;
        if (json.ok && json.data) {
          setRequest(json.data);
        } else {
          setNotFound(true);
        }
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

  useEffect(() => {
    const cleanup = fetchRequest();
    return cleanup;
  }, [fetchRequest]);

  if (loading) {
    return <TravelExpenseLoadingPopup label="กำลังโหลดคำขอ..." subtitle={LOADING_SUBTITLE} />;
  }

  if (notFound || !request) {
    return (
      <PageContainer className="acc-theme py-6 px-3 sm:px-0">
        <PageHeaderBar
          icon={Luggage}
          title="ไม่พบคำขอ"
          subtitle="รายการนี้อาจถูกลบหรือคุณไม่มีสิทธิ์เข้าถึง"
          onBack={handleBack}
          backLabel="กลับ"
        />
        <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>
          ไม่พบคำขอนี้
        </p>
      </PageContainer>
    );
  }

  return (
    <PageContainer className="acc-theme py-6 px-3 sm:px-0">
      <PageHeaderBar
        icon={Luggage}
        title={request.requestNo ?? "ฉบับร่าง"}
        subtitle="แบบฟอร์มขอจองที่พัก/ตั๋วโดยสาร (ทำงานต่างจังหวัด)"
        onBack={handleBack}
        backLabel="กลับ"
        titleExtra={
          <>
            <TravelBookingStatusBadge status={request.status} />
            <span
              className="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0"
              style={{ background: "var(--bg-badge)", color: "var(--text-muted)", border: "1px solid var(--border-light)" }}
            >
              AP-17
            </span>
          </>
        }
      />

      {/* Deliberately not `readOnlyBooking`, the same call the queue's SidePanel makes.
          A roster member reaching a request here by link is the same operator they are
          two clicks away in the queue, and the panel's own routes —
          admin/requests/[id]/booking and /complete — already authorize with
          `canAccessBookingArea`. Making this page read-only would hide work the server
          grants, which is the epic's complaint pointed the other way. The panel stays
          gated inside the component on `canAccount` + ManagerApproved, so an owner or
          manager opening the same URL still gets the read-only summary. */}
      <TravelBookingDetail request={request} onChanged={fetchRequest} />
    </PageContainer>
  );
}
