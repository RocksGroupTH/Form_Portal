"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Check, User, Mail, UserCog, Paperclip, Camera, X, FileText } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Avatar } from "@/components/ui/Avatar";
import { RequesterPickerModal, type RequesterOption } from "@/components/RequesterPickerModal";
import { CurrencyCombobox } from "@/features/advance/components/CurrencyCombobox";
import { TravelExpenseLoadingPopup } from "@/features/accounting/components/TravelExpenseLoadingPopup";
import type { AccBrandOption } from "@/features/accounting/types";
import type { AdvancePayeeType, AdvanceRequest, AdvanceSaveInput } from "@/features/advance/types";
import { AP2_DEFAULT_CURRENCY, AP2_MAX_CLEAR_DAYS, AP2_PRPO_THRESHOLD } from "@/features/advance/constants";
import type { BankOption } from "@/lib/adv/bank-master-service";

interface Props {
  initial: AdvanceRequest | null;
  onSaved: (id: number) => void;
  onSubmitted: (id: number) => void;
  /** Reports unsaved-edit state so the page can guard the in-app Back button (P1.2). */
  onDirtyChange?: (dirty: boolean) => void;
}

const labelStyle = { color: "var(--text-secondary)" } as const;
const fieldClass = "w-full text-[13px] px-3 py-2 rounded-xl outline-none";
const fieldStyle = {
  background: "var(--bg-input, var(--bg-card))",
  color: "var(--text-primary)",
  border: "1px solid var(--border-card)",
} as const;

export function AdvanceForm({ initial, onSaved, onSubmitted, onDirtyChange }: Props) {
  const [brands, setBrands] = useState<AccBrandOption[]>([]);
  const [banks, setBanks] = useState<BankOption[]>([]);
  // Requester = the logged-in user (auto from HR), same as AP-1's ผู้ขอเบิก part.
  const [emp, setEmp] = useState<{
    staffId: number | null; fullName: string | null; position: string | null;
    departmentName: string | null; email: string | null; photoUrl: string | null;
  } | null>(null);
  // On-behalf: same-department colleagues + the selected requester (null = self).
  const [colleagues, setColleagues] = useState<RequesterOption[]>([]);
  const [requesterStaffId, setRequesterStaffId] = useState<number | null>(null);
  const [requesterPickerOpen, setRequesterPickerOpen] = useState(false);
  // First approval level: Head Accounting (a pool, not the requester's manager).
  const [headApprovers, setHeadApprovers] = useState<
    { staffId: number | null; email: string; displayName: string | null; position: string | null; photoUrl: string | null }[]
  >([]);
  // Attachments (image/PDF, ≤4MB) — need a saved request id.
  const [files, setFiles] = useState<{ id: number; fileName: string; fileSize: number; contentType: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [deleteFileId, setDeleteFileId] = useState<number | null>(null);
  const [deletingFile, setDeletingFile] = useState(false);

  const [brandCode, setBrandCode] = useState(initial?.brandCode ?? "");
  // Empty until chosen — the form reveals lower fields step by step (brand → โอนให้ → rest).
  const [payeeType, setPayeeType] = useState<AdvancePayeeType | "">(initial?.advance?.payeeType ?? "");
  const [payeeName, setPayeeName] = useState(initial?.advance?.payeeName ?? "");
  const [payeeBankAccount, setPayeeBankAccount] = useState(initial?.advance?.payeeBankAccount ?? "");
  const [payeeBankCode, setPayeeBankCode] = useState(initial?.advance?.payeeBankCode ?? "");
  const [needByDate, setNeedByDate] = useState(initial?.advance?.needByDate ?? "");
  const [expectedClearDate, setExpectedClearDate] = useState(initial?.advance?.expectedClearDate ?? "");
  const [purpose, setPurpose] = useState(initial?.advance?.purpose ?? "");
  const initialCurrency = initial?.advance?.currency ?? AP2_DEFAULT_CURRENCY;
  const [foreign, setForeign] = useState(initialCurrency.toUpperCase() !== AP2_DEFAULT_CURRENCY);
  const [currencyCode, setCurrencyCode] = useState(
    initialCurrency.toUpperCase() === AP2_DEFAULT_CURRENCY ? "USD" : initialCurrency,
  );
  const [currencies, setCurrencies] = useState<{ code: string; name: string }[]>([]);
  const [amount, setAmount] = useState(initial?.advance?.amount != null ? String(initial.advance.amount) : "");
  const [exchangeRate, setExchangeRate] = useState(
    initial?.advance?.exchangeRate != null ? String(initial.advance.exchangeRate) : "",
  );
  const [fxLoading, setFxLoading] = useState(false);
  const [fxAsOf, setFxAsOf] = useState<string | null>(null);
  const [whtNote, setWhtNote] = useState(initial?.advance?.whtNote ?? "");
  const [overReason, setOverReason] = useState(initial?.advance?.overThresholdReason ?? "");
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [ready, setReady] = useState(false);
  // HR-dependent cards (requester + Head Accounting) load separately so a slow
  // Graph photo fetch never holds the whole form (same approach as AP-3).
  const [hrLoading, setHrLoading] = useState(true);

  // Tracked in state so an in-form auto-save (e.g. before attaching a file) makes
  // the new id available immediately, without waiting for a parent reload.
  const [savedId, setSavedId] = useState<number | null>(initial?.id ?? null);
  const [savedAt, setSavedAt] = useState<Date | null>(null); // P2.3 — last successful save time
  const requestId = savedId;
  const readOnly = !!initial && initial.status !== "Draft" && initial.status !== "Returned";

  // P1.1 — client-side submit validation (mirrors validateAdvanceForSubmit).
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Refs for focus-on-error (in visual order).
  const brandRef = useRef<HTMLDivElement>(null);
  const payeeTypeRef = useRef<HTMLSelectElement>(null);
  const payeeNameRef = useRef<HTMLInputElement>(null);
  const payeeBankAccountRef = useRef<HTMLInputElement>(null);
  const payeeBankCodeRef = useRef<HTMLSelectElement>(null);
  const needByDateRef = useRef<HTMLInputElement>(null);
  const expectedClearDateRef = useRef<HTMLInputElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const exchangeRateRef = useRef<HTMLInputElement>(null);
  const overReasonRef = useRef<HTMLTextAreaElement>(null);
  const purposeRef = useRef<HTMLTextAreaElement>(null);

  // P1.2 — unsaved-change guard: snapshot of the last saved form payload.
  const [savedSnapshot, setSavedSnapshot] = useState<string | null>(null);

  // Clear a single field's error (called from each input's onChange).
  const clearError = (key: string) =>
    setErrors((p) => {
      if (!(key in p)) return p;
      const next = { ...p };
      delete next[key];
      return next;
    });

  useEffect(() => {
    let cancelled = false;
    // Essential options gate the form (fast config: brand chips + banks).
    Promise.all([
      fetch("/api/request/advance/options/brands").then((r) => r.json()),
      fetch("/api/request/advance/options/banks").then((r) => r.json()),
    ])
      .then(([b, bk]) => {
        if (cancelled) return;
        if (b.ok) setBrands(b.data);
        if (bk.ok) setBanks(bk.data);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setReady(true); });

    // HR-dependent cards (requester + Head Accounting) — best-effort, NOT gated,
    // so the form appears immediately and the cards show a skeleton until this lands.
    Promise.all([
      fetch("/api/me/employee").then((r) => r.json()),
      fetch("/api/request/advance/requesters").then((r) => r.json()),
      fetch("/api/request/advance/first-approvers").then((r) => r.json()),
    ])
      .then(([m, rq, fa]) => {
        if (cancelled) return;
        if (fa?.ok) setHeadApprovers(fa.data ?? []);
        // AP-1 logic: requester is the logged-in user, resolved from HR.
        const e = m?.data?.employee;
        if (e) setEmp({
          staffId: e.staffId ?? null, fullName: e.fullName ?? null,
          position: e.position ?? null, departmentName: e.departmentName ?? null,
          email: m?.data?.email ?? e.email ?? null, photoUrl: e.photoUrl ?? null,
        });
        if (rq?.ok) {
          setColleagues(rq.data?.colleagues ?? []);
          // Resume an on-behalf draft: seed the selected requester when the saved
          // staffId differs from the logged-in user.
          const selfId = e?.staffId ?? null;
          if (initial?.staffId != null && selfId != null && initial.staffId !== selfId) {
            setRequesterStaffId(initial.staffId);
          }
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setHrLoading(false); });
    return () => { cancelled = true; };
  }, [initial]);

  async function fetchFxRate(code: string) {
    const cur = code.trim().toUpperCase();
    if (!cur || cur === AP2_DEFAULT_CURRENCY) return;
    setFxLoading(true);
    try {
      const res = await fetch(`/api/request/advance/fx-rate?currency=${encodeURIComponent(cur)}`);
      const json = (await res.json()) as { ok: boolean; data?: { rate: number; asOf: string; source?: string }; error?: string };
      if (json.ok && json.data) {
        const src = json.data.source === "BOT" ? "ธปท." : "ECB";
        setExchangeRate(String(json.data.rate));
        setFxAsOf(`${json.data.asOf} (${src})`);
        toast.success(`อัตรา ${src} ${cur} = ${json.data.rate} (ณ ${json.data.asOf})`);
      } else {
        toast.error(json.error ?? "ดึงอัตราแลกเปลี่ยนไม่สำเร็จ");
      }
    } catch {
      toast.error("ดึงอัตราแลกเปลี่ยนไม่สำเร็จ");
    } finally {
      setFxLoading(false);
    }
  }

  // Load existing attachments once the request is saved.
  useEffect(() => {
    if (!requestId) { setFiles([]); return; }
    let cancelled = false;
    fetch(`/api/request/advance/requests/${requestId}/files`)
      .then((r) => r.json())
      .then((j: { ok: boolean; data?: typeof files }) => { if (!cancelled && j.ok && j.data) setFiles(j.data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [requestId]);

  // Currency dropdown options from the FX source (default selection is USD).
  useEffect(() => {
    let cancelled = false;
    fetch("/api/request/advance/currencies")
      .then((r) => r.json())
      .then((j: { ok: boolean; data?: { code: string; name: string }[] }) => {
        if (!cancelled && j.ok && j.data) setCurrencies(j.data.filter((c) => c.code !== AP2_DEFAULT_CURRENCY));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  async function uploadFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    for (const f of Array.from(list)) {
      if (f.size > 4 * 1024 * 1024) return toast.error(`${f.name}: ไฟล์ใหญ่เกิน 4MB`);
    }
    const fd = new FormData();
    Array.from(list).forEach((f) => fd.append("files", f));
    setUploading(true);
    const wasNew = requestId == null;
    try {
      // Attaching on a brand-new form auto-saves the draft first, so the file has a request to attach to.
      const id = requestId ?? (await persist());
      const res = await fetch(`/api/request/advance/requests/${id}/files`, { method: "POST", body: fd });
      const j = (await res.json()) as { ok: boolean; data?: typeof files; error?: string };
      if (!j.ok) throw new Error(j.error ?? "อัปโหลดไม่สำเร็จ");
      if (j.data) setFiles(j.data);
      // Auto-created a draft on a fresh form → reflect its id in the URL so a
      // refresh/back returns to the same draft instead of a blank New form.
      if (wasNew) { onSaved(id); toast.success("สร้างแบบร่างอัตโนมัติ · แนบไฟล์แล้ว"); }
      else toast.success("แนบไฟล์แล้ว");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "อัปโหลดไม่สำเร็จ");
    } finally {
      setUploading(false);
    }
  }

  async function confirmRemoveFile() {
    if (deleteFileId == null) return;
    const fileId = deleteFileId;
    setDeletingFile(true);
    try {
      const res = await fetch(`/api/request/advance/files/${fileId}`, { method: "DELETE" });
      const j = (await res.json()) as { ok: boolean; error?: string };
      if (!j.ok) throw new Error(j.error ?? "ลบไม่สำเร็จ");
      setFiles((prev) => prev.filter((f) => f.id !== fileId));
      setDeleteFileId(null);
      toast.success("ลบไฟล์แล้ว");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "ลบไม่สำเร็จ");
    } finally {
      setDeletingFile(false);
    }
  }

  // Employee payee name mirrors the requester; vendor is typed in.
  // Requester display: a resumed request keeps its stamped requester; a new form
  // shows the logged-in user.
  // On-behalf: a selected colleague overrides the display; else self (or a
  // resumed draft's stamped requester).
  const selectedColleague = requesterStaffId
    ? (colleagues.find((c) => c.staffId === requesterStaffId) ?? null)
    : null;
  const reqStaffId = requesterStaffId ?? initial?.staffId ?? emp?.staffId ?? null;
  const reqName = selectedColleague?.fullName ?? initial?.requesterFullName ?? emp?.fullName ?? "";
  const reqPos = selectedColleague?.position ?? initial?.requesterPosition ?? emp?.position ?? "";
  const reqDept = selectedColleague?.departmentName ?? initial?.requesterDepartmentName ?? emp?.departmentName ?? "";
  const reqEmail = selectedColleague?.email ?? initial?.requesterEmail ?? emp?.email ?? null;
  const reqPhoto = selectedColleague?.photoUrl ?? emp?.photoUrl ?? null;

  const effectivePayeeName = payeeType === "employee" ? reqName : payeeName;

  // Common currencies (incl. MYR for the Malaysia entity) first, then the rest.
  const orderedCurrencies = useMemo(() => {
    const list = currencies.length ? currencies : [{ code: "USD", name: "US Dollar" }];
    const priority = ["USD", "MYR", "SGD", "CNY", "EUR", "GBP", "JPY"];
    const top = priority
      .map((c) => list.find((x) => x.code === c))
      .filter((x): x is { code: string; name: string } => !!x);
    const rest = list.filter((x) => !priority.includes(x.code));
    return [...top, ...rest];
  }, [currencies]);

  const baseAmount = useMemo(() => {
    const amt = amount ? Number(amount) : 0;
    const rate = foreign ? (exchangeRate ? Number(exchangeRate) : 0) : 1;
    return Math.round(amt * rate * 100) / 100;
  }, [amount, exchangeRate, foreign]);

  function buildInput(): AdvanceSaveInput {
    return {
      id: requestId ?? undefined,
      brandCode: brandCode || null,
      staffId: requesterStaffId ?? null,
      advance: {
        payeeType: payeeType || null,
        payeeName: effectivePayeeName || null,
        payeeBankAccount: payeeType === "vendor" ? payeeBankAccount || null : null,
        payeeBankCode: payeeType === "vendor" ? payeeBankCode || null : null,
        needByDate: needByDate || null,
        expectedClearDate: expectedClearDate || null,
        purpose: purpose || null,
        currency: foreign ? (currencyCode || "USD").toUpperCase() : AP2_DEFAULT_CURRENCY,
        amount: amount ? Number(amount) : null,
        exchangeRate: foreign ? (exchangeRate ? Number(exchangeRate) : null) : 1,
        baseAmount,
        whtNote: whtNote || null,
        overThresholdReason: overReason || null,
      },
    };
  }

  // P1.2 — initialize/refresh the saved snapshot once the form is ready (and on
  // resume/initial change), so a freshly loaded form is not considered dirty.
  useEffect(() => {
    if (!ready) return;
    setSavedSnapshot(JSON.stringify(buildInput()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, initial]);

  // dirty only once a baseline snapshot exists (state, so seeding re-renders the guard).
  const dirty = ready && !readOnly && savedSnapshot !== null && JSON.stringify(buildInput()) !== savedSnapshot;

  // Report dirty state up so the page can guard the in-app Back button (P1.2).
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty]); // eslint-disable-line react-hooks/exhaustive-deps

  // Warn on refresh / tab-close / hard navigation while there are unsaved edits.
  // In-app route interception via the Next App Router is out of scope here —
  // beforeunload covers the browser-level exits, which is sufficient for now.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  // P1.6 — date bounds. Normal client component: new Date() is fine here.
  const todayYmd = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, []);
  const clearMaxYmd = useMemo(() => {
    if (!needByDate) return undefined;
    const d = new Date(needByDate);
    if (Number.isNaN(d.getTime())) return undefined;
    d.setDate(d.getDate() + AP2_MAX_CLEAR_DAYS);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, [needByDate]);

  // P1.1 — mirror validateAdvanceForSubmit (server stays the source of truth).
  function validate(): Record<string, string> {
    const errs: Record<string, string> = {};
    if (!brandCode) errs.brand = "กรุณาเลือกแบรนด์";
    if (!payeeType) errs.payeeType = "กรุณาเลือกผู้รับโอน (โอนให้)";
    if (payeeType === "vendor") {
      if (!payeeName.trim()) errs.payeeName = "กรุณากรอกชื่อคู่ค้า";
      if (!payeeBankAccount.trim()) errs.payeeBankAccount = "กรุณากรอกเลขที่บัญชีคู่ค้า";
      if (!payeeBankCode.trim()) errs.payeeBankCode = "กรุณาเลือกธนาคารของคู่ค้า";
    }
    if (!needByDate) errs.needByDate = "กรุณาระบุวันที่ต้องการเริ่มใช้เงิน";
    if (!expectedClearDate) errs.expectedClearDate = "กรุณาระบุวันที่คาดว่าจะเคลียร์";
    if (needByDate && expectedClearDate) {
      const need = new Date(needByDate);
      const clear = new Date(expectedClearDate);
      const today = new Date(); today.setHours(0, 0, 0, 0);
      if (need < today) errs.needByDate = "วันที่ต้องการเริ่มใช้เงินต้องไม่เป็นอดีต";
      if (clear < need) errs.expectedClearDate = "วันเคลียร์ต้องไม่ก่อนวันที่ต้องการใช้เงิน";
      else {
        const diffDays = (clear.getTime() - need.getTime()) / 86_400_000;
        if (diffDays > AP2_MAX_CLEAR_DAYS)
          errs.expectedClearDate = `วันเคลียร์ต้องไม่เกิน ${AP2_MAX_CLEAR_DAYS} วันจากวันที่ต้องการใช้เงิน`;
      }
    }
    if (!amount || Number(amount) <= 0) errs.amount = "กรุณาระบุจำนวนเงินที่ถูกต้อง";
    if (foreign && (!exchangeRate || Number(exchangeRate) <= 0))
      errs.exchangeRate = "กรุณาระบุอัตราแลกเปลี่ยน (สำหรับสกุลเงินต่างประเทศ)";
    if (!purpose.trim()) errs.purpose = "กรุณากรอกรายละเอียดค่าใช้จ่าย";
    if (baseAmount > AP2_PRPO_THRESHOLD && !overReason.trim())
      errs.overReason = `ยอดเกิน ${AP2_PRPO_THRESHOLD.toLocaleString()} บาท — กรุณาระบุเหตุผลเพิ่มเติม`;
    return errs;
  }

  // Focusable field refs in visual order — used to jump to the first error.
  const errorFieldOrder: { key: string; ref: React.RefObject<HTMLElement | null> }[] = [
    { key: "brand", ref: brandRef },
    { key: "payeeType", ref: payeeTypeRef },
    { key: "payeeName", ref: payeeNameRef },
    { key: "payeeBankAccount", ref: payeeBankAccountRef },
    { key: "payeeBankCode", ref: payeeBankCodeRef },
    { key: "needByDate", ref: needByDateRef },
    { key: "expectedClearDate", ref: expectedClearDateRef },
    { key: "amount", ref: amountRef },
    { key: "exchangeRate", ref: exchangeRateRef },
    { key: "overReason", ref: overReasonRef },
    { key: "purpose", ref: purposeRef },
  ];

  async function persist(): Promise<number> {
    const url = requestId
      ? `/api/request/advance/requests/${requestId}`
      : "/api/request/advance/requests";
    const res = await fetch(url, {
      method: requestId ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildInput()),
    });
    const json = (await res.json()) as { ok: boolean; data?: { id: number }; error?: string };
    if (!json.ok) throw new Error(json.error ?? "บันทึกไม่สำเร็จ");
    const id = json.data?.id ?? requestId!;
    if (id !== requestId) setSavedId(id); // remember a freshly created draft's id
    return id;
  }

  async function handleSave() {
    setSaving(true);
    try {
      const id = await persist();
      setSavedSnapshot(JSON.stringify(buildInput())); // no longer dirty
      setSavedAt(new Date());
      toast.success("บันทึกแบบร่างแล้ว");
      onSaved(id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmit() {
    // P1.1 — validate client-side first; block + focus the first error, no save.
    const errs = validate();
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      const first = errorFieldOrder.find((f) => errs[f.key]);
      const el = first?.ref.current;
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.focus({ preventScroll: true });
      }
      toast.error(`กรุณาตรวจสอบข้อมูลที่ยังไม่ครบ (${Object.keys(errs).length} จุด)`);
      return;
    }
    setErrors({});

    setSubmitting(true);
    // Step 1: persist the latest values. If this fails, nothing was saved.
    let id: number;
    try {
      id = await persist();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
      setSubmitting(false);
      return;
    }
    // Step 2: submit. If only this fails, the draft is already saved — say so
    // clearly (and keep it resumable) so the user never thinks their data is gone.
    try {
      const res = await fetch(`/api/request/advance/requests/${id}/submit`, { method: "POST" });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) throw new Error(json.error ?? "ส่งคำขอไม่สำเร็จ");
      setSavedSnapshot(JSON.stringify(buildInput())); // submitted → not dirty
      setSavedAt(new Date());
      toast.success("ส่งคำขอแล้ว");
      onSubmitted(id);
    } catch (e) {
      setSavedSnapshot(JSON.stringify(buildInput())); // draft persisted — not dirty
      setSavedAt(new Date());
      onSaved(id); // draft persisted — reflect its id in the URL so it can be resumed
      const detail = e instanceof Error ? e.message : "";
      toast.error(`บันทึกแบบร่างแล้ว แต่ส่งคำขอไม่สำเร็จ: ${detail || "กรุณาลองส่งอีกครั้ง"}`);
    } finally {
      setSubmitting(false);
    }
  }

  const box = { background: "var(--bg-card)", boxShadow: "var(--shadow-card)" } as const;

  if (!ready) {
    return (
      <TravelExpenseLoadingPopup
        label="กำลังเตรียมแบบฟอร์ม..."
        subtitle="แบบฟอร์มขอเบิกเงินทดรองจ่าย (AP-2)"
      />
    );
  }

  return (
    <div className="flex flex-col gap-4 pb-20">
      {/* Requester (รหัสพนักงาน กรอกเอง → auto ดึง HR) + brand chips like AP-1 */}
      <div className="rounded-2xl p-4 sm:p-5 flex flex-col gap-3" style={box}>
        {/* ผู้ขอเบิก — same card + on-behalf picker as AP-1 */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-[13px] font-bold" style={{ color: "var(--text-primary)" }}>
            <User size={15} /> ผู้ขอเบิก
          </div>
          {!readOnly && colleagues.length > 0 && (
            <button type="button" onClick={() => setRequesterPickerOpen(true)}
              className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] font-semibold cursor-pointer"
              style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)", color: "var(--nav-active-text)" }}>
              <UserCog size={13} /> เปลี่ยนผู้ขอเบิก
            </button>
          )}
        </div>
        <RequesterPickerModal
          open={requesterPickerOpen}
          onClose={() => setRequesterPickerOpen(false)}
          colleagues={colleagues}
          self={emp ? {
            staffId: emp.staffId ?? 0, fullName: emp.fullName, position: emp.position,
            departmentName: emp.departmentName, email: emp.email, photoUrl: emp.photoUrl,
          } : null}
          value={requesterStaffId}
          onSelect={setRequesterStaffId}
        />
        {/* ผู้ขอเบิก (ซ้าย) + ผู้อนุมัติ Head Accounting (ขวา) — layout เดียวกับ AP-1 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
          {/* ผู้ขอเบิก */}
          <div className="flex flex-col gap-2.5 min-w-0">
            {hrLoading && !reqName ? <PersonSkeleton /> : (
            <div className="flex items-center gap-3 min-w-0">
              <div className="shrink-0 rounded-2xl overflow-hidden" style={{ boxShadow: "0 0 0 2px var(--nav-active-bg)" }}>
                <Avatar name={reqName || "?"} size={48} photo={reqPhoto ?? undefined} color="var(--nav-active-text)" />
              </div>
              <div className="min-w-0 flex flex-col gap-0.5">
                <div className="flex items-baseline gap-2 min-w-0">
                  <span className="text-[14px] font-bold truncate" style={{ color: "var(--text-primary)" }}>{reqName || "-"}</span>
                  {reqStaffId != null && (
                    <span className="text-[11px] shrink-0" style={{ color: "var(--text-muted)" }}>#{reqStaffId}</span>
                  )}
                </div>
                {(reqDept || reqPos) && (
                  <span className="text-[12px] truncate" style={{ color: "var(--text-muted)" }}>
                    {[reqDept, reqPos].filter(Boolean).join(" · ")}
                  </span>
                )}
                {reqEmail && (
                  <span className="inline-flex items-center gap-1 text-[12px] truncate" style={{ color: "var(--text-secondary)" }}>
                    <Mail size={11} className="shrink-0" /> <span className="truncate">{reqEmail}</span>
                  </span>
                )}
              </div>
            </div>
            )}
            {requesterStaffId != null && (
              <span className="text-[12px] px-3 py-2 rounded-lg" style={{ background: "var(--nav-active-bg)", color: "var(--nav-active-text)" }}>
                กำลังกรอกแทน {reqName || `#${requesterStaffId}`} — คำขอจะอยู่ใน "คำขอของฉัน" ของคุณ และเข้าอนุมัติที่ Head Accounting
              </span>
            )}
          </div>

          {/* ผู้อนุมัติขั้นแรก · Head Accounting (ขวา, border-left บน md) */}
          <div className="flex flex-col gap-3 min-w-0 border-t md:border-t-0 md:border-l pt-4 md:pt-0 md:pl-6"
            style={{ borderColor: "var(--border-card)" }}>
            <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
              ผู้อนุมัติขั้นแรก · Head Accounting
            </span>
            {hrLoading && headApprovers.length === 0 ? (
              <PersonSkeleton />
            ) : headApprovers.length > 0 ? (
              headApprovers.map((a) => (
                <div key={a.email} className="flex items-center gap-3 min-w-0">
                  <div className="shrink-0 rounded-2xl overflow-hidden" style={{ boxShadow: "0 0 0 2px var(--nav-active-bg)" }}>
                    <Avatar name={a.displayName || a.email} size={48} photo={a.photoUrl ?? undefined} color="var(--nav-active-text)" />
                  </div>
                  <div className="min-w-0 flex flex-col gap-0.5">
                    <div className="flex items-baseline gap-2 min-w-0">
                      <span className="text-[14px] font-bold truncate" style={{ color: "var(--text-primary)" }}>{a.displayName ?? a.email}</span>
                      {a.staffId != null && <span className="text-[11px] shrink-0" style={{ color: "var(--text-muted)" }}>#{a.staffId}</span>}
                    </div>
                    {a.position && <span className="text-[12px] truncate" style={{ color: "var(--text-muted)" }}>{a.position}</span>}
                    <span className="inline-flex items-center gap-1 text-[12px] truncate" style={{ color: "var(--text-secondary)" }}>
                      <Mail size={11} className="shrink-0" /> <span className="truncate">{a.email}</span>
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-[12.5px] leading-relaxed m-0" style={{ color: "var(--text-muted)" }}>
                ยังไม่ได้กำหนดผู้อนุมัติ Head Accounting — ตั้งที่ ตั้งค่า AP-2 › ผู้อนุมัติ
              </p>
            )}
          </div>
        </div>

        <div ref={brandRef} tabIndex={-1} className="outline-none">
          <label className="text-[12px] font-bold" style={labelStyle}>แบรนด์ที่เบิก *</label>
          {brands.length === 0 ? (
            <p className="text-[13px] mt-1" style={{ color: "var(--text-faint)" }}>
              กำลังโหลดแบรนด์...
            </p>
          ) : (
            <div className="flex flex-wrap gap-2 mt-1">
              {brands.map((b) => {
                const active = brandCode === b.brandCode;
                return (
                  <button key={b.brandCode} type="button" disabled={readOnly}
                    onClick={() => { setBrandCode(active ? "" : b.brandCode); clearError("brand"); }}
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
          {errors.brand && (
            <p id="err-brand" className="text-[11px] mt-0.5 m-0" style={{ color: "#dc2626" }}>{errors.brand}</p>
          )}
        </div>
      </div>

      {/* Payee (โอนให้) */}
      <div className="rounded-2xl p-4 sm:p-5 flex flex-col gap-3" style={box}>
        <Field label="โอนให้ *" error={errors.payeeType} errorId="err-payeeType">
          <select ref={payeeTypeRef} className={fieldClass} style={fieldStyle} value={payeeType} disabled={readOnly || !brandCode}
            aria-invalid={!!errors.payeeType} aria-describedby={errors.payeeType ? "err-payeeType" : undefined}
            onChange={(e) => {
              const v = e.target.value as AdvancePayeeType | "";
              setPayeeType(v);
              clearError("payeeType");
              // สลับผู้รับโอน → เริ่มชื่อคู่ค้าใหม่ (ว่าง) และล้างข้อมูลบัญชีเมื่อไม่ใช่คู่ค้า
              setPayeeName("");
              if (v !== "vendor") { setPayeeBankAccount(""); setPayeeBankCode(""); }
            }}>
            <option value="">— เลือก —</option>
            <option value="employee">พนักงาน (ผู้ขอเบิก)</option>
            <option value="vendor">คู่ค้า</option>
          </select>
        </Field>
        {!brandCode && (
          <p className="text-[11px]" style={{ color: "var(--text-faint)" }}>เลือกแบรนด์ก่อน จึงจะเลือก "โอนให้" ได้</p>
        )}
        {payeeType === "vendor" && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="ชื่อคู่ค้า *" error={errors.payeeName} errorId="err-payeeName">
              <input ref={payeeNameRef} className={fieldClass} style={fieldStyle} value={payeeName} disabled={readOnly}
                aria-invalid={!!errors.payeeName} aria-describedby={errors.payeeName ? "err-payeeName" : undefined}
                onChange={(e) => { setPayeeName(e.target.value); clearError("payeeName"); }} />
            </Field>
            <Field label="เลขที่บัญชี *" error={errors.payeeBankAccount} errorId="err-payeeBankAccount">
              <input ref={payeeBankAccountRef} className={fieldClass} style={fieldStyle} value={payeeBankAccount} disabled={readOnly}
                aria-invalid={!!errors.payeeBankAccount} aria-describedby={errors.payeeBankAccount ? "err-payeeBankAccount" : undefined}
                onChange={(e) => { setPayeeBankAccount(e.target.value); clearError("payeeBankAccount"); }} />
            </Field>
            <Field label="ธนาคาร *" error={errors.payeeBankCode} errorId="err-payeeBankCode">
              <select ref={payeeBankCodeRef} className={fieldClass} style={fieldStyle} value={payeeBankCode} disabled={readOnly}
                aria-invalid={!!errors.payeeBankCode} aria-describedby={errors.payeeBankCode ? "err-payeeBankCode" : undefined}
                onChange={(e) => { setPayeeBankCode(e.target.value); clearError("payeeBankCode"); }}>
                <option value="">— เลือกธนาคาร —</option>
                {banks.map((bk) => <option key={bk.bankCode} value={bk.bankCode}>{bk.bankName}</option>)}
              </select>
            </Field>
          </div>
        )}
        {payeeType === "employee" && (
          <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            โอนเข้าบัญชีของผู้ขอเบิก ({effectivePayeeName || "—"}) ตามข้อมูล HR
          </p>
        )}
      </div>

      {/* Advance detail — dimmed + disabled until โอนให้ is chosen */}
      <fieldset disabled={readOnly || !payeeType}
        className="rounded-2xl p-4 sm:p-5 flex flex-col gap-4 border-0 m-0 min-w-0 disabled:cursor-not-allowed"
        style={{ ...box, minWidth: 0, opacity: payeeType ? 1 : 0.5 }}>
        {!payeeType && (
          <p className="text-[11px]" style={{ color: "var(--text-faint)" }}>
            เลือก &quot;โอนให้&quot; ก่อน จึงจะกรอกรายละเอียดค่าใช้จ่าย จำนวนเงิน ฯลฯ ได้
          </p>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="วันที่ต้องการเริ่มใช้เงิน *" error={errors.needByDate} errorId="err-needByDate">
            <input ref={needByDateRef} type="date" className={fieldClass} style={fieldStyle} value={needByDate}
              min={todayYmd}
              aria-invalid={!!errors.needByDate} aria-describedby={errors.needByDate ? "err-needByDate" : undefined}
              disabled={readOnly} onChange={(e) => { setNeedByDate(e.target.value); clearError("needByDate"); }} />
          </Field>
          <Field label="วันที่คาดว่าจะเคลียร์ * (≤ 30 วัน)" error={errors.expectedClearDate} errorId="err-expectedClearDate">
            <input ref={expectedClearDateRef} type="date" className={fieldClass} style={fieldStyle} value={expectedClearDate}
              min={needByDate || todayYmd} max={clearMaxYmd}
              aria-invalid={!!errors.expectedClearDate} aria-describedby={errors.expectedClearDate ? "err-expectedClearDate" : undefined}
              disabled={readOnly} onChange={(e) => { setExpectedClearDate(e.target.value); clearError("expectedClearDate"); }} />
          </Field>
        </div>

        {/* Currency + amount */}
        <div className="flex flex-col gap-2">
          <label className="text-[12px] font-bold flex items-center gap-3" style={labelStyle}>
            สกุลเงิน
            <span className="flex items-center gap-1 font-normal">
              <input type="checkbox" checked={foreign} disabled={readOnly}
                onChange={(e) => { const on = e.target.checked; setForeign(on); if (on && currencyCode) fetchFxRate(currencyCode); }} />
              สกุลต่างประเทศ
            </span>
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            {foreign && (
              <Field label="สกุลเงิน *">
                <CurrencyCombobox options={orderedCurrencies} value={currencyCode} disabled={readOnly}
                  onChange={(code) => { setCurrencyCode(code); fetchFxRate(code); }} />
              </Field>
            )}
            <Field label={foreign ? "จำนวนเงิน (สกุลนั้น) *" : "จำนวนเงิน (บาท) *"} error={errors.amount} errorId="err-amount">
              <input ref={amountRef} type="number" min="0" step="0.01" className={fieldClass} style={fieldStyle} value={amount}
                aria-invalid={!!errors.amount} aria-describedby={errors.amount ? "err-amount" : undefined}
                disabled={readOnly} onChange={(e) => { setAmount(e.target.value); clearError("amount"); }} placeholder="0.00" />
            </Field>
            {foreign && (
              <Field label="อัตราแลกเปลี่ยน *" error={errors.exchangeRate} errorId="err-exchangeRate">
                <div className="flex items-center gap-1.5">
                  <input ref={exchangeRateRef} type="number" min="0" step="0.000001" className={fieldClass} style={fieldStyle}
                    value={exchangeRate} disabled={readOnly}
                    aria-invalid={!!errors.exchangeRate} aria-describedby={errors.exchangeRate ? "err-exchangeRate" : undefined}
                    onChange={(e) => { setExchangeRate(e.target.value); clearError("exchangeRate"); }} placeholder="เช่น 36.50" />
                  <Button variant="secondary" size="sm" type="button" loading={fxLoading}
                    disabled={readOnly || !currencyCode.trim()}
                    onClick={() => fetchFxRate(currencyCode)}>ดึงอัตรา</Button>
                </div>
                {fxAsOf && (
                  <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                    อัตรา ธปท. ณ {fxAsOf}
                  </span>
                )}
              </Field>
            )}
            <Field label="ยอดที่เบิก (บาท)">
              <input className={fieldClass} style={fieldStyle} disabled
                value={baseAmount ? baseAmount.toLocaleString(undefined, { minimumFractionDigits: 2 }) : ""} />
            </Field>
          </div>
          <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            ยอดเกิน {AP2_PRPO_THRESHOLD.toLocaleString()} บาท ต้องระบุเหตุผลเพิ่มเติมด้านล่าง · สกุลต่างประเทศใช้ rate ธปท. วันศุกร์ก่อนจ่าย
          </span>
        </div>

        {baseAmount != null && baseAmount > AP2_PRPO_THRESHOLD && (
          <Field label={`เหตุผลเพิ่มเติม (ยอดเกิน ${AP2_PRPO_THRESHOLD.toLocaleString()} บาท) *`} error={errors.overReason} errorId="err-overReason">
            <textarea ref={overReasonRef} rows={2} className={fieldClass} style={fieldStyle} value={overReason} disabled={readOnly}
              aria-invalid={!!errors.overReason} aria-describedby={errors.overReason ? "err-overReason" : undefined}
              onChange={(e) => { setOverReason(e.target.value); clearError("overReason"); }}
              placeholder="เหตุผลที่ขอเบิกเกินวงเงิน / เหตุใดจึงไม่ผ่านกระบวนการ PR-PO" />
          </Field>
        )}

        <Field label="รายละเอียดค่าใช้จ่าย *" error={errors.purpose} errorId="err-purpose">
          <textarea ref={purposeRef} rows={3} className={fieldClass} style={fieldStyle} value={purpose} disabled={readOnly}
            aria-invalid={!!errors.purpose} aria-describedby={errors.purpose ? "err-purpose" : undefined}
            onChange={(e) => { setPurpose(e.target.value); clearError("purpose"); }}
            placeholder="ระบุรายการค่าใช้จ่ายและจำนวนเงินประมาณการของแต่ละรายการ เช่น ค่าจัดกิจกรรมพนักงาน" />
        </Field>

        <Field label="หมายเหตุ หัก ณ ที่จ่าย (ถ้ามี)">
          <textarea rows={2} className={fieldClass} style={fieldStyle} value={whtNote} disabled={readOnly}
            onChange={(e) => setWhtNote(e.target.value)}
            placeholder="กรณีจ่ายค่าบริการเกิน 1,000 บาท ติดต่อบัญชีเพื่อออกหนังสือรับรองหัก ณ ที่จ่าย" />
        </Field>

        {/* Attachment — รูปภาพ/PDF ≤4MB (เหมือน AP-17) */}
        <Field label="แนบไฟล์ประกอบ (ใบเสนอราคา / รูปถ่าย)">
            <div className="flex flex-col gap-2">
              {!readOnly && (
                <div className="flex flex-wrap items-center gap-2">
                  <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold cursor-pointer"
                    style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)", color: "var(--nav-active-text)" }}>
                    <Paperclip size={14} /> แนบไฟล์
                    <input type="file" hidden multiple accept="image/*,application/pdf" disabled={uploading}
                      onChange={(e) => { uploadFiles(e.target.files); e.target.value = ""; }} />
                  </label>
                  <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold cursor-pointer"
                    style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)", color: "var(--nav-active-text)" }}>
                    <Camera size={14} /> ถ่ายรูป
                    <input type="file" hidden accept="image/*" capture="environment" disabled={uploading}
                      onChange={(e) => { uploadFiles(e.target.files); e.target.value = ""; }} />
                  </label>
                  {uploading && <span className="text-[12px]" style={{ color: "var(--text-muted)" }}>กำลังอัปโหลด...</span>}
                </div>
              )}
              <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>รองรับรูปภาพ/PDF · ไม่เกิน 4MB ต่อไฟล์</span>
              {files.length > 0 && (
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                  {files.map((f) => {
                    const href = `/api/request/advance/files/${f.id}`;
                    const isImg = (f.contentType ?? "").toLowerCase().startsWith("image/");
                    const ext = (f.fileName.split(".").pop() ?? "").toUpperCase().slice(0, 4);
                    return (
                      <div key={f.id} className="group relative flex flex-col rounded-lg overflow-hidden"
                        style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}>
                        <a href={href} target="_blank" rel="noreferrer" title={f.fileName} className="block">
                          <div className="w-full aspect-square flex items-center justify-center overflow-hidden"
                            style={{ background: "var(--bg-badge)" }}>
                            {isImg ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={href} alt={f.fileName} loading="lazy" className="w-full h-full object-cover" />
                            ) : (
                              <div className="flex flex-col items-center gap-1">
                                <FileText size={22} style={{ color: "var(--nav-active-text)" }} />
                                <span className="text-[9px] font-bold" style={{ color: "var(--text-muted)" }}>{ext || "FILE"}</span>
                              </div>
                            )}
                          </div>
                        </a>
                        <div className="flex items-center gap-1 px-1.5 py-1">
                          <span className="flex-1 min-w-0 truncate text-[10px]" style={{ color: "var(--text-primary)" }} title={f.fileName}>{f.fileName}</span>
                          <span className="text-[9px] shrink-0" style={{ color: "var(--text-faint)" }}>{Math.max(1, Math.round(f.fileSize / 1024))}KB</span>
                        </div>
                        {!readOnly && (
                          <button type="button" onClick={() => setDeleteFileId(f.id)} title="ลบ" aria-label={`ลบไฟล์แนบ ${f.fileName}`}
                            className="absolute top-1 right-1 p-0.5 rounded cursor-pointer border-none opacity-0 group-hover:opacity-100 transition-opacity"
                            style={{ background: "rgba(220,38,38,0.9)", color: "#fff" }}><X size={12} /></button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
        </Field>
      </fieldset>

      {!readOnly && (
        <div
          className="sticky bottom-0 z-10 -mx-4 sm:-mx-5 px-4 sm:px-5 py-3 flex flex-wrap items-center justify-between gap-3"
          style={{
            background: "var(--bg-card)",
            borderTop: "1px solid var(--border-card)",
            boxShadow: "0 -4px 12px rgba(0,0,0,0.06)",
          }}
        >
          <div className="flex flex-col gap-0.5">
            <div className="flex items-baseline gap-2">
              <span className="text-[12px]" style={{ color: "var(--text-muted)" }}>ยอดที่เบิก:</span>
              <span className="text-[15px] font-bold" style={{ color: "var(--text-primary)" }}>
                {baseAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ฿
              </span>
            </div>
            {/* P2.3 — saved-state indicator */}
            {saving || submitting ? (
              <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>กำลังบันทึก...</span>
            ) : dirty ? (
              <span className="text-[11px] font-semibold" style={{ color: "var(--text-info-yellow)" }}>● ยังไม่บันทึก</span>
            ) : savedAt ? (
              <span className="text-[11px] font-semibold" style={{ color: "var(--text-info-green)" }}>
                ✓ บันทึกแล้ว {String(savedAt.getHours()).padStart(2, "0")}:{String(savedAt.getMinutes()).padStart(2, "0")}
              </span>
            ) : initial ? (
              <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>✓ แบบร่างที่บันทึกไว้</span>
            ) : (
              <span className="text-[11px]" style={{ color: "var(--text-faint)" }}>แบบร่างใหม่</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={handleSave} loading={saving} disabled={submitting}>บันทึกแบบร่าง</Button>
            <Button variant="primary" onClick={handleSubmit} loading={submitting} disabled={saving}>ส่งคำขอ</Button>
          </div>
        </div>
      )}

      {/* delete-attachment confirm popup */}
      <Dialog
        open={deleteFileId != null}
        onOpenChange={(o) => { if (!o && !deletingFile) setDeleteFileId(null); }}
        title="ลบไฟล์แนบ"
        contentClassName="max-w-[380px]"
      >
        <div className="flex flex-col gap-3 p-1">
          <p className="text-[13px] m-0" style={{ color: "var(--text-secondary)" }}>ต้องการลบไฟล์แนบนี้ใช่ไหม?</p>
          {(() => {
            const f = files.find((x) => x.id === deleteFileId);
            return f ? (
              <div className="text-[12px] px-3 py-2 rounded-lg truncate" title={f.fileName}
                style={{ background: "var(--bg-card-alt)", border: "1px solid var(--border-card)", color: "var(--text-primary)" }}>
                {f.fileName}
              </div>
            ) : null;
          })()}
          <div className="flex items-center justify-end gap-2 mt-1">
            <Button variant="secondary" onClick={() => setDeleteFileId(null)} disabled={deletingFile}>ยกเลิก</Button>
            <Button variant="primary" onClick={confirmRemoveFile} loading={deletingFile}>ลบ</Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

/** Placeholder for a requester/approver card while the HR lookup is in flight. */
function PersonSkeleton() {
  const bar = { background: "var(--bg-badge)" } as const;
  return (
    <div className="flex items-center gap-3 min-w-0 animate-pulse">
      <div className="shrink-0 rounded-2xl" style={{ width: 48, height: 48, ...bar }} />
      <div className="flex-1 min-w-0 flex flex-col gap-1.5">
        <div className="h-3.5 rounded" style={{ width: "60%", ...bar }} />
        <div className="h-3 rounded" style={{ width: "45%", ...bar }} />
        <div className="h-3 rounded" style={{ width: "70%", ...bar }} />
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  error,
  errorId,
}: {
  label: string;
  children: ReactNode;
  error?: string;
  errorId?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[12px] font-bold" style={labelStyle}>{label}</label>
      {children}
      {error && (
        <p id={errorId} role="alert" className="text-[11px] mt-0.5 m-0" style={{ color: "#dc2626" }}>{error}</p>
      )}
    </div>
  );
}
