"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Gift } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeaderBar } from "@/components/layout/PageHeaderBar";
import { TravelExpenseLoadingPopup } from "@/features/accounting/components/TravelExpenseLoadingPopup";
import { RewardForm } from "@/features/reward/components/RewardForm";
import type { RewardRequest } from "@/features/reward/types";
import { safeReplace } from "@/lib/safe-router";

const SUBTITLE = "แบบฟอร์มแลกของรางวัล (AP-11)";

export default function RewardPage() {
  return (
    <Suspense
      fallback={<TravelExpenseLoadingPopup label="กำลังเตรียมแบบฟอร์ม..." subtitle={SUBTITLE} />}
    >
      <RewardPageContent />
    </Suspense>
  );
}

/**
 * The AP-11 form.
 *
 * `?id=` resumes one request; without it the page starts a blank draft. There
 * is no draft picker — arriving with no id always begins something new, and an
 * earlier unfinished draft is reachable only by its own URL. AP-1 and AP-17
 * offer theirs on arrival; AP-11 deliberately does not.
 */
function RewardPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const idParam = searchParams.get("id");
  const requestId = idParam ? Number(idParam) : null;

  const [initial, setInitial] = useState<RewardRequest | null>(null);
  const [loading, setLoading] = useState(requestId != null);
  const [notFound, setNotFound] = useState(false);
  /**
   * Submitted, and on the way out.
   *
   * `safeReplace` defers the navigation through `startTransition` +
   * `queueMicrotask`, so without this the form paints at least one more frame
   * holding a request that is no longer a draft. The flag swaps it for the
   * loading screen on the same tick the submit resolves, so the last thing the
   * requester sees of the form is the moment they pressed the button.
   */
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (requestId == null || Number.isNaN(requestId)) return;

    let cancelled = false;
    setLoading(true);
    fetch(`/api/request/reward/requests/${requestId}`)
      .then((r) => r.json())
      .then((json: { ok: boolean; data?: RewardRequest }) => {
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

  // Put the new draft's id in the URL, so a reload resumes it rather than
  // starting a second one.
  const handleSaved = useCallback(
    (id: number) => {
      if (!requestId) safeReplace(router, `/request/reward?id=${id}`);
    },
    [requestId, router],
  );

  /**
   * Where a submitted request leaves you.
   *
   * `/my-request`, not the request's own page. AP-1 and AP-17 both land on the
   * detail page, but AP-11's detail page is also its approval page — the action
   * row lives there — so a requester who is their own manager (which every UAT
   * tester is, deliberately) went straight from pressing "ส่งคำขอ" to being
   * offered "อนุมัติ". AP-17 already sends people here when a submit produces
   * more than one request, so the destination is not a new idea in this app.
   *
   * `replace`, not `push`: the entry it would leave behind is
   * `/request/reward?id=…` for a request that is no longer a draft, so Back
   * would reopen an editable form over a submitted request.
   *
   * `brand` is carried so BrandGate does not have to re-resolve it from the
   * cookie on arrival.
   */
  const handleSubmitted = useCallback(() => {
    setLeaving(true);
    const brand = searchParams.get("brand");
    safeReplace(router, brand ? `/my-request?brand=${encodeURIComponent(brand)}` : "/my-request");
  }, [router, searchParams]);

  if (leaving) {
    return <TravelExpenseLoadingPopup label="ส่งคำขอแล้ว — กำลังไปที่คำขอของฉัน..." subtitle={SUBTITLE} />;
  }

  if (loading) {
    return <TravelExpenseLoadingPopup label="กำลังโหลดฉบับร่าง..." subtitle={SUBTITLE} />;
  }

  if (notFound) {
    return (
      <PageContainer className="acc-theme py-6 px-3 sm:px-0">
        <PageHeaderBar
          icon={Gift}
          title="ไม่พบคำขอ"
          subtitle="รายการนี้อาจถูกลบหรือคุณไม่มีสิทธิ์เข้าถึง"
          backHref="/"
          backLabel="กลับ"
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer className="acc-theme py-6 px-3 sm:px-0">
      <PageHeaderBar
        icon={Gift}
        title="แลกของรางวัล"
        subtitle="AP-11 · สำหรับทีม OP"
        backHref="/"
        backLabel="กลับ"
      />
      <RewardForm initial={initial} onSaved={handleSaved} onSubmitted={handleSubmitted} />
    </PageContainer>
  );
}
