"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { FileText, Pencil } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeaderBar } from "@/components/layout/PageHeaderBar";
import { TravelExpenseLoadingPopup } from "@/features/accounting/components/TravelExpenseLoadingPopup";
import { statusLabelDisplay } from "@/features/accounting/constants";
import { createTravelBackAction } from "@/features/accounting/lib/navigation";
import { ReimburseDetail } from "@/features/reimburse/components/ReimburseDetail";
import type { ReimburseDetail as ReimburseDetailData } from "@/features/reimburse/types";

/**
 * AP-4 detail — the request, its attachments, its approval timeline and the
 * approve / reject bar for whoever the pending step belongs to.
 *
 * The page owns the fetch, so `ReimburseDetail` gets an `onChanged` that re-runs
 * it: an approval moves the step, and the action bar it just used describes a
 * step that is over.
 *
 * The other action here is the edit link, shown only while the request is still
 * editable — a `Returned` request re-opens in the form and keeps its number.
 */

const LOADING_SUBTITLE = "ขอเบิกเงินคืนพนักงาน (AP-4)";

export default function ReimburseDetailPage() {
  return (
    <Suspense fallback={<TravelExpenseLoadingPopup label="กำลังโหลดคำขอ..." subtitle={LOADING_SUBTITLE} />}>
      <ReimburseDetailContent />
    </Suspense>
  );
}

function ReimburseDetailContent() {
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

  const [request, setRequest] = useState<ReimburseDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  // Bumped by `onChanged` to re-run the fetch below after an approval or a
  // rejection, rather than duplicating the request-loading logic.
  const [reloadKey, setReloadKey] = useState(0);
  const handleChanged = useCallback(() => setReloadKey((n) => n + 1), []);

  useEffect(() => {
    if (requestId == null || Number.isNaN(requestId)) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setNotFound(false);

    fetch(`/api/request/reimburse/requests/${requestId}`)
      .then((r) => r.json())
      .then((json: { ok: boolean; data?: ReimburseDetailData }) => {
        if (cancelled) return;
        if (json.ok && json.data) setRequest(json.data);
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
  }, [requestId, reloadKey]);

  if (loading) {
    return <TravelExpenseLoadingPopup label="กำลังโหลดคำขอ..." subtitle={LOADING_SUBTITLE} />;
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

  const editable = request.status === "Draft" || request.status === "Returned";
  const editHref = `/request/reimburse?id=${request.id}${returnPath ? `&from=${encodeURIComponent(returnPath)}` : ""}`;

  return (
    <PageContainer className="acc-theme py-6 px-3 sm:px-0">
      <PageHeaderBar
        icon={FileText}
        title={request.requestNo ?? "ฉบับร่าง"}
        subtitle="ขอเบิกเงินคืนพนักงาน (Staff Reimbursement)"
        onBack={handleBack}
        backLabel="กลับ"
        titleExtra={
          <>
            <span
              className="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0"
              style={{ background: "var(--nav-active-bg)", color: "var(--nav-active-text)" }}
            >
              {statusLabelDisplay(request.status)}
            </span>
            <span
              className="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0"
              style={{
                background: "var(--bg-badge)",
                color: "var(--text-muted)",
                border: "1px solid var(--border-light)",
              }}
            >
              AP-4
            </span>
          </>
        }
        right={
          editable ? (
            <Link
              href={editHref}
              className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12.5px] font-semibold no-underline"
              style={{
                background: "var(--bg-card-alt)",
                border: "1px solid var(--border-card)",
                color: "var(--nav-active-text)",
              }}
            >
              <Pencil size={13} /> แก้ไขคำขอ
            </Link>
          ) : undefined
        }
      />

      <ReimburseDetail request={request} onChanged={handleChanged} />
    </PageContainer>
  );
}
