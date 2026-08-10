"use client";

import { Suspense, useEffect, useState, useCallback } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeaderBar } from "@/components/layout/PageHeaderBar";
import { RequestDetail } from "@/features/accounting/components/RequestDetail";
import { TravelExpenseLoadingPopup } from "@/features/accounting/components/TravelExpenseLoadingPopup";
import { FileText } from "lucide-react";
import type { AccRequest } from "@/features/accounting/types";
import { statusLabelDisplay } from "@/features/accounting/constants";
import { createTravelBackAction } from "@/features/accounting/lib/navigation";

/* ── Status badge for the heading ── */

function HeadingStatusBadge({ status }: { status: string }) {
  const label = statusLabelDisplay(status);
  return (
    <span
      className="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0"
      style={{
        background: "var(--nav-active-bg)",
        color: "var(--nav-active-text)",
      }}
    >
      {label}
    </span>
  );
}

export default function TravelExpenseDetailPage() {
  return (
    <Suspense fallback={<TravelExpenseLoadingPopup label="กำลังโหลดคำขอ..." />}>
      <TravelExpenseDetailContent />
    </Suspense>
  );
}

function TravelExpenseDetailContent() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const rawId = params?.id;
  const requestId = rawId ? Number(String(rawId)) : null;
  const returnPath = searchParams.get("from") || undefined;
  const handleBack = useCallback(
    () => createTravelBackAction(router, returnPath)(),
    [router, returnPath],
  );

  const [request, setRequest] = useState<AccRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const fetchRequest = useCallback(() => {
    if (requestId == null || isNaN(requestId)) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setNotFound(false);

    fetch(`/api/request/accounting/requests/${requestId}`)
      .then((r) => r.json())
      .then((json: { ok: boolean; data?: AccRequest }) => {
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
    return <TravelExpenseLoadingPopup label="กำลังโหลดคำขอ..." />;
  }

  if (notFound || !request) {
    return (
      <PageContainer className="acc-theme py-6 px-3 sm:px-0">
        <PageHeaderBar
          icon={FileText}
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
      {/* Full-width — header + detail both span the page like the Request hub */}
      <PageHeaderBar
        icon={FileText}
        title={request.requestNo ?? "ฉบับร่าง"}
        subtitle="แบบฟอร์มเบิกค่าเดินทาง (ออฟฟิต)"
        onBack={handleBack}
        backLabel="กลับ"
        titleExtra={
          <>
            <HeadingStatusBadge status={request.status} />
            <span
              className="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0"
              style={{
                background: "var(--bg-badge)",
                color: "var(--text-muted)",
                border: "1px solid var(--border-light)",
              }}
            >
              AP-1
            </span>
          </>
        }
      />

      <RequestDetail
        request={request}
        onChanged={fetchRequest}
        stickyTopClassName="top-14 md:top-12"
      />
    </PageContainer>
  );
}
