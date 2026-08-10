"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { Luggage } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeaderBar } from "@/components/layout/PageHeaderBar";
import { TravelExpenseLoadingPopup } from "@/features/accounting/components/TravelExpenseLoadingPopup";
import { TravelBookingForm } from "@/features/travel-booking/components/TravelBookingForm";
import { TravelBookingDraftPicker } from "@/features/travel-booking/components/TravelBookingDraftPicker";
import type { TravelBookingDraftSummary, TravelBookingGroup } from "@/features/travel-booking/types";
import {
  createTravelBookingBackAction,
  travelBookingAfterSubmitHref,
  travelBookingFormHref,
  travelBookingNewHref,
} from "@/features/travel-booking/lib/navigation";
import { safeBack, safePush, safeReplace } from "@/lib/safe-router";

export default function TravelBookingPage() {
  return (
    <Suspense fallback={<TravelExpenseLoadingPopup label="กำลังเตรียมแบบฟอร์ม..." subtitle="แบบฟอร์มขอจองที่พัก/ตั๋วโดยสาร (AP-17)" />}>
      <TravelBookingContent />
    </Suspense>
  );
}

function TravelBookingContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const groupKeyParam = searchParams.get("groupKey");
  const skipPicker = searchParams.get("new") === "1";
  const returnPath = searchParams.get("from") || undefined;
  const handleBack = useCallback(() => createTravelBookingBackAction(router, returnPath)(), [router, returnPath]);

  const [initial, setInitial] = useState<TravelBookingGroup | null>(null);
  const [loading, setLoading] = useState(groupKeyParam !== null);
  const [notFound, setNotFound] = useState(false);

  const [checkingDrafts, setCheckingDrafts] = useState(groupKeyParam === null && !skipPicker);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [drafts, setDrafts] = useState<TravelBookingDraftSummary[]>([]);
  const [readyForForm, setReadyForForm] = useState(groupKeyParam !== null || skipPicker);

  useEffect(() => {
    if (groupKeyParam !== null || skipPicker) {
      setCheckingDrafts(false);
      setReadyForForm(true);
      return;
    }

    let cancelled = false;
    setCheckingDrafts(true);

    fetch("/api/request/travel-booking/requests/drafts")
      .then((r) => r.json())
      .then((json: { ok: boolean; data?: TravelBookingDraftSummary[] }) => {
        if (cancelled) return;
        const list = json.ok && json.data ? json.data : [];
        setDrafts(list);
        if (list.length > 0) setPickerOpen(true);
        else setReadyForForm(true);
      })
      .catch(() => { if (!cancelled) setReadyForForm(true); })
      .finally(() => { if (!cancelled) setCheckingDrafts(false); });

    return () => { cancelled = true; };
  }, [groupKeyParam, skipPicker]);

  useEffect(() => {
    if (groupKeyParam === null) return;

    let cancelled = false;
    setLoading(true);
    setNotFound(false);

    fetch(`/api/request/travel-booking/requests/group/${encodeURIComponent(groupKeyParam)}`)
      .then((r) => r.json())
      .then((json: { ok: boolean; data?: TravelBookingGroup }) => {
        if (cancelled) return;
        if (json.ok && json.data && json.data.requests.length > 0) {
          setInitial(json.data);
        } else {
          setNotFound(true);
        }
      })
      .catch(() => { if (!cancelled) setNotFound(true); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [groupKeyParam]);

  function handlePickDraft(groupKey: string) {
    setPickerOpen(false);
    safeReplace(router, travelBookingFormHref(groupKey, returnPath));
  }

  function handleNew() {
    setPickerOpen(false);
    setReadyForForm(true);
    safeReplace(router, travelBookingNewHref(returnPath));
  }

  function handlePickerDismiss() {
    safeBack(router);
  }

  /** Draft summaries only carry a GroupKey — resolve one request id to call the delete endpoint. */
  async function handleDeleteDraft(groupKey: string) {
    const groupRes = await fetch(`/api/request/travel-booking/requests/group/${encodeURIComponent(groupKey)}`);
    const groupJson = (await groupRes.json()) as { ok: boolean; data?: TravelBookingGroup };
    const anchorId = groupJson.ok ? groupJson.data?.requests[0]?.id : undefined;
    if (!anchorId) {
      toast.error("ลบแบบร่างไม่สำเร็จ");
      throw new Error("no anchor request id");
    }
    const res = await fetch(`/api/request/travel-booking/requests/${anchorId}`, { method: "DELETE" });
    const json = (await res.json()) as { ok: boolean; error?: string };
    if (!json.ok) {
      toast.error(json.error ?? "ลบแบบร่างไม่สำเร็จ");
      throw new Error(json.error ?? "delete failed");
    }
    toast.success("ลบแบบร่างแล้ว");
    const next = drafts.filter((d) => d.groupKey !== groupKey);
    setDrafts(next);
    if (next.length === 0) {
      setPickerOpen(false);
      setReadyForForm(true);
      safeReplace(router, travelBookingNewHref(returnPath));
    }
  }

  /** After saving a new draft group, update the URL so subsequent saves target the same group. */
  function handleSaved(groupKey: string) {
    if (!groupKeyParam) {
      safeReplace(router, travelBookingFormHref(groupKey, returnPath));
    }
  }

  /**
   * After submitting: a single trip lands on its detail page
   * (`/request/travel-booking/{firstRequestId}`). Two or more trips can't all fit on one detail
   * page, so land on "คำขอของฉัน" (My Request) where every submitted trip is listed. Falls back to
   * the old `travelBookingAfterSubmitHref` behavior if the submit response had no request id.
   */
  function handleSubmitted(count: number, firstRequestId: number | null) {
    if (count >= 2) {
      safePush(router, "/my-request");
      return;
    }
    if (firstRequestId != null) {
      safePush(router, `/request/travel-booking/${firstRequestId}`);
      return;
    }
    safePush(router, travelBookingAfterSubmitHref(returnPath));
  }

  if (checkingDrafts) {
    return <TravelExpenseLoadingPopup label="กำลังตรวจสอบแบบร่าง..." subtitle="แบบฟอร์มขอจองที่พัก/ตั๋วโดยสาร (AP-17)" />;
  }

  if (pickerOpen) {
    return (
      <TravelBookingDraftPicker
        open
        drafts={drafts}
        onPickDraft={handlePickDraft}
        onNew={handleNew}
        onDismiss={handlePickerDismiss}
        onDeleteDraft={handleDeleteDraft}
      />
    );
  }

  if (!readyForForm) return null;

  if (loading) {
    return <TravelExpenseLoadingPopup label="กำลังโหลดแบบร่าง..." subtitle="แบบฟอร์มขอจองที่พัก/ตั๋วโดยสาร (AP-17)" />;
  }

  if (notFound) {
    return (
      <PageContainer className="acc-theme py-6 px-3 sm:px-0">
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
        title="แบบฟอร์มขอจองที่พัก/ตั๋วโดยสาร"
        subtitle="AP-17 · ทำงานต่างจังหวัด · กรอกได้หลายคำขอในครั้งเดียว"
        onBack={handleBack}
        backLabel="กลับ"
      />

      <TravelBookingForm initial={initial} onSaved={handleSaved} onSubmitted={handleSubmitted} />
    </PageContainer>
  );
}
