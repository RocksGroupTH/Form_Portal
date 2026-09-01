"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  Check, Paperclip, Camera, X, Plus, Trash2, Banknote, User, Mail, FileText,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Avatar } from "@/components/ui/Avatar";
import {
  AttachmentViewer,
  attachmentKind,
  type AttachmentKind,
  type AttachmentSource,
} from "@/components/ui/AttachmentViewer";
import { TravelExpenseLoadingPopup } from "@/features/accounting/components/TravelExpenseLoadingPopup";
import { PoweredByClaude } from "@/components/ui/PoweredByClaude";
import { BranchPicker, GlPicker, cellClass, cellStyle } from "./LinePickers";
import { OcrConfirmModal, type OcrRow } from "./OcrConfirmModal";
import type { AccBrandOption, AccFileMeta } from "@/features/accounting/types";
import type {
  BranchOption,
  ClearAdvanceRequest,
  ClearAdvanceSaveInput,
  GlAccountOption,
  PendingAdvanceOption,
} from "@/features/clear-advance/types";
import {
  AP3_DEFAULT_CURRENCY,
  isRocksPcBrand,
  FORCE_GL_NON_ROCKS_PC,
} from "@/features/clear-advance/constants";

interface Props {
  initial: ClearAdvanceRequest | null;
  onSaved: (id: number) => void;
  onSubmitted: (id: number) => void;
  /** Notifies the page when the form has unsaved edits, so it can guard navigation (P1.2). */
  onDirtyChange?: (dirty: boolean) => void;
  /**
   * Called when the first attachment auto-creates a Draft. Lets the page record
   * the id so its URL-sync (?id=) does NOT re-fetch/remount this form — which
   * would wipe unsaved client state (e.g. an OCR-filled line). (P1.3 interaction.)
   */
  onAutoDraft?: (id: number) => void;
}

const labelStyle = { color: "var(--text-secondary)" } as const;
const fieldClass = "w-full text-[13px] px-3 py-2 rounded-xl outline-none";
const fieldStyle = {
  background: "var(--bg-input, var(--bg-card))",
  color: "var(--text-primary)",
  border: "1px solid var(--border-card)",
} as const;
const COMPANY_BANK_LINE =
  "โอนคืน: บริษัท ร็อคส์ พีซี จำกัด · กสิกรไทย 772-1-01878-9 สาขาเซ็นทรัลเวิลด์";

function money(n: number | null | undefined): string {
  return (n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
function num(v: string): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Grow a textarea to fit its content (wraps onto a 2nd line for long text). */
function autoGrow(el: HTMLTextAreaElement | null): void {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

/** Inline validation message shown next to a field (P1.1 — not toast-only). */
function FieldError({ msg }: { msg?: string }): ReactNode {
  if (!msg) return null;
  return (
    <p role="alert" className="text-[12px] mt-1 m-0 flex items-start gap-1"
      style={{ color: "var(--text-danger, #dc2626)" }}>
      <span aria-hidden>⚠</span>
      <span>{msg}</span>
    </p>
  );
}

/** One editable expense row in state — string amounts keep the inputs controllable. */
interface LineRow {
  id?: number;
  /** The attached receipt this line was OCR-filled from — cleared with its file. */
  sourceFileId?: number;
  expenseDate: string;
  docNo: string;
  glAccountNo: string;
  glAccountName: string;
  description: string;
  branchCode: string;
  amountBeforeVat: string;
  vatAmount: string;
  whtAmount: string;
}

/** One editable WHT-certificate row in state. */
interface WhtRow {
  id?: number;
  expenseDate: string;
  docNo: string;
  description: string;
  taxId: string;
  payeeName: string;
  payeeAddress: string;
  amount: string;
  whtAmount: string;
}

function emptyLine(): LineRow {
  return {
    expenseDate: "", docNo: "", glAccountNo: "", glAccountName: "",
    description: "", branchCode: "", amountBeforeVat: "", vatAmount: "", whtAmount: "",
  };
}

export function ClearAdvanceForm({ initial, onSaved, onSubmitted, onDirtyChange, onAutoDraft }: Props) {
  const [brands, setBrands] = useState<AccBrandOption[]>([]);
  const [pending, setPending] = useState<PendingAdvanceOption[]>([]);
  // True while the brand-scoped pending-advance list is being fetched — avoids
  // flashing the "ไม่มีเงินทดรองจ่าย" empty state before the list has loaded.
  const [pendingLoading, setPendingLoading] = useState(false);
  // Each line's account list is fetched for that line's branch (§2.4), keyed by
  // branch code so switching back to a branch already seen costs no round trip.
  const [glByBranch, setGlByBranch] = useState<Record<string, GlAccountOption[]>>({});
  const glRequested = useRef<Set<string>>(new Set());
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [files, setFiles] = useState<AccFileMeta[]>([]);
  const [refundProofFiles, setRefundProofFiles] = useState<AccFileMeta[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadingProof, setUploadingProof] = useState(false);
  const [ocrScanning, setOcrScanning] = useState(false);
  // OCR candidates awaiting confirmation (§7) — null while the modal is closed.
  const [ocrRows, setOcrRows] = useState<OcrRow[] | null>(null);
  // Pages the reader dropped for being neither receipt nor slip — shown as a count.
  const [ocrSkipped, setOcrSkipped] = useState(0);

  const [brandCode, setBrandCode] = useState(initial?.brandCode ?? "");
  const [advanceRequestId, setAdvanceRequestId] = useState<number | null>(initial?.clear?.advanceRequestId ?? null);
  const [refundTransferDate, setRefundTransferDate] = useState(initial?.clear?.refundTransferDate ?? "");
  const [refundTransferAmount, setRefundTransferAmount] = useState(
    initial?.clear?.refundTransferAmount != null ? String(initial.clear.refundTransferAmount) : "",
  );
  const [slipWarn, setSlipWarn] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ fileId: number; refType: "clear_doc" | "refund_proof" } | null>(null);

  // Requester (ผู้ขอ) + first approver (ผู้จัดการ), resolved from HR — shown like AP-2.
  type Person = { staffId: number | null; fullName: string | null; position: string | null; departmentName?: string | null; email: string | null; photoUrl: string | null };
  const [emp, setEmp] = useState<Person | null>(null);
  const [manager, setManager] = useState<Person | null>(null);
  const [managerReason, setManagerReason] = useState<string | null>(null);
  // HR lookup for the requester/manager cards is non-blocking (same as AP-1): the
  // form renders immediately and the cards show a skeleton until this resolves.
  const [employeeLoading, setEmployeeLoading] = useState(true);

  const [lines, setLines] = useState<LineRow[]>(() => {
    const it = initial?.clear?.items ?? [];
    if (it.length === 0) return [emptyLine()];
    return it.map((x) => ({
      id: x.id,
      sourceFileId: x.sourceFileId ?? undefined,
      expenseDate: x.expenseDate ?? "",
      docNo: x.docNo ?? "",
      glAccountNo: x.glAccountNo ?? "",
      glAccountName: x.glAccountName ?? "",
      description: x.description ?? "",
      branchCode: x.branchCode ?? "",
      amountBeforeVat: x.amountBeforeVat != null ? String(x.amountBeforeVat) : "",
      vatAmount: x.vatAmount != null ? String(x.vatAmount) : "",
      whtAmount: x.whtAmount != null ? String(x.whtAmount) : "",
    }));
  });
  const [whtRows, setWhtRows] = useState<WhtRow[]>(() =>
    (initial?.clear?.whtItems ?? []).map((w) => ({
      id: w.id,
      expenseDate: w.expenseDate ?? "",
      docNo: w.docNo ?? "",
      description: w.description ?? "",
      taxId: w.taxId ?? "",
      payeeName: w.payeeName ?? "",
      payeeAddress: w.payeeAddress ?? "",
      amount: w.amount != null ? String(w.amount) : "",
      whtAmount: w.whtAmount != null ? String(w.whtAmount) : "",
    })),
  );

  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [ready, setReady] = useState(false);
  // Inline validation (P1.1): once the user tries to submit, field errors show
  // next to each field and clear themselves as the field is fixed (errors are
  // derived from live state, not stored). rootRef locates the first bad field.
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Unsaved-change tracking (P1.2). Dirty = the requester edited a field since the
  // form loaded or since the last successful persist. File uploads persist a draft
  // on their own, so they aren't counted here. Reset to false inside persist().
  const [dirty, setDirty] = useState(false);
  const dirtyInit = useRef(true);
  useEffect(() => {
    if (dirtyInit.current) { dirtyInit.current = false; return; }
    setDirty(true);
  }, [brandCode, advanceRequestId, lines, whtRows, refundTransferDate, refundTransferAmount]);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  // Warn on browser refresh / tab close / navigating away by URL while dirty.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const [savedId, setSavedId] = useState<number | null>(initial?.id ?? null);
  const requestId = savedId;
  /* One viewer for the whole form, not one per thumbnail — a modal rendered
     inside a list item is a modal per item. Both `FileArea` instances (receipts
     and the refund slip) report clicks here.

     Every kind opens it, including PDFs, which used to be an `<a target="_blank">`
     pointed at the download route: that route serves anything non-raster as
     `Content-Disposition: attachment` under `nosniff`, so the new tab downloaded
     the file and closed. The viewer fetches the bytes itself and renders them
     from a Blob inside our own origin, which is why no server header is relaxed. */
  const [viewing, setViewing] = useState<{ source: AttachmentSource; kind: AttachmentKind } | null>(
    null,
  );
  const openFileViewer = (f: AccFileMeta) =>
    setViewing({
      source: { name: f.fileName, url: f.url },
      // Declared type first, then the name — SharePoint returns
      // `application/octet-stream` often enough that the fallback matters.
      kind: attachmentKind(f.fileName, f.contentType),
    });
  const readOnly = !!initial && initial.status !== "Draft" && initial.status !== "Returned";

  // "เป็นค่าใช้จ่ายของ" is the selected brand: home brands book their own G/L,
  // any other brand forces every line to 110723001.
  const glForced = !!brandCode && !isRocksPcBrand(brandCode);

  // Snapshot amount stamped on a saved request (survives even if the AP-2 advance
  // leaves the pending list); else the live option's amount once one is chosen.
  const selectedOption = useMemo(
    () => pending.find((p) => p.advanceRequestId === advanceRequestId) ?? null,
    [pending, advanceRequestId],
  );
  const advanceAmount =
    selectedOption?.advanceAmount ??
    (advanceRequestId != null ? initial?.clear?.advanceAmount ?? null : null);
  const advanceRequestNo = selectedOption?.advanceRequestNo ?? initial?.clear?.advanceRequestNo ?? null;

  useEffect(() => {
    let cancelled = false;
    // Essential options gate the form. The HR lookup (requester/manager cards) is
    // NOT gated — it can be slow (Graph photo fetch returns a large base64 image),
    // so the form renders immediately and the cards show a skeleton until it lands
    // (same concept as AP-1).
    fetch("/api/request/clear-advance/options/brands")
      .then((r) => r.json())
      .then((b) => {
        if (cancelled) return;
        if (b?.ok) setBrands(b.data ?? []);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setReady(true); });

    // Requester + first-approver (manager) cards — best-effort, non-blocking.
    const meQ = `/api/me/employee?form=AP-3${initial?.id != null ? `&id=${initial.id}` : ""}`;
    fetch(meQ).then((r) => r.json()).then((me) => {
      if (cancelled || !me?.ok) return;
      const e = me.data?.employee;
      setEmp(e ? { staffId: e.staffId ?? null, fullName: e.fullName ?? null, position: e.position ?? null, departmentName: e.departmentName ?? null, email: e.email ?? null, photoUrl: e.photoUrl ?? null } : null);
      const m = me.data?.manager;
      setManager(m ? { staffId: m.staffId ?? null, fullName: m.fullName ?? null, position: m.position ?? null, email: m.email ?? null, photoUrl: m.photoUrl ?? null } : null);
      setManagerReason(me.data?.managerReason ?? null);
    }).catch(() => {}).finally(() => { if (!cancelled) setEmployeeLoading(false); });
    return () => { cancelled = true; };
  }, [initial?.id]);

  // Fetch the account list for every branch the lines currently use. The server
  // decides which accounts a branch may charge, so nothing is filtered here.
  const branchKeys = useMemo(
    () => Array.from(new Set(lines.map((l) => l.branchCode).filter(Boolean))).sort().join("|"),
    [lines],
  );
  useEffect(() => {
    const missing = (branchKeys ? branchKeys.split("|") : []).filter((c) => !glRequested.current.has(c));
    if (missing.length === 0) return;
    missing.forEach((c) => glRequested.current.add(c));
    let cancelled = false;
    Promise.all(
      missing.map((code) =>
        fetch(`/api/request/clear-advance/options/gl-accounts?branch=${encodeURIComponent(code)}`)
          .then((r) => r.json())
          .then((j: { ok: boolean; data?: GlAccountOption[] }) => [code, j.ok ? j.data ?? [] : []] as const)
          .catch(() => {
            glRequested.current.delete(code); // let a later render retry
            return [code, [] as GlAccountOption[]] as const;
          }),
      ),
    ).then((entries) => {
      if (!cancelled) setGlByBranch((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
    });
    return () => { cancelled = true; };
  }, [branchKeys]);

  // Changing a line's branch can invalidate the account already on it — drop the
  // pick rather than submit an account that branch is not allowed to charge.
  useEffect(() => {
    if (readOnly) return;
    setLines((prev) => {
      let changed = false;
      const next = prev.map((l) => {
        const opts = l.branchCode ? glByBranch[l.branchCode] : undefined;
        if (!l.glAccountNo || !opts || opts.some((o) => o.glAccountNo === l.glAccountNo)) return l;
        changed = true;
        return { ...l, glAccountNo: "", glAccountName: "" };
      });
      return changed ? next : prev;
    });
  }, [glByBranch, lines, readOnly]);

  /** Options for one line, keeping a stored account visible on a read-only request
   *  even when the current branch filter would no longer offer it. */
  const glOptionsFor = (l: LineRow): GlAccountOption[] => {
    const opts = (l.branchCode && glByBranch[l.branchCode]) || [];
    if (!l.glAccountNo || opts.some((o) => o.glAccountNo === l.glAccountNo)) return opts;
    return [{ glAccountNo: l.glAccountNo, nameTh: l.glAccountName || null, nameEn: null, dimensionType: "Employee" }, ...opts];
  };

  // Branch + pending-advance options are scoped to the chosen brand.
  useEffect(() => {
    if (!brandCode) { setBranches([]); setPending([]); setPendingLoading(false); return; }
    let cancelled = false;
    const excludeQ = initial?.id != null ? `&exclude=${initial.id}` : "";
    setPendingLoading(true);
    fetch(`/api/request/clear-advance/options/branches?brand=${encodeURIComponent(brandCode)}`)
      .then((r) => r.json())
      .then((j: { ok: boolean; data?: BranchOption[] }) => { if (!cancelled && j.ok) setBranches(j.data ?? []); })
      .catch(() => { if (!cancelled) setBranches([]); });
    fetch(`/api/request/clear-advance/pending-advances?brand=${encodeURIComponent(brandCode)}${excludeQ}`)
      .then((r) => r.json())
      .then((j: { ok: boolean; data?: PendingAdvanceOption[] }) => { if (!cancelled && j.ok) setPending(j.data ?? []); })
      .catch(() => { if (!cancelled) setPending([]); })
      .finally(() => { if (!cancelled) setPendingLoading(false); });
    return () => { cancelled = true; };
  }, [brandCode, initial?.id]);

  // Load existing attachments once the request is saved (split by refType).
  useEffect(() => {
    if (!requestId) {
      setFiles(initial?.clear?.files ?? []);
      setRefundProofFiles(initial?.clear?.refundProofFiles ?? []);
      return;
    }
    let cancelled = false;
    fetch(`/api/request/clear-advance/requests/${requestId}`)
      .then((r) => r.json())
      .then((j: { ok: boolean; data?: ClearAdvanceRequest }) => {
        if (cancelled || !j.ok || !j.data?.clear) return;
        setFiles(j.data.clear.files ?? []);
        setRefundProofFiles(j.data.clear.refundProofFiles ?? []);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [requestId, initial?.clear?.files, initial?.clear?.refundProofFiles]);

  /* ── derived totals ── */

  const lineCalc = useMemo(() => {
    let cumNet = 0;
    return lines.map((l) => {
      const before = num(l.amountBeforeVat);
      const vat = num(l.vatAmount);
      const wht = num(l.whtAmount);
      const total = round2(before + vat);
      const net = round2(total - wht);
      cumNet = round2(cumNet + net);
      const balance = round2((advanceAmount ?? 0) - cumNet);
      return { before, vat, wht, total, net, balance };
    });
  }, [lines, advanceAmount]);

  const sums = useMemo(() => {
    const s = { before: 0, vat: 0, total: 0, wht: 0, net: 0 };
    for (const c of lineCalc) {
      s.before = round2(s.before + c.before);
      s.vat = round2(s.vat + c.vat);
      s.total = round2(s.total + c.total);
      s.wht = round2(s.wht + c.wht);
      s.net = round2(s.net + c.net);
    }
    return s;
  }, [lineCalc]);

  const actualTotal = sums.net;
  const refundToCompany = round2((advanceAmount ?? 0) - actualTotal);
  const showWht = sums.wht > 0;
  const certWht = useMemo(
    () => round2(whtRows.reduce((s, w) => s + num(w.whtAmount), 0)),
    [whtRows],
  );
  const whtMismatch = showWht && Math.abs(sums.wht - certWht) > 0.01;
  const needsRefundTransfer = refundToCompany > 0;

  /* ── line mutations ── */

  function updateLine(idx: number, patch: Partial<LineRow>) {
    setLines((p) => p.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  function addWht() {
    setWhtRows((p) => [...p, {
      expenseDate: "", docNo: "", description: "", taxId: "",
      payeeName: "", payeeAddress: "", amount: "", whtAmount: "",
    }]);
  }
  function removeWht(idx: number) { setWhtRows((p) => p.filter((_, i) => i !== idx)); }
  function updateWht(idx: number, patch: Partial<WhtRow>) {
    setWhtRows((p) => p.map((w, i) => (i === idx ? { ...w, ...patch } : w)));
  }

  /** Prefill the WHT certificate table from the expense lines that carry WHT. */
  function prefillWhtFromLines() {
    const src = lines.filter((l) => num(l.whtAmount) > 0);
    if (src.length === 0) { toast.error("ยังไม่มีรายการที่มีภาษีหัก ณ ที่จ่าย"); return; }
    setWhtRows(src.map((l) => ({
      expenseDate: l.expenseDate,
      docNo: l.docNo,
      description: l.description,
      taxId: "",
      payeeName: "",
      payeeAddress: "",
      amount: l.amountBeforeVat,
      whtAmount: l.whtAmount,
    })));
    toast.success("ดึงรายการหัก ณ ที่จ่ายจากค่าใช้จ่ายแล้ว — กรุณากรอกเลขผู้เสียภาษี/ชื่อผู้รับ");
  }

  /* ── persistence ── */

  function buildInput(): ClearAdvanceSaveInput {
    return {
      id: requestId ?? undefined,
      brandCode: brandCode || null,
      staffId: null, // requester resolved server-side from HR
      clear: {
        id: initial?.clear?.id,
        advanceRequestId: advanceRequestId ?? null,
        advanceRequestNo,
        advanceAmount,
        expenseOf: brandCode || null,
        actualTotal,
        refundToCompany,
        currency: AP3_DEFAULT_CURRENCY,
        whtNote: null,
        refundTransferDate: refundTransferDate || null,
        refundTransferAmount: refundTransferAmount.trim() ? num(refundTransferAmount) : null,
        pvDocNo: null,
        paymentDate: null,
        items: lines
          .filter((l) => l.glAccountNo || l.description.trim() || num(l.amountBeforeVat) > 0)
          .map((l, i) => {
            const before = num(l.amountBeforeVat);
            const vat = num(l.vatAmount);
            const wht = num(l.whtAmount);
            const total = round2(before + vat);
            return {
              id: l.id,
              lineNo: i + 1,
              expenseDate: l.expenseDate || null,
              docNo: l.docNo.trim() || null,
              glAccountNo: glForced ? FORCE_GL_NON_ROCKS_PC : (l.glAccountNo || null),
              glAccountName: glForced ? null : (l.glAccountName || null),
              description: l.description.trim() || null,
              branchCode: l.branchCode || null,
              amountBeforeVat: before,
              vatAmount: vat,
              totalInclVat: total,
              whtAmount: wht,
              netAmount: round2(total - wht),
              sortOrder: i,
              sourceFileId: l.sourceFileId ?? null,
            };
          }),
        whtItems: whtRows
          .filter((w) => num(w.whtAmount) > 0 || w.taxId.trim() || w.payeeName.trim())
          .map((w, i) => ({
            id: w.id,
            lineNo: i + 1,
            expenseDate: w.expenseDate || null,
            docNo: w.docNo.trim() || null,
            description: w.description.trim() || null,
            taxId: w.taxId.trim() || null,
            payeeName: w.payeeName.trim() || null,
            payeeAddress: w.payeeAddress.trim() || null,
            amount: num(w.amount) || null,
            whtAmount: num(w.whtAmount) || null,
            netAmount: round2(num(w.amount) - num(w.whtAmount)),
            sortOrder: i,
          })),
      },
    };
  }

  async function persist(): Promise<number> {
    const url = requestId
      ? `/api/request/clear-advance/requests/${requestId}`
      : "/api/request/clear-advance/requests";
    const res = await fetch(url, {
      method: requestId ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildInput()),
    });
    const json = (await res.json()) as { ok: boolean; data?: { id: number }; error?: string };
    if (!json.ok) throw new Error(json.error ?? "บันทึกไม่สำเร็จ");
    const id = json.data?.id ?? requestId!;
    if (id !== requestId) setSavedId(id);
    setDirty(false); // current field state is now persisted
    return id;
  }

  /**
   * Client-side mirror of the server's submit checks. Returns one entry per
   * problem, in field order, tagged with the field key so the UI can render the
   * message inline and focus the first bad field. Server validation stays the
   * source of truth — these messages match it (P1.1: no client/server conflict).
   */
  function collectErrors(): { key: string; message: string }[] {
    const errs: { key: string; message: string }[] = [];
    if (!brandCode) errs.push({ key: "brand", message: "กรุณาเลือกแบรนด์" });
    if (advanceRequestId == null) errs.push({ key: "advance", message: "กรุณาเลือกเงินทดรองจ่ายที่จะเคลียร์" });
    const valid = lines.filter((l) => l.glAccountNo || l.description.trim() || num(l.amountBeforeVat) > 0);
    if (valid.length === 0) {
      errs.push({ key: "lines", message: "กรุณากรอกรายการค่าใช้จ่ายอย่างน้อย 1 รายการ" });
    } else {
      for (const l of valid) {
        if (!l.expenseDate) { errs.push({ key: "lines", message: "มีรายการค่าใช้จ่ายที่ยังไม่ได้ระบุวันที่" }); break; }
        if (!glForced && !l.glAccountNo) { errs.push({ key: "lines", message: "มีรายการค่าใช้จ่ายที่ยังไม่ได้เลือกหมวด (รายการ)" }); break; }
        if (!(num(l.amountBeforeVat) > 0)) { errs.push({ key: "lines", message: "มีรายการที่จำนวนเงินก่อน VAT ไม่ถูกต้อง" }); break; }
      }
    }
    if (whtMismatch) errs.push({ key: "wht", message: "ยอดภาษีหัก ณ ที่จ่ายในตารางใบรับรอง ไม่ตรงกับยอดในรายการค่าใช้จ่าย" });
    if (showWht) {
      for (const w of whtRows) {
        if (num(w.whtAmount) > 0 && (!w.taxId.trim() || !w.payeeName.trim())) {
          errs.push({ key: "wht", message: "รายการหัก ณ ที่จ่าย ต้องกรอกเลขผู้เสียภาษีและชื่อผู้รับให้ครบ" });
          break;
        }
      }
    }
    if (files.length === 0) errs.push({ key: "files", message: "กรุณาแนบใบเสร็จ/ใบกำกับภาษีอย่างน้อย 1 ไฟล์" });
    if (needsRefundTransfer) {
      if (!(num(refundTransferAmount) > 0)) errs.push({ key: "refundAmount", message: "กรณีต้องโอนเงินคืนบริษัท กรุณาระบุจำนวนเงินที่โอนคืน" });
      if (!refundTransferDate) errs.push({ key: "refundDate", message: "กรณีต้องโอนเงินคืนบริษัท กรุณาระบุวันที่โอนเงินคืน" });
      if (refundProofFiles.length === 0) errs.push({ key: "refundProof", message: "กรุณาแนบหลักฐานการโอนเงินคืนบริษัท" });
    }
    return errs;
  }

  async function handleSave() {
    setSaving(true);
    try {
      const id = await persist();
      toast.success("บันทึกแบบร่างแล้ว");
      onSaved(id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmit() {
    const errs = collectErrors();
    if (errs.length) {
      setSubmitAttempted(true);
      const firstKey = errs[0].key;
      // Scroll to and focus the first invalid field (after the errors paint).
      requestAnimationFrame(() => {
        const box = rootRef.current?.querySelector<HTMLElement>(`[data-err="${firstKey}"]`);
        if (!box) return;
        box.scrollIntoView({ behavior: "smooth", block: "center" });
        const focusable = box.querySelector<HTMLElement>("input, select, textarea, button");
        (focusable ?? box).focus?.();
      });
      // Toast is a summary — the precise location is the inline message.
      toast.error(errs.length === 1 ? errs[0].message : `กรุณาแก้ไข ${errs.length} รายการก่อนส่งคำขอ`);
      return;
    }
    setSubmitting(true);
    // Track whether the draft was persisted before the submit call: if persist
    // succeeds but submit fails, the latest data is safe in the Draft — the user
    // must not be told it was lost, only that sending failed and can be retried.
    let persisted = false;
    try {
      const id = await persist();
      persisted = true;
      const res = await fetch(`/api/request/clear-advance/requests/${id}/submit`, { method: "POST" });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) throw new Error(json.error ?? "ส่งคำขอไม่สำเร็จ");
      toast.success("ส่งคำขอแล้ว");
      onSubmitted(id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "ส่งคำขอไม่สำเร็จ";
      toast.error(
        persisted
          ? `บันทึกแบบร่างล่าสุดแล้ว แต่ส่งคำขอไม่สำเร็จ: ${msg} — กรุณาลองส่งอีกครั้ง`
          : msg,
      );
    } finally {
      setSubmitting(false);
    }
  }

  /* ── file upload (refType = clear_doc | refund_proof) ── */

  async function uploadFiles(
    list: FileList | null,
    refType: "clear_doc" | "refund_proof",
  ) {
    if (!list || list.length === 0) return;
    // Receipts require the advance to be chosen first (the OCR fills lines that
    // clear THAT advance). Refund-proof isn't gated (it only appears post-refund).
    if (refType === "clear_doc" && advanceRequestId == null) {
      return void toast.error("กรุณาเลือก “เงินทดรองจ่ายที่จะเคลียร์” ก่อนแนบใบเสร็จ");
    }
    // Snapshot the File objects up front: the underlying FileList can be
    // invalidated once the input re-renders (e.g. after the auto-create URL sync),
    // which would drop files from the upload loop below.
    const filesArr = Array.from(list);
    for (const f of filesArr) {
      if (f.size > 4 * 1024 * 1024) return toast.error(`${f.name}: ไฟล์ใหญ่เกิน 4MB`);
    }
    const isProof = refType === "refund_proof";
    (isProof ? setUploadingProof : setUploading)(true);
    if (isProof) setSlipWarn(null);
    try {
      const wasNew = requestId == null;
      const id = requestId ?? (await persist());
      if (wasNew && typeof window !== "undefined") {
        // The first attachment on a new form auto-creates a Draft. Tell the page
        // first (so its ?id= sync won't re-fetch/remount this form and wipe unsaved
        // state), then reflect the id in the URL so a refresh or Back reloads the
        // same Draft and a re-attach reuses it instead of spawning a second Draft.
        onAutoDraft?.(id);
        const params = new URLSearchParams(window.location.search);
        params.delete("new");
        params.set("id", String(id));
        window.history.replaceState(null, "", `?${params.toString()}`);
      }
      // OCR runs on images and PDFs (server rasterises PDFs first).
      const isOcrable = (f: File) =>
        f.type.startsWith("image/") || f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf");
      // Pair each ocrable receipt with the id it was stored under, so the expense
      // line it fills can be tagged and cleared again if the file is deleted.
      const ocrDocs: { file: File; fileId: number }[] = [];
      for (const f of filesArr) {
        const fd = new FormData();
        fd.append("file", f);
        fd.append("refType", refType);
        const res = await fetch(`/api/request/clear-advance/requests/${id}/files`, { method: "POST", body: fd });
        const j = (await res.json()) as { ok: boolean; data?: AccFileMeta; error?: string };
        if (!j.ok) throw new Error(j.error ?? "อัปโหลดไม่สำเร็จ");
        if (j.data) {
          const newFile = j.data!;
          (isProof ? setRefundProofFiles : setFiles)((prev) =>
            prev.some((x) => x.id === newFile.id) ? prev : [...prev, newFile],
          );
          if (isOcrable(f)) ocrDocs.push({ file: f, fileId: j.data.id });
        }
      }
      toast.success("แนบไฟล์แล้ว");
      // Both boxes go through the same reader: the model says what each page is
      // (receipt / slip / other), and that — not the box it was dropped in —
      // decides where the values land (decision: 2026-09-01).
      if (ocrDocs.length) void verifyReceipts(ocrDocs);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "อัปโหลดไม่สำเร็จ");
    } finally {
      (isProof ? setUploadingProof : setUploading)(false);
    }
  }

  interface ReceiptData {
    kind: "receipt" | "slip";
    date: string | null; description: string | null; docNo: string | null;
    wht: number | null; taxId: string | null; payeeName: string | null; payeeAddress: string | null;
    total: number | null; vat: number | null; beforeVat: number | null;
  }

  /** OCR one receipt image → one entry per receipt/slip found in it, plus the
   *  count of pages that were neither (§8). */
  async function ocrReceipt(file: File): Promise<{ rows: ReceiptData[]; skipped: number }> {
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/request/clear-advance/verify-receipt", { method: "POST", body: fd });
      const j = (await res.json()) as { ok: boolean; data?: ReceiptData[]; skippedPages?: number };
      if (!j.ok || !j.data) return { rows: [], skipped: 0 };
      return {
        rows: j.data.filter(
          (d) => d.date != null || d.docNo != null || d.beforeVat != null || d.description != null,
        ),
        skipped: j.skippedPages ?? 0,
      };
    } catch {
      return { rows: [], skipped: 0 };
    }
  }

  /**
   * OCR each uploaded receipt / tax invoice — ONE expense line per invoice
   * number, so a photo holding two invoices yields two rows (§8). The parsed
   * values do NOT reach the expense table: they open the confirmation modal
   * (§7), and only ยืนยันบันทึก writes them.
   */
  async function verifyReceipts(docs: { file: File; fileId: number }[]) {
    setOcrScanning(true);
    try {
      const candidates: OcrRow[] = [];
      let skipped = 0;
      for (const d of docs) {
        const read = await ocrReceipt(d.file); // serialized — the OCR worker is shared
        skipped += read.skipped;
        read.rows.forEach((r, i) => candidates.push({
          key: `${d.fileId}-${i}`,
          kind: r.kind,
          include: true,
          sourceFileId: d.fileId,
          fileName: d.file.name,
          expenseDate: r.date ?? "",
          docNo: r.docNo ?? "",
          branchCode: "",
          glAccountNo: "",
          glAccountName: "",
          description: r.description ?? "",
          amountBeforeVat: r.beforeVat != null ? String(r.beforeVat) : "",
          vatAmount: r.vat != null ? String(r.vat) : "",
          whtAmount: r.wht != null && r.wht > 0 ? String(r.wht) : "",
          taxId: r.taxId ?? "",
          payeeName: r.payeeName ?? "",
          payeeAddress: r.payeeAddress ?? "",
          totalAmount: r.total != null ? String(r.total) : "",
        }));
      }
      // Open even with no rows when pages were dropped: the count is the only
      // report the reviewer gets that something was thrown away.
      if (candidates.length === 0 && skipped === 0) return;
      setOcrSkipped(skipped);
      setOcrRows(candidates);
    } finally {
      setOcrScanning(false);
    }
  }

  /** The user accepted (possibly re-classified, possibly edited) OCR rows. A
   *  receipt fills the next empty expense line, appending one when none is free
   *  and never overwriting a line the user already filled; a slip fills the
   *  refund-transfer fields. The row's kind decides, not the upload box. */
  function acceptOcrRows(accepted: OcrRow[]) {
    setOcrRows(null);
    if (accepted.length === 0) return;

    const rows = accepted.filter((r) => r.kind === "receipt");
    const slips = accepted.filter((r) => r.kind === "slip");

    // A slip is the proof of money going back to the company: take its amount
    // and date as the editable defaults, and say so when it disagrees with the
    // refund the form computed.
    const slip = slips[0];
    if (slip) {
      const amount = num(slip.amountBeforeVat);
      if (amount > 0) setRefundTransferAmount(String(amount));
      if (slip.expenseDate) setRefundTransferDate(slip.expenseDate);
      if (refundToCompany > 0 && amount > 0 && round2(amount) !== round2(refundToCompany)) {
        setSlipWarn(
          `ยอดในสลิปไม่ตรงกับที่ต้องโอนคืน (฿${refundToCompany.toLocaleString()}) — อ่านจากสลิปได้ ฿${amount.toLocaleString()}`,
        );
      } else {
        setSlipWarn(null);
      }
    }

    if (rows.length === 0) {
      if (slip) toast.success("เติมยอด/วันที่จากสลิปโอนเงินให้แล้ว — กรุณาตรวจสอบ");
      return;
    }

    setLines((prev) => {
      const next = [...prev];
      const isBlank = (l: LineRow) =>
        !l.glAccountNo && !l.expenseDate && !l.docNo && !l.description && !num(l.amountBeforeVat) && !num(l.vatAmount);
      for (const r of rows) {
        let idx = next.findIndex(isBlank);
        if (idx < 0) { next.push(emptyLine()); idx = next.length - 1; }
        next[idx] = {
          ...next[idx],
          sourceFileId: r.sourceFileId,
          expenseDate: r.expenseDate,
          docNo: r.docNo,
          branchCode: r.branchCode,
          glAccountNo: r.glAccountNo,
          glAccountName: r.glAccountName,
          description: r.description,
          amountBeforeVat: r.amountBeforeVat,
          vatAmount: r.vatAmount,
          whtAmount: r.whtAmount,
        };
      }
      return next;
    });

    // Rows that carry withholding tax → prefill a WHT-certificate row (opens the
    // WHT section; keeps its total matching the line WHT). Payee/tax-id best-effort.
    const whtRowsFromOcr = rows.filter((r) => num(r.whtAmount) > 0);
    if (whtRowsFromOcr.length) {
      setWhtRows((prev) => [
        ...prev,
        ...whtRowsFromOcr.map((r) => ({
          expenseDate: r.expenseDate,
          docNo: r.docNo,
          description: r.description,
          taxId: r.taxId,
          payeeName: r.payeeName,
          payeeAddress: r.payeeAddress,
          amount: r.amountBeforeVat || r.totalAmount,
          whtAmount: r.whtAmount,
        })),
      ]);
    }

    toast.success(
      `เพิ่ม ${rows.length} รายการลงตารางค่าใช้จ่ายแล้ว` + (slip ? " · เติมข้อมูลสลิปโอนเงินให้แล้ว" : ""),
    );
  }

  /** Clicking the ✕ opens a confirm popup; the actual delete runs on confirm. */
  function removeFile(fileId: number, refType: "clear_doc" | "refund_proof") {
    setPendingDelete({ fileId, refType });
  }

  async function doRemoveFile() {
    if (!pendingDelete) return;
    const { fileId, refType } = pendingDelete;
    setPendingDelete(null);
    try {
      const res = await fetch(`/api/request/clear-advance/requests/${requestId}/files?fileId=${fileId}`, {
        method: "DELETE",
      });
      const j = (await res.json()) as { ok: boolean; error?: string };
      if (!j.ok) throw new Error(j.error ?? "ลบไม่สำเร็จ");
      (refType === "refund_proof" ? setRefundProofFiles : setFiles)((prev) => prev.filter((f) => f.id !== fileId));
      // A receipt's expense line was OCR-filled from it (1 file = 1 line) — drop
      // that line when the file goes. Save is replace-all, so any saved item is
      // removed with it. Always keep at least one (blank) line.
      if (refType === "clear_doc") {
        setLines((prev) => {
          if (!prev.some((l) => l.sourceFileId === fileId)) return prev;
          const kept = prev.filter((l) => l.sourceFileId !== fileId);
          return kept.length > 0 ? kept : [emptyLine()];
        });
      }
      toast.success("ลบไฟล์แล้ว");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "ลบไม่สำเร็จ");
    }
  }

  const box = { background: "var(--bg-card)", boxShadow: "var(--shadow-card)" } as const;

  if (!ready) {
    return (
      <TravelExpenseLoadingPopup
        label="กำลังเตรียมแบบฟอร์ม..."
        subtitle="แบบฟอร์มเคลียร์คืนเงินทดรองจ่าย (AP-3)"
      />
    );
  }

  // Derived inline errors: recomputed each render so a field's message clears the
  // moment it's fixed. Only surfaced after the first submit attempt. First message
  // per key wins (matches the order collectErrors emits).
  const fieldErrors: Record<string, string> = {};
  if (submitAttempted) {
    for (const e of collectErrors()) if (!(e.key in fieldErrors)) fieldErrors[e.key] = e.message;
  }

  return (
    <div className="flex flex-col gap-4" ref={rootRef}>
      {/* Requester note + brand */}
      <div className="rounded-2xl p-4 sm:p-5 flex flex-col gap-3" style={box}>
        {/* ผู้ขอ (ซ้าย) + ผู้อนุมัติขั้นแรก · ผู้จัดการ (ขวา) — layout เดียวกับ AP-2 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
          <div className="flex flex-col gap-1.5 min-w-0">
            <span className="text-[10px] font-semibold uppercase tracking-wide inline-flex items-center gap-1" style={{ color: "var(--text-muted)" }}>
              <User size={11} /> ผู้ขอเคลียร์
            </span>
            {employeeLoading ? <PersonSkeleton /> : (
            <div className="flex items-center gap-3 min-w-0">
              <div className="shrink-0 rounded-2xl overflow-hidden" style={{ boxShadow: "0 0 0 2px var(--nav-active-bg)" }}>
                <Avatar name={emp?.fullName || "?"} size={44} photo={emp?.photoUrl ?? undefined} color="var(--nav-active-text)" />
              </div>
              <div className="min-w-0 flex flex-col gap-0.5">
                <div className="flex items-baseline gap-2 min-w-0">
                  <span className="text-[14px] font-bold truncate" style={{ color: "var(--text-primary)" }}>{emp?.fullName || "-"}</span>
                  {emp?.staffId != null && <span className="text-[11px] shrink-0" style={{ color: "var(--text-muted)" }}>#{emp.staffId}</span>}
                </div>
                {(emp?.departmentName || emp?.position) && (
                  <span className="text-[12px] truncate" style={{ color: "var(--text-muted)" }}>
                    {[emp?.departmentName, emp?.position].filter(Boolean).join(" · ")}
                  </span>
                )}
                {emp?.email && (
                  <span className="inline-flex items-center gap-1 text-[12px] truncate" style={{ color: "var(--text-secondary)" }}>
                    <Mail size={11} className="shrink-0" /> <span className="truncate">{emp.email}</span>
                  </span>
                )}
              </div>
            </div>
            )}
          </div>

          <div className="flex flex-col gap-1.5 min-w-0 border-t md:border-t-0 md:border-l pt-4 md:pt-0 md:pl-6" style={{ borderColor: "var(--border-card)" }}>
            <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
              ผู้อนุมัติขั้นแรก · ผู้จัดการ
            </span>
            {employeeLoading ? <PersonSkeleton /> : manager ? (
              <div className="flex items-center gap-3 min-w-0">
                <div className="shrink-0 rounded-2xl overflow-hidden" style={{ boxShadow: "0 0 0 2px var(--nav-active-bg)" }}>
                  <Avatar name={manager.fullName || "?"} size={44} photo={manager.photoUrl ?? undefined} color="var(--nav-active-text)" />
                </div>
                <div className="min-w-0 flex flex-col gap-0.5">
                  <div className="flex items-baseline gap-2 min-w-0">
                    <span className="text-[14px] font-bold truncate" style={{ color: "var(--text-primary)" }}>{manager.fullName || "-"}</span>
                    {manager.staffId != null && <span className="text-[11px] shrink-0" style={{ color: "var(--text-muted)" }}>#{manager.staffId}</span>}
                  </div>
                  {manager.position && <span className="text-[12px] truncate" style={{ color: "var(--text-muted)" }}>{manager.position}</span>}
                  {manager.email && (
                    <span className="inline-flex items-center gap-1 text-[12px] truncate" style={{ color: "var(--text-secondary)" }}>
                      <Mail size={11} className="shrink-0" /> <span className="truncate">{manager.email}</span>
                    </span>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-[12px] leading-relaxed m-0" style={{ color: "var(--text-muted)" }}>
                {managerReason ?? "ยังไม่พบผู้จัดการใน HR — กรุณาติดต่อ HR"}
              </p>
            )}
            <span className="text-[11px] mt-0.5" style={{ color: "var(--text-faint)" }}>
              ลำดับอนุมัติ: ผู้จัดการ → บัญชี → หัวหน้าบัญชี
            </span>
          </div>
        </div>

        <div data-err="brand">
          <label className="text-[12px] font-bold" style={labelStyle}>แบรนด์ *</label>
          {brands.length === 0 ? (
            <p className="text-[13px] mt-1" style={{ color: "var(--text-faint)" }}>กำลังโหลดแบรนด์...</p>
          ) : (
            <div className="flex flex-wrap gap-2 mt-1">
              {brands.map((b) => {
                const active = brandCode === b.brandCode;
                return (
                  <button key={b.brandCode} type="button" disabled={readOnly}
                    onClick={() => {
                      const next = active ? "" : b.brandCode;
                      setBrandCode(next);
                      // Advances + branches are brand-scoped — drop stale picks.
                      setAdvanceRequestId(null);
                      setLines((prev) => prev.map((l) => ({ ...l, branchCode: "" })));
                    }}
                    className="flex items-center gap-2 px-3 py-2 rounded-xl cursor-pointer text-[14px] font-semibold transition-all disabled:cursor-not-allowed"
                    style={{
                      borderWidth: 2, borderStyle: "solid",
                      borderColor: active ? "var(--nav-active-text)" : "var(--border-card)",
                      background: active ? "var(--nav-active-bg)" : "var(--bg-card-alt)",
                      color: active ? "var(--nav-active-text)" : "var(--text-secondary)",
                    }}>
                    {b.brandLogo && (
                      <img src={b.brandLogo} alt="" className="h-5 w-auto object-contain"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                    )}
                    {b.brandName}
                    {active && <Check size={14} />}
                  </button>
                );
              })}
            </div>
          )}
          <FieldError msg={fieldErrors.brand} />
        </div>
      </div>

      {/* Linked AP-2 advance + expenseOf */}
      <div className="rounded-2xl p-4 sm:p-5 flex flex-col gap-4" style={box}>
        <div data-err="advance">
        <Field label="เงินทดรองจ่ายที่จะเคลียร์ *">
          {pending.length === 0 && advanceRequestId == null ? (
            brandCode && pendingLoading ? (
              <p className="text-[12px] px-3 py-2 rounded-lg m-0 animate-pulse"
                style={{ background: "var(--bg-card-alt)", color: "var(--text-muted)", border: "1px solid var(--border-card)" }}>
                กำลังโหลดเงินทดรองจ่าย...
              </p>
            ) : (
              <p className="text-[12px] px-3 py-2 rounded-lg m-0"
                style={{ background: "var(--bg-info-yellow)", color: "var(--text-info-yellow)", border: "1px solid var(--border-info-yellow)" }}>
                {!brandCode
                  ? "กรุณาเลือกแบรนด์ก่อนเลือกเงินทดรองจ่ายที่ต้องการเคลียร์"
                  : "ไม่มีเงินทดรองจ่ายที่รออนุมัติให้เคลียร์สำหรับแบรนด์นี้"}
              </p>
            )
          ) : (
            <select className={fieldClass} style={fieldStyle} value={advanceRequestId ?? ""} disabled={readOnly}
              aria-invalid={!!fieldErrors.advance}
              onChange={(e) => setAdvanceRequestId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">— เลือกเงินทดรองจ่าย —</option>
              {advanceRequestId != null && !selectedOption && (
                <option value={advanceRequestId}>
                  {advanceRequestNo ?? `#${advanceRequestId}`}
                  {advanceAmount != null ? ` · ฿${money(advanceAmount)}` : ""}
                </option>
              )}
              {pending.map((p) => {
                const foreign = p.currency && p.currency !== "THB";
                const hint = [
                  foreign ? `${p.currency} ${money(p.origAmount)} @ ${p.exchangeRate}` : null,
                  p.needByDate ? `ใช้เงิน ${p.needByDate}` : null,
                  p.purpose?.trim() ? p.purpose.trim().slice(0, 40) : null,
                ].filter(Boolean).join(" · ");
                return (
                  <option key={p.advanceRequestId} value={p.advanceRequestId}>
                    {p.advanceRequestNo ?? `#${p.advanceRequestId}`} · ฿{money(p.advanceAmount)}
                    {hint ? ` — ${hint}` : ""}
                  </option>
                );
              })}
            </select>
          )}
        </Field>
        <FieldError msg={fieldErrors.advance} />
        </div>
        {advanceRequestId != null && (
          <div className="flex items-center justify-between gap-3 rounded-xl px-4 py-3"
            style={{ background: "var(--bg-card-alt)", border: "1px solid var(--border-card)" }}>
            <span className="text-[12px] font-semibold flex flex-col gap-0.5" style={{ color: "var(--text-secondary)" }}>
              <span>วงเงินที่ได้รับ {advanceRequestNo ? `(${advanceRequestNo})` : ""}</span>
              {selectedOption?.currency && selectedOption.currency !== "THB" && (
                <span className="text-[11px] font-normal" style={{ color: "var(--text-muted)" }}>
                  แปลงจาก {selectedOption.currency} {money(selectedOption.origAmount)} @ {selectedOption.exchangeRate}
                </span>
              )}
            </span>
            <span className="text-[15px] font-bold tabular-nums" style={{ color: "var(--text-heading)" }}>
              ฿{money(advanceAmount)}
            </span>
          </div>
        )}

        {/* "เป็นค่าใช้จ่ายของ" = the selected brand (no separate field). */}
        {glForced && (
          <p className="text-[11px] mt-1 px-2.5 py-1.5 rounded-lg m-0"
            style={{ background: "var(--bg-info-yellow)", color: "var(--text-info-yellow)", border: "1px solid var(--border-info-yellow)" }}>
            ค่าใช้จ่ายของบริษัทอื่น (ไม่ใช่ Rocks PC) → ทุกบรรทัดใช้บัญชี {FORCE_GL_NON_ROCKS_PC} อัตโนมัติ (คอลัมน์ “รายการ” ถูกล็อก)
          </p>
        )}
      </div>

      {/* Receipts (refType clear_doc) — attach first: each file OCR-fills one expense line */}
      <div className="rounded-2xl p-4 sm:p-5 flex flex-col gap-3" style={box} data-err="files">
        <Field label="ใบเสร็จ / ใบกำกับภาษี * (แนบก่อนกรอกรายการ)">
          <FileArea
            files={files} readOnly={readOnly} uploading={uploading}
            locked={advanceRequestId == null}
            lockedHint="กรุณาเลือก “เงินทดรองจ่ายที่จะเคลียร์” ก่อน จึงจะแนบใบเสร็จได้"
            onPick={(list) => uploadFiles(list, "clear_doc")}
            onRemove={(id) => removeFile(id, "clear_doc")}
            onView={openFileViewer}
          />
          {!readOnly && advanceRequestId != null && (
            <div className="flex items-start justify-between gap-2 mt-1">
              <p className="text-[11px] m-0" style={{ color: "var(--text-faint)" }}>
              แนบใบเสร็จ/ใบกำกับภาษี (รูปภาพหรือ PDF · ไทย/อังกฤษ) — <b>1 ใบกำกับ = 1 รายการ</b> (ไฟล์เดียวมีหลายใบได้ · PDF อ่านได้สูงสุด 15 หน้า) ระบบจะอ่าน “วันที่ · เลขที่เอกสาร · รายละเอียด · ยอดก่อน VAT · VAT · หัก ณ ที่จ่าย (พร้อมเลขผู้เสียภาษี/ชื่อผู้รับ ถ้ามี)” มาเติมให้ (แก้ไขได้)
              </p>
              <PoweredByClaude />
            </div>
          )}
          <FieldError msg={fieldErrors.files} />
        </Field>
      </div>

      {/* Expense-line grid (AP-3.1 section 1) */}
      <div className="rounded-2xl p-4 sm:p-5 flex flex-col gap-3" style={box} data-err="lines">
        <div className="flex items-center justify-between gap-2">
          <label className="text-[12px] font-bold" style={labelStyle}>รายการค่าใช้จ่ายจริง *</label>
        </div>
        {!readOnly && (
          <p className="text-[11px] m-0 -mt-2 leading-relaxed" style={{ color: "var(--text-faint)" }}>
            1 ใบกำกับ = 1 รายการ · ระบบจะอ่าน “วันที่ · เลขที่เอกสาร · รายละเอียด · ยอดก่อน VAT · VAT · หัก ณ ที่จ่าย” มาเติมให้ Auto (สามารถแก้ไขได้)
          </p>
        )}
        <FieldError msg={fieldErrors.lines} />
        <FieldError msg={fieldErrors.wht} />

        <div className="overflow-x-auto overflow-y-auto show-x-scroll max-h-[480px] -mx-1 px-1 pb-1 hidden md:block">
          <table className="w-full border-collapse" style={{ minWidth: 1620 }}>
            <thead>
              <tr className="text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                <Th w={34}>#</Th>
                <Th w={120}>วันที่</Th>
                <Th w={210}>เลขที่เอกสาร</Th>
                {/* Branch comes before the G/L account: it filters the account list. */}
                <Th w={190}>สาขา</Th>
                <Th w={220}>รายการ</Th>
                <Th w={240}>รายละเอียด</Th>
                <Th w={100} right>ก่อน VAT</Th>
                <Th w={90} right>VAT</Th>
                <Th w={100} right>รวม</Th>
                <Th w={90} right>WHT</Th>
                <Th w={100} right>สุทธิ</Th>
                <Th w={110} right>คงเหลือ</Th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, idx) => {
                const c = lineCalc[idx];
                return (
                  <tr key={idx} className="align-top">
                    <Td><span className="text-[12px] tabular-nums" style={{ color: "var(--text-muted)" }}>{idx + 1}</span></Td>
                    <Td>
                      <input type="date" className={cellClass} style={{ ...cellStyle, width: "100%" }}
                        value={l.expenseDate} disabled={readOnly}
                        onChange={(e) => updateLine(idx, { expenseDate: e.target.value })} />
                    </Td>
                    <Td>
                      <input className={cellClass} style={{ ...cellStyle, width: "100%" }}
                        value={l.docNo} disabled={readOnly} placeholder="—"
                        onChange={(e) => updateLine(idx, { docNo: e.target.value })} />
                    </Td>
                    <Td>
                      <BranchPicker options={branches} value={l.branchCode}
                        disabled={readOnly || !brandCode} noBrand={!brandCode}
                        onPick={(code) => updateLine(idx, { branchCode: code })} />
                    </Td>
                    <Td>
                      {glForced ? (
                        <div className="text-[12px] px-2 py-1.5 rounded-lg"
                          style={{ background: "var(--bg-card-alt)", color: "var(--text-muted)", border: "1px dashed var(--border-card)" }}>
                          {FORCE_GL_NON_ROCKS_PC} · เงินจ่ายแทนบริษัทอื่น
                        </div>
                      ) : (
                        <GlPicker
                          options={glOptionsFor(l)}
                          valueNo={l.glAccountNo}
                          disabled={readOnly || !l.branchCode}
                          noBranch={!l.branchCode}
                          onPick={(o) => updateLine(idx, { glAccountNo: o?.glAccountNo ?? "", glAccountName: o?.nameTh ?? "" })}
                        />
                      )}
                    </Td>
                    <Td>
                      <textarea rows={1} className={cellClass}
                        style={{ ...cellStyle, width: "100%", resize: "none", overflow: "hidden", minHeight: 30, lineHeight: 1.35 }}
                        value={l.description} disabled={readOnly} placeholder="—"
                        ref={(el) => autoGrow(el)}
                        onChange={(e) => { autoGrow(e.target); updateLine(idx, { description: e.target.value }); }} />
                    </Td>
                    <Td right>
                      <input type="number" min="0" step="0.01" className={`${cellClass} text-right`} style={{ ...cellStyle, width: "100%" }}
                        value={l.amountBeforeVat} disabled={readOnly} placeholder="0.00"
                        onChange={(e) => updateLine(idx, { amountBeforeVat: e.target.value })} />
                    </Td>
                    <Td right>
                      <input type="number" min="0" step="0.01" className={`${cellClass} text-right`} style={{ ...cellStyle, width: "100%" }}
                        value={l.vatAmount} disabled={readOnly} placeholder="0.00"
                        onChange={(e) => updateLine(idx, { vatAmount: e.target.value })} />
                    </Td>
                    <Td right><ReadCell value={money(c.total)} /></Td>
                    <Td right>
                      <input type="number" min="0" step="0.01" className={`${cellClass} text-right`} style={{ ...cellStyle, width: "100%" }}
                        value={l.whtAmount} disabled={readOnly} placeholder="0.00"
                        onChange={(e) => updateLine(idx, { whtAmount: e.target.value })} />
                    </Td>
                    <Td right><ReadCell value={money(c.net)} strong /></Td>
                    <Td right><ReadCell value={money(c.balance)} tone={c.balance < 0 ? "danger" : undefined} /></Td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="text-[12px] font-bold" style={{ color: "var(--text-heading)" }}>
                <Td colSpan={6}><span className="text-[11px]" style={{ color: "var(--text-secondary)" }}>รวมทั้งหมด</span></Td>
                <Td right><FootVal value={money(sums.before)} /></Td>
                <Td right><FootVal value={money(sums.vat)} /></Td>
                <Td right><FootVal value={money(sums.total)} /></Td>
                <Td right><FootVal value={money(sums.wht)} /></Td>
                <Td right><FootVal value={money(sums.net)} accent /></Td>
                <Td right />
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Mobile: each expense line as an editable card (P2.4) — same state/handlers */}
        <div className="md:hidden flex flex-col gap-3">
          {lines.map((l, idx) => {
            const c = lineCalc[idx];
            return (
              <div key={idx} className="rounded-xl p-3 flex flex-col gap-2.5"
                style={{ background: "var(--bg-card-alt)", border: "1px solid var(--border-card)" }}>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold" style={{ color: "var(--text-muted)" }}>รายการที่ {idx + 1}</span>
                </div>
                <MField label="วันที่">
                  <input type="date" className={fieldClass} style={fieldStyle}
                    value={l.expenseDate} disabled={readOnly}
                    onChange={(e) => updateLine(idx, { expenseDate: e.target.value })} />
                </MField>
                <MField label="เลขที่เอกสาร">
                  <input className={fieldClass} style={fieldStyle}
                    value={l.docNo} disabled={readOnly} placeholder="—"
                    onChange={(e) => updateLine(idx, { docNo: e.target.value })} />
                </MField>
                <MField label="สาขา">
                  <BranchPicker options={branches} value={l.branchCode}
                    disabled={readOnly || !brandCode} noBrand={!brandCode}
                    onPick={(code) => updateLine(idx, { branchCode: code })} />
                </MField>
                <MField label="รายการ">
                  {glForced ? (
                    <div className="text-[12px] px-3 py-2 rounded-xl"
                      style={{ background: "var(--bg-card)", color: "var(--text-muted)", border: "1px dashed var(--border-card)" }}>
                      {FORCE_GL_NON_ROCKS_PC} · เงินจ่ายแทนบริษัทอื่น
                    </div>
                  ) : (
                    <GlPicker
                      options={glOptionsFor(l)} valueNo={l.glAccountNo}
                      disabled={readOnly || !l.branchCode} noBranch={!l.branchCode}
                      onPick={(o) => updateLine(idx, { glAccountNo: o?.glAccountNo ?? "", glAccountName: o?.nameTh ?? "" })}
                    />
                  )}
                </MField>
                <MField label="รายละเอียด">
                  <textarea rows={1} className={fieldClass}
                    style={{ ...fieldStyle, resize: "none", overflow: "hidden", minHeight: 38, lineHeight: 1.4 }}
                    value={l.description} disabled={readOnly} placeholder="—"
                    ref={(el) => autoGrow(el)}
                    onChange={(e) => { autoGrow(e.target); updateLine(idx, { description: e.target.value }); }} />
                </MField>
                <div className="grid grid-cols-2 gap-2">
                  <MField label="ก่อน VAT">
                    <input type="number" min="0" step="0.01" inputMode="decimal" className={`${fieldClass} text-right`} style={fieldStyle}
                      value={l.amountBeforeVat} disabled={readOnly} placeholder="0.00"
                      onChange={(e) => updateLine(idx, { amountBeforeVat: e.target.value })} />
                  </MField>
                  <MField label="VAT">
                    <input type="number" min="0" step="0.01" inputMode="decimal" className={`${fieldClass} text-right`} style={fieldStyle}
                      value={l.vatAmount} disabled={readOnly} placeholder="0.00"
                      onChange={(e) => updateLine(idx, { vatAmount: e.target.value })} />
                  </MField>
                  <MField label="WHT">
                    <input type="number" min="0" step="0.01" inputMode="decimal" className={`${fieldClass} text-right`} style={fieldStyle}
                      value={l.whtAmount} disabled={readOnly} placeholder="0.00"
                      onChange={(e) => updateLine(idx, { whtAmount: e.target.value })} />
                  </MField>
                </div>
                <div className="flex items-center justify-between gap-2 text-[12px] pt-2"
                  style={{ borderTop: "1px solid var(--border-light)" }}>
                  <span style={{ color: "var(--text-muted)" }}>รวม <b style={{ color: "var(--text-heading)" }}>฿{money(c.total)}</b></span>
                  <span style={{ color: "var(--text-muted)" }}>สุทธิ <b style={{ color: "var(--text-heading)" }}>฿{money(c.net)}</b></span>
                  <span style={{ color: "var(--text-muted)" }}>คงเหลือ <b style={{ color: c.balance < 0 ? "var(--color-danger)" : "var(--text-heading)" }}>฿{money(c.balance)}</b></span>
                </div>
              </div>
            );
          })}
          {/* Mobile totals */}
          <div className="flex items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-[12px] font-bold"
            style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)", color: "var(--text-heading)" }}>
            <span className="text-[11px]" style={{ color: "var(--text-secondary)" }}>รวมทั้งหมด</span>
            <span className="tabular-nums">สุทธิ ฿{money(sums.net)}</span>
          </div>
        </div>

        {/* Refund summary */}
        {advanceRequestId != null && (
          <RefundSummary advanceAmount={advanceAmount ?? 0} actualTotal={actualTotal} refund={refundToCompany} />
        )}
      </div>

      {/* WHT certificate sub-table (AP-3.1 section 2) */}
      {showWht && (
        <div className="rounded-2xl p-4 sm:p-5 flex flex-col gap-3" style={box}>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <label className="text-[12px] font-bold" style={labelStyle}>
              หนังสือรับรองการหักภาษี ณ ที่จ่าย *
            </label>
            {!readOnly && (
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" type="button" onClick={prefillWhtFromLines}>ดึงจากรายการ</Button>
                <Button variant="ghost" size="sm" type="button" icon={<Plus size={14} />} onClick={addWht}>เพิ่มแถว</Button>
              </div>
            )}
          </div>

          {whtMismatch && (
            <p className="text-[11px] px-2.5 py-1.5 rounded-lg m-0"
              style={{ background: "color-mix(in srgb, var(--color-danger) 8%, transparent)", color: "var(--color-danger)", border: "1px solid color-mix(in srgb, var(--color-danger) 25%, transparent)" }}>
              ยอด WHT ในตารางนี้ (฿{money(certWht)}) ต้องเท่ากับยอด WHT ในรายการค่าใช้จ่าย (฿{money(sums.wht)})
            </p>
          )}

          <div className="overflow-x-auto -mx-1 px-1 hidden md:block">
            <table className="w-full border-collapse" style={{ minWidth: 980 }}>
              <thead>
                <tr className="text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                  <Th w={34}>#</Th>
                  <Th w={110}>วันที่</Th>
                  <Th w={100}>เลขที่เอกสาร</Th>
                  <Th w={130}>เลขผู้เสียภาษี *</Th>
                  <Th w={150}>ชื่อผู้รับ *</Th>
                  <Th w={170}>ที่อยู่</Th>
                  <Th w={100} right>ค่าใช้จ่าย</Th>
                  <Th w={90} right>WHT</Th>
                  {!readOnly && <Th w={34}> </Th>}
                </tr>
              </thead>
              <tbody>
                {whtRows.length === 0 ? (
                  <tr>
                    <Td colSpan={readOnly ? 8 : 9}>
                      <span className="text-[12px]" style={{ color: "var(--text-muted)" }}>
                        ยังไม่มีรายการ — กด “ดึงจากรายการ” หรือ “เพิ่มแถว”
                      </span>
                    </Td>
                  </tr>
                ) : whtRows.map((w, idx) => (
                  <tr key={idx} className="align-top">
                    <Td><span className="text-[12px] tabular-nums" style={{ color: "var(--text-muted)" }}>{idx + 1}</span></Td>
                    <Td>
                      <input type="date" className={cellClass} style={{ ...cellStyle, width: "100%" }}
                        value={w.expenseDate} disabled={readOnly}
                        onChange={(e) => updateWht(idx, { expenseDate: e.target.value })} />
                    </Td>
                    <Td>
                      <input className={cellClass} style={{ ...cellStyle, width: "100%" }}
                        value={w.docNo} disabled={readOnly} placeholder="—"
                        onChange={(e) => updateWht(idx, { docNo: e.target.value })} />
                    </Td>
                    <Td>
                      <input className={cellClass} style={{ ...cellStyle, width: "100%" }}
                        value={w.taxId} disabled={readOnly} placeholder="เลข 13 หลัก"
                        onChange={(e) => updateWht(idx, { taxId: e.target.value })} />
                    </Td>
                    <Td>
                      <input className={cellClass} style={{ ...cellStyle, width: "100%" }}
                        value={w.payeeName} disabled={readOnly} placeholder="ชื่อ-สกุล / บริษัท"
                        onChange={(e) => updateWht(idx, { payeeName: e.target.value })} />
                    </Td>
                    <Td>
                      <input className={cellClass} style={{ ...cellStyle, width: "100%" }}
                        value={w.payeeAddress} disabled={readOnly} placeholder="—"
                        onChange={(e) => updateWht(idx, { payeeAddress: e.target.value })} />
                    </Td>
                    <Td right>
                      <input type="number" min="0" step="0.01" className={`${cellClass} text-right`} style={{ ...cellStyle, width: "100%" }}
                        value={w.amount} disabled={readOnly} placeholder="0.00"
                        onChange={(e) => updateWht(idx, { amount: e.target.value })} />
                    </Td>
                    <Td right>
                      <input type="number" min="0" step="0.01" className={`${cellClass} text-right`} style={{ ...cellStyle, width: "100%" }}
                        value={w.whtAmount} disabled={readOnly} placeholder="0.00"
                        onChange={(e) => updateWht(idx, { whtAmount: e.target.value })} />
                    </Td>
                    {!readOnly && (
                      <Td>
                        <button type="button" onClick={() => removeWht(idx)}
                          className="p-1.5 rounded-lg cursor-pointer border-none bg-transparent"
                          style={{ color: "var(--color-danger)" }} title="ลบแถว" aria-label={`ลบรายการหัก ณ ที่จ่ายที่ ${idx + 1}`}>
                          <Trash2 size={14} />
                        </button>
                      </Td>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="text-[12px] font-bold" style={{ color: "var(--text-heading)" }}>
                  <Td colSpan={7}><span className="text-[11px]" style={{ color: "var(--text-secondary)" }}>รวม WHT</span></Td>
                  <Td right><FootVal value={money(certWht)} accent={!whtMismatch} tone={whtMismatch ? "danger" : undefined} /></Td>
                  {!readOnly && <Td />}
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Mobile: WHT rows as editable cards (P2.4) */}
          <div className="md:hidden flex flex-col gap-3">
            {whtRows.length === 0 ? (
              <p className="text-[12px] m-0" style={{ color: "var(--text-muted)" }}>
                ยังไม่มีรายการ — กด “ดึงจากรายการ” หรือ “เพิ่มแถว”
              </p>
            ) : whtRows.map((w, idx) => (
              <div key={idx} className="rounded-xl p-3 flex flex-col gap-2.5"
                style={{ background: "var(--bg-card-alt)", border: "1px solid var(--border-card)" }}>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold" style={{ color: "var(--text-muted)" }}>รายการที่ {idx + 1}</span>
                  {!readOnly && (
                    <button type="button" onClick={() => removeWht(idx)}
                      className="p-1.5 rounded-lg cursor-pointer border-none bg-transparent"
                      style={{ color: "var(--color-danger)" }} aria-label={`ลบรายการหัก ณ ที่จ่ายที่ ${idx + 1}`}>
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <MField label="วันที่">
                    <input type="date" className={fieldClass} style={fieldStyle}
                      value={w.expenseDate} disabled={readOnly}
                      onChange={(e) => updateWht(idx, { expenseDate: e.target.value })} />
                  </MField>
                  <MField label="เลขที่เอกสาร">
                    <input className={fieldClass} style={fieldStyle}
                      value={w.docNo} disabled={readOnly} placeholder="—"
                      onChange={(e) => updateWht(idx, { docNo: e.target.value })} />
                  </MField>
                </div>
                <MField label="เลขผู้เสียภาษี *">
                  <input className={fieldClass} style={fieldStyle} inputMode="numeric"
                    value={w.taxId} disabled={readOnly} placeholder="เลข 13 หลัก"
                    onChange={(e) => updateWht(idx, { taxId: e.target.value })} />
                </MField>
                <MField label="ชื่อผู้รับ *">
                  <input className={fieldClass} style={fieldStyle}
                    value={w.payeeName} disabled={readOnly} placeholder="ชื่อ-สกุล / บริษัท"
                    onChange={(e) => updateWht(idx, { payeeName: e.target.value })} />
                </MField>
                <MField label="ที่อยู่">
                  <input className={fieldClass} style={fieldStyle}
                    value={w.payeeAddress} disabled={readOnly} placeholder="—"
                    onChange={(e) => updateWht(idx, { payeeAddress: e.target.value })} />
                </MField>
                <div className="grid grid-cols-2 gap-2">
                  <MField label="ค่าใช้จ่าย">
                    <input type="number" min="0" step="0.01" inputMode="decimal" className={`${fieldClass} text-right`} style={fieldStyle}
                      value={w.amount} disabled={readOnly} placeholder="0.00"
                      onChange={(e) => updateWht(idx, { amount: e.target.value })} />
                  </MField>
                  <MField label="WHT">
                    <input type="number" min="0" step="0.01" inputMode="decimal" className={`${fieldClass} text-right`} style={fieldStyle}
                      value={w.whtAmount} disabled={readOnly} placeholder="0.00"
                      onChange={(e) => updateWht(idx, { whtAmount: e.target.value })} />
                  </MField>
                </div>
              </div>
            ))}
            {whtRows.length > 0 && (
              <div className="flex items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-[12px] font-bold"
                style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}>
                <span className="text-[11px]" style={{ color: "var(--text-secondary)" }}>รวม WHT</span>
                <span className="tabular-nums" style={{ color: whtMismatch ? "var(--color-danger)" : "var(--nav-active-text)" }}>฿{money(certWht)}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Refund transfer (only when money must be returned to the company) */}
      {needsRefundTransfer && (
        <div className="rounded-2xl p-4 sm:p-5 flex flex-col gap-3" style={box}>
          <div className="flex items-center gap-2 text-[13px] font-bold" style={{ color: "var(--text-primary)" }}>
            <Banknote size={15} /> การโอนเงินคืนบริษัท
          </div>
          <p className="text-[12px] px-3 py-2 rounded-lg m-0"
            style={{ background: "var(--bg-info-green)", color: "var(--text-info-green)", border: "1px solid var(--border-info-green)" }}>
            {COMPANY_BANK_LINE}
          </p>
          <div data-err="refundProof">
          <Field label="หลักฐานการโอนเงินคืน *">
            <FileArea
              files={refundProofFiles} readOnly={readOnly} uploading={uploadingProof}
              onPick={(list) => uploadFiles(list, "refund_proof")}
              onRemove={(id) => removeFile(id, "refund_proof")}
              onView={openFileViewer}
            />
            <div className="flex items-start justify-between gap-2 mt-1">
              <p className="text-[11px] m-0" style={{ color: "var(--text-faint)" }}>
              แนบสลิปแล้วระบบจะอ่าน “จำนวนเงิน” และ “วันที่” มาเติมให้อัตโนมัติ (แก้ไขได้) · ยอดที่ต้องโอนคืน ฿{money(refundToCompany)}
              </p>
              <PoweredByClaude />
            </div>
            <FieldError msg={fieldErrors.refundProof} />
          </Field>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div data-err="refundAmount">
            <Field label="จำนวนเงินที่โอนคืน (บาท) *">
              <input type="number" inputMode="decimal" min={0} step="0.01"
                className={fieldClass} style={fieldStyle} value={refundTransferAmount}
                disabled={readOnly} placeholder={money(refundToCompany)}
                aria-invalid={!!fieldErrors.refundAmount}
                onChange={(e) => setRefundTransferAmount(e.target.value)} />
              <FieldError msg={fieldErrors.refundAmount} />
            </Field>
            </div>
            <div data-err="refundDate">
            <Field label="วันที่โอนเงินคืน *">
              <input type="date" className={fieldClass} style={fieldStyle} value={refundTransferDate}
                disabled={readOnly} aria-invalid={!!fieldErrors.refundDate}
                onChange={(e) => setRefundTransferDate(e.target.value)} />
              <FieldError msg={fieldErrors.refundDate} />
            </Field>
            </div>
          </div>
          {slipWarn && (
            <p className="text-[12px] px-3 py-2 rounded-lg m-0 flex items-start gap-2"
              style={{ background: "var(--bg-info-yellow)", color: "var(--text-info-yellow)", border: "1px solid var(--border-info-yellow)" }}>
              <span aria-hidden>⚠️</span>
              <span>{slipWarn} — กรุณาตรวจสอบสลิปอีกครั้ง (ยังส่งคำขอได้ แต่บัญชีจะเห็นการเตือนนี้)</span>
            </p>
          )}
        </div>
      )}

      {!readOnly && (
        <div className="flex items-center justify-end gap-2">
          <Button variant="secondary" onClick={handleSave} loading={saving} disabled={submitting}>บันทึกแบบร่าง</Button>
          <Button variant="primary" onClick={handleSubmit} loading={submitting} disabled={saving}>ส่งคำขอ</Button>
        </div>
      )}

      {/* Confirm popup for file delete */}
      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(o) => { if (!o) setPendingDelete(null); }}
        title="ยืนยันการลบไฟล์"
        scrollable={false}
      >
        <div className="px-5 py-4 flex flex-col gap-4">
          <p className="text-[13px] m-0" style={{ color: "var(--text-secondary)" }}>
            คุณต้องการลบไฟล์นี้ใช่หรือไม่? การลบไม่สามารถย้อนกลับได้
          </p>
          <div className="flex items-center justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setPendingDelete(null)}>ยกเลิก</Button>
            <Button variant="danger" size="sm" onClick={doRemoveFile}>ลบไฟล์</Button>
          </div>
        </div>
      </Dialog>

      {/* OCR results wait here until the user confirms them (§7) */}
      {/* Mounted only while there are candidates: a fresh `[]` prop on every closed
          render would re-seed the modal's local copy in a loop. */}
      {ocrRows !== null && (
      <OcrConfirmModal
        open
        rows={ocrRows}
        skippedPages={ocrSkipped}
        branches={branches}
        brandChosen={!!brandCode}
        glForced={glForced}
        forcedGlLabel={`${FORCE_GL_NON_ROCKS_PC} · เงินจ่ายแทนบริษัทอื่น`}
        onConfirm={acceptOcrRows}
        onCancel={() => setOcrRows(null)}
      />
      )}

      {/* OCR scanning overlays — shown while Claude reads receipts / transfer slips */}
      {ocrScanning && (
        <TravelExpenseLoadingPopup
          label="กำลังตรวจสอบ..."
          subtitle="AI กำลังอ่านข้อมูลจากใบเสร็จ / ใบกำกับภาษี"
        />
      )}
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

function Th({ children, w, right }: { children: ReactNode; w?: number; right?: boolean }) {
  return (
    // Sticky so the header stays visible while scrolling many expense rows.
    // inset box-shadow (not border-bottom) keeps the underline under border-collapse.
    <th className={`px-2 py-1.5 font-bold ${right ? "text-right" : "text-left"}`}
      style={{
        width: w, whiteSpace: "nowrap",
        position: "sticky", top: 0, zIndex: 2,
        background: "var(--bg-card)",
        boxShadow: "inset 0 -1px 0 var(--border-card)",
      }}>
      {children}
    </th>
  );
}

function Td({ children, right, colSpan }: { children?: ReactNode; right?: boolean; colSpan?: number }) {
  return (
    <td colSpan={colSpan} className={`px-2 py-1.5 ${right ? "text-right" : ""}`}
      style={{ borderBottom: "1px solid var(--border-light)", verticalAlign: "top" }}>
      {children}
    </td>
  );
}

function ReadCell({ value, strong, tone }: { value: string; strong?: boolean; tone?: "danger" }) {
  return (
    <span className={`inline-block text-[12px] tabular-nums px-2 py-1.5 ${strong ? "font-bold" : ""}`}
      style={{ color: tone === "danger" ? "var(--color-danger)" : strong ? "var(--text-heading)" : "var(--text-secondary)" }}>
      {value}
    </span>
  );
}

function FootVal({ value, accent, tone }: { value: string; accent?: boolean; tone?: "danger" }) {
  return (
    <span className="text-[13px] font-bold tabular-nums"
      style={{ color: tone === "danger" ? "var(--color-danger)" : accent ? "var(--nav-active-text)" : "var(--text-heading)" }}>
      ฿{value}
    </span>
  );
}

function FileArea({
  files, readOnly, uploading, onPick, onRemove, onView, locked, lockedHint,
}: {
  files: AccFileMeta[];
  readOnly: boolean;
  uploading: boolean;
  onPick: (list: FileList | null) => void;
  onRemove: (id: number) => void;
  onView: (f: AccFileMeta) => void;
  /** Disable attaching until a prerequisite is met (e.g. pick the advance first). */
  locked?: boolean;
  lockedHint?: string;
}) {
  const disabled = uploading || locked;
  const btnStyle = {
    background: "var(--bg-card)", border: "1px solid var(--border-card)",
    color: locked ? "var(--text-faint)" : "var(--nav-active-text)",
    opacity: locked ? 0.5 : 1, cursor: locked ? "not-allowed" : "pointer",
  } as const;
  return (
    <div className="flex flex-col gap-2">
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold" style={btnStyle}>
            <Paperclip size={14} /> แนบไฟล์
            <input type="file" hidden multiple accept="image/*,application/pdf" disabled={disabled}
              onChange={(e) => { onPick(e.target.files); e.target.value = ""; }} />
          </label>
          <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold" style={btnStyle}>
            <Camera size={14} /> ถ่ายรูป
            <input type="file" hidden accept="image/*" capture="environment" disabled={disabled}
              onChange={(e) => { onPick(e.target.files); e.target.value = ""; }} />
          </label>
          {uploading && <span className="text-[12px]" style={{ color: "var(--text-muted)" }}>กำลังอัปโหลด...</span>}
        </div>
      )}
      <span className="text-[11px]" style={{ color: locked ? "var(--text-info-yellow)" : "var(--text-muted)" }}>
        {locked ? (lockedHint ?? "กรุณาเลือกก่อนจึงจะแนบไฟล์ได้") : "รองรับรูปภาพ/PDF · ไม่เกิน 4MB ต่อไฟล์"}
      </span>
      {files.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {files.map((f) => {
            // Declared type first, then the name — SharePoint returns
            // `application/octet-stream` often enough that the fallback matters.
            const isImage = attachmentKind(f.fileName, f.contentType) === "image";
            return (
            <div key={f.id} className="relative rounded-lg overflow-hidden"
              style={{ width: 76, height: 76, border: "1px solid var(--border-card)", background: "var(--bg-card)" }}>
              <button type="button" onClick={() => onView(f)} title={f.fileName}
                className="block w-full h-full cursor-pointer border-none p-0 bg-transparent">
                {isImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={f.url} alt={f.fileName} className="w-full h-full object-cover" />
                ) : (
                  <span className="w-full h-full flex flex-col items-center justify-center gap-1 px-1"
                    style={{ color: "var(--text-muted)" }}>
                    <FileText size={22} />
                    <span className="text-[9px] font-semibold leading-tight text-center truncate w-full">
                      {(f.fileName.split(".").pop() ?? "").toUpperCase().slice(0, 4) || "FILE"}
                    </span>
                  </span>
                )}
              </button>
              {!readOnly && (
                <button type="button" onClick={() => onRemove(f.id)}
                  className="absolute top-0.5 right-0.5 leading-none p-0.5 rounded-full cursor-pointer border-none"
                  style={{ background: "rgba(0,0,0,0.55)", color: "#fff" }} title="ลบ" aria-label={`ลบไฟล์ ${f.fileName}`}>
                  <X size={12} />
                </button>
              )}
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RefundSummary({
  advanceAmount, actualTotal, refund,
}: { advanceAmount: number; actualTotal: number; refund: number }) {
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
    <div className="rounded-xl p-4 flex flex-col gap-2"
      style={{ background: tone.bg, border: `1px solid ${tone.border}` }}>
      <div className="flex items-center justify-between text-[12px]" style={{ color: "var(--text-secondary)" }}>
        <span>วงเงินที่ได้รับ</span>
        <span className="tabular-nums font-semibold">฿{money(advanceAmount)}</span>
      </div>
      <div className="flex items-center justify-between text-[12px]" style={{ color: "var(--text-secondary)" }}>
        <span>ยอดใช้จ่ายจริง (สุทธิ)</span>
        <span className="tabular-nums font-semibold">฿{money(actualTotal)}</span>
      </div>
      <div className="flex items-center justify-between pt-2" style={{ borderTop: `1px solid ${tone.border}` }}>
        <span className="text-[14px] font-bold" style={{ color: tone.text }}>{label}</span>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[12px] font-bold" style={labelStyle}>{label}</label>
      {children}
    </div>
  );
}

/** Loading skeleton for the requester / manager cards (same look as AP-1). */
function PersonSkeleton(): ReactNode {
  return (
    <div className="flex items-center gap-3">
      <div className="shrink-0 w-11 h-11 rounded-2xl animate-pulse" style={{ background: "var(--bg-card-alt)" }} />
      <div className="flex-1 flex flex-col gap-2 min-w-0">
        <div className="h-3 w-32 rounded animate-pulse" style={{ background: "var(--bg-card-alt)" }} />
        <div className="h-3 w-44 rounded animate-pulse" style={{ background: "var(--bg-card-alt)" }} />
        <div className="h-3 w-36 rounded animate-pulse" style={{ background: "var(--bg-card-alt)" }} />
      </div>
    </div>
  );
}

/** Compact labeled field used inside the mobile expense/WHT cards (P2.4). The
 *  <label> wrapper associates the caption with the control it contains. */
function MField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 min-w-0">
      <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>{label}</span>
      {children}
    </label>
  );
}
