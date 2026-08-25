"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeaderBar } from "@/components/layout/PageHeaderBar";
import { AdvanceForm } from "@/features/advance/components/AdvanceForm";
import { AdvanceDraftPicker } from "@/features/advance/components/AdvanceDraftPicker";
import { TravelExpenseLoadingPopup } from "@/features/accounting/components/TravelExpenseLoadingPopup";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Wallet } from "lucide-react";
import type { AdvanceRequest, AdvanceDraftSummary } from "@/features/advance/types";

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
  // Draft resume picker (only on a fresh form, i.e. no ?id).
  const [drafts, setDrafts] = useState<AdvanceDraftSummary[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  // P2.2 — gate the fresh form until the draft lookup finishes, so it never
  // flashes (and can't be filled) before the resume dialog gets a chance to open.
  const [draftsChecked, setDraftsChecked] = useState(requestId !== null);
  // Unsaved-change guard (P1.2): the form reports dirty; the in-app Back button
  // then confirms before leaving (refresh/close is handled by the form's beforeunload).
  const [dirty, setDirty] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  function handleBack() {
    if (dirty) setConfirmLeave(true);
    else router.back();
  }

  useEffect(() => {
    if (requestId !== null) return; // resuming a specific request — no picker
    let cancelled = false;
    fetch("/api/request/advance/requests/drafts")
      .then((r) => r.json())
      .then((j: { ok: boolean; data?: AdvanceDraftSummary[] }) => {
        if (cancelled || !j.ok || !j.data?.length) return;
        setDrafts(j.data);
        setPickerOpen(true);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setDraftsChecked(true); });
    return () => { cancelled = true; };
  }, [requestId]);

  const handlePickDraft = (id: number) => { setPickerOpen(false); router.replace(`/request/advance?id=${id}`); };
  const handleDeleteDraft = async (id: number) => {
    const res = await fetch(`/api/request/advance/requests/${id}`, { method: "DELETE" });
    const j = (await res.json()) as { ok: boolean; error?: string };
    if (!j.ok) { toast.error(j.error ?? "ลบแบบร่างไม่สำเร็จ"); throw new Error(j.error ?? "delete failed"); }
    toast.success("ลบแบบร่างแล้ว");
    setDrafts((prev) => {
      const next = prev.filter((d) => d.id !== id);
      if (next.length === 0) setPickerOpen(false);
      return next;
    });
  };

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
        onBack={handleBack}
        backLabel="กลับ"
      />
      {loading || (requestId === null && !draftsChecked) ? (
        <TravelExpenseLoadingPopup label="กำลังตรวจสอบแบบร่าง..." subtitle="แบบฟอร์มขอเบิกเงินทดรองจ่าย (AP-2)" />
      ) : notFound ? (
        <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>ไม่พบคำขอนี้</p>
      ) : (
        <AdvanceForm initial={initial} onSaved={handleSaved} onSubmitted={handleSubmitted} onDirtyChange={setDirty} />
      )}

      <Dialog
        open={confirmLeave}
        onOpenChange={(v) => { if (!v) setConfirmLeave(false); }}
        title="ออกจากหน้านี้?"
        description="มีข้อมูลที่แก้ไขแต่ยังไม่ได้บันทึก หากออกตอนนี้ข้อมูลที่ยังไม่บันทึกจะหายไป"
        contentClassName="max-w-sm"
      >
        <div className="flex flex-col sm:flex-row gap-2 sm:justify-end pt-1">
          <Button type="button" variant="secondary" onClick={() => setConfirmLeave(false)}>อยู่ต่อ</Button>
          <Button type="button" variant="danger" onClick={() => { setConfirmLeave(false); router.back(); }}>
            ออกโดยไม่บันทึก
          </Button>
        </div>
      </Dialog>

      <AdvanceDraftPicker
        open={pickerOpen}
        drafts={drafts}
        onPickDraft={handlePickDraft}
        onNew={() => setPickerOpen(false)}
        onDismiss={() => setPickerOpen(false)}
        onDeleteDraft={handleDeleteDraft}
      />
    </PageContainer>
  );
}
