"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import {
  Check, Paperclip, Camera, X, Plus, Trash2, Search, Banknote, User, Mail, FileText,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Avatar } from "@/components/ui/Avatar";
import { TravelExpenseLoadingPopup } from "@/features/accounting/components/TravelExpenseLoadingPopup";
import { PoweredByClaude } from "@/components/ui/PoweredByClaude";
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
const cellClass = "text-[12px] px-2 py-1.5 rounded-lg outline-none";
const cellStyle = {
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
  const [glAccounts, setGlAccounts] = useState<GlAccountOption[]>([]);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [files, setFiles] = useState<AccFileMeta[]>([]);
  const [refundProofFiles, setRefundProofFiles] = useState<AccFileMeta[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadingProof, setUploadingProof] = useState(false);
  const [ocrScanning, setOcrScanning] = useState(false);
  const [slipScanning, setSlipScanning] = useState(false);

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
    Promise.all([
      fetch("/api/request/clear-advance/options/brands").then((r) => r.json()),
      fetch("/api/request/clear-advance/options/gl-accounts").then((r) => r.json()),
    ])
      .then(([b, gl]) => {
        if (cancelled) return;
        if (b?.ok) setBrands(b.data ?? []);
        if (gl?.ok) setGlAccounts(gl.data ?? []);
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
    const firstFile = filesArr[0];
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
          if (!isProof && isOcrable(f)) ocrDocs.push({ file: f, fileId: j.data.id });
        }
      }
      toast.success("แนบไฟล์แล้ว");
      // Auto-verify the refund slip amount against the required refund (best-effort).
      if (isProof && firstFile && isOcrable(firstFile)) void verifyRefundSlip(firstFile);
      // Read each receipt / tax invoice → one expense line per file (best-effort).
      if (ocrDocs.length) void verifyReceipts(ocrDocs);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "อัปโหลดไม่สำเร็จ");
    } finally {
      (isProof ? setUploadingProof : setUploading)(false);
    }
  }

  interface ReceiptData {
    date: string | null; description: string | null; docNo: string | null;
    wht: number | null; taxId: string | null; payeeName: string | null; payeeAddress: string | null;
    total: number | null; vat: number | null; beforeVat: number | null;
  }

  /** OCR a single receipt image → parsed fields (or null on failure). */
  async function ocrReceipt(file: File): Promise<ReceiptData | null> {
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/request/clear-advance/verify-receipt", { method: "POST", body: fd });
      const j = (await res.json()) as { ok: boolean; data?: ReceiptData };
      if (!j.ok || !j.data) return null;
      const d = j.data;
      if (d.date == null && d.docNo == null && d.beforeVat == null && d.description == null) return null;
      return d;
    } catch {
      return null;
    }
  }

  /**
   * OCR each uploaded receipt / tax invoice — ONE expense line per file. Each
   * file's date / doc no. / amount-before-VAT / VAT fills the next empty line
   * (a new line is appended when none is free), all as editable defaults. Never
   * overwrites a line the user already filled.
   */
  async function verifyReceipts(docs: { file: File; fileId: number }[]) {
    setOcrScanning(true);
    try {
    const parsed: { data: ReceiptData; fileId: number }[] = [];
    for (const d of docs) {
      const r = await ocrReceipt(d.file); // serialized — the OCR worker is shared
      if (r) parsed.push({ data: r, fileId: d.fileId });
    }
    if (parsed.length === 0) return;

    setLines((prev) => {
      const next = [...prev];
      const isBlank = (l: LineRow) =>
        !l.glAccountNo && !l.expenseDate && !l.docNo && !l.description && !num(l.amountBeforeVat) && !num(l.vatAmount);
      for (const { data: r, fileId } of parsed) {
        let idx = next.findIndex(isBlank);
        if (idx < 0) { next.push(emptyLine()); idx = next.length - 1; }
        const l = { ...next[idx], sourceFileId: fileId };
        if (r.date) l.expenseDate = r.date;
        if (r.docNo) l.docNo = r.docNo;
        if (r.description) l.description = r.description;
        if (r.beforeVat != null) l.amountBeforeVat = String(r.beforeVat);
        if (r.vat != null) l.vatAmount = String(r.vat);
        if (r.wht != null && r.wht > 0) l.whtAmount = String(r.wht);
        next[idx] = l;
      }
      return next;
    });

    // Docs that carry withholding tax → prefill a WHT-certificate row (opens the
    // WHT section; keeps its total matching the line WHT). Payee/tax-id best-effort.
    const whtDocs = parsed.map((p) => p.data).filter((r) => (r.wht ?? 0) > 0);
    if (whtDocs.length) {
      setWhtRows((prev) => [
        ...prev,
        ...whtDocs.map((r) => ({
          expenseDate: r.date ?? "",
          docNo: r.docNo ?? "",
          description: r.description ?? "",
          taxId: r.taxId ?? "",
          payeeName: r.payeeName ?? "",
          payeeAddress: r.payeeAddress ?? "",
          amount: r.beforeVat != null ? String(r.beforeVat) : r.total != null ? String(r.total) : "",
          whtAmount: String(r.wht),
        })),
      ]);
    }

    toast.success(
      parsed.length === 1
        ? "อ่านเอกสารมาเติมเป็น 1 รายการให้แล้ว — กรุณาตรวจสอบ/แก้ไข"
        : `อ่าน ${parsed.length} เอกสารมาเติมเป็น ${parsed.length} รายการให้แล้ว — กรุณาตรวจสอบ/แก้ไข`,
    );
    } finally {
      setOcrScanning(false);
    }
  }

  /** OCR the refund slip: Claude vision first, fallback Tesseract. */
  async function verifyRefundSlip(file: File) {
    if (!(refundToCompany > 0)) return;
    setSlipScanning(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("expected", String(refundToCompany));
      const res = await fetch("/api/request/clear-advance/verify-slip", { method: "POST", body: fd });
      const j = (await res.json()) as {
        ok: boolean;
        data?: {
          configured: boolean; matched: boolean; expected: number;
          bestAmount: number | null; date: string | null; amounts: number[];
        };
      };
      if (!j.ok || !j.data || !j.data.configured) { setSlipWarn(null); return; }
      const { matched, bestAmount, date, amounts } = j.data;

      // Read-from-file → default the editable fields (user can still edit).
      if (bestAmount != null) setRefundTransferAmount(String(bestAmount));
      if (date) setRefundTransferDate(date);

      if (matched) {
        setSlipWarn(null);
        toast.success(`อ่านสลิปแล้ว: ฿${(bestAmount ?? refundToCompany).toLocaleString()} ตรงกับยอดที่ต้องโอนคืน`);
      } else {
        const found = amounts.length
          ? amounts.slice(0, 5).map((a) => `฿${a.toLocaleString()}`).join(", ")
          : "ไม่พบตัวเลขยอดเงิน";
        setSlipWarn(`ยอดในสลิปไม่ตรงกับที่ต้องโอนคืน (฿${refundToCompany.toLocaleString()}) — อ่านจากสลิปได้: ${found}`);
        if (bestAmount != null) toast("เติมยอด/วันที่จากสลิปให้แล้ว — กรุณาตรวจสอบก่อนส่ง");
      }
    } catch {
      setSlipWarn(null); // OCR unavailable — never block the flow.
    } finally {
      setSlipScanning(false);
    }
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
          />
          {!readOnly && advanceRequestId != null && (
            <div className=”flex items-start justify-between gap-2 mt-1”>
              <p className=”text-[11px] m-0” style={{ color: “var(--text-faint)” }}>
                แนบใบเสร็จ/ใบกำกับภาษี (รูปภาพหรือ PDF · ไทย/อังกฤษ) — <b>1 ไฟล์ = 1 รายการ</b> ระบบจะอ่าน “วันที่ · เลขที่เอกสาร · รายละเอียด · ยอดก่อน VAT · VAT · หัก ณ ที่จ่าย (พร้อมเลขผู้เสียภาษี/ชื่อผู้รับ ถ้ามี)” มาเติมให้ (แก้ไขได้)
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
            1 ไฟล์ = 1 รายการ · ระบบจะอ่าน “วันที่ · เลขที่เอกสาร · รายละเอียด · ยอดก่อน VAT · VAT · หัก ณ ที่จ่าย” มาเติมให้ Auto (สามารถแก้ไขได้)
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
                <Th w={220}>รายการ</Th>
                <Th w={240}>รายละเอียด</Th>
                <Th w={190}>สาขา</Th>
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
                      {glForced ? (
                        <div className="text-[12px] px-2 py-1.5 rounded-lg"
                          style={{ background: "var(--bg-card-alt)", color: "var(--text-muted)", border: "1px dashed var(--border-card)" }}>
                          {FORCE_GL_NON_ROCKS_PC} · เงินจ่ายแทนบริษัทอื่น
                        </div>
                      ) : (
                        <GlPicker
                          options={glAccounts}
                          valueNo={l.glAccountNo}
                          disabled={readOnly}
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
                    <Td>
                      <BranchPicker options={branches} value={l.branchCode}
                        disabled={readOnly || !brandCode} noBrand={!brandCode}
                        onPick={(code) => updateLine(idx, { branchCode: code })} />
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
                <MField label="รายการ">
                  {glForced ? (
                    <div className="text-[12px] px-3 py-2 rounded-xl"
                      style={{ background: "var(--bg-card)", color: "var(--text-muted)", border: "1px dashed var(--border-card)" }}>
                      {FORCE_GL_NON_ROCKS_PC} · เงินจ่ายแทนบริษัทอื่น
                    </div>
                  ) : (
                    <GlPicker
                      options={glAccounts} valueNo={l.glAccountNo} disabled={readOnly}
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
                <MField label="สาขา">
                  <BranchPicker options={branches} value={l.branchCode}
                    disabled={readOnly || !brandCode} noBrand={!brandCode}
                    onPick={(code) => updateLine(idx, { branchCode: code })} />
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
            />
            <div className=”flex items-start justify-between gap-2 mt-1”>
              <p className=”text-[11px] m-0” style={{ color: “var(--text-faint)” }}>
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

      {/* OCR scanning overlays — shown while Claude reads receipts / transfer slips */}
      {ocrScanning && (
        <TravelExpenseLoadingPopup
          label="กำลังตรวจสอบ..."
          subtitle="AI กำลังอ่านข้อมูลจากใบเสร็จ / ใบกำกับภาษี"
        />
      )}
      {slipScanning && (
        <TravelExpenseLoadingPopup
          label="กำลังตรวจสอบ..."
          subtitle="AI กำลังอ่านข้อมูลจากสลิปโอนเงิน"
        />
      )}
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

/** Searchable G/L account picker (`glAccountNo — nameTh`). */
function GlPicker({
  options, valueNo, disabled, onPick,
}: {
  options: GlAccountOption[];
  valueNo: string;
  disabled?: boolean;
  onPick: (o: GlAccountOption | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number; above: boolean } | null>(null);
  const selected = options.find((o) => o.glAccountNo === valueNo) ?? null;

  // Anchor the popup to the button in viewport coords (position: fixed) so it
  // floats ABOVE the table's overflow container instead of being clipped inside it.
  const place = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const width = Math.max(260, Math.min(320, window.innerWidth - 16));
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    const spaceBelow = window.innerHeight - r.bottom;
    const above = spaceBelow < 280 && r.top > spaceBelow;
    setPos({ top: above ? r.top - 4 : r.bottom + 4, left, width, above });
  };

  useEffect(() => {
    if (!open) return;
    place();
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || popRef.current?.contains(t)) return;
      setOpen(false);
    };
    const reflow = () => place();
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("scroll", reflow, true); // capture: follows any scroll container
    window.addEventListener("resize", reflow);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("scroll", reflow, true);
      window.removeEventListener("resize", reflow);
    };
  }, [open]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    const base = !term
      ? options
      : options.filter((o) =>
          o.glAccountNo.toLowerCase().includes(term) ||
          (o.nameTh ?? "").toLowerCase().includes(term) ||
          (o.nameEn ?? "").toLowerCase().includes(term));
    return base.slice(0, 60);
  }, [q, options]);

  return (
    <div className="relative">
      <button ref={btnRef} type="button" disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox" aria-expanded={open}
        aria-label={selected ? `รายการ: ${selected.glAccountNo} ${selected.nameTh ?? ""}` : "เลือกรายการบัญชี"}
        className={`${cellClass} w-full text-left flex items-center gap-1.5 disabled:cursor-not-allowed`}
        style={{ ...cellStyle, minHeight: 32 }}>
        <span className="flex-1 min-w-0 truncate" style={{ color: selected ? "var(--text-primary)" : "var(--text-faint)" }}>
          {selected ? `${selected.glAccountNo} — ${selected.nameTh ?? ""}` : "— เลือกรายการ —"}
        </span>
        <Search size={12} className="shrink-0" style={{ color: "var(--text-faint)" }} />
      </button>
      {open && pos && createPortal(
        <div ref={popRef}
          className="fixed z-[70] rounded-xl overflow-hidden"
          style={{
            top: pos.above ? undefined : pos.top,
            bottom: pos.above ? window.innerHeight - pos.top : undefined,
            left: pos.left, width: pos.width,
            background: "var(--bg-dropdown, var(--bg-card))",
            border: "1px solid var(--border-card)", boxShadow: "var(--shadow-dropdown)",
          }}>
          <div className="p-2" style={{ borderBottom: "1px solid var(--border-light)" }}>
            <input autoFocus className={cellClass} style={{ ...cellStyle, width: "100%" }}
              aria-label="ค้นหาเลขบัญชี / ชื่อบัญชี"
              placeholder="ค้นหาเลขบัญชี / ชื่อบัญชี" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="max-h-56 overflow-y-auto slim-scroll">
            {valueNo && (
              <button type="button" onClick={() => { onPick(null); setOpen(false); setQ(""); }}
                className="w-full text-left px-3 py-1.5 text-[11px] cursor-pointer border-none bg-transparent"
                style={{ color: "var(--text-muted)" }}>
                ล้างการเลือก
              </button>
            )}
            {filtered.length === 0 ? (
              <p className="px-3 py-2 text-[12px] m-0" style={{ color: "var(--text-muted)" }}>ไม่พบบัญชี</p>
            ) : filtered.map((o) => (
              <button key={o.glAccountNo} type="button"
                onClick={() => { onPick(o); setOpen(false); setQ(""); }}
                className="w-full text-left px-3 py-1.5 cursor-pointer border-none bg-transparent hover:opacity-80"
                style={{ background: o.glAccountNo === valueNo ? "var(--nav-active-bg)" : "transparent" }}>
                <span className="block text-[12px] font-semibold" style={{ color: "var(--text-primary)" }}>{o.glAccountNo}</span>
                <span className="block text-[11px] truncate" style={{ color: "var(--text-muted)" }}>{o.nameTh ?? o.nameEn ?? ""}</span>
              </button>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

/** Branch dimension picker — searchable, shows only the Code in the field.
 *  Same floating-portal behaviour as GlPicker so it isn't clipped by the table. */
function BranchPicker({
  options, value, disabled, noBrand, onPick,
}: {
  options: BranchOption[];
  value: string;
  disabled?: boolean;
  noBrand?: boolean;
  onPick: (code: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number; above: boolean } | null>(null);
  const selected = options.find((o) => o.code === value) ?? null;

  const place = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const width = Math.max(260, Math.min(320, window.innerWidth - 16));
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    const spaceBelow = window.innerHeight - r.bottom;
    const above = spaceBelow < 280 && r.top > spaceBelow;
    setPos({ top: above ? r.top - 4 : r.bottom + 4, left, width, above });
  };

  useEffect(() => {
    if (!open) return;
    place();
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || popRef.current?.contains(t)) return;
      setOpen(false);
    };
    const reflow = () => place();
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("scroll", reflow, true);
    window.addEventListener("resize", reflow);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("scroll", reflow, true);
      window.removeEventListener("resize", reflow);
    };
  }, [open]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    const base = !term
      ? options
      : options.filter((o) =>
          o.code.toLowerCase().includes(term) ||
          (o.name ?? "").toLowerCase().includes(term));
    return base.slice(0, 80);
  }, [q, options]);

  return (
    <div className="relative">
      <button ref={btnRef} type="button" disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox" aria-expanded={open}
        aria-label={selected ? `สาขา: ${selected.code}` : "เลือกสาขา"}
        className={`${cellClass} w-full text-left flex items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-60`}
        style={{ ...cellStyle, minHeight: 32 }}>
        <span className="flex-1 min-w-0 truncate" style={{ color: selected ? "var(--text-primary)" : "var(--text-faint)" }}>
          {selected ? selected.code : (noBrand ? "เลือกแบรนด์ก่อน" : "— เลือก —")}
        </span>
        <Search size={12} className="shrink-0" style={{ color: "var(--text-faint)" }} />
      </button>
      {open && pos && createPortal(
        <div ref={popRef}
          className="fixed z-[70] rounded-xl overflow-hidden"
          style={{
            top: pos.above ? undefined : pos.top,
            bottom: pos.above ? window.innerHeight - pos.top : undefined,
            left: pos.left, width: pos.width,
            background: "var(--bg-dropdown, var(--bg-card))",
            border: "1px solid var(--border-card)", boxShadow: "var(--shadow-dropdown)",
          }}>
          <div className="p-2" style={{ borderBottom: "1px solid var(--border-light)" }}>
            <input autoFocus className={cellClass} style={{ ...cellStyle, width: "100%" }}
              aria-label="ค้นหาสาขา"
              placeholder="ค้นหาสาขา (Code / ชื่อ)" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="max-h-56 overflow-y-auto slim-scroll">
            {value && (
              <button type="button" onClick={() => { onPick(""); setOpen(false); setQ(""); }}
                className="w-full text-left px-3 py-1.5 text-[11px] cursor-pointer border-none bg-transparent"
                style={{ color: "var(--text-muted)" }}>
                ล้างการเลือก
              </button>
            )}
            {filtered.length === 0 ? (
              <p className="px-3 py-2 text-[12px] m-0" style={{ color: "var(--text-muted)" }}>ไม่พบสาขา</p>
            ) : filtered.map((o) => (
              <button key={o.code} type="button"
                onClick={() => { onPick(o.code); setOpen(false); setQ(""); }}
                className="w-full text-left px-3 py-1.5 cursor-pointer border-none bg-transparent hover:opacity-80"
                style={{ background: o.code === value ? "var(--nav-active-bg)" : "transparent" }}>
                <span className="block text-[12px] font-semibold" style={{ color: "var(--text-primary)" }}>{o.code}</span>
                {o.name && <span className="block text-[11px] truncate" style={{ color: "var(--text-muted)" }}>{o.name}</span>}
              </button>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

function FileArea({
  files, readOnly, uploading, onPick, onRemove, locked, lockedHint,
}: {
  files: AccFileMeta[];
  readOnly: boolean;
  uploading: boolean;
  onPick: (list: FileList | null) => void;
  onRemove: (id: number) => void;
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
            const isPdf = f.contentType === "application/pdf" || f.fileName?.toLowerCase().endsWith(".pdf");
            return (
            <div key={f.id} className="relative rounded-lg overflow-hidden"
              style={{ width: 76, height: 76, border: "1px solid var(--border-card)", background: "var(--bg-card)" }}>
              <a href={f.url} target="_blank" rel="noreferrer" title={f.fileName} className="block w-full h-full">
                {isPdf ? (
                  <span className="w-full h-full flex flex-col items-center justify-center gap-1 px-1"
                    style={{ color: "var(--text-muted)" }}>
                    <FileText size={22} />
                    <span className="text-[9px] font-semibold leading-tight text-center truncate w-full">PDF</span>
                  </span>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={f.url} alt={f.fileName} className="w-full h-full object-cover" />
                )}
              </a>
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
