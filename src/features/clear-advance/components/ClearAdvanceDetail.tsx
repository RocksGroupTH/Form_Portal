"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  FileText, User, Mail, Wallet, CheckCircle, XCircle, Clock, RotateCcw,
  ThumbsUp, ThumbsDown, Ban, Paperclip, Image as ImageIcon, Banknote, ReceiptText,
  Printer,
} from "lucide-react";
import type { ClearAdvanceDetail as ClearDetail } from "@/features/clear-advance/types";
import { Dialog } from "@/components/ui/Dialog";
import { PND_LABEL } from "@/lib/clr/wht-pnd-core";
import { normalizeTaxIdInput, taxIdNotice } from "@/lib/clr/seller-tax-id";
import { Avatar } from "@/components/ui/Avatar";
import {
  AttachmentViewer,
  attachmentKind,
  type AttachmentKind,
  type AttachmentSource,
} from "@/components/ui/AttachmentViewer";
import { RequestStatusBadge } from "@/features/accounting/components/RequestStatusBadge";
import { CLR_STEP_CODES, CLR_STEP_LABEL_TH, type ClrStepCode } from "@/features/clear-advance/constants";
import type { AccFileMeta } from "@/features/accounting/types";
import type { ClearAdvanceItem, ClearAdvanceRequest, ClrApproval } from "@/features/clear-advance/types";
import { linesMissingTaxVendor } from "@/lib/clr/tax-vendor-core";
import { glMissingMessage, linesMissingGl } from "@/lib/clr/clear-advance-line-validation";
import { tinsNeedingRdCheck } from "@/lib/clr/rd-vat-core";
import { useTaxVendors } from "@/features/clear-advance/hooks/useTaxVendors";
import { useRdVatByTin } from "@/features/clear-advance/hooks/useRdVatByTin";
import { VendorCell } from "@/features/clear-advance/components/VendorCell";
import { RdCell } from "@/features/clear-advance/components/RdCell";
import { useGlOptionsByBranch } from "@/features/clear-advance/hooks/useGlOptionsByBranch";
import { GlCell } from "@/features/clear-advance/components/GlCell";
import { PaymentDatePicker } from "@/components/ui/PaymentDatePicker";
import { advanceBcDocLabel } from "@/lib/clr/advance-bc-doc";
import { refundEvidenceMessage, refundEvidenceMissing } from "@/lib/clr/refund-evidence";
import { isRocksPcBrand } from "@/features/clear-advance/constants";
import { hrPhotoUrl } from "@/lib/hr/photo-url";
import { pndBlockReason } from "@/lib/clr/wht-pnd-core";

function money(n: number | null | undefined): string {
  return (n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Local-getter datetime formatter — never toISOString for display. */
function fmtDate(raw: string | null | undefined): string {
  if (!raw) return "";
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
}

/** Date-only display (expense dates come as YYYY-MM-DD). */
function fmtDateOnly(raw: string | null | undefined): string {
  if (!raw) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw;
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

const box = { background: "var(--bg-card)", border: "1px solid var(--border-card)", boxShadow: "var(--shadow-sm)" } as const;

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl overflow-hidden mb-4" style={box}>
      <div className="flex items-center gap-2.5 px-5 py-3"
        style={{ borderBottom: "1px solid var(--border-card)", background: "var(--bg-card-alt)" }}>
        <span className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: "var(--nav-active-bg)", color: "var(--nav-active-text)" }}>
          {icon}
        </span>
        <h2 className="text-[13px] font-bold" style={{ color: "var(--text-heading)" }}>{title}</h2>
      </div>
      <div className="px-5 py-4">{children}</div>
    </div>
  );
}

function DetailRow({ label, value, valueStyle }: { label: string; value: React.ReactNode; valueStyle?: React.CSSProperties }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-baseline gap-0.5 sm:gap-2">
      <span className="text-[11px] font-medium shrink-0 sm:w-40" style={{ color: "var(--text-secondary)" }}>{label}</span>
      <span className="text-[13px]" style={{ color: "var(--text-primary)", ...valueStyle }}>{value ?? "—"}</span>
    </div>
  );
}

function ApprovalStatusBadge({ status }: { status: string }) {
  const cfg: Record<string, { label: string; icon: React.ReactNode; bg: string; text: string; border: string }> = {
    Pending: { label: "รออนุมัติ", icon: <Clock size={12} />, bg: "var(--bg-info-yellow)", text: "var(--text-info-yellow)", border: "var(--border-info-yellow)" },
    Approved: { label: "อนุมัติแล้ว", icon: <CheckCircle size={12} />, bg: "var(--bg-info-green)", text: "var(--text-info-green)", border: "var(--border-info-green)" },
    Rejected: { label: "ไม่อนุมัติ", icon: <XCircle size={12} />, bg: "rgba(220,38,38,0.08)", text: "var(--color-danger)", border: "rgba(220,38,38,0.2)" },
    Returned: { label: "ส่งกลับแก้ไข", icon: <RotateCcw size={12} />, bg: "var(--bg-info-yellow)", text: "var(--text-info-yellow)", border: "var(--border-info-yellow)" },
  };
  const c = cfg[status] ?? { label: status, icon: <Clock size={12} />, bg: "var(--bg-badge)", text: "var(--text-muted)", border: "var(--border-card)" };
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full"
      style={{ background: c.bg, color: c.text, border: `1px solid ${c.border}` }}>
      {c.icon}{c.label}
    </span>
  );
}

interface Props {
  request: ClearAdvanceRequest;
  /**
   * Whether this viewer is accounting, and so may see and set the G/L account.
   *
   * The requester used to choose it; they no longer see the column at all, and
   * neither does the manager. This component cannot work that out for itself —
   * it knows which step the request is at, not who is looking — so the server
   * decides it in the detail GET and hands it down. Defaults to false so a
   * mount that does not know (MyRequestsPanel, which is the requester's own
   * list) hides the column, which is the right answer there.
   */
  canSeeGlAccount?: boolean;
  onChanged?: () => void;
}

export function ClearAdvanceDetail({ request, canSeeGlAccount = false, onChanged }: Props) {
  const clear = request.clear;
  const items = clear?.items ?? [];
  const whtItems = clear?.whtItems ?? [];
  const files = clear?.files ?? [];
  const refundProofFiles = clear?.refundProofFiles ?? [];
  const refund = clear?.refundToCompany ?? 0;
  const companyPaysExtra = refund < 0;

  const [viewerStaffId, setViewerStaffId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  /* One viewer for the whole page, not one per thumbnail. It replaces the
     image-only lightbox: every kind now opens in page, because the download
     route serves anything non-raster as `Content-Disposition: attachment`. */
  const [viewing, setViewing] = useState<{ source: AttachmentSource; kind: AttachmentKind } | null>(
    null,
  );
  const openFileViewer = (f: AccFileMeta) =>
    setViewing({
      source: { name: f.fileName, url: f.url },
      kind: attachmentKind(f.fileName, f.contentType),
    });

  // Manager step dialogs.
  const [mgAction, setMgAction] = useState<"approve" | "return" | "reject" | null>(null);
  const [mgComment, setMgComment] = useState("");
  // Account / Head step inputs.
  const [accChecked, setAccChecked] = useState(false);
  const [pvDocNo, setPvDocNo] = useState(clear?.pvDocNo ?? "");
  const [paymentDate, setPaymentDate] = useState(clear?.paymentDate ?? "");
  const [accAction, setAccAction] = useState<null | "reject" | "return">(null);
  const [accComment, setAccComment] = useState("");
  const [cancelOpen, setCancelOpen] = useState(false);

  // ACCOUNT-step inline edit state.
  /* The account step's editor saves itself.
     Correcting the lines and naming each seller's vendor IS this step's work, so
     there was nothing for an "edit" button to reveal and nothing for a "save"
     button to decide: the step ends with an approval, and that is the moment
     anything is committed to. What the buttons did add was a way to lose work —
     a filled-in vendor sat unsaved until someone remembered the footer. */
  const savedSnapshot = useRef<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);
  const [saveState, setSaveState] = useState<
    | { kind: "idle" }
    | { kind: "saving" }
    | { kind: "saved"; at: number }
    | { kind: "error"; message: string }
  >({ kind: "idle" });
  const [editItems, setEditItemsState] = useState<ClearDetail["items"]>(() => clear?.items ?? []);
  // The WHT payees as accounting may change them. Only the ภ.ง.ด. type is
  // editable here: the payee's identity came off the receipt the requester held,
  // and this step decides how the withholding is filed, not who was paid.
  const [editWht, setEditWhtState] = useState<ClearDetail["whtItems"]>(() => clear?.whtItems ?? []);

  /**
   * Whether a person changed something in this editor.
   *
   * Autosave asks it before writing, because "the rows differ from the last
   * snapshot" is not the same question. Seeding sets both the rows and the
   * snapshot, and the two do not land in the same render — so an editor that had
   * only ever been seeded could still look changed for one pass and write itself
   * back. It did: a hot reload while this page was open wrote the rows without
   * the Tax Vendor No. that was on screen, three times, and the item row's id
   * moved each time (a save is a delete-and-reinsert). Anything that reseeds
   * mid-edit — a refetch, a remount — would do the same.
   *
   * So the write is gated on the edit, not on the difference.
   */
  const dirty = useRef(false);
  const setEditItems: typeof setEditItemsState = (v) => {
    dirty.current = true;
    setEditItemsState(v);
  };
  const setEditWht: typeof setEditWhtState = (v) => {
    dirty.current = true;
    setEditWhtState(v);
  };

  useEffect(() => {
    let cancelled = false;
    fetch("/api/me/employee")
      .then((r) => r.json())
      .then((json: { ok: boolean; data?: { employee?: { staffId?: number | null } | null } }) => {
        if (cancelled) return;
        const sid = json.ok ? json.data?.employee?.staffId : null;
        setViewerStaffId(sid != null ? sid : null);
      })
      .catch(() => { if (!cancelled) setViewerStaffId(null); });
    return () => { cancelled = true; };
  }, []);

  const step = request.currentStepCode;
  const inApproval = request.status === "Submitted" && step != null;
  const isManagerStep = inApproval && step === "MANAGER";
  const isAccountStep = inApproval && step === "ACCOUNT";
  const isHeadStep = inApproval && step === "HEAD";

  /* Input tax is claimed against a vendor, so a VAT line has to name one before
     it leaves the account step — the head step cannot edit lines, so this is the
     last chance to choose. The server refuses the same thing; this is so the
     accountant sees which line, not an error after clicking.
     Read from the rows on screen, not the ones last fetched: autosave writes
     without re-fetching, so the request's own copy lags a vendor just chosen. */
  const missingVendorLines = linesMissingTaxVendor(isAccountStep ? editItems : items);
  /* Same rows, same reason: the ภ.ง.ด. type the journal builder refuses without.
     The sentence comes from the same function the server uses, so the screen and
     the refusal cannot drift apart. */
  const pndProblem = isAccountStep
    ? pndBlockReason(editItems, editWht)
    : pndBlockReason(items, whtItems);
  /* The account list for every branch the lines use. Fetched here rather than
     on the requester's form, which no longer shows the column. */
  const glByBranch = useGlOptionsByBranch(editItems.map((it) => it.branchCode));
  /* The seller's BC vendor and the registry's answer about their tax id, both
     for the whole grid. They used to live one-per-card below the table; the
     registry in particular was asked once per card, so six lines sharing a
     seller made six calls for one answer. */
  const { vendors, list: vendorList, load: loadVendors } = useTaxVendors(request.brandCode ?? null);
  /* Only while the grid is editable. `editItems` is seeded from the request for
     every viewer, so asking for its tax ids unconditionally had a manager's
     page load reaching the registry's 15-second SOAP for a column that is not
     on their screen. */
  const { byTin: rdByTin, ask: askRd } = useRdVatByTin(
    isAccountStep ? editItems.map((it) => it.taxId) : [],
  );

  /* The payment rounds, from the calendar AP-1 and AP-2 already share — there
     is no AP-3 endpoint because there is no AP-3 rule; it is the same 2nd and
     4th Friday, shifted off holidays. Only fetched while the account step is
     open, and only the company-pays case can choose from them. */
  const [paymentRounds, setPaymentRounds] = useState<string[]>([]);
  const [roundsAttempt, setRoundsAttempt] = useState(0);
  useEffect(() => {
    if (!isAccountStep || !companyPaysExtra) return;
    let cancelled = false;
    fetch("/api/request/advance/payment-dates")
      .then((r) => r.json())
      .then((j: { ok?: boolean; data?: { dates?: string[]; default?: string | null } }) => {
        if (cancelled || !j?.data?.dates) return;
        setPaymentRounds(j.data.dates);
        /* Seeded with the round the claim belongs to, the way AP-2 does, so the
           common case is confirm-and-approve. Never over an existing pick. */
        setPaymentDate((prev) => prev || j.data?.default || "");
      })
      .catch(() => {
        /* Not swallowed. With no rounds the picker offers nothing and approval
           is blocked with no way forward, so the officer is told and the next
           render tries again — the same failure the G/L options and the OCR
           suggestions each had to be taught to survive. */
        if (!cancelled) { toast.error("โหลดรอบวันจ่ายไม่สำเร็จ — กำลังลองใหม่"); setRoundsAttempt((n) => n + 1); }
      });
    return () => { cancelled = true; };
  }, [isAccountStep, companyPaysExtra, roundsAttempt]);

  /* A date stored before this rule existed, or from a round that has since
     passed. Shown rather than dropped — but it is about to become a posting
     date in BC, so it has to be re-picked before this step can end. */
  const paymentDateOffCycle =
    companyPaysExtra && !!paymentDate && paymentRounds.length > 0 && !paymentRounds.includes(paymentDate);
  /* A non-home brand books every line to FORCE_GL_NON_ROCKS_PC at save time, so
     the cell shows the forced account rather than a picker. */
  const glForced = !!request.brandCode && !isRocksPcBrand(request.brandCode);

  /* The G/L account, on the same terms: accounting chooses it now, and this is
     the last step that can edit a line. `glMissingMessage` is the sentence the
     server throws, so the screen and the refusal cannot drift apart. */
  const missingGlLines = linesMissingGl(isAccountStep ? editItems : items);

  /* The refund as the officer's unsaved edits leave it. The stored figure does
     not move while they type — autosave writes but nothing refetches — so a
     warning read off `clear` would arrive only after they pressed approve.

     Always recomputed, never `it.netAmount`: that column is derived and only
     refreshed when persistClear writes, so on a row being edited it still
     holds the figure from before the edit. ExpenseTable may read it because it
     renders saved rows; this reads the ones being typed into. Same arithmetic
     as `lineTotals` on the server, which is what will decide the stored sign. */
  const liveRefund = isAccountStep
    ? Math.round(
        ((clear?.advanceAmount ?? 0) -
          editItems.reduce(
            (sum, it) =>
              sum + ((it.amountBeforeVat ?? 0) + (it.vatAmount ?? 0) - (it.whtAmount ?? 0)),
            0,
          )) * 100,
      ) / 100
    : refund;
  /* Cutting an expense can turn "the company owes me" into "I owe the company"
     — for money the requester has not sent, because until this edit they did
     not owe it. Nothing on this screen can fix that, so the message points at
     ส่งกลับแก้ไข and the server refuses the approval too. */
  const refundGap = isAccountStep
    ? refundEvidenceMissing({
        refundToCompany: liveRefund,
        refundTransferDate: clear?.refundTransferDate,
        proofCount: refundProofFiles.length,
      })
    : null;
  const accountBlocked = missingVendorLines.length > 0 || !!pndProblem || missingGlLines.length > 0 || paymentDateOffCycle || !!refundGap;

  /* Seed the editor from the request at the account step. The snapshot taken
     here is what "unchanged" means — autosave compares against it, so seeding
     never counts as an edit and never writes the rows back unprompted. */
  useEffect(() => {
    if (!isAccountStep) return;
    const seedItems = clear?.items ?? [];
    const seedWht = clear?.whtItems ?? [];
    setEditItemsState(seedItems);
    setEditWhtState(seedWht);
    savedSnapshot.current = JSON.stringify({ items: seedItems, wht: seedWht });
    dirty.current = false;
  }, [isAccountStep, clear?.items, clear?.whtItems]);

  /* A stored vendor is a bare number — the list is what carries its name, so a
     grid that opens with one already chosen loads it without waiting for a
     cell to be opened. The module cache makes that free after the first. */
  useEffect(() => {
    if (vendors !== null) return;
    if (!isAccountStep) return; // no picker on screen, no list to fetch
    if (editItems.some((it) => (it.taxVendorNo ?? "").trim())) void loadVendors();
  }, [isAccountStep, editItems, vendors, loadVendors]);

  // Requester self-cancel: they own it, still pending the manager (before Account),
  // within 24h of submit. Sends an email to the manager + requester on cancel.
  const isOwner = viewerStaffId != null && request.staffId != null && viewerStaffId === request.staffId;
  const canCancel =
    isOwner &&
    request.status === "Submitted" &&
    step === "MANAGER" &&
    request.submittedAt != null &&
    Date.now() - new Date(request.submittedAt).getTime() <= 24 * 3600 * 1000;

  const approvalsByStep = useMemo(() => {
    const map = new Map<ClrStepCode, ClrApproval>();
    for (const a of request.approvals ?? []) map.set(a.stepCode, a);
    return map;
  }, [request.approvals]);

  async function act(path: string, body?: unknown) {
    setBusy(true);
    try {
      const res = await fetch(`/api/request/clear-advance/requests/${request.id}/${path}`, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) throw new Error(json.error ?? "ดำเนินการไม่สำเร็จ");
      toast.success("ดำเนินการสำเร็จ");
      setMgAction(null); setMgComment("");
      setAccAction(null); setAccComment(""); setAccChecked(false);
      setCancelOpen(false);
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "ดำเนินการไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  function handleManagerAction() {
    if (!mgAction) return;
    if ((mgAction === "return" || mgAction === "reject") && !mgComment.trim()) {
      return toast.error("กรุณาระบุเหตุผล");
    }
    if (mgAction === "approve") act("approve");
    else if (mgAction === "return") act("return", { comment: mgComment.trim() });
    else act("reject", { comment: mgComment.trim() });
  }

  async function handleAccountApprove() {
    // Payment date is required only when the company pays extra (company owes the requester).
    if (companyPaysExtra && !paymentDate) {
      return toast.error("กรณีบริษัทต้องจ่ายเพิ่ม กรุณาระบุวันจ่าย");
    }
    if (paymentDateOffCycle) {
      return toast.error("วันที่จ่ายไม่อยู่ในรอบที่กำหนด (ศุกร์ที่ 2 หรือ 4)");
    }
    if (refundGap) return toast.error(refundEvidenceMessage(refundGap));
    if (missingVendorLines.length > 0) {
      return toast.error(
        `กรุณาเลือก Vendor ผู้ขายให้ครบก่อนอนุมัติ — รายการที่ ${missingVendorLines.join(", ")}`,
      );
    }
    if (missingGlLines.length > 0) return toast.error(glMissingMessage(missingGlLines));
    if (pndProblem) return toast.error(pndProblem);
    // An edit still sitting in the debounce would be approved over: the server
    // checks the stored rows, which would not yet hold the vendor on screen.
    await flushSave();
    if (savedSnapshot.current !== JSON.stringify({ items: editItems, wht: editWht })) {
      return toast.error("ยังบันทึกรายการไม่สำเร็จ — แก้ไขให้บันทึกผ่านก่อนจึงอนุมัติได้");
    }
    act("approve", {
      isChecked: accChecked,
      pvDocNo: pvDocNo.trim() || null,
      paymentDate: paymentDate || null,
    });
  }

  /* The rows as they stand, for the saver to read without being re-created on
     every keystroke. */
  const latest = useRef({ items: editItems, wht: editWht });
  latest.current = { items: editItems, wht: editWht };

  const saveNow = useCallback(async () => {
    if (!clear) return;
    // Serialise. The write is a delete-and-reinsert of the rows, so two of them
    // in flight together finish in whatever order the server gets to them and
    // the older one can land last.
    if (inFlight.current) await inFlight.current;
    if (!dirty.current) return;
    const snap = JSON.stringify({ items: latest.current.items, wht: latest.current.wht });
    if (snap === savedSnapshot.current) return;
    setSaveState({ kind: "saving" });
    const run = (async () => {
      try {
        const res = await fetch(`/api/request/clear-advance/requests/${request.id}/account-edit`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: request.id,
            brandCode: request.brandCode ?? null,
            staffId: request.staffId ?? null,
            clear: { ...clear, items: latest.current.items, whtItems: latest.current.wht },
          }),
        });
        const json = (await res.json()) as { ok: boolean; error?: string };
        if (!json.ok) throw new Error(json.error ?? "บันทึกไม่สำเร็จ");
        savedSnapshot.current = snap;
        dirty.current = false;
        setSaveState({ kind: "saved", at: Date.now() });
      } catch (e) {
        // Left dirty on purpose: the next edit retries, and the line says so
        // rather than a toast that scrolls away.
        setSaveState({ kind: "error", message: e instanceof Error ? e.message : "บันทึกไม่สำเร็จ" });
      }
    })();
    inFlight.current = run;
    await run;
    inFlight.current = null;
  }, [clear, request.id, request.brandCode, request.staffId]);

  /* Wait out the typing, then write. A number being retyped passes through
     states nobody meant to store, and the row rewrite is a delete-and-reinsert. */
  useEffect(() => {
    if (!isAccountStep || savedSnapshot.current === null || !dirty.current) return;
    if (JSON.stringify({ items: editItems, wht: editWht }) === savedSnapshot.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void saveNow(), 900);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [editItems, editWht, isAccountStep, saveNow]);

  /* Nothing may be approved on top of an edit still sitting in a timer. */
  const flushSave = useCallback(async () => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    if (inFlight.current) await inFlight.current;
    await saveNow();
  }, [saveNow]);


  return (
    <div>
      {/* A new tab, not a route change: the print sheet is a dead end — you look
          at it, print it, and come back to a detail page that never unmounted. */}
      <div className="flex justify-end mb-3">
        <a href={`/request/clear-advance/${request.id}/print`} target="_blank" rel="noreferrer"
          className="inline-flex items-center gap-2 text-[13px] font-semibold px-4 py-2 rounded-lg no-underline"
          style={{ background: "var(--bg-card-alt)", border: "1px solid var(--border-card)", color: "var(--text-primary)" }}>
          <Printer size={14} /> พิมพ์ AP-3.1
        </a>
      </div>

      {/* Requester self-cancel bar */}
      {canCancel && (
        <div className="rounded-2xl p-4 mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5" style={box}>
          <div className="flex items-start gap-2.5 min-w-0">
            <Ban size={16} style={{ color: "var(--color-danger)", marginTop: 2 }} className="shrink-0" />
            <div className="min-w-0">
              <p className="text-[13px] font-semibold" style={{ color: "var(--text-heading)" }}>ยกเลิกคำขอ</p>
              <p className="text-[11px] leading-relaxed" style={{ color: "var(--text-muted)" }}>
                ยกเลิกเองได้ภายใน 24 ชม. หลังส่งคำขอ และก่อนผู้จัดการอนุมัติ (ก่อนถึงขั้นบัญชี) · ระบบจะแจ้งเมลผู้จัดการ
              </p>
            </div>
          </div>
          <button type="button" onClick={() => setCancelOpen(true)}
            className="shrink-0 inline-flex items-center gap-2 text-[13px] font-semibold px-4 py-2 rounded-lg cursor-pointer"
            style={{ color: "var(--color-danger)", border: "1px solid rgba(220,38,38,0.3)", background: "rgba(220,38,38,0.06)" }}>
            <Ban size={14} /> ยกเลิกคำขอ
          </button>
        </div>
      )}

      {/* Approval timeline + actions */}
      <Section title="ขั้นตอนการอนุมัติ" icon={<CheckCircle size={15} />}>
        {/* Manager step action buttons */}
        {isManagerStep && (
          <div className="mb-4 pb-4 flex flex-wrap gap-2" style={{ borderBottom: "1px solid var(--border-light)" }}>
            <button type="button" onClick={() => { setMgAction("approve"); setMgComment(""); }} disabled={busy}
              className="inline-flex items-center gap-2 text-[13px] font-medium px-4 py-2 rounded-lg cursor-pointer"
              style={{ background: "var(--bg-info-green)", color: "var(--text-info-green)", border: "1px solid var(--border-info-green)" }}>
              <ThumbsUp size={14} /> อนุมัติ
            </button>
            <button type="button" onClick={() => { setMgAction("return"); setMgComment(""); }} disabled={busy}
              className="inline-flex items-center gap-2 text-[13px] font-medium px-4 py-2 rounded-lg cursor-pointer"
              style={{ background: "var(--bg-info-yellow)", color: "var(--text-info-yellow)", border: "1px solid var(--border-info-yellow)" }}>
              <RotateCcw size={14} /> ส่งกลับแก้ไข
            </button>
            <button type="button" onClick={() => { setMgAction("reject"); setMgComment(""); }} disabled={busy}
              className="inline-flex items-center gap-2 text-[13px] font-medium px-4 py-2 rounded-lg cursor-pointer"
              style={{ color: "var(--color-danger)", border: "1px solid rgba(220,38,38,0.25)", background: "rgba(220,38,38,0.06)" }}>
              <ThumbsDown size={14} /> ไม่อนุมัติ
            </button>
          </div>
        )}

        {/* Account step — PV/PPEX doc no. + payment date panel. API authorizes; 403 toasts. */}
        {isAccountStep && (
          <div className="mb-4 pb-4 flex flex-col gap-3" style={{ borderBottom: "1px solid var(--border-light)" }}>
            <p className="text-[11px] m-0" style={{ color: "var(--text-muted)" }}>
              ขั้นตอน: {CLR_STEP_LABEL_TH.ACCOUNT}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold" style={{ color: "var(--text-secondary)" }}>เลขที่ PV / PPEX</label>
                <input className="text-[13px] px-3 py-2 rounded-lg outline-none"
                  style={{ background: "var(--bg-input)", color: "var(--text-primary)", border: "1px solid var(--border-input)" }}
                  value={pvDocNo} onChange={(e) => setPvDocNo(e.target.value)} placeholder="เช่น PV2601-0001" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold" style={{ color: "var(--text-secondary)" }}>
                  วันจ่าย{companyPaysExtra ? " *" : ""}
                </label>
                {companyPaysExtra ? (
                  <>
                    {/* Locked to the rounds treasury actually pays on. It used to
                        be a bare date input whose only rule was "not in the
                        past", and the word (ศุกร์) on the label was the whole of
                        the policy — this date becomes the G/L posting date in
                        BC, where an off-cycle one matches no payment run and a
                        closed-period one is refused after three approvals. */}
                    <PaymentDatePicker
                      value={paymentDate}
                      onChange={setPaymentDate}
                      allowedDates={paymentRounds}
                    />
                    <span className="text-[10px]" style={{ color: paymentDateOffCycle ? "var(--color-danger)" : "var(--text-faint)" }}>
                      {paymentDateOffCycle
                        ? "วันจ่ายเดิมไม่อยู่ในรอบที่กำหนดแล้ว — เลือกใหม่ก่อนอนุมัติ"
                        : "บริษัทต้องจ่ายเพิ่ม — เลือกรอบจ่าย (ศุกร์ที่ 2/4)"}
                    </span>
                  </>
                ) : (
                  <>
                    {/* Nothing to choose. The employee's transfer already has a
                        date and the journal posts on it either way, so a second
                        editable field could only ever disagree with the first. */}
                    <div className="text-[13px] px-3 py-2 rounded-lg"
                      style={{ background: "var(--bg-card-alt)", color: "var(--text-muted)", border: "1px dashed var(--border-card)" }}>
                      {fmtDateOnly(clear?.refundTransferDate ?? null) || "—"}
                    </div>
                    <span className="text-[10px]" style={{ color: "var(--text-faint)" }}>
                      {(clear?.refundToCompany ?? 0) > 0
                        ? "พนักงานโอนคืนบริษัท — ใช้วันที่โอนคืน แก้ที่ช่อง “วันที่โอนเงินคืน”"
                        : "ไม่มีการจ่ายเงิน"}
                    </span>
                  </>
                )}
              </div>
            </div>
            <label className="text-[12px] flex items-center gap-2" style={{ color: "var(--text-secondary)" }}>
              <input type="checkbox" checked={accChecked} onChange={(e) => setAccChecked(e.target.checked)} />
              ตรวจสอบแล้ว
            </label>
            {missingVendorLines.length > 0 && (
              <p className="text-[12px] m-0 px-3 py-2 rounded-lg"
                style={{ background: "var(--bg-info-yellow)", color: "var(--text-info-yellow)", border: "1px solid var(--border-info-yellow)" }}>
                รายการที่ {missingVendorLines.join(", ")} มี VAT แต่ยังไม่ได้เลือก Vendor ผู้ขาย —
                เลือกในคอลัมน์ “Vendor” ของตารางด้านบน แล้วบันทึก จึงจะอนุมัติได้
              </p>
            )}
            {refundGap && (
              <p className="text-[12px] m-0 px-3 py-2 rounded-lg"
                style={{ background: "var(--bg-info-yellow)", color: "var(--text-info-yellow)", border: "1px solid var(--border-info-yellow)" }}>
                {refundEvidenceMessage(refundGap)}
              </p>
            )}
            {missingGlLines.length > 0 && (
              <p className="text-[12px] m-0 px-3 py-2 rounded-lg"
                style={{ background: "var(--bg-info-yellow)", color: "var(--text-info-yellow)", border: "1px solid var(--border-info-yellow)" }}>
                รายการที่ {missingGlLines.join(", ")} ยังไม่ได้เลือก “รายการ” (หมวดบัญชี) —
                เลือกในตารางด้านบน แล้วบันทึก จึงจะอนุมัติได้
              </p>
            )}
            {pndProblem && (
              <p className="text-[12px] m-0 px-3 py-2 rounded-lg"
                style={{ background: "var(--bg-info-yellow)", color: "var(--text-info-yellow)", border: "1px solid var(--border-info-yellow)" }}>
                {pndProblem}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={handleAccountApprove} disabled={busy || accountBlocked}
                title={accountBlocked ? (pndProblem ?? "ต้องเลือก Vendor ผู้ขายของรายการที่มี VAT ให้ครบก่อน") : undefined}
                className="inline-flex items-center gap-2 text-[13px] font-medium px-4 py-2 rounded-lg"
                style={{ background: "var(--bg-info-green)", color: "var(--text-info-green)", border: "1px solid var(--border-info-green)",
                  opacity: accountBlocked ? 0.5 : 1,
                  cursor: accountBlocked ? "not-allowed" : "pointer" }}>
                <ThumbsUp size={14} /> อนุมัติ
              </button>
              <button type="button" onClick={() => { setAccAction("return"); setAccComment(""); }} disabled={busy}
                className="inline-flex items-center gap-2 text-[13px] font-medium px-4 py-2 rounded-lg cursor-pointer"
                style={{ background: "var(--bg-info-yellow)", color: "var(--text-info-yellow)", border: "1px solid var(--border-info-yellow)" }}>
                <RotateCcw size={14} /> ส่งกลับแก้ไข
              </button>
              <button type="button" onClick={() => { setAccAction("reject"); setAccComment(""); }} disabled={busy}
                className="inline-flex items-center gap-2 text-[13px] font-medium px-4 py-2 rounded-lg cursor-pointer"
                style={{ color: "var(--color-danger)", border: "1px solid rgba(220,38,38,0.25)", background: "rgba(220,38,38,0.06)" }}>
                <ThumbsDown size={14} /> ไม่อนุมัติ
              </button>
            </div>

            {/* The account step's work: correct the lines, name each seller's
                vendor. Always open, and it saves itself. */}
            <div className="mt-1">
              {(
                <div className="mt-1 flex flex-col gap-3">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <p className="text-[11px] m-0" style={{ color: "var(--text-muted)" }}>
                      แก้ไขได้เฉพาะในขั้นบัญชี (ACCOUNT) — บันทึกอัตโนมัติ
                    </p>
                    <SaveStatus state={saveState} onRetry={() => void saveNow()} />
                    {/* One ask for every tax id the registry has not answered
                        for yet. Counted by id, not by row: six receipts from
                        one seller are one question. It never forces a refresh —
                        a stored answer never expires, and the way to get a
                        newer one is ตรวจใหม่ on that row. */}
                    {(() => {
                      const pending = tinsNeedingRdCheck(editItems, rdByTin);
                      return (
                        <button
                          type="button"
                          disabled={pending.length === 0}
                          title={pending.length === 0 ? "ตรวจกับกรมสรรพากรครบทุกเลขแล้ว" : undefined}
                          onClick={() => pending.forEach((tin) => void askRd(tin))}
                          className="text-[11px] px-2 py-0.5 rounded-lg border-none"
                          style={{
                            background: pending.length === 0 ? "var(--bg-card-alt)" : "var(--nav-active-bg)",
                            color: pending.length === 0 ? "var(--text-faint)" : "var(--nav-active-text)",
                            cursor: pending.length === 0 ? "default" : "pointer",
                          }}
                        >
                          {pending.length === 0
                            ? "ตรวจสรรพากรครบแล้ว"
                            : `ตรวจสรรพากร (${pending.length} รายการ)`}
                        </button>
                      );
                    })()}
                  </div>
                  {/* show-x-scroll: `.acc-theme *` hides every scrollbar, so a
                      table wider than the page scrolled with nothing on screen
                      to say it could — the ก่อน VAT / VAT / WHT columns sat off
                      the right edge and looked missing. The AP-3 form's own grid
                      already opts back in; this one had not. */}
                  <div className="overflow-x-auto show-x-scroll pb-1 -mx-1 px-1">
                    <table className="w-full border-collapse" style={{ minWidth: 1500 }}>
                      <thead>
                        <tr className="text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                          <th className="px-2 py-1.5 text-left" style={{ borderBottom: "1px solid var(--border-card)", whiteSpace: "nowrap" }}>#</th>
                          <th className="px-2 py-1.5 text-left" style={{ borderBottom: "1px solid var(--border-card)", whiteSpace: "nowrap" }}>วันที่</th>
                          <th className="px-2 py-1.5 text-left" style={{ borderBottom: "1px solid var(--border-card)", whiteSpace: "nowrap" }}>รายละเอียด</th>
                          {canSeeGlAccount && (
                            <th className="px-2 py-1.5 text-left" style={{ borderBottom: "1px solid var(--border-card)", whiteSpace: "nowrap" }}>รายการ</th>
                          )}
                          {/* From the tax invoice, and accounting holds it — so
                              they can type what the OCR could not read. These
                              three become the VAT line's Tax Invoice No., VAT
                              registration and Tax Invoice Name. */}
                          <th className="px-2 py-1.5 text-left" style={{ borderBottom: "1px solid var(--border-card)", whiteSpace: "nowrap" }}>เลขที่ใบกำกับ</th>
                          <th className="px-2 py-1.5 text-left" style={{ borderBottom: "1px solid var(--border-card)", whiteSpace: "nowrap" }}>เลขผู้เสียภาษี</th>
                          <th className="px-2 py-1.5 text-left" style={{ borderBottom: "1px solid var(--border-card)", whiteSpace: "nowrap" }}>ชื่อผู้ขาย</th>
                          <th className="px-2 py-1.5 text-left" style={{ borderBottom: "1px solid var(--border-card)", whiteSpace: "nowrap" }}>สาขาผู้ขาย</th>
                          <th className="px-2 py-1.5 text-left" style={{ borderBottom: "1px solid var(--border-card)", whiteSpace: "nowrap" }}>RD</th>
                          <th className="px-2 py-1.5 text-left" style={{ borderBottom: "1px solid var(--border-card)", whiteSpace: "nowrap" }}>Vendor</th>
                          <th className="px-2 py-1.5 text-right" style={{ borderBottom: "1px solid var(--border-card)", whiteSpace: "nowrap" }}>ก่อน VAT</th>
                          <th className="px-2 py-1.5 text-right" style={{ borderBottom: "1px solid var(--border-card)", whiteSpace: "nowrap" }}>VAT</th>
                          <th className="px-2 py-1.5 text-right" style={{ borderBottom: "1px solid var(--border-card)", whiteSpace: "nowrap" }}>WHT</th>
                        </tr>
                      </thead>
                      <tbody>
                        {editItems.map((it, i) => (
                          <tr key={it.id ?? i} className="text-[12px]" style={{ color: "var(--text-primary)" }}>
                            <td className="px-2 py-1.5" style={{ borderBottom: "1px solid var(--border-light)" }}>{i + 1}</td>
                            <td className="px-2 py-1.5" style={{ borderBottom: "1px solid var(--border-light)" }}>
                              <input
                                type="date"
                                className="text-[12px] px-2 py-1 rounded outline-none w-36"
                                style={{ background: "var(--bg-input)", color: "var(--text-primary)", border: "1px solid var(--border-input)" }}
                                value={it.expenseDate ?? ""}
                                onChange={(e) => {
                                  const next = [...editItems];
                                  next[i] = { ...next[i], expenseDate: e.target.value || null };
                                  setEditItems(next);
                                }}
                              />
                            </td>
                            <td className="px-2 py-1.5" style={{ borderBottom: "1px solid var(--border-light)" }}>
                              <input
                                className="text-[12px] px-2 py-1 rounded outline-none w-48"
                                style={{ background: "var(--bg-input)", color: "var(--text-primary)", border: "1px solid var(--border-input)" }}
                                value={it.description ?? ""}
                                placeholder="รายละเอียด"
                                onChange={(e) => {
                                  const next = [...editItems];
                                  next[i] = { ...next[i], description: e.target.value };
                                  setEditItems(next);
                                }}
                              />
                            </td>
                            {canSeeGlAccount && (
                              <td className="px-2 py-1.5" style={{ borderBottom: "1px solid var(--border-light)", minWidth: 200 }}>
                                <GlCell
                                  line={it}
                                  optionsByBranch={glByBranch}
                                  glForced={glForced}
                                  onPick={(o) => {
                                    const next = [...editItems];
                                    next[i] = {
                                      ...next[i],
                                      glAccountNo: o?.glAccountNo ?? null,
                                      glAccountName: o?.nameTh ?? null,
                                    };
                                    setEditItems(next);
                                  }}
                                />
                              </td>
                            )}
                            <td className="px-2 py-1.5" style={{ borderBottom: "1px solid var(--border-light)" }}>
                              <input
                                className="text-[12px] px-2 py-1 rounded outline-none w-32"
                                style={{ background: "var(--bg-input)", color: "var(--text-primary)", border: "1px solid var(--border-input)" }}
                                value={it.docNo ?? ""}
                                placeholder="เลขที่ใบกำกับ"
                                onChange={(e) => {
                                  const next = [...editItems];
                                  next[i] = { ...next[i], docNo: e.target.value || null };
                                  setEditItems(next);
                                }}
                              />
                            </td>
                            <td className="px-2 py-1.5" style={{ borderBottom: "1px solid var(--border-light)" }}>
                              {/* Digits only, thirteen of them. Anything else in
                                  this box is a typo or a paste that brought its
                                  formatting along, and the RD lookup asks only
                                  about a 13-digit number — so a fourteenth digit
                                  typed by accident used to turn a working field
                                  into one that quietly stopped checking. */}
                              <input
                                className="text-[12px] px-2 py-1 rounded outline-none w-36"
                                style={{
                                  background: "var(--bg-input)", color: "var(--text-primary)",
                                  border: `1px solid ${taxIdNotice(it.taxId) ? "var(--color-warning)" : "var(--border-input)"}`,
                                }}
                                value={it.taxId ?? ""}
                                placeholder="เลข 13 หลัก"
                                inputMode="numeric"
                                maxLength={13}
                                onChange={(e) => {
                                  const next = [...editItems];
                                  next[i] = { ...next[i], taxId: normalizeTaxIdInput(e.target.value) || null };
                                  setEditItems(next);
                                }}
                              />
                              {taxIdNotice(it.taxId) && (
                                <div className="text-[10px] mt-0.5" style={{ color: "var(--color-warning)", maxWidth: "9rem" }}>
                                  {taxIdNotice(it.taxId)}
                                </div>
                              )}
                            </td>
                            <td className="px-2 py-1.5" style={{ borderBottom: "1px solid var(--border-light)" }}>
                              <input
                                className="text-[12px] px-2 py-1 rounded outline-none w-48"
                                style={{ background: "var(--bg-input)", color: "var(--text-primary)", border: "1px solid var(--border-input)" }}
                                value={it.payeeName ?? ""}
                                placeholder="ชื่อผู้ขาย"
                                onChange={(e) => {
                                  const next = [...editItems];
                                  next[i] = { ...next[i], payeeName: e.target.value || null };
                                  setEditItems(next);
                                }}
                              />
                            </td>
                            <td className="px-2 py-1.5" style={{ borderBottom: "1px solid var(--border-light)" }}>
                              <input
                                className="text-[12px] px-2 py-1 rounded outline-none w-24"
                                style={{ background: "var(--bg-input)", color: "var(--text-primary)", border: "1px solid var(--border-input)" }}
                                value={it.taxBranchCode ?? ""}
                                placeholder="00000"
                                maxLength={5}
                                onChange={(e) => {
                                  const next = [...editItems];
                                  next[i] = { ...next[i], taxBranchCode: e.target.value || null };
                                  setEditItems(next);
                                }}
                              />
                            </td>
                            <td className="px-2 py-1.5" style={{ borderBottom: "1px solid var(--border-light)" }}>
                              <RdCell
                                item={it}
                                answer={rdByTin[(it.taxId ?? "").replace(/\D/g, "")]}
                                onRecheck={(refresh) => void askRd((it.taxId ?? "").replace(/\D/g, ""), refresh)}
                                onApply={(patch) => {
                                  const next = [...editItems];
                                  next[i] = { ...next[i], ...patch };
                                  setEditItems(next);
                                }}
                              />
                            </td>
                            <td className="px-2 py-1.5" style={{ borderBottom: "1px solid var(--border-light)", minWidth: 200 }}>
                              <VendorCell
                                item={it}
                                vendors={vendors}
                                list={vendorList}
                                onLoad={() => void loadVendors()}
                                onPick={(vendorNo) => {
                                  const next = [...editItems];
                                  next[i] = { ...next[i], taxVendorNo: vendorNo };
                                  setEditItems(next);
                                }}
                              />
                            </td>
                            <td className="px-2 py-1.5 text-right" style={{ borderBottom: "1px solid var(--border-light)" }}>
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                className="text-[12px] px-2 py-1 rounded outline-none w-28 text-right tabular-nums"
                                style={{ background: "var(--bg-input)", color: "var(--text-primary)", border: "1px solid var(--border-input)" }}
                                value={it.amountBeforeVat ?? ""}
                                onChange={(e) => {
                                  const next = [...editItems];
                                  next[i] = { ...next[i], amountBeforeVat: e.target.value === "" ? null : Number(e.target.value) };
                                  setEditItems(next);
                                }}
                              />
                            </td>
                            <td className="px-2 py-1.5 text-right" style={{ borderBottom: "1px solid var(--border-light)" }}>
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                className="text-[12px] px-2 py-1 rounded outline-none w-24 text-right tabular-nums"
                                style={{ background: "var(--bg-input)", color: "var(--text-primary)", border: "1px solid var(--border-input)" }}
                                value={it.vatAmount ?? ""}
                                onChange={(e) => {
                                  const next = [...editItems];
                                  next[i] = { ...next[i], vatAmount: e.target.value === "" ? null : Number(e.target.value) };
                                  setEditItems(next);
                                }}
                              />
                            </td>
                            <td className="px-2 py-1.5 text-right" style={{ borderBottom: "1px solid var(--border-light)" }}>
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                className="text-[12px] px-2 py-1 rounded outline-none w-24 text-right tabular-nums"
                                style={{ background: "var(--bg-input)", color: "var(--text-primary)", border: "1px solid var(--border-input)" }}
                                value={it.whtAmount ?? ""}
                                onChange={(e) => {
                                  const next = [...editItems];
                                  next[i] = { ...next[i], whtAmount: e.target.value === "" ? null : Number(e.target.value) };
                                  setEditItems(next);
                                }}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {editWht.length > 0 && (
                    <div className="flex flex-col gap-2">
                      <p className="text-[11px] font-bold m-0" style={{ color: "var(--text-muted)" }}>
                        ประเภท ภ.ง.ด. ต่อผู้รับเงิน
                      </p>
                      {editWht.map((w, i) => (
                        <div key={w.id ?? i} className="flex items-center gap-2 flex-wrap">
                          <span className="text-[12px] min-w-0 grow" style={{ color: "var(--text-primary)" }}>
                            {w.payeeName ?? "—"}
                            <span className="text-[11px] ml-2" style={{ color: "var(--text-muted)" }}>
                              {w.taxId ?? "ไม่มีเลขผู้เสียภาษี"}
                            </span>
                          </span>
                          <select
                            className="text-[12px] px-2 py-1 rounded-lg"
                            style={{ background: "var(--bg-card)", color: "var(--text-primary)", border: "1px solid var(--border-card)" }}
                            value={w.pndType ?? ""}
                            onChange={(e) => {
                              const v = e.target.value as "PND3" | "PND53" | "";
                              setEditWht((prev) => prev.map((x, j) => (
                                j === i ? { ...x, pndType: v || null } : x
                              )));
                            }}>
                            <option value="">— ยังไม่ระบุ —</option>
                            <option value="PND3">{PND_LABEL.PND3}</option>
                            <option value="PND53">{PND_LABEL.PND53}</option>
                          </select>
                        </div>
                      ))}
                    </div>
                  )}

                </div>
              )}
            </div>
          </div>
        )}

        {/* Head step — check + approve / revise / reject. */}
        {isHeadStep && (
          <div className="mb-4 pb-4 flex flex-col gap-3" style={{ borderBottom: "1px solid var(--border-light)" }}>
            <p className="text-[11px] m-0" style={{ color: "var(--text-muted)" }}>
              ขั้นตอน: {CLR_STEP_LABEL_TH.HEAD}
            </p>
            <label className="text-[12px] flex items-center gap-2" style={{ color: "var(--text-secondary)" }}>
              <input type="checkbox" checked={accChecked} onChange={(e) => setAccChecked(e.target.checked)} />
              ตรวจสอบแล้ว
            </label>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => act("approve", { isChecked: accChecked })} disabled={busy}
                className="inline-flex items-center gap-2 text-[13px] font-medium px-4 py-2 rounded-lg cursor-pointer"
                style={{ background: "var(--bg-info-green)", color: "var(--text-info-green)", border: "1px solid var(--border-info-green)" }}>
                <ThumbsUp size={14} /> อนุมัติ
              </button>
              <button type="button" onClick={() => { setAccAction("return"); setAccComment(""); }} disabled={busy}
                className="inline-flex items-center gap-2 text-[13px] font-medium px-4 py-2 rounded-lg cursor-pointer"
                style={{ background: "var(--bg-info-yellow)", color: "var(--text-info-yellow)", border: "1px solid var(--border-info-yellow)" }}>
                <RotateCcw size={14} /> ส่งกลับแก้ไข
              </button>
              <button type="button" onClick={() => { setAccAction("reject"); setAccComment(""); }} disabled={busy}
                className="inline-flex items-center gap-2 text-[13px] font-medium px-4 py-2 rounded-lg cursor-pointer"
                style={{ color: "var(--color-danger)", border: "1px solid rgba(220,38,38,0.25)", background: "rgba(220,38,38,0.06)" }}>
                <ThumbsDown size={14} /> ไม่อนุมัติ
              </button>
            </div>
          </div>
        )}

        {/* 3-step timeline (MANAGER → ACCOUNT → HEAD) */}
        <div className="flex flex-col gap-0">
          {CLR_STEP_CODES.map((code, idx) => {
            const a = approvalsByStep.get(code);
            const status = a?.status ?? "Pending";
            const isLast = idx === CLR_STEP_CODES.length - 1;
            const who = a?.actionedByName ?? a?.assignedName ?? null;
            return (
              <div key={code} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
                    style={
                      status === "Approved" ? { background: "var(--bg-info-green)", color: "var(--text-info-green)", border: "1px solid var(--border-info-green)" }
                      : status === "Rejected" ? { background: "rgba(220,38,38,0.08)", color: "var(--color-danger)", border: "1px solid rgba(220,38,38,0.2)" }
                      : status === "Returned" ? { background: "var(--bg-info-yellow)", color: "var(--text-info-yellow)", border: "1px solid var(--border-info-yellow)" }
                      : { background: "var(--bg-badge)", color: "var(--text-muted)", border: "1px solid var(--border-card)" }
                    }>
                    {status === "Approved" ? <CheckCircle size={14} /> : status === "Rejected" ? <XCircle size={14} />
                      : status === "Returned" ? <RotateCcw size={13} /> : <Clock size={13} />}
                  </div>
                  {!isLast && <div className="w-px flex-1 my-1" style={{ background: "var(--border-light)", minHeight: 16 }} />}
                </div>
                <div className="flex-1 pb-4">
                  <div className="mb-1"><ApprovalStatusBadge status={status} /></div>
                  <div className="mb-0.5">
                    <span className="text-[13px] font-medium" style={{ color: "var(--text-heading)" }}>
                      {CLR_STEP_LABEL_TH[code]}
                    </span>
                  </div>
                  {who && (
                    <p className="text-[11px] m-0" style={{ color: "var(--text-muted)" }}>
                      {status === "Pending" ? "รอดำเนินการโดย" : status === "Approved" ? "อนุมัติโดย"
                        : status === "Rejected" ? "ไม่อนุมัติโดย" : "ส่งกลับโดย"} {who}
                    </p>
                  )}
                  {a?.comment && (
                    <p className="text-[12px] mt-1 px-2 py-1.5 rounded-lg"
                      style={{ color: "var(--text-secondary)", background: "var(--bg-card-alt)", border: "1px solid var(--border-light)" }}>
                      {a.comment}
                    </p>
                  )}
                  {a?.actionedAt && (
                    <p className="text-[10px] mt-1" style={{ color: "var(--text-faint)" }}>{fmtDate(a.actionedAt)}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      {/* Request summary */}
      <Section title="รายละเอียดคำขอ" icon={<FileText size={15} />}>
        <div className="flex flex-col gap-2.5">
          <DetailRow label="เลขที่คำขอ" value={request.requestNo ?? "ฉบับร่าง"} />
          <DetailRow label="สถานะ" value={<RequestStatusBadge status={request.status} />} />
          <DetailRow label="แบรนด์ / เป็นค่าใช้จ่ายของ" value={request.brandCode} />
          {clear?.pvDocNo && <DetailRow label="เลขที่ PV / PPEX" value={clear.pvDocNo} />}
          {clear?.paymentDate && <DetailRow label="วันจ่าย" value={fmtDateOnly(clear.paymentDate)} />}
          {request.submittedAt && <DetailRow label="วันที่ส่ง" value={fmtDate(request.submittedAt)} />}
        </div>
      </Section>

      {/* Requester */}
      <Section title="ผู้ขอ" icon={<User size={15} />}>
        <div className="flex items-center gap-3 min-w-0">
          <div className="shrink-0 rounded-2xl overflow-hidden" style={{ boxShadow: "0 0 0 2px var(--nav-active-bg)" }}>
            <Avatar name={request.requesterFullName || "?"} size={48} photo={hrPhotoUrl(request.staffId)} color="var(--nav-active-text)" />
          </div>
          <div className="min-w-0 flex flex-col gap-0.5">
            <div className="flex items-baseline gap-2 min-w-0">
              <span className="text-[14px] font-bold truncate" style={{ color: "var(--text-primary)" }}>{request.requesterFullName || "-"}</span>
              {request.staffId != null && <span className="text-[11px] shrink-0" style={{ color: "var(--text-muted)" }}>#{request.staffId}</span>}
            </div>
            {(request.requesterDepartmentName || request.requesterPosition) && (
              <span className="text-[12px] truncate" style={{ color: "var(--text-muted)" }}>
                {[request.requesterDepartmentName, request.requesterPosition].filter(Boolean).join(" · ")}
              </span>
            )}
            {request.requesterEmail && (
              <span className="inline-flex items-center gap-1 text-[12px] truncate" style={{ color: "var(--text-secondary)" }}>
                <Mail size={11} className="shrink-0" /> <span className="truncate">{request.requesterEmail}</span>
              </span>
            )}
          </div>
        </div>
      </Section>

      {/* Linked advance + expense ledger */}
      <Section title="เงินทดรองจ่ายที่เคลียร์" icon={<Wallet size={15} />}>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <AmountTile label="เลขที่ AP-2" value={clear?.advanceRequestNo ?? "—"} plain />
          {/* Beside the AP-2 number because it is the same advance, named the
              way BC names it — the number an accountant reconciles against. */}
          <AmountTile label="Doc No (BC)" {...advanceBcDocLabel(clear?.advanceErpDocumentNo, clear?.advanceErpStatus)} plain />
          <AmountTile label="วงเงินที่ได้รับ" value={`฿${money(clear?.advanceAmount)}`} />
          <AmountTile label="ใช้จ่ายจริง (สุทธิ)" value={`฿${money(clear?.actualTotal)}`} />
        </div>

        {/* Expense-line table with running balance */}
        <div className="mt-4">
          <p className="text-[10px] font-semibold uppercase tracking-wide m-0 mb-2" style={{ color: "var(--text-muted)" }}>
            รายการค่าใช้จ่ายจริง
          </p>
          {items.length === 0 ? (
            <p className="text-[12px] m-0" style={{ color: "var(--text-muted)" }}>— ไม่มีรายการ</p>
          ) : (
            <ExpenseTable items={items} advanceAmount={clear?.advanceAmount ?? 0} showGl={canSeeGlAccount} />
          )}
        </div>

        {/* Refund / extra summary */}
        <RefundBanner refund={refund} />
      </Section>

      {/* WHT certificate table */}
      {whtItems.length > 0 && (
        <Section title="หนังสือรับรองการหักภาษี ณ ที่จ่าย" icon={<ReceiptText size={15} />}>
          <div className="overflow-x-auto show-x-scroll pb-1 -mx-1 px-1">
            <table className="w-full border-collapse" style={{ minWidth: 820 }}>
              <thead>
                <tr className="text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                  <ThD>#</ThD><ThD>วันที่</ThD><ThD>เลขผู้เสียภาษี</ThD><ThD>ชื่อผู้รับ</ThD>
                  <ThD>ที่อยู่</ThD><ThD>ภ.ง.ด.</ThD><ThD right>ค่าใช้จ่าย</ThD><ThD right>WHT</ThD><ThD right>สุทธิ</ThD>
                </tr>
              </thead>
              <tbody>
                {whtItems.map((w, i) => (
                  <tr key={w.id ?? i} className="text-[12px]" style={{ color: "var(--text-primary)" }}>
                    <TdD>{i + 1}</TdD>
                    <TdD>{fmtDateOnly(w.expenseDate)}</TdD>
                    <TdD>{w.taxId ?? "—"}</TdD>
                    <TdD>{w.payeeName ?? "—"}</TdD>
                    <TdD>{w.payeeAddress ?? "—"}</TdD>
                    {/* Blank is not "individual" — it means nobody has decided,
                        and the send refuses on it. Shown as its own state. */}
                    <TdD>
                      {w.pndType ? (
                        PND_LABEL[w.pndType]
                      ) : (
                        <span style={{ color: "var(--text-warning)" }}>ยังไม่ระบุ</span>
                      )}
                    </TdD>
                    <TdD right>{money(w.amount)}</TdD>
                    <TdD right>{money(w.whtAmount)}</TdD>
                    <TdD right>{money(w.netAmount)}</TdD>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {/* Refund transfer proof (only when returning money) */}
      {(refund > 0 || clear?.refundTransferDate || refundProofFiles.length > 0) && (
        <Section title="การโอนเงินคืนบริษัท" icon={<Banknote size={15} />}>
          <div className="flex flex-col gap-3">
            <DetailRow
              label="จำนวนเงินที่โอนคืนจริง"
              value={
                clear?.refundTransferAmount != null ? (
                  (() => {
                    /* Red, and the figure goes red with it. A slip that
                       disagrees with the amount owed is the one thing on this
                       card an accountant has to catch, and it was an amber
                       11px note beside a black number: the number read as
                       settled and the note did not argue loudly enough (user,
                       2026-09-11).

                       Two different disagreements, because they are two
                       different mistakes. The note used to print
                       "ต้องโอนคืน ฿{refund}" for both, which on a clearing the
                       company pays out reads "must return ฿-2,319" — nothing is
                       owed back there, and a slip on it is the anomaly. */
                    const paid = clear.refundTransferAmount ?? 0;
                    const owed = refund > 0 ? refund : 0;
                    const problem =
                      refund > 0
                        ? (Math.abs(paid - refund) > 0.01
                            ? `⚠ ต้องโอนคืน ฿${owed.toLocaleString()}`
                            : null)
                        : (paid > 0 ? "⚠ ใบนี้บริษัทเป็นฝ่ายจ่าย — ไม่ควรมียอดโอนคืน" : null);
                    return (
                      <span style={problem ? { color: "var(--text-danger)", fontWeight: 700 } : undefined}>
                        ฿{paid.toLocaleString()}
                        {problem && (
                          <span className="text-[12px] ml-2 font-bold" style={{ color: "var(--text-danger)" }}>
                            {problem}
                          </span>
                        )}
                      </span>
                    );
                  })()
                ) : "—"
              }
            />
            <DetailRow label="วันที่โอนเงินคืน" value={clear?.refundTransferDate ? fmtDateOnly(clear.refundTransferDate) : "—"} />
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide m-0 mb-1.5" style={{ color: "var(--text-muted)" }}>
                หลักฐานการโอนคืน ({refundProofFiles.length})
              </p>
              <FileThumbs files={refundProofFiles} onView={openFileViewer} />
            </div>
          </div>
        </Section>
      )}

      {/* Receipts */}
      <Section title={`ใบเสร็จ / ใบกำกับภาษี (${files.length})`} icon={<Paperclip size={15} />}>
        <FileThumbs files={files} onView={openFileViewer} />
      </Section>

      {/* Manager approve confirm dialog */}
      <Dialog open={mgAction === "approve"} onOpenChange={(o) => { if (!o) setMgAction(null); }} title="ยืนยันการอนุมัติ">
        <p className="text-[13px] mb-6" style={{ color: "var(--text-secondary)" }}>
          อนุมัติคำขอเลขที่ <strong style={{ color: "var(--text-heading)" }}>{request.requestNo ?? "ฉบับร่าง"}</strong> ใช่หรือไม่?
        </p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => setMgAction(null)} disabled={busy}
            className="text-[13px] font-medium px-4 py-2 rounded-lg"
            style={{ color: "var(--text-secondary)", background: "var(--bg-card-alt)", border: "1px solid var(--border-card)" }}>ยกเลิก</button>
          <button type="button" onClick={handleManagerAction} disabled={busy}
            className="text-[13px] font-medium px-4 py-2 rounded-lg"
            style={{ background: "var(--bg-info-green)", color: "var(--text-info-green)", border: "1px solid var(--border-info-green)", opacity: busy ? 0.7 : 1 }}>
            {busy ? "กำลังดำเนินการ..." : "ยืนยัน อนุมัติ"}
          </button>
        </div>
      </Dialog>

      {/* Manager return / reject reason dialog */}
      <Dialog open={mgAction === "return" || mgAction === "reject"} onOpenChange={(o) => { if (!o) setMgAction(null); }}
        title={mgAction === "return" ? "ส่งกลับแก้ไข — ระบุเหตุผล" : "ไม่อนุมัติ — ระบุเหตุผล"}>
        <textarea rows={3} className="w-full rounded-lg px-3 py-2 text-[13px] outline-none mb-5"
          style={{ background: "var(--bg-input)", color: "var(--text-primary)", border: "1px solid var(--border-input)" }}
          placeholder="ระบุเหตุผล / ความคิดเห็น..." value={mgComment} onChange={(e) => setMgComment(e.target.value)} />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => setMgAction(null)} disabled={busy}
            className="text-[13px] font-medium px-4 py-2 rounded-lg"
            style={{ color: "var(--text-secondary)", background: "var(--bg-card-alt)", border: "1px solid var(--border-card)" }}>ยกเลิก</button>
          <button type="button" onClick={handleManagerAction} disabled={busy || !mgComment.trim()}
            className="text-[13px] font-medium px-4 py-2 rounded-lg"
            style={{ background: mgAction === "return" ? "var(--bg-info-yellow)" : "var(--color-danger)",
              color: mgAction === "return" ? "var(--text-info-yellow)" : "#fff", opacity: busy || !mgComment.trim() ? 0.7 : 1 }}>
            {busy ? "กำลังดำเนินการ..." : mgAction === "return" ? "ยืนยัน ส่งกลับแก้ไข" : "ยืนยัน ไม่อนุมัติ"}
          </button>
        </div>
      </Dialog>

      {/* Account/Head revise (return) or reject reason dialog */}
      <Dialog open={accAction !== null} onOpenChange={(o) => { if (!o) setAccAction(null); }}
        title={accAction === "return" ? "ส่งกลับแก้ไข — ระบุเหตุผล" : "ไม่อนุมัติ — ระบุเหตุผล"}>
        <textarea rows={3} className="w-full rounded-lg px-3 py-2 text-[13px] outline-none mb-5"
          style={{ background: "var(--bg-input)", color: "var(--text-primary)", border: "1px solid var(--border-input)" }}
          placeholder={accAction === "return" ? "ระบุสิ่งที่ต้องแก้ไข..." : "ระบุเหตุผลที่ไม่อนุมัติ..."}
          value={accComment} onChange={(e) => setAccComment(e.target.value)} />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => setAccAction(null)} disabled={busy}
            className="text-[13px] font-medium px-4 py-2 rounded-lg"
            style={{ color: "var(--text-secondary)", background: "var(--bg-card-alt)", border: "1px solid var(--border-card)" }}>ยกเลิก</button>
          <button type="button"
            onClick={() => { if (!accComment.trim()) return toast.error("กรุณาระบุเหตุผล"); act(accAction === "return" ? "return" : "reject", { comment: accComment.trim() }); }}
            disabled={busy || !accComment.trim()}
            className="text-[13px] font-medium px-4 py-2 rounded-lg"
            style={accAction === "return"
              ? { background: "var(--text-info-yellow)", color: "#fff", opacity: busy || !accComment.trim() ? 0.7 : 1 }
              : { background: "var(--color-danger)", color: "#fff", opacity: busy || !accComment.trim() ? 0.7 : 1 }}>
            {busy ? "กำลังดำเนินการ..." : accAction === "return" ? "ยืนยัน ส่งกลับแก้ไข" : "ยืนยัน ไม่อนุมัติ"}
          </button>
        </div>
      </Dialog>

      {/* Cancel confirm dialog */}
      <Dialog open={cancelOpen} onOpenChange={setCancelOpen} title="ยืนยันการยกเลิกคำขอ">
        <p className="text-[13px] mb-6" style={{ color: "var(--text-secondary)" }}>
          คุณต้องการยกเลิกคำขอเลขที่ <strong style={{ color: "var(--text-heading)" }}>{request.requestNo ?? "ฉบับร่าง"}</strong> ใช่หรือไม่? การดำเนินการนี้ไม่สามารถยกเลิกคืนได้
        </p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => setCancelOpen(false)} disabled={busy}
            className="text-[13px] font-medium px-4 py-2 rounded-lg"
            style={{ color: "var(--text-secondary)", background: "var(--bg-card-alt)", border: "1px solid var(--border-card)" }}>ไม่ใช่</button>
          <button type="button" onClick={() => act("cancel")} disabled={busy}
            className="text-[13px] font-medium px-4 py-2 rounded-lg"
            style={{ background: "var(--color-danger)", color: "#fff", opacity: busy ? 0.7 : 1 }}>
            {busy ? "กำลังยกเลิก..." : "ยืนยัน ยกเลิกคำขอ"}
          </button>
        </div>
      </Dialog>

      <AttachmentViewer
        open={viewing != null}
        source={viewing?.source ?? null}
        kind={viewing?.kind ?? "other"}
        onClose={() => setViewing(null)}
      />
    </div>
  );
}

/* ────────────────────────── sub-components ────────────────────────── */

function ThD({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th className={`px-2 py-1.5 font-bold ${right ? "text-right" : "text-left"}`}
      style={{ borderBottom: "1px solid var(--border-card)", whiteSpace: "nowrap" }}>{children}</th>
  );
}
function TdD({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <td className={`px-2 py-1.5 ${right ? "text-right tabular-nums" : ""}`}
      style={{ borderBottom: "1px solid var(--border-light)" }}>{children}</td>
  );
}

/**
 * The read-only expense grid.
 *
 * `showGl` is off for the requester and the manager: the G/L account is
 * accounting's, chosen at the ACCOUNT step, and showing it to the person who
 * did not choose it invites a question they cannot act on. The description
 * beside it is the requester's own words and stays either way — the column
 * simply loses its accounting half rather than disappearing.
 */
function ExpenseTable({
  items,
  advanceAmount,
  showGl,
}: { items: ClearAdvanceItem[]; advanceAmount: number; showGl: boolean }) {
  let cumNet = 0;
  const totals = { before: 0, vat: 0, total: 0, wht: 0, net: 0 };
  const rows = items.map((it, i) => {
    const before = it.amountBeforeVat ?? 0;
    const vat = it.vatAmount ?? 0;
    const total = it.totalInclVat ?? before + vat;
    const wht = it.whtAmount ?? 0;
    const net = it.netAmount ?? total - wht;
    cumNet = Math.round((cumNet + net) * 100) / 100;
    const balance = Math.round((advanceAmount - cumNet) * 100) / 100;
    totals.before += before; totals.vat += vat; totals.total += total; totals.wht += wht; totals.net += net;
    return { it, before, vat, total, wht, net, balance, i };
  });
  return (
    <div className="overflow-x-auto show-x-scroll pb-1 -mx-1 px-1">
      <table className="w-full border-collapse" style={{ minWidth: 980 }}>
        <thead>
          <tr className="text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
            <ThD>#</ThD><ThD>วันที่</ThD><ThD>เลขที่เอกสาร</ThD><ThD>{showGl ? "รายการ" : "รายละเอียด"}</ThD>
            <ThD>สาขา</ThD><ThD right>ก่อน VAT</ThD><ThD right>VAT</ThD><ThD right>รวม</ThD>
            <ThD right>WHT</ThD><ThD right>สุทธิ</ThD><ThD right>คงเหลือ</ThD>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ it, before, vat, total, wht, net, balance, i }) => (
            <tr key={it.id ?? i} className="text-[12px]" style={{ color: "var(--text-primary)" }}>
              <TdD>{i + 1}</TdD>
              <TdD>{fmtDateOnly(it.expenseDate)}</TdD>
              <TdD>{it.docNo ?? "—"}</TdD>
              <TdD>
                {showGl ? (
                  <>
                    <span className="block">{it.glAccountNo ?? "—"}</span>
                    {(it.glAccountName || it.description) && (
                      <span className="block text-[11px]" style={{ color: "var(--text-muted)" }}>
                        {[it.glAccountName, it.description].filter(Boolean).join(" · ")}
                      </span>
                    )}
                  </>
                ) : (
                  <span className="block">{it.description || "—"}</span>
                )}
              </TdD>
              <TdD>{it.branchCode ?? "—"}</TdD>
              <TdD right>{money(before)}</TdD>
              <TdD right>{money(vat)}</TdD>
              <TdD right>{money(total)}</TdD>
              <TdD right>{money(wht)}</TdD>
              <TdD right>{money(net)}</TdD>
              <TdD right>
                <span style={{ color: balance < 0 ? "var(--color-danger)" : undefined }}>{money(balance)}</span>
              </TdD>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="text-[12px] font-bold" style={{ color: "var(--text-heading)", background: "var(--bg-card-alt)" }}>
            <td colSpan={5} className="px-2 py-2 text-[11px]" style={{ color: "var(--text-secondary)" }}>รวมทั้งหมด</td>
            <td className="px-2 py-2 text-right tabular-nums">{money(totals.before)}</td>
            <td className="px-2 py-2 text-right tabular-nums">{money(totals.vat)}</td>
            <td className="px-2 py-2 text-right tabular-nums">{money(totals.total)}</td>
            <td className="px-2 py-2 text-right tabular-nums">{money(totals.wht)}</td>
            <td className="px-2 py-2 text-right tabular-nums" style={{ color: "var(--nav-active-text)" }}>{money(totals.net)}</td>
            <td className="px-2 py-2" />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/**
 * Thumbnails. **Every kind opens the shared in-page viewer** — the one AP-1,
 * AP-4 and AP-17 use — so "view" means view. A non-image used to be an
 * `<a target="_blank">` pointed at the download route, where
 * `attachmentResponseHeaders` serves it `Content-Disposition: attachment`: the
 * tab downloaded the file and closed, which is not viewing it.
 *
 * `attachmentKind` derives the kind from the declared type and then the name —
 * SharePoint hands back `application/octet-stream` often enough that the
 * filename fallback is load-bearing.
 */
function FileThumbs({ files, onView }: { files: AccFileMeta[]; onView: (f: AccFileMeta) => void }) {
  if (files.length === 0) {
    return <p className="text-[12px] m-0" style={{ color: "var(--text-muted)" }}>— ไม่มีเอกสารแนบ</p>;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {files.map((f) => attachmentKind(f.fileName, f.contentType) === "image" ? (
        <button key={f.id} type="button" onClick={() => onView(f)} title={f.fileName}
          className="w-20 h-20 rounded-lg overflow-hidden cursor-pointer border-none p-0" style={{ background: "var(--bg-card-alt)" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={f.url} alt={f.fileName} className="w-full h-full object-cover" />
        </button>
      ) : (
        <button key={f.id} type="button" onClick={() => onView(f)} title={f.fileName}
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-[12px] cursor-pointer"
          style={{ background: "var(--bg-card-alt)", border: "1px solid var(--border-card)", color: "var(--text-primary)" }}>
          <ImageIcon size={13} style={{ color: "var(--nav-active-text)" }} />
          <span className="truncate max-w-[180px]">{f.fileName}</span>
        </button>
      ))}
    </div>
  );
}

/** `muted` is for a tile whose value is the reason there is no value — it
 *  should read as a note, not as a figure. */
function AmountTile({ label, value, text, plain, muted }: {
  label: string; value?: string; text?: string; plain?: boolean; muted?: boolean;
}) {
  const shown = value ?? text ?? "—";
  return (
    <div className="rounded-xl px-3.5 py-3 min-w-0" style={{ background: "var(--bg-card-alt)", border: "1px solid var(--border-card)" }}>
      <p className="text-[10px] font-semibold uppercase tracking-wide m-0 mb-1.5" style={{ color: "var(--text-muted)" }}>{label}</p>
      <p className={`m-0 break-words ${muted ? "text-[12px]" : plain ? "text-[13px] font-semibold" : "text-[15px] font-bold tabular-nums"}`}
        style={{ color: muted ? "var(--text-muted)" : "var(--text-heading)" }}>{shown}</p>
    </div>
  );
}

function RefundBanner({ refund }: { refund: number }) {
  const rounded = Math.round(refund * 100) / 100;
  let tone: { bg: string; border: string; text: string };
  let label: string;
  if (rounded > 0) {
    tone = { bg: "var(--bg-info-green)", border: "var(--border-info-green)", text: "var(--text-info-green)" };
    label = `ต้องโอนคืนบริษัท ฿${money(rounded)}`;
  } else if (rounded < 0) {
    tone = { bg: "var(--bg-info-yellow)", border: "var(--border-info-yellow)", text: "var(--text-info-yellow)" };
    label = `บริษัทต้องจ่ายเพิ่ม ฿${money(Math.abs(rounded))}`;
  } else {
    tone = { bg: "var(--bg-card-alt)", border: "var(--border-card)", text: "var(--text-secondary)" };
    label = "พอดี — ไม่มียอดคืน/จ่ายเพิ่ม";
  }
  return (
    <div className="mt-4 rounded-xl px-4 py-3 flex items-center justify-between gap-3"
      style={{ background: tone.bg, border: `1px solid ${tone.border}` }}>
      <span className="text-[13px] font-bold" style={{ color: tone.text }}>{label}</span>
    </div>
  );
}

/**
 * What autosave is doing, in the one place the eye already is.
 *
 * A toast would be wrong here: it announces a save that is about to happen again
 * on the next keystroke, and it is gone by the time anyone wonders whether the
 * vendor they picked was kept. A failure stays on screen and stays retryable,
 * because the rows are still only on this page until it succeeds.
 */
function SaveStatus({
  state,
  onRetry,
}: {
  state:
    | { kind: "idle" }
    | { kind: "saving" }
    | { kind: "saved"; at: number }
    | { kind: "error"; message: string };
  onRetry: () => void;
}) {
  if (state.kind === "idle") return null;
  if (state.kind === "saving") {
    return (
      <span className="text-[11px]" style={{ color: "var(--text-faint)" }}>
        กำลังบันทึก…
      </span>
    );
  }
  if (state.kind === "saved") {
    const t = new Date(state.at).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
    return (
      <span className="text-[11px]" style={{ color: "var(--text-info-green)" }}>
        ✓ บันทึกแล้ว {t}
      </span>
    );
  }
  return (
    <span className="text-[11px] flex items-center gap-1" style={{ color: "var(--color-danger)" }}>
      บันทึกไม่สำเร็จ — {state.message}
      <button
        type="button"
        onClick={onRetry}
        className="underline cursor-pointer border-none bg-transparent p-0 text-[11px]"
        style={{ color: "var(--nav-active-text)" }}
      >
        ลองใหม่
      </button>
    </span>
  );
}
