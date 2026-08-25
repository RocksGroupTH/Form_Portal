"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { FileText, Plus, ChevronRight, ReceiptText, Trash2 } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeaderBar } from "@/components/layout/PageHeaderBar";
import { Dialog, Button } from "@/components/ui";
import { ClearAdvanceForm } from "@/features/clear-advance/components/ClearAdvanceForm";
import { TravelExpenseLoadingPopup } from "@/features/accounting/components/TravelExpenseLoadingPopup";
import { STATUS_LABEL_TH } from "@/features/accounting/constants";
import { clearAdvanceFormHref, clearAdvanceDetailHref, clearAdvanceNewHref } from "@/features/clear-advance/lib/navigation";
import type { ClearAdvanceRequest, ClearAdvanceDraftSummary } from "@/features/clear-advance/types";

const SUBTITLE = "AP-3 · เคลียร์คืนเงินทดรองจ่าย";

export default function ClearAdvancePage() {
  return (
    <Suspense fallback={<TravelExpenseLoadingPopup label="กำลังเตรียมแบบฟอร์ม..." subtitle="แบบฟอร์มเคลียร์คืนเงินทดรองจ่าย (AP-3)" />}>
      <ClearAdvanceContent />
    </Suspense>
  );
}

function ClearAdvanceContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const idParam = searchParams.get("id");
  const isNew = searchParams.get("new") === "1";
  const requestId = idParam ? Number(idParam) : null;

  const [initial, setInitial] = useState<ClearAdvanceRequest | null>(null);
  const [loading, setLoading] = useState(requestId !== null);
  const [notFound, setNotFound] = useState(false);

  // Inline draft picker (shown when no ?id and not ?new=1, and drafts exist).
  const [drafts, setDrafts] = useState<ClearAdvanceDraftSummary[] | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Unsaved-change guard (P1.2): the form reports its dirty state; leaving via the
  // Back button then asks for confirmation. (Refresh/close is handled in the form
  // via beforeunload.)
  const [dirty, setDirty] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  function handleBack() {
    if (dirty) setConfirmLeave(true);
    else router.back();
  }

  // Id of a Draft the form auto-created from its first attachment. Its ?id= sync
  // must NOT trigger the fetch below — the form already holds that Draft's state,
  // and re-fetching would remount it and wipe unsaved edits (e.g. an OCR-filled line).
  const selfCreated = useRef<number | null>(null);

  // Load an existing request when ?id is present.
  useEffect(() => {
    if (requestId === null) return;
    if (requestId === selfCreated.current) return; // form already has this Draft
    let cancelled = false;
    setLoading(true);
    setNotFound(false);
    fetch(`/api/request/clear-advance/requests/${requestId}`)
      .then((r) => r.json())
      .then((json: { ok: boolean; data?: ClearAdvanceRequest }) => {
        if (cancelled) return;
        if (json.ok && json.data) setInitial(json.data);
        else setNotFound(true);
      })
      .catch(() => { if (!cancelled) setNotFound(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [requestId]);

  // Fetch drafts to offer a resume dialog (only in fresh-form mode).
  useEffect(() => {
    if (requestId !== null || isNew) return;
    let cancelled = false;
    fetch("/api/request/clear-advance/requests/drafts")
      .then((r) => r.json())
      .then((json: { ok: boolean; data?: ClearAdvanceDraftSummary[] }) => {
        if (cancelled) return;
        const list = json.ok && json.data ? json.data : [];
        setDrafts(list);
        setPickerOpen(list.length > 0);
      })
      .catch(() => { if (!cancelled) setDrafts([]); });
    return () => { cancelled = true; };
  }, [requestId, isNew]);

  function handleSaved(id: number) {
    if (!requestId) router.replace(clearAdvanceFormHref(id));
  }
  function handleSubmitted(id: number) {
    router.push(clearAdvanceDetailHref(id));
  }
  async function handleDeleteDraft(id: number) {
    const res = await fetch(`/api/request/clear-advance/requests/${id}`, { method: "DELETE" });
    const j = (await res.json()) as { ok: boolean; error?: string };
    if (!j.ok) { toast.error(j.error ?? "ลบแบบร่างไม่สำเร็จ"); throw new Error(j.error ?? "delete failed"); }
    toast.success("ลบแบบร่างแล้ว");
    const next = (drafts ?? []).filter((d) => d.id !== id);
    setDrafts(next);
    if (next.length === 0) { setPickerOpen(false); router.replace(clearAdvanceNewHref()); }
  }

  return (
    <PageContainer className="acc-theme py-6 px-3 sm:px-0">
      <PageHeaderBar
        icon={ReceiptText}
        title="เคลียร์คืนเงินทดรองจ่าย"
        subtitle={SUBTITLE}
        onBack={handleBack}
        backLabel="กลับ"
      />
      {loading ? (
        <TravelExpenseLoadingPopup label="กำลังโหลดแบบร่าง..." subtitle="แบบฟอร์มเคลียร์คืนเงินทดรองจ่าย (AP-3)" />
      ) : notFound ? (
        <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>ไม่พบคำขอนี้</p>
      ) : (
        <ClearAdvanceForm
          initial={initial}
          onSaved={handleSaved}
          onSubmitted={handleSubmitted}
          onDirtyChange={setDirty}
          onAutoDraft={(id) => { selfCreated.current = id; }}
        />
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

      <DraftPickerDialog
        open={pickerOpen && !!drafts && drafts.length > 0}
        drafts={drafts ?? []}
        onPick={(id) => { setPickerOpen(false); router.replace(clearAdvanceFormHref(id)); }}
        onNew={() => setPickerOpen(false)}
        onDismiss={() => setPickerOpen(false)}
        onDelete={handleDeleteDraft}
      />
    </PageContainer>
  );
}

function fmtUpdatedAt(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
}

function money(n: number | null): string {
  if (n == null) return "—";
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Minimal inline draft picker (AP-3 shape — advance no. + amounts). */
function DraftPickerDialog({
  open, drafts, onPick, onNew, onDismiss, onDelete,
}: {
  open: boolean;
  drafts: ClearAdvanceDraftSummary[];
  onPick: (id: number) => void;
  onNew: () => void;
  onDismiss: () => void;
  onDelete: (id: number) => Promise<void>;
}) {
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  async function confirmDelete(id: number) {
    setBusy(true);
    try { await onDelete(id); } catch { /* toast handled by caller */ } finally { setBusy(false); setConfirmId(null); }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => { if (!v) onDismiss(); }}
      title="เลือกแบบร่างหรือสร้างใหม่"
      description="พบแบบร่างที่บันทึกไว้ — เลือกเปิดต่อ ลบ หรือเริ่มคำขอใหม่"
      contentClassName="max-w-md"
    >
      <div className="flex flex-col gap-3">
        <p className="text-[13px] m-0" style={{ color: "var(--text-muted)" }}>
          คุณมีแบบร่างเคลียร์เงินทดรองจ่าย {drafts.length} รายการ
        </p>
        <ul className="flex flex-col gap-2 m-0 p-0 list-none max-h-[min(50vh,320px)] overflow-y-auto">
          {drafts.map((d) => (
            <li key={d.id} className="flex items-stretch gap-2">
              <button type="button" onClick={() => onPick(d.id)}
                className="flex-1 min-w-0 text-left rounded-xl p-3.5 cursor-pointer border-none"
                style={{ background: "var(--bg-card-alt)", border: "1px solid var(--border-card)" }}>
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
                    style={{ background: "var(--nav-active-bg)", color: "var(--nav-active-text)" }}>
                    <FileText size={16} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-[13px] font-bold" style={{ color: "var(--text-heading)" }}>
                        {d.advanceRequestNo ?? "ยังไม่ได้เลือกเงินทดรอง"}
                      </span>
                      {d.brandCode && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                          style={{ background: "var(--nav-active-bg)", color: "var(--nav-active-text)" }}>{d.brandCode}</span>
                      )}
                      {d.status === "Returned" && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
                          style={{ background: "color-mix(in srgb, var(--color-warning) 15%, transparent)", color: "var(--color-warning)" }}>
                          {STATUS_LABEL_TH.Returned}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] m-0" style={{ color: "var(--text-muted)" }}>
                      อัปเดต {fmtUpdatedAt(d.updatedAt)}
                      {d.actualTotal != null ? ` · ใช้จ่าย ฿${money(d.actualTotal)}` : ""}
                    </p>
                  </div>
                  <ChevronRight size={16} className="shrink-0 mt-1" style={{ color: "var(--text-faint)" }} />
                </div>
              </button>

              {/* Delete with inline confirm */}
              {confirmId === d.id ? (
                <div className="flex flex-col justify-center gap-1 shrink-0">
                  <button type="button" onClick={() => confirmDelete(d.id)} disabled={busy}
                    className="text-[11px] font-bold px-2.5 py-1 rounded-lg cursor-pointer border-none"
                    style={{ background: "var(--btn-danger-bg, #dc2626)", color: "#fff" }}>ลบ</button>
                  <button type="button" onClick={() => setConfirmId(null)} disabled={busy}
                    className="text-[11px] px-2.5 py-1 rounded-lg cursor-pointer border-none bg-transparent"
                    style={{ color: "var(--text-muted)" }}>ยกเลิก</button>
                </div>
              ) : (
                <button type="button" onClick={() => setConfirmId(d.id)} title="ลบแบบร่าง"
                  className="shrink-0 self-center p-2 rounded-lg cursor-pointer border-none bg-transparent"
                  style={{ color: "var(--text-danger, #dc2626)" }}>
                  <Trash2 size={16} />
                </button>
              )}
            </li>
          ))}
        </ul>
        <div className="pt-3 flex flex-col sm:flex-row gap-2 sm:justify-end" style={{ borderTop: "1px solid var(--border-light)" }}>
          <Button type="button" variant="primary" icon={<Plus size={15} />} onClick={onNew}>สร้างคำขอใหม่</Button>
        </div>
      </div>
    </Dialog>
  );
}
