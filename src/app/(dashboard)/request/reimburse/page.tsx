"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { FileText, Loader2, Plus, ChevronRight, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeaderBar } from "@/components/layout/PageHeaderBar";
import { Dialog } from "@/components/ui";
import { TravelExpenseLoadingPopup } from "@/features/accounting/components/TravelExpenseLoadingPopup";
import { createTravelBackAction } from "@/features/accounting/lib/navigation";
import { fmtBaht } from "@/features/travel-booking/components/shared";
import { ReimburseForm } from "@/features/reimburse/components/ReimburseForm";
import type { ReimburseDetail } from "@/features/reimburse/types";
import { safeBack, safePush, safeReplace } from "@/lib/safe-router";

/**
 * AP-4 — fill, save a draft, resume, submit.
 *
 * `?id=` resumes a saved request, `?new=1` skips the resume prompt, `?from=`
 * carries the page to return to.
 *
 * The resume prompt asks about **one** request, not a list: AP-4's
 * `requests/drafts` answers with a single summary or `null` (there is no
 * on-behalf submission, so a person has at most one open claim), where AP-1's
 * equivalent returns an array.
 */

const LOADING_SUBTITLE = "ขอเบิกเงินคืนพนักงาน (AP-4)";

/** What `GET /api/request/reimburse/requests/drafts` answers with. */
interface ReimburseDraftSummary {
  id: number;
  brandCode: string | null;
  status: "Draft" | "Returned";
  purpose: string | null;
  itemCount: number;
  totalAmount: number | null;
  updatedAt: string;
}

function appendFrom(href: string, from?: string): string {
  if (!from) return href;
  return `${href}${href.includes("?") ? "&" : "?"}from=${encodeURIComponent(from)}`;
}

const formHref = (id: number, from?: string) => appendFrom(`/request/reimburse?id=${id}`, from);
const newHref = (from?: string) => appendFrom("/request/reimburse?new=1", from);
const detailHref = (id: number, from?: string) => appendFrom(`/request/reimburse/${id}`, from);

/** Local getters — the server runs on Thai time. */
function fmtUpdatedAt(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()} ${hh}:${mi}`;
}

/** The shared `fmtBaht`, plus the em-dash a draft with nothing totalled wants. */
function fmtDraftTotal(n: number | null): string {
  if (n == null || n === 0) return "—";
  return fmtBaht(n);
}

export default function ReimbursePage() {
  return (
    <Suspense fallback={<TravelExpenseLoadingPopup label="กำลังเตรียมแบบฟอร์ม..." subtitle={LOADING_SUBTITLE} />}>
      <ReimburseContent />
    </Suspense>
  );
}

function ReimburseContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const idParam = searchParams.get("id");
  const skipPrompt = searchParams.get("new") === "1";
  const requestId = idParam ? Number(idParam) : null;
  const returnPath = searchParams.get("from") || undefined;
  const handleBack = useCallback(
    () => createTravelBackAction(router, returnPath)(),
    [router, returnPath],
  );

  const [initial, setInitial] = useState<ReimburseDetail | null>(null);
  const [loading, setLoading] = useState(requestId !== null);
  const [notFound, setNotFound] = useState(false);

  const [checkingDraft, setCheckingDraft] = useState(requestId === null && !skipPrompt);
  const [draft, setDraft] = useState<ReimburseDraftSummary | null>(null);
  const [promptOpen, setPromptOpen] = useState(false);
  const [readyForForm, setReadyForForm] = useState(requestId !== null || skipPrompt);
  /** Two-step discard inside the prompt — a nested confirm dialog reads worse than swapping the row. */
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [discarding, setDiscarding] = useState(false);

  /* Resume: one open request, or none. */
  useEffect(() => {
    if (requestId !== null || skipPrompt) {
      setCheckingDraft(false);
      setReadyForForm(true);
      return;
    }

    let cancelled = false;
    setCheckingDraft(true);

    fetch("/api/request/reimburse/requests/drafts")
      .then((r) => r.json())
      .then((json: { ok: boolean; data?: ReimburseDraftSummary | null }) => {
        if (cancelled) return;
        const found = json.ok && json.data ? json.data : null;
        setDraft(found);
        if (found) setPromptOpen(true);
        else setReadyForForm(true);
      })
      .catch(() => {
        if (!cancelled) setReadyForForm(true);
      })
      .finally(() => {
        if (!cancelled) setCheckingDraft(false);
      });

    return () => {
      cancelled = true;
    };
  }, [requestId, skipPrompt]);

  /* Load the request being resumed. */
  useEffect(() => {
    if (requestId === null) return;

    let cancelled = false;
    setLoading(true);
    setNotFound(false);

    fetch(`/api/request/reimburse/requests/${requestId}`)
      .then((r) => r.json())
      .then((json: { ok: boolean; data?: ReimburseDetail }) => {
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

  /* After the first save, put the id in the URL so later saves update the same record. */
  const handleSaved = useCallback(
    (id: number) => {
      if (!requestId) safeReplace(router, formHref(id, returnPath));
    },
    [requestId, router, returnPath],
  );

  const handleSubmitted = useCallback(
    (id: number) => safePush(router, detailHref(id, returnPath)),
    [router, returnPath],
  );

  /**
   * Discard the open draft, then start a fresh one.
   *
   * Only offered for a `Draft`, and offered rather than implied. Starting a new
   * request used to leave the old draft in the database and in SharePoint with
   * nothing able to reach it again: `listMyRequestRows` excludes `Draft`, and
   * this prompt asks about `TOP 1 … ORDER BY UpdatedAt DESC`, so the moment a
   * newer draft exists the older one is in no list, no prompt and no link.
   *
   * A `Returned` request is a different case and is deliberately left alone —
   * it carries a running number and an approval history, and it *is* listed in
   * My Requests, so nothing is lost by starting a new claim beside it.
   *
   * A failed delete does not proceed: silently starting a new draft anyway would
   * recreate the orphan the button exists to prevent.
   */
  const handleDiscardDraft = useCallback(async () => {
    if (!draft) return;
    setDiscarding(true);
    try {
      const res = await fetch(`/api/request/reimburse/requests/${draft.id}`, { method: "DELETE" });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) {
        toast.error(json.error ?? "ลบแบบร่างไม่สำเร็จ");
        return;
      }
      toast.success("ลบแบบร่างแล้ว");
      setPromptOpen(false);
      setReadyForForm(true);
      safeReplace(router, newHref(returnPath));
    } catch {
      toast.error("ลบแบบร่างไม่สำเร็จ");
    } finally {
      setDiscarding(false);
    }
  }, [draft, router, returnPath]);

  if (checkingDraft) {
    return <TravelExpenseLoadingPopup label="กำลังตรวจสอบแบบร่าง..." subtitle={LOADING_SUBTITLE} />;
  }

  if (promptOpen && draft) {
    const isReturned = draft.status === "Returned";
    return (
      <Dialog
        open
        onOpenChange={(v) => {
          if (!v) safeBack(router);
        }}
        title={isReturned ? "มีคำขอที่ถูกส่งกลับแก้ไข" : "มีแบบร่างค้างอยู่"}
        description={
          isReturned
            ? "แก้ไขคำขอเดิมต่อ (เลขที่คำขอเดิมยังอยู่) หรือเริ่มคำขอใหม่"
            : "เปิดแบบร่างเดิมต่อ หรือเริ่มคำขอใหม่"
        }
        contentClassName="max-w-md"
        uniformSurface
      >
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => {
              setPromptOpen(false);
              safeReplace(router, formHref(draft.id, returnPath));
            }}
            className="w-full text-left rounded-xl p-3.5 flex items-center gap-3 cursor-pointer border-none"
            style={{ background: "var(--bg-card-alt)" }}
          >
            <span
              className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
              style={{ background: "var(--nav-active-bg)", color: "var(--nav-active-text)" }}
            >
              <FileText size={16} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-bold truncate" style={{ color: "var(--text-heading)" }}>
                {draft.purpose?.trim() || (isReturned ? "คำขอที่ถูกส่งกลับ" : "แบบร่างคำขอเบิกเงินคืน")}
              </span>
              <span className="block text-[11px] truncate" style={{ color: "var(--text-muted)" }}>
                {draft.itemCount} รายการ · ฿{fmtDraftTotal(draft.totalAmount)} · แก้ไขล่าสุด {fmtUpdatedAt(draft.updatedAt)}
              </span>
            </span>
            <ChevronRight size={16} className="shrink-0" style={{ color: "var(--text-faint)" }} />
          </button>

          {/* A Returned request is listed in My Requests, so starting a new one
              beside it loses nothing and it is left where it is. A Draft is
              not listed anywhere, so "start a new one" has to mean "and discard
              this", or the old draft — and its SharePoint attachments — become
              unreachable for good. */}
          {isReturned ? (
            <button
              type="button"
              onClick={() => {
                setPromptOpen(false);
                setReadyForForm(true);
                safeReplace(router, newHref(returnPath));
              }}
              className="w-full text-left rounded-xl p-3.5 flex items-center gap-3 cursor-pointer"
              style={{ background: "transparent", border: "1px dashed var(--border-card)" }}
            >
              <span
                className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                style={{ background: "var(--bg-card-alt)", color: "var(--text-muted)" }}
              >
                <Plus size={16} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-bold" style={{ color: "var(--text-heading)" }}>
                  เริ่มคำขอใหม่
                </span>
                <span className="block text-[11px]" style={{ color: "var(--text-muted)" }}>
                  คำขอที่ถูกส่งกลับยังอยู่ในหน้า &quot;คำขอของฉัน&quot;
                </span>
              </span>
            </button>
          ) : confirmDiscard ? (
            <div
              className="w-full rounded-xl p-3.5 flex flex-col gap-2.5"
              style={{ background: "var(--status-bad-bg)", border: "1px solid var(--border-card)" }}
            >
              <p className="text-[12px] leading-relaxed m-0" style={{ color: "var(--status-bad-text)" }}>
                ลบแบบร่างเดิมทิ้งถาวร รวมถึงไฟล์ที่แนบไว้ทั้งหมด แล้วเริ่มคำขอใหม่?
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={discarding}
                  onClick={() => setConfirmDiscard(false)}
                  className="flex-1 px-3 py-2 rounded-lg text-[12px] font-medium border-none enabled:cursor-pointer disabled:opacity-60"
                  style={{ background: "var(--bg-badge)", color: "var(--text-secondary)" }}
                >
                  ยกเลิก
                </button>
                <button
                  type="button"
                  disabled={discarding}
                  onClick={() => void handleDiscardDraft()}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-bold border-none text-white enabled:cursor-pointer disabled:opacity-60"
                  style={{ background: "var(--color-danger)" }}
                >
                  {discarding ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                  ลบแล้วเริ่มใหม่
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDiscard(true)}
              className="w-full text-left rounded-xl p-3.5 flex items-center gap-3 cursor-pointer"
              style={{ background: "transparent", border: "1px dashed var(--border-card)" }}
            >
              <span
                className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                style={{ background: "var(--bg-card-alt)", color: "var(--text-muted)" }}
              >
                <Plus size={16} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-bold" style={{ color: "var(--text-heading)" }}>
                  เริ่มคำขอใหม่
                </span>
                <span className="block text-[11px]" style={{ color: "var(--text-muted)" }}>
                  ลบแบบร่างเดิมและไฟล์ที่แนบไว้ทิ้ง
                </span>
              </span>
            </button>
          )}
        </div>
      </Dialog>
    );
  }

  if (!readyForForm) return null;

  if (loading) {
    return <TravelExpenseLoadingPopup label="กำลังโหลดแบบร่าง..." subtitle={LOADING_SUBTITLE} />;
  }

  if (notFound) {
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
      <PageHeaderBar
        icon={FileText}
        title="ขอเบิกเงินคืนพนักงาน"
        subtitle="AP-4 · กรอกข้อมูลให้ครบถ้วนก่อนส่งคำขอ"
        onBack={handleBack}
        backLabel="กลับ"
      />

      <ReimburseForm initial={initial} onSaved={handleSaved} onSubmitted={handleSubmitted} />
    </PageContainer>
  );
}
