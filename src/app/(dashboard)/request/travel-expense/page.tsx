"use client";

import { Suspense, useState, useEffect, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeaderBar } from "@/components/layout/PageHeaderBar";
import { TravelExpenseForm } from "@/features/accounting/components/TravelExpenseForm";
import { TravelExpenseTour } from "@/features/accounting/components/tour/TravelExpenseTour";
import { TravelDraftPickerDialog } from "@/features/accounting/components/TravelDraftPickerDialog";
import { TravelExpenseLoadingPopup } from "@/features/accounting/components/TravelExpenseLoadingPopup";
import { FileText } from "lucide-react";
import { toast } from "sonner";
// Pure and import-free, which is what makes it safe in a client component — and
// sharing it is the point: the server refuses a mutate on any other status, so
// a second list here would drift into offering an edit the API then rejects.
import { EDITABLE_STATUSES } from "@/lib/acc/request-acl-policy";
import type { AccRequest, TravelDraftSummary } from "@/features/accounting/types";
import {
  createTravelBackAction,
  travelExpenseDetailHref,
  travelExpenseFormHref,
  travelExpenseNewHref,
} from "@/features/accounting/lib/navigation";
import { safeBack, safePush, safeReplace } from "@/lib/safe-router";

/* ── Default export: wraps inner component in Suspense (required for useSearchParams) ── */

export default function TravelExpensePage() {
  return (
    <Suspense fallback={<TravelExpenseLoadingPopup label="กำลังเตรียมแบบฟอร์ม..." />}>
      <TravelExpenseContent />
    </Suspense>
  );
}

/* ── Inner client component that reads search params ── */

function TravelExpenseContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const idParam = searchParams.get("id");
  const skipPicker = searchParams.get("new") === "1";
  const requestId = idParam ? Number(idParam) : null;
  const returnPath = searchParams.get("from") || undefined;
  const handleBack = useCallback(
    () => createTravelBackAction(router, returnPath)(),
    [router, returnPath],
  );

  const [initial, setInitial] = useState<AccRequest | null>(null);
  const [loading, setLoading] = useState(requestId !== null);
  const [notFound, setNotFound] = useState(false);

  const [checkingDrafts, setCheckingDrafts] = useState(requestId === null && !skipPicker);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [drafts, setDrafts] = useState<TravelDraftSummary[]>([]);
  const [readyForForm, setReadyForForm] = useState(requestId !== null || skipPicker);

  // Picker shown when Save is blocked by a travel-date that already exists in another draft.
  const [dupPickerOpen, setDupPickerOpen] = useState(false);
  const [dupDrafts, setDupDrafts] = useState<TravelDraftSummary[]>([]);

  useEffect(() => {
    if (requestId !== null || skipPicker) {
      setCheckingDrafts(false);
      setReadyForForm(true);
      return;
    }

    let cancelled = false;
    setCheckingDrafts(true);

    fetch("/api/request/accounting/requests/drafts")
      .then((r) => r.json())
      .then((json: { ok: boolean; data?: TravelDraftSummary[] }) => {
        if (cancelled) return;
        const list = json.ok && json.data ? json.data : [];
        setDrafts(list);
        if (list.length > 0) {
          setPickerOpen(true);
        } else {
          setReadyForForm(true);
        }
      })
      .catch(() => {
        if (!cancelled) setReadyForForm(true);
      })
      .finally(() => {
        if (!cancelled) setCheckingDrafts(false);
      });

    return () => {
      cancelled = true;
    };
  }, [requestId, skipPicker]);

  useEffect(() => {
    if (requestId === null) return;

    let cancelled = false;
    setLoading(true);
    setNotFound(false);

    fetch(`/api/request/accounting/requests/${requestId}`)
      .then((r) => r.json())
      .then((json: { ok: boolean; data?: AccRequest }) => {
        if (cancelled) return;
        if (json.ok && json.data) {
          // A request that is not a Draft or Returned cannot be changed —
          // `decideRequestMutate` refuses every save, submit and attachment on
          // it. This page had no status check at all, so a Submitted, Approved
          // or Rejected request opened as a fully editable form with a working
          // attach button, and every write came back 403 "แก้ไขได้เฉพาะคำขอที่
          // เป็นฉบับร่างของคุณเท่านั้น". Reported as "แนบไฟล์ไม่สำเร็จ" on a
          // rejected claim, which is exactly what it looks like from the form.
          //
          // The detail page is where a finished request belongs, and it is
          // reachable, so send them there rather than showing an inert form.
          if (!EDITABLE_STATUSES.includes(json.data.status)) {
            toast.info("คำขอนี้ไม่ได้อยู่ในสถานะที่แก้ไขได้ — เปิดหน้ารายละเอียดให้แทน");
            router.replace(`/request/travel-expense/${requestId}`);
            return;
          }
          setInitial(json.data);
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
  }, [requestId, router]);

  function handlePickDraft(id: number) {
    setPickerOpen(false);
    safeReplace(router, travelExpenseFormHref(id, returnPath));
  }

  function handleNew() {
    setPickerOpen(false);
    setReadyForForm(true);
    safeReplace(router, travelExpenseNewHref(returnPath));
  }

  function handlePickerDismiss() {
    safeBack(router);
  }

  /* Delete a draft; refresh the list and fall through to a fresh form if none remain */
  async function handleDeleteDraft(id: number) {
    const res = await fetch(`/api/request/accounting/requests/${id}`, { method: "DELETE" });
    const json = (await res.json()) as { ok: boolean; error?: string };
    if (!json.ok) {
      toast.error(json.error ?? "ลบแบบร่างไม่สำเร็จ");
      throw new Error(json.error ?? "delete failed");
    }
    toast.success("ลบแบบร่างแล้ว");
    const next = drafts.filter((d) => d.id !== id);
    setDrafts(next);
    if (next.length === 0) {
      setPickerOpen(false);
      setReadyForForm(true);
      safeReplace(router, travelExpenseNewHref(returnPath));
    }
  }

  /* After saving a new draft, update the URL so subsequent saves update the same record */
  function handleSaved(id: number) {
    if (!requestId) {
      safeReplace(router, travelExpenseFormHref(id, returnPath));
    }
  }

  /* After submitting, navigate to the detail page */
  function handleSubmitted(id: number) {
    const from = searchParams.get("from");
    safePush(router, travelExpenseDetailHref(id, returnPath));
  }

  /* Save blocked: the travel date already exists in another draft — offer those drafts. */
  function handleDuplicateDraftDate(list: TravelDraftSummary[]) {
    setDupDrafts(list);
    setDupPickerOpen(true);
  }

  async function handleDupDelete(id: number) {
    const res = await fetch(`/api/request/accounting/requests/${id}`, { method: "DELETE" });
    const json = (await res.json()) as { ok: boolean; error?: string };
    if (!json.ok) {
      toast.error(json.error ?? "ลบแบบร่างไม่สำเร็จ");
      throw new Error(json.error ?? "delete failed");
    }
    toast.success("ลบแบบร่างแล้ว");
    const next = dupDrafts.filter((d) => d.id !== id);
    setDupDrafts(next);
    if (next.length === 0) setDupPickerOpen(false);
  }

  if (checkingDrafts) {
    return <TravelExpenseLoadingPopup label="กำลังตรวจสอบแบบร่าง..." />;
  }

  if (pickerOpen) {
    return (
      <TravelDraftPickerDialog
        open
        drafts={drafts}
        onPickDraft={handlePickDraft}
        onNew={handleNew}
        onDismiss={handlePickerDismiss}
        onDeleteDraft={handleDeleteDraft}
      />
    );
  }

  if (!readyForForm) {
    return null;
  }

  if (loading) {
    return <TravelExpenseLoadingPopup label="กำลังโหลดแบบร่าง..." />;
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
      {/* Page heading */}
      <PageHeaderBar
        icon={FileText}
        title="ใบเบิกค่าใช้จ่ายในการเดินทาง"
        subtitle="AP-1 · กรอกข้อมูลให้ครบถ้วนก่อนส่งคำขอ"
        onBack={handleBack}
        backLabel="กลับ"
        dataTour="ap1-intro"
      />

      {/* Form */}
      <TravelExpenseForm
        initial={initial}
        onSaved={handleSaved}
        onSubmitted={handleSubmitted}
        onDuplicateDraftDate={handleDuplicateDraftDate}
      />

      <TravelExpenseTour />

      {/* Duplicate-date picker (overlay) — open an existing draft with that date or start fresh */}
      <TravelDraftPickerDialog
        open={dupPickerOpen}
        drafts={dupDrafts}
        onPickDraft={(id) => {
          setDupPickerOpen(false);
          safeReplace(router, travelExpenseFormHref(id, returnPath));
        }}
        onNew={() => setDupPickerOpen(false)}
        onDismiss={() => setDupPickerOpen(false)}
        onDeleteDraft={handleDupDelete}
      />
    </PageContainer>
  );
}
