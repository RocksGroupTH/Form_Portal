"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import {
  CircleAlert,
  CircleCheck,
  FileCheck,
  ListChecks,
  Mail,
  Paperclip,
  Receipt,
  Save,
  Send,
  User,
} from "lucide-react";
import { Button } from "@/components/ui";
import { Avatar } from "@/components/ui/Avatar";
import { UatDataBanner } from "@/components/UatDataBanner";
import { useBrand } from "@/components/BrandProvider";
import { useUserPhoto } from "@/lib/hooks/useUserPhoto";
import type { AccBrandOption } from "@/features/accounting/types";
import { TravelExpenseLoadingPopup } from "@/features/accounting/components/TravelExpenseLoadingPopup";
import {
  SectionCard,
  fmtBaht,
  inputClass,
  inputStyle,
  labelClass,
  labelStyle,
  requiredStar,
} from "@/features/travel-booking/components/shared";
import { sumReimburseItems } from "@/lib/acc/reimburse/calc";
import { isBlankItemRow } from "@/lib/acc/reimburse/item-money";
import { AP4_FORM_CODE, REIMBURSE_FILE_REFTYPES } from "@/features/reimburse/constants";
import type {
  ReimburseDetail,
  ReimburseFileMeta,
  ReimburseItem,
  ReimburseRule,
} from "@/features/reimburse/types";
import { ReimburseNotice } from "./ReimburseNotice";
import { ReimburseItemGrid, findItemRowProblems } from "./ReimburseItemGrid";
import { ReimburseRuleChecklist } from "./ReimburseRuleChecklist";
import { ReimburseAttachments } from "./ReimburseAttachments";

/**
 * AP-4 — ขอเบิกเงินคืนพนักงาน. Fill, save a draft, resume, submit.
 *
 * Laid out like AP-1's `TravelExpenseForm`: `SectionCard` stack, a readiness
 * list naming everything still missing, and a sticky save/submit bar. The
 * repeating grid follows AP-17's `TravelBookingTab`.
 *
 * Three things it does that are AP-4's alone, and that a copy of AP-1's client
 * code gets wrong:
 *
 * 1. **Blank rows are stripped before the POST.** The server labels its
 *    per-row errors by position among the rows it keeps, so a blank row above a
 *    filled one would make the message name a different, valid row. The
 *    predicate is `isBlankItemRow` — the server's own, imported, not a second
 *    definition that can drift.
 * 2. **The upload's multipart field is `files`** (plural), and the slot is
 *    chosen by `refType`, where AP-1 posts a single `file`.
 * 3. **`requests/drafts` answers with one summary or null**, not an array —
 *    handled by the page, which owns resume.
 */

/* ─────────────────────────── helpers ─────────────────────────── */

interface EmployeeCard {
  staffId: number;
  firstName: string | null;
  lastName: string | null;
  fullName: string;
  departmentName?: string | null;
  position?: string | null;
  photoUrl?: string | null;
  email?: string | null;
  emailCompBr?: string | null;
}

interface ManagerCard {
  staffId: number;
  fullName: string | null;
  email: string | null;
  position?: string | null;
  photoUrl?: string | null;
}

async function jsonFetcher<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const json = await res.json();
  if (!json.ok) throw new Error(json.error ?? "Request failed");
  return json.data as T;
}

function emptyItem(sortOrder: number): ReimburseItem {
  // `amount: 0` is the untouched marker the server's `isBlankItemRow` reads —
  // a fresh row is not a claim for nothing.
  return { sortOrder, expenseDate: null, description: "", amount: 0, vatAmount: null, whtAmount: null };
}

function seedItems(initial?: ReimburseDetail | null): ReimburseItem[] {
  const rows = initial?.items ?? [];
  return rows.length > 0 ? rows.map((it, i) => ({ ...it, sortOrder: i })) : [emptyItem(0)];
}

/* ─────────────────────────── props ─────────────────────────── */

interface ReimburseFormProps {
  /** The draft or Returned request being resumed, if any. */
  initial?: ReimburseDetail | null;
  onSaved?: (id: number) => void;
  onSubmitted?: (id: number) => void;
}

/* ─────────────────────────── component ─────────────────────────── */

export function ReimburseForm({ initial, onSaved, onSubmitted }: ReimburseFormProps) {
  const { brand: appBrand } = useBrand();

  const [requestId, setRequestId] = useState<number | null>(initial?.id ?? null);
  // A Returned request keeps the running number it was given at first submit —
  // it re-opens for editing, it does not become a new draft.
  const [requestNo, setRequestNo] = useState<string | null>(initial?.requestNo ?? null);
  const [status, setStatus] = useState<ReimburseDetail["status"]>(initial?.status ?? "Draft");
  const [brandCode, setBrandCode] = useState<string | null>(initial?.brandCode ?? appBrand ?? null);
  const [purpose, setPurpose] = useState<string>(initial?.purpose ?? "");
  const [items, setItems] = useState<ReimburseItem[]>(() => seedItems(initial));
  const [ackedRuleIds, setAckedRuleIds] = useState<number[]>(initial?.ackedRuleIds ?? []);
  const [excelFile, setExcelFile] = useState<ReimburseFileMeta | null>(initial?.excelFile ?? null);
  const [receiptFiles, setReceiptFiles] = useState<ReimburseFileMeta[]>(initial?.receiptFiles ?? []);
  const [pendingExcel, setPendingExcel] = useState<File | null>(null);
  const [pendingReceipts, setPendingReceipts] = useState<File[]>([]);

  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [triedSubmit, setTriedSubmit] = useState(false);

  const itemsRef = useRef<HTMLDivElement>(null);
  const filesRef = useRef<HTMLDivElement>(null);
  const rulesRef = useRef<HTMLDivElement>(null);
  const managerRef = useRef<HTMLDivElement>(null);
  const brandRef = useRef<HTMLDivElement>(null);

  /* ── server data ── */

  /**
   * The brands AP-4 may be claimed against — `AccFormBrand`, not the navbar.
   *
   * This form used to record whatever the app-level BrandGate cookie held,
   * because no allowed-brands endpoint existed for AP-4. That made every AP-4
   * request carry a code matching zero `AccFormBrand` rows: harmless only until
   * something joins the two, and wrong per spec from the first save. The list is
   * an admin's to set at Settings → ตั้งค่าขอเบิกเงินคืนพนักงาน → แบรนด์ที่เบิกได้.
   */
  const { data: allowedBrands, isLoading: brandsLoading } = useSWR<AccBrandOption[]>(
    "/api/request/reimburse/options/brands",
    jsonFetcher,
    { revalidateOnFocus: false },
  );

  const {
    data: rulesData,
    error: rulesError,
    isLoading: rulesLoading,
    mutate: reloadRules,
  } = useSWR<ReimburseRule[]>("/api/request/reimburse/settings/rules", jsonFetcher, {
    revalidateOnFocus: false,
  });
  const rules = useMemo(() => rulesData ?? [], [rulesData]);

  // `?form=AP-4` and `&id=` so the manager previewed here is the one the submit
  // will assign: this route is not form-specific, so without the hints a tester
  // in UAT mode is shown their real HR manager instead of their UAT one.
  const resumedIdParam = requestId ? `&id=${requestId}` : "";
  const { data: employeeData, error: employeeError } = useSWR<{
    email: string | null;
    employee: EmployeeCard | null;
    hint: string | null;
    manager: ManagerCard | null;
    managerReason: string | null;
  }>(
    [`/api/me/employee?form=${AP4_FORM_CODE}${resumedIdParam}`, "reimburse-form"],
    ([url]: [string, string]) => jsonFetcher(url),
    { revalidateOnFocus: false },
  );

  const employee = employeeData?.employee ?? null;
  const employeeEmail = employeeData?.email ?? null;
  const employeeHint = employeeData?.hint ?? null;
  const manager = employeeData?.manager ?? null;
  const managerReason = employeeData?.managerReason ?? null;
  const employeeLoading = !employeeData && !employeeError;

  const sessionPhoto = useUserPhoto();
  const requesterPhoto = employee?.photoUrl ?? sessionPhoto;
  const employeeName = employee
    ? employee.firstName && employee.lastName
      ? `${employee.firstName} ${employee.lastName}`
      : employee.fullName
    : "";

  /**
   * What the picker offers: the allowlist, plus the code this request was
   * already saved with when that code is no longer on it.
   *
   * Dropping it instead would silently re-point a saved claim at a different
   * company the next time it is opened — a Returned AP-4 request written before
   * the allowlist existed carries a BrandGate code (`PCTH`…) that matches no
   * `AccFormBrand` row at all. It is kept, and the picker says so.
   */
  const brandOptions = useMemo<AccBrandOption[]>(() => {
    const list = allowedBrands ?? [];
    const saved = initial?.brandCode ?? null;
    if (!saved || list.some((b) => b.brandCode === saved)) return list;
    return list.concat([{ brandCode: saved, brandName: saved, brandLogo: null }]);
  }, [allowedBrands, initial?.brandCode]);

  const selectedBrand = brandOptions.find((b) => b.brandCode === brandCode) ?? null;

  /**
   * Settle on a brand once the allowlist has actually answered.
   *
   * Nothing is decided while it is loading or after it failed: the initial state
   * is still the BrandGate cookie, which is what this form used before there was
   * a list, so a fetch failure degrades to the old behaviour rather than to no
   * brand at all. A resumed request keeps its own code either way.
   */
  useEffect(() => {
    if (!allowedBrands || allowedBrands.length === 0) return;
    setBrandCode((prev) => {
      if (prev && allowedBrands.some((b) => b.brandCode === prev)) return prev;
      if (initial?.brandCode) return prev;
      const fromNavbar =
        appBrand && allowedBrands.some((b) => b.brandCode === appBrand) ? appBrand : null;
      return fromNavbar ?? allowedBrands[0].brandCode;
    });
  }, [allowedBrands, appBrand, initial?.brandCode]);

  /* ── item editing ── */

  const updateItem = useCallback((index: number, patch: Partial<ReimburseItem>) => {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  }, []);

  const addItem = useCallback(() => {
    setItems((prev) => prev.concat(emptyItem(prev.length)));
  }, []);

  const removeItem = useCallback((index: number) => {
    setItems((prev) => {
      const next = prev.filter((_, i) => i !== index).map((it, i) => ({ ...it, sortOrder: i }));
      // Never leave the grid with nothing to type into.
      return next.length > 0 ? next : [emptyItem(0)];
    });
  }, []);

  /* ── rule acknowledgement ── */

  const toggleRule = useCallback((ruleId: number, next: boolean) => {
    setAckedRuleIds((prev) =>
      next ? (prev.indexOf(ruleId) === -1 ? prev.concat(ruleId) : prev) : prev.filter((id) => id !== ruleId),
    );
  }, []);

  const toggleAllRules = useCallback(
    (next: boolean) => setAckedRuleIds(next ? rules.map((r) => r.id) : []),
    [rules],
  );

  /* ── completeness (mirrors the server's validateReimburseForSubmit) ── */

  const filledItems = useMemo(() => items.filter((it) => !isBlankItemRow(it)), [items]);
  const rowProblems = useMemo(() => findItemRowProblems(items), [items]);

  const hasExcel = !!excelFile || !!pendingExcel;
  const hasReceipt = receiptFiles.length > 0 || pendingReceipts.length > 0;
  const ackedSet = useMemo(() => new Set(ackedRuleIds), [ackedRuleIds]);
  const allRulesAcked = rules.every((r) => ackedSet.has(r.id));

  const missing: { key: string; label: string }[] = [];
  // The manager is not one of the four content conditions, but the server
  // refuses without one all the same, and the remedy (HR, or the UAT tester
  // list) is not something the requester can reach from this form — so it is
  // named here rather than discovered on a failed round trip. Same guard AP-1
  // uses: only once the lookup has actually answered.
  if (!employeeLoading && !manager) {
    missing.push({ key: "manager", label: "ผู้จัดการ (ManagerStaffId)" });
  }
  // The server has always refused a submit with no brand (`ERR_NO_BRAND`), and
  // until the picker existed that could not happen — the cookie always had one.
  // It can now: an empty `AccFormBrand` allowlist leaves nothing to pick. Named
  // here rather than discovered on a failed round trip, like the manager above,
  // and only once the list has answered.
  if (!brandsLoading && !brandCode) {
    missing.push({ key: "brand", label: "แบรนด์ที่เบิก" });
  }
  if (filledItems.length === 0) {
    missing.push({ key: "items", label: "รายการค่าใช้จ่ายอย่างน้อย 1 รายการ" });
  }
  for (const p of rowProblems) {
    missing.push({ key: `item-${p.index}-${p.kind}`, label: p.label });
  }
  if (!hasExcel) {
    missing.push({ key: "excel", label: "ไฟล์ Excel สรุปรายการ (AP-4.1)" });
  }
  if (!hasReceipt) {
    missing.push({ key: "receipt", label: "หลักฐาน (ใบเสร็จ/ใบกำกับภาษี) อย่างน้อย 1 ไฟล์" });
  }
  // An errored or still-in-flight fetch leaves `rules` empty, and `[].every()`
  // is `true` — so without these two branches the readiness panel goes green
  // while the checklist has nothing to tick, and the submit earns a server-side
  // ERR_RULES_NOT_ACKED the requester cannot act on. A genuinely empty list
  // still passes vacuously, exactly as the server decides it; an *unknown* one
  // must not.
  if (rulesError) {
    missing.push({ key: "rules", label: "ระเบียบการจ่าย Reimburse (โหลดไม่สำเร็จ — กดลองใหม่)" });
  } else if (rulesLoading) {
    missing.push({ key: "rules", label: "ระเบียบการจ่าย Reimburse (กำลังโหลด...)" });
  } else if (!allRulesAcked) {
    missing.push({ key: "rules", label: "ระเบียบการจ่าย Reimburse (ยืนยันให้ครบทุกข้อ)" });
  }

  const canSubmit = missing.length === 0;
  const missingKeys = new Set(missing.map((m) => m.key));
  const showErr = (key: string) => triedSubmit && missingKeys.has(key);

  // Keyed on the first missing entry, not on `missing` itself: that array is
  // rebuilt on every render, so a `[missing]` dep list memoises nothing.
  const firstMissingKey = missing[0]?.key ?? null;
  const focusFirstMissing = useCallback(() => {
    const first = firstMissingKey;
    if (!first) return;
    const el =
      first === "manager"
        ? managerRef.current
        : first === "brand"
          ? brandRef.current
          : first === "items" || first.startsWith("item-")
            ? itemsRef.current
            : first === "excel" || first === "receipt"
              ? filesRef.current
              : rulesRef.current;
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [firstMissingKey]);

  /* ── persistence ── */

  const reloadFromServer = useCallback(async (id: number) => {
    try {
      const res = await fetch(`/api/request/reimburse/requests/${id}`);
      const json = (await res.json()) as { ok: boolean; data?: ReimburseDetail };
      if (!json.ok || !json.data) return;
      const d = json.data;
      setRequestNo(d.requestNo);
      setStatus(d.status);
      setBrandCode((prev) => d.brandCode ?? prev);
      setPurpose(d.purpose ?? "");
      setItems(d.items.length > 0 ? d.items.map((it, i) => ({ ...it, sortOrder: i })) : [emptyItem(0)]);
      setAckedRuleIds(d.ackedRuleIds);
      setExcelFile(d.excelFile);
      setReceiptFiles(d.receiptFiles);
    } catch {
      /* the save already succeeded — a failed refresh is not a failed save */
    }
  }, []);

  /**
   * Upload whatever was chosen before the request had an id. One call per slot:
   * the route validates every file in a batch before storing any of them, so
   * the receipts go up together rather than one request each.
   */
  const uploadPending = useCallback(
    async (id: number): Promise<boolean> => {
      let ok = true;

      const post = async (refType: string, files: File[]): Promise<boolean> => {
        const fd = new FormData();
        fd.append("refType", refType);
        // `files`, plural — AP-4's route reads `formData.getAll("files")`.
        for (const f of files) fd.append("files", f);
        try {
          const res = await fetch(`/api/request/reimburse/requests/${id}/files`, {
            method: "POST",
            body: fd,
          });
          const json = (await res.json()) as { ok: boolean; error?: string };
          if (!json.ok) {
            toast.error(json.error ?? "อัปโหลดไฟล์ไม่สำเร็จ");
            return false;
          }
          return true;
        } catch {
          toast.error("อัปโหลดไฟล์ไม่สำเร็จ");
          return false;
        }
      };

      // Clear only what was actually sent, never the whole slot.
      //
      // This callback closes over the files that were pending when it was
      // created, and it awaits a Graph round trip per slot — seconds, on a first
      // save that flushes the workbook and every receipt. `setPendingReceipts([])`
      // therefore discarded anything added during that window **without ever
      // uploading it**: the reload then dropped the row, and because the
      // readiness gate counts pending files, `handleSubmit`'s silent save could
      // go on to submit without a document the requester had watched themselves
      // attach. The functional updates below subtract the uploaded set from
      // whatever the slot holds now, so a late addition survives to the next
      // save. `File` identity is by reference and `addReceipts` concatenates the
      // same instances, so `indexOf` is the right test.
      if (pendingExcel) {
        const sent = pendingExcel;
        if (await post(REIMBURSE_FILE_REFTYPES.EXCEL, [sent])) {
          setPendingExcel((cur) => (cur === sent ? null : cur));
        } else ok = false;
      }
      if (pendingReceipts.length > 0) {
        const sent = pendingReceipts;
        if (await post(REIMBURSE_FILE_REFTYPES.RECEIPT, sent)) {
          setPendingReceipts((cur) => cur.filter((f) => sent.indexOf(f) === -1));
        } else ok = false;
      }
      return ok;
    },
    [pendingExcel, pendingReceipts],
  );

  /**
   * Save, then flush whatever files were held back.
   *
   * `uploadsOk` is reported separately from the id because they fail
   * differently: the draft really is saved even when an upload is refused, so
   * returning null would lie about it — but submitting on top of a failed
   * upload walks into a server refusal for a missing attachment the requester
   * believes they attached.
   */
  const handleSaveDraft = useCallback(
    async (opts?: { silent?: boolean }): Promise<{ id: number; uploadsOk: boolean } | null> => {
      setSaving(true);
      try {
        const body = {
          id: requestId ?? undefined,
          brandCode,
          purpose: purpose.trim() || null,
          // Only rows the requester actually filled in. A blank row above a
          // filled one would otherwise shift every row label in the server's
          // error messages.
          items: items
            .filter((it) => !isBlankItemRow(it))
            .map((it, i) => ({ ...it, sortOrder: i })),
          ackedRuleIds,
        };
        const res = await fetch("/api/request/reimburse/requests", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const json = (await res.json()) as { ok: boolean; data?: { id: number }; error?: string };
        if (!json.ok) {
          toast.error(json.error ?? "บันทึกไม่สำเร็จ");
          return null;
        }
        const id = json.data?.id ?? requestId;
        if (!id) return null;
        if (!requestId) setRequestId(id);

        const uploadsOk = await uploadPending(id);
        await reloadFromServer(id);
        if (!opts?.silent && uploadsOk) toast.success("บันทึกร่างแล้ว");
        onSaved?.(id);
        return { id, uploadsOk };
      } catch {
        toast.error("บันทึกไม่สำเร็จ");
        return null;
      } finally {
        setSaving(false);
      }
    },
    [requestId, brandCode, purpose, items, ackedRuleIds, uploadPending, reloadFromServer, onSaved],
  );

  const handleSubmit = useCallback(async () => {
    setTriedSubmit(true);
    if (!canSubmit) {
      focusFirstMissing();
      toast.error("กรุณากรอกข้อมูลให้ครบก่อนส่งคำขอ");
      return;
    }
    setSubmitting(true);
    try {
      // Submit operates on what is persisted — it takes no payload — so the
      // latest edits and any held-back files have to land first.
      const saved = await handleSaveDraft({ silent: true });
      if (!saved) return;
      if (!saved.uploadsOk) {
        // `uploadPending` has already said which file and why. Submitting now
        // would only earn a second refusal, for an attachment the requester
        // thinks they have supplied.
        toast.error("แนบไฟล์ไม่ครบ — ยังส่งคำขอไม่ได้");
        return;
      }
      const id = saved.id;

      const res = await fetch(`/api/request/reimburse/requests/${id}/submit`, { method: "POST" });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) {
        toast.error(json.error ?? "ส่งคำขอไม่สำเร็จ");
        return;
      }
      toast.success("ส่งคำขอแล้ว");
      onSubmitted?.(id);
    } catch {
      toast.error("ส่งคำขอไม่สำเร็จ");
    } finally {
      setSubmitting(false);
    }
  }, [canSubmit, focusFirstMissing, handleSaveDraft, onSubmitted]);

  const handleDeleteStored = useCallback(
    async (fileId: number): Promise<boolean> => {
      try {
        const res = await fetch(`/api/request/reimburse/files/${fileId}`, { method: "DELETE" });
        const json = (await res.json()) as { ok: boolean; error?: string };
        if (!json.ok) {
          toast.error(json.error ?? "ลบไฟล์ไม่สำเร็จ");
          return false;
        }
        setExcelFile((prev) => (prev && prev.id === fileId ? null : prev));
        setReceiptFiles((prev) => prev.filter((f) => f.id !== fileId));
        toast.success("ลบไฟล์แล้ว");
        return true;
      } catch {
        toast.error("ลบไฟล์ไม่สำเร็จ");
        return false;
      }
    },
    [],
  );

  const selectExcel = useCallback(
    (file: File | null) => {
      // Choosing a replacement while one is already stored is not a delete: the
      // upload route repoints `ExcelFileId` and removes the superseded file
      // itself, so the old one stays until the new one is safely in place.
      setPendingExcel(file);
    },
    [],
  );

  const addReceipts = useCallback((files: File[]) => {
    setPendingReceipts((prev) => prev.concat(files));
  }, []);

  const removePendingReceipt = useCallback((index: number) => {
    setPendingReceipts((prev) => prev.filter((_, i) => i !== index));
  }, []);

  /* ─────────────────────────── render ─────────────────────────── */

  // `sumReimburseItems`, not a second sum: the grid's total uses it too, and a
  // local reduce diverges from it whenever the float error crosses a half — a
  // claim of 0.615 renders 0.62 under the grid and 0.61 here, which is worse
  // than either figure being wrong on its own.
  const totalLabel = fmtBaht(sumReimburseItems(filledItems));

  return (
    <div className="w-full max-w-full mx-auto flex flex-col gap-4 min-w-0">
      {/* Which set of books this draft belongs to, before anything a reader
          could act on. `requestId`, not `initial?.id`: it picks up the id the
          server hands back on first save, so a brand-new draft is labelled from
          the moment it becomes a row. */}
      <div className="-mb-4 empty:hidden">
        <UatDataBanner requestId={requestId} holdSpace={false} />
      </div>

      <ReimburseNotice />

      {/* ── ผู้ขอเบิก ── */}
      <SectionCard icon={<User size={15} />} title="ผู้ขอเบิก">
        {employeeLoading ? (
          <div className="flex items-center gap-4">
            <div className="shrink-0 w-14 h-14 rounded-2xl animate-pulse" style={{ background: "var(--bg-card-alt)" }} />
            <div className="flex-1 flex flex-col gap-2">
              <div className="h-3 w-32 rounded animate-pulse" style={{ background: "var(--bg-card-alt)" }} />
              <div className="h-3 w-48 rounded animate-pulse" style={{ background: "var(--bg-card-alt)" }} />
            </div>
          </div>
        ) : !employee ? (
          <div
            className="rounded-xl px-4 py-3 text-[13px] leading-relaxed"
            style={{
              background: "var(--bg-info-yellow)",
              color: "var(--text-info-yellow)",
              border: "1px solid var(--border-card)",
            }}
          >
            ไม่พบข้อมูลพนักงานสำหรับอีเมล <b>{employeeEmail ?? "-"}</b> ในระบบ HR
            {employeeHint ? ` — ${employeeHint}` : ""} · กรุณาตรวจสอบว่าอีเมลตรงกับ Employee ใน
            Rocks_Portal_HR
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="shrink-0 rounded-2xl overflow-hidden" style={{ boxShadow: "0 0 0 2px var(--nav-active-bg)" }}>
                <Avatar name={employeeName || "?"} size={48} photo={requesterPhoto} color="var(--nav-active-text)" />
              </div>
              <div className="min-w-0 flex flex-col gap-0.5">
                <div className="flex items-baseline gap-2 min-w-0">
                  <span className="text-[14px] font-bold truncate" style={{ color: "var(--text-primary)" }}>
                    {employeeName || "-"}
                  </span>
                  <span className="text-[11px] shrink-0" style={{ color: "var(--text-muted)" }}>
                    #{employee.staffId}
                  </span>
                </div>
                {(employee.departmentName || employee.position) && (
                  <span className="text-[12px] truncate" style={{ color: "var(--text-muted)" }}>
                    {[employee.departmentName, employee.position].filter(Boolean).join(" · ")}
                  </span>
                )}
                {(employee.email || employee.emailCompBr) && (
                  <span className="inline-flex items-center gap-1 text-[12px] truncate" style={{ color: "var(--text-secondary)" }}>
                    <Mail size={11} className="shrink-0" />
                    <span className="truncate">{employee.email ?? employee.emailCompBr}</span>
                  </span>
                )}
              </div>
            </div>

            <div
              ref={managerRef}
              className="flex items-center gap-3 min-w-0 border-t md:border-t-0 md:border-l border-[var(--border-light)] pt-4 md:pt-0 md:pl-6"
              style={showErr("manager") ? { boxShadow: "0 0 0 1px var(--color-danger)", borderRadius: 10, padding: 12 } : {}}
            >
              {manager ? (
                <>
                  <div className="shrink-0 rounded-2xl overflow-hidden" style={{ boxShadow: "0 0 0 2px var(--nav-active-bg)" }}>
                    <Avatar name={manager.fullName || "?"} size={48} photo={manager.photoUrl ?? undefined} color="var(--nav-active-text)" />
                  </div>
                  <div className="min-w-0 flex flex-col gap-0.5">
                    <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                      หัวหน้างาน (ผู้จัดการ){requiredStar}
                    </span>
                    <div className="flex items-baseline gap-2 min-w-0">
                      <span className="text-[14px] font-bold truncate" style={{ color: "var(--text-primary)" }}>
                        {manager.fullName ?? "-"}
                      </span>
                      <span className="text-[11px] shrink-0" style={{ color: "var(--text-muted)" }}>
                        #{manager.staffId}
                      </span>
                    </div>
                    {manager.position && (
                      <span className="text-[12px] truncate" style={{ color: "var(--text-muted)" }}>
                        {manager.position}
                      </span>
                    )}
                    {manager.email && (
                      <span className="inline-flex items-center gap-1 text-[12px] truncate" style={{ color: "var(--text-secondary)" }}>
                        <Mail size={11} className="shrink-0" />
                        <span className="truncate">{manager.email}</span>
                      </span>
                    )}
                  </div>
                </>
              ) : (
                <div className="flex flex-col gap-0.5 min-w-0">
                  <span
                    className="text-[10px] font-semibold uppercase tracking-wide"
                    style={showErr("manager") ? { color: "var(--color-danger)" } : labelStyle}
                  >
                    หัวหน้างาน (ผู้จัดการ){requiredStar}
                  </span>
                  <p
                    className="text-[12.5px] leading-relaxed m-0"
                    style={{ color: showErr("manager") ? "var(--color-danger)" : "var(--text-muted)" }}
                  >
                    {managerReason ?? "ยังไม่ได้กำหนดผู้จัดการ (ManagerStaffId) ในระบบ HR"}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </SectionCard>

      {/* ── รายละเอียดการเบิก ── */}
      <SectionCard icon={<Receipt size={15} />} title="รายละเอียดการเบิก">
        {/* ── แบรนด์ที่เบิก — the AccFormBrand allowlist, not the navbar ── */}
        <div
          ref={brandRef}
          style={
            showErr("brand")
              ? { boxShadow: "0 0 0 1px var(--color-danger)", borderRadius: 10, padding: 12 }
              : {}
          }
        >
          <label
            className={labelClass}
            style={showErr("brand") ? { ...labelStyle, color: "var(--color-danger)" } : labelStyle}
          >
            แบรนด์ที่เบิก{requiredStar}
          </label>

          {brandsLoading ? (
            <div className="h-9 w-40 rounded-xl animate-pulse" style={{ background: "var(--bg-card-alt)" }} />
          ) : brandOptions.length === 0 ? (
            <p
              className="text-[12.5px] leading-relaxed m-0 rounded-xl px-4 py-3"
              style={{ background: "var(--bg-info-yellow)", color: "var(--text-info-yellow)" }}
            >
              ยังไม่ได้กำหนดแบรนด์ที่เบิกได้สำหรับ AP-4 — กรุณาแจ้งผู้ดูแลระบบให้ตั้งค่าที่
              ตั้งค่าขอเบิกเงินคืนพนักงาน → แบรนด์ที่เบิกได้
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {brandOptions.map((opt) => {
                const active = opt.brandCode === brandCode;
                return (
                  <button
                    key={opt.brandCode}
                    type="button"
                    onClick={() => setBrandCode(opt.brandCode)}
                    aria-pressed={active}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-xl cursor-pointer transition-colors"
                    style={{
                      borderWidth: 1,
                      borderStyle: "solid",
                      borderColor: active
                        ? "color-mix(in srgb, var(--nav-active-text) 45%, var(--border-card))"
                        : "var(--border-card)",
                      background: active ? "var(--nav-active-bg)" : "var(--bg-card-alt)",
                    }}
                  >
                    {opt.brandLogo && (
                      <img
                        src={opt.brandLogo}
                        alt=""
                        className="h-5 w-auto object-contain"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = "none";
                        }}
                      />
                    )}
                    <span
                      className="text-[14px] font-semibold"
                      style={{ color: active ? "var(--nav-active-text)" : "var(--text-primary)" }}
                    >
                      {opt.brandName}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* The picker is over `AccFormBrand`, so what it offers is a setting,
              not the navbar brand. A resumed request whose saved code has since
              been removed from that list keeps it and is told why — changing it
              silently would move the claim to a different company. */}
          {!brandsLoading && brandOptions.length > 0 && (
            <p className="text-[11.5px] mt-1.5 m-0" style={{ color: "var(--text-faint)" }}>
              {selectedBrand && !(allowedBrands ?? []).some((b) => b.brandCode === selectedBrand.brandCode)
                ? "แบรนด์ที่บันทึกไว้กับคำขอนี้ ปัจจุบันไม่อยู่ในรายการที่อนุญาตแล้ว — ยังคงไว้ตามเดิม เลือกใหม่ได้จากรายการข้างต้น"
                : "รายการแบรนด์ที่อนุญาตให้เบิกในแบบฟอร์ม AP-4 (ตั้งค่าโดยผู้ดูแลระบบ)"}
            </p>
          )}
        </div>

        <div>
          <label className={labelClass} style={labelStyle}>
            วัตถุประสงค์ / รายละเอียดการเบิก
          </label>
          <textarea
            rows={2}
            className={inputClass}
            style={{ ...inputStyle, resize: "vertical" }}
            value={purpose}
            placeholder="เบิกค่าอะไร ใช้กับงานไหน (ถ้ามี)..."
            onChange={(e) => setPurpose(e.target.value)}
          />
        </div>
      </SectionCard>

      {/* ── รายการค่าใช้จ่ายจริง ── */}
      <div ref={itemsRef} className="min-w-0">
        <SectionCard icon={<ListChecks size={15} />} title="รายการค่าใช้จ่ายจริง">
          <ReimburseItemGrid
            items={items}
            onUpdate={updateItem}
            onAdd={addItem}
            onRemove={removeItem}
            problems={rowProblems}
            showProblems={triedSubmit}
          />
        </SectionCard>
      </div>

      {/* ── เอกสารแนบ ── */}
      <div ref={filesRef} className="min-w-0">
        <SectionCard icon={<Paperclip size={15} />} title="เอกสารแนบ">
          <ReimburseAttachments
            excelFile={excelFile}
            receiptFiles={receiptFiles}
            pendingExcel={pendingExcel}
            pendingReceipts={pendingReceipts}
            onSelectExcel={selectExcel}
            onAddReceipts={addReceipts}
            onRemovePendingReceipt={removePendingReceipt}
            onDeleteStored={handleDeleteStored}
            excelError={showErr("excel")}
            receiptError={showErr("receipt")}
          />
        </SectionCard>
      </div>

      {/* ── ระเบียบการจ่าย Reimburse ── */}
      <div ref={rulesRef} className="min-w-0">
        <SectionCard icon={<FileCheck size={15} />} title="ระเบียบการจ่าย Reimburse">
          <ReimburseRuleChecklist
            rules={rules}
            loading={rulesLoading}
            failed={!!rulesError}
            onRetry={() => void reloadRules()}
            checkedIds={ackedRuleIds}
            onToggle={toggleRule}
            onToggleAll={toggleAllRules}
            hasError={showErr("rules")}
          />
        </SectionCard>
      </div>

      {/* ── สรุป & ส่งคำขอ ── */}
      <SectionCard icon={<FileCheck size={15} />} title="สรุป & ส่งคำขอ">
        <div
          className="rounded-xl px-4 py-3 flex flex-col gap-2"
          style={{
            background: canSubmit ? "var(--bg-info-green)" : "var(--bg-card-alt)",
            border: `1px solid ${canSubmit ? "var(--color-success)" : "var(--border-card)"}`,
          }}
        >
          <p className="text-[12px] font-semibold uppercase tracking-wide m-0" style={{ color: "var(--text-muted)" }}>
            ตรวจสอบความครบถ้วน
          </p>
          {canSubmit ? (
            <p className="text-[13px] font-semibold m-0 flex items-center gap-1.5" style={{ color: "var(--color-success)" }}>
              <CircleCheck size={15} />
              ข้อมูลครบถ้วน — พร้อมส่งคำขอ
            </p>
          ) : (
            <ul className="m-0 pl-4 flex flex-col gap-1">
              {missing.map((m) => (
                <li key={m.key} className="text-[12px]" style={{ color: "var(--color-danger)" }}>
                  {m.label}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div
          className="rounded-xl px-4 py-3 flex flex-col gap-1.5"
          style={{ background: "var(--bg-card-alt)", border: "1px solid var(--border-card)" }}
        >
          {/* A pointer to the notice, never a restatement of it.
              `REIMBURSE_NOTICE` at the top of this page already carries the
              one-month originals deadline and the payment cycle, verbatim from
              the owner. A hand-written summary sitting beside it is a second,
              unsourced rendering of the same compliance material: it drifts the
              first time Accounting edit the notice, and nobody notices because
              it does not look like a copy. This feature has already shipped one
              such paraphrase, which moved a withholding-tax obligation from the
              employee to the company. */}
          <p className="text-[12px] leading-relaxed m-0" style={{ color: "var(--text-muted)" }}>
            กรุณาอ่าน &quot;ข้อควรทราบก่อนเบิกค่าใช้จ่าย&quot; ด้านบนของหน้านี้ให้ครบก่อนส่งคำขอ
          </p>
        </div>
      </SectionCard>

      {/* Sticky summary + actions — outside the card so `position: sticky` is not
          clipped by SectionCard's overflow-hidden. */}
      <div
        className="sticky bottom-3 rounded-2xl px-4 py-3.5 flex items-center justify-between gap-3 flex-wrap"
        style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)", boxShadow: "var(--shadow-lg)" }}
      >
        <div className="flex flex-col min-w-0">
          <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
            ยอดรวมที่ขอเบิก
            {requestNo ? ` · ${requestNo}` : ""}
            {status === "Returned" ? " · ส่งกลับแก้ไข" : ""}
          </span>
          <span className="text-[16px] font-bold" style={{ color: "var(--text-heading)" }}>
            ฿{totalLabel}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="lg"
            icon={<Save size={15} />}
            loading={saving && !submitting}
            disabled={saving || submitting}
            onClick={() => void handleSaveDraft()}
            type="button"
          >
            บันทึกร่าง
          </Button>
          <Button
            variant="primary"
            size="lg"
            icon={<Send size={15} />}
            loading={submitting}
            disabled={saving || submitting}
            onClick={() => void handleSubmit()}
            type="button"
          >
            ส่งคำขอ
          </Button>
        </div>
      </div>

      {triedSubmit && !canSubmit && (
        <p className="text-[12px] m-0 flex items-center gap-1.5" style={{ color: "var(--color-danger)" }}>
          <CircleAlert size={13} className="shrink-0" />
          ยังกรอกไม่ครบ — ดูรายการที่ขาดในส่วน &quot;ตรวจสอบความครบถ้วน&quot; ด้านบน
        </p>
      )}

      {/* The overlay covers saving as well as submitting, and that is the fix
          for a data-loss window rather than a nicety.
          `handleSaveDraft` runs POST → `uploadPending` → `reloadFromServer`, and
          the reload hard-sets `purpose`, `items` and `ackedRuleIds` from the
          snapshot the server had *before* the save. On a first save that window
          is seconds, because every attachment goes to SharePoint through Graph
          inside it — long enough that typing the next line, or attaching the
          next receipt, is the natural thing to do. Only the two buttons used to
          be disabled, so those edits were replaced under a "บันทึกร่างแล้ว"
          success toast with nothing telling the requester.
          Blocking input for the whole round trip is the honest answer: the form
          is not editable while its state is being replaced. */}
      {submitting || saving ? (
        <TravelExpenseLoadingPopup
          label={submitting ? "กำลังส่งคำขอ..." : "กำลังบันทึกร่าง..."}
          subtitle="กรุณารอสักครู่ อย่าปิดหน้านี้"
        />
      ) : null}
    </div>
  );
}
