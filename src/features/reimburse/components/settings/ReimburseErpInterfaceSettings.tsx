"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { CheckCircle2, Circle, Link2, RefreshCw, Save } from "lucide-react";
import { Button } from "@/components/ui";
import { SearchableSelect } from "@/features/accounting/components/settings/SearchableSelect";

interface ConfigRow {
  brandCode: string;
  brandName: string;
  brandLogo: string | null;
  interfaceTarget: string;
  targetFromReimburse: boolean;
  bcName: string | null;
  bcConnectionName: string | null;
  bcProfileComplete: boolean;
  environment: string | null;
  branchCode: string | null;
  bankAccountNo: string | null;
  journalBatchName: string | null;
  ready: boolean;
  active: boolean;
}

type SelectOption = { value: string; label: string; subLabel?: string };
interface AcctOpt { accountNo: string; displayName: string | null }
interface BatchOpt { batchName: string; displayName: string | null; templateName: string | null }
interface BranchOpt { code: string; displayName: string | null }
interface CompanyErp { gl: AcctOpt[]; bank: AcctOpt[]; journalBatch: BatchOpt[]; branch: BranchOpt[] }

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function decode(v: string | null | undefined): string {
  if (!v?.trim()) return "—";
  try { return decodeURIComponent(v.trim()); } catch { return v.trim(); }
}

function acctOptions(items: AcctOpt[], current?: string | null): SelectOption[] {
  const seen = new Set<string>();
  const out: SelectOption[] = [];
  for (const o of items ?? []) {
    if (seen.has(o.accountNo)) continue;
    seen.add(o.accountNo);
    const sub = o.displayName?.trim() && o.displayName.trim() !== o.accountNo ? o.displayName.trim() : undefined;
    out.push({ value: o.accountNo, label: o.accountNo, subLabel: sub });
  }
  if (current && !seen.has(current)) out.push({ value: current, label: current });
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

function branchOptions(items: BranchOpt[], current?: string | null): SelectOption[] {
  const seen = new Set<string>();
  const out: SelectOption[] = [];
  for (const o of items ?? []) {
    if (seen.has(o.code)) continue;
    seen.add(o.code);
    const sub = o.displayName?.trim() && o.displayName.trim() !== o.code ? o.displayName.trim() : undefined;
    out.push({ value: o.code, label: o.code, subLabel: sub });
  }
  if (current && !seen.has(current)) out.push({ value: current, label: current });
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

function batchOptions(items: BatchOpt[], current?: string | null): SelectOption[] {
  const seen = new Set<string>();
  const out: SelectOption[] = [];
  for (const o of items ?? []) {
    if (seen.has(o.batchName)) continue;
    seen.add(o.batchName);
    const sub = [
      o.templateName?.trim(),
      o.displayName?.trim() && o.displayName.trim() !== o.batchName ? o.displayName.trim() : null,
    ].filter(Boolean).join(" · ") || undefined;
    out.push({ value: o.batchName, label: o.batchName, subLabel: sub });
  }
  if (current && !seen.has(current)) out.push({ value: current, label: current });
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] font-bold uppercase tracking-wide mb-1.5" style={{ color: "var(--text-faint)" }}>{children}</p>;
}

/**
 * "ตั้งค่าครบ" / "ยังไม่ครบ" — never "พร้อมส่ง". `row.ready` means the
 * configuration is complete (a bank account and a journal batch are set and
 * the Business Central profile resolves), not that anything is about to be
 * sent — AP-4 has no send path at all yet (CLAUDE.md: "AP-4 never reaches
 * Business Central, deliberately"). AP-2's equivalent panel earns "พร้อมส่ง"
 * because AP-2 sends; wearing that word here would promise an action that
 * cannot happen.
 */
function StatusBadge({ ready }: { ready: boolean }) {
  const Icon = ready ? CheckCircle2 : Circle;
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full"
      style={ready
        ? { background: "rgba(79,163,122,0.15)", color: "var(--text-info-green)" }
        : { background: "var(--bg-badge)", color: "var(--text-muted)" }}>
      <Icon size={12} />{ready ? "ตั้งค่าครบ" : "ยังไม่ครบ"}
    </span>
  );
}

function BrandCard({ row, erpByCompany, onSaved }: {
  row: ConfigRow;
  erpByCompany: Record<string, CompanyErp>;
  onSaved: () => void;
}) {
  // AP-4 owns its target Company + Bank + Branch + Journal Batch, the same
  // shape AP-2's panel edits. No G/L account field — see the service's own
  // docblock for why: Business Central resolves the debit account from the
  // matched vendor's posting group, not from a configured G/L, and AP-4 has
  // no reason to expect its eventual payload would need one AP-2's does not.
  const [targetSel, setTargetSel] = useState(row.interfaceTarget ?? "");
  const [bank, setBank] = useState(row.bankAccountNo ?? "");
  const [branch, setBranch] = useState(row.branchCode ?? "");
  const [batch, setBatch] = useState(row.journalBatchName ?? "");
  const [busy, setBusy] = useState(false);

  const companyOpts = useMemo(
    () => Object.keys(erpByCompany).sort().map((c) => ({ value: c, label: c })),
    [erpByCompany],
  );

  // Changing the target Company resets the picks — accounts are
  // company-specific, so a Bank/Branch/Batch from the old Company must never
  // be saved here.
  function onTargetChange(v: string) {
    if (v === targetSel) return;
    setTargetSel(v);
    setBank(""); setBranch(""); setBatch("");
  }

  const target = targetSel;
  const erp = erpByCompany[targetSel];
  const bankOpts = useMemo(() => acctOptions(erp?.bank ?? [], bank), [erp, bank]);
  const branchOpts = useMemo(() => branchOptions(erp?.branch ?? [], branch), [erp, branch]);
  const batchOpts = useMemo(() => batchOptions(erp?.journalBatch ?? [], batch), [erp, batch]);

  const targetDirty = targetSel.trim() !== (row.interfaceTarget ?? "").trim();
  const bankDirty = bank.trim() !== (row.bankAccountNo ?? "").trim();
  const branchDirty = branch.trim() !== (row.branchCode ?? "").trim();
  const batchDirty = batch.trim() !== (row.journalBatchName ?? "").trim();
  const anyDirty = targetDirty || bankDirty || branchDirty || batchDirty;

  async function saveAll() {
    if (!targetSel.trim()) return toast.error("กรุณาเลือก Company ปลายทาง");
    if (!bank.trim()) return toast.error("กรุณาเลือก Bank Account");
    setBusy(true);
    try {
      const res = await fetch("/api/request/reimburse/settings/erp-interface", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandCode: row.brandCode,
          interfaceBrandCode: targetSel.trim(),
          bankAccountNo: bank.trim(),
          branchCode: branch.trim(),
          journalBatchName: batch.trim(),
        }),
      });
      const j = (await res.json()) as { ok: boolean; error?: string };
      if (!j.ok) throw new Error(j.error ?? "บันทึกไม่สำเร็จ");
      toast.success(`บันทึกการตั้งค่า ${row.brandName} แล้ว`);
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  const noOpts = !erp;
  const bcLine = [decode(row.bcName), row.bcConnectionName?.trim()].filter((v) => v && v !== "—").join(" · ") || "—";

  return (
    <div className="rounded-xl p-4"
      style={{
        background: anyDirty ? "var(--bg-info-yellow)" : "var(--bg-card-alt)",
        border: `1px solid ${anyDirty ? "var(--border-info-yellow)" : row.ready ? "var(--border-info-green)" : "var(--border-card)"}`,
        opacity: row.active ? 1 : 0.6,
      }}>
      <div className="flex items-center gap-3 mb-3">
        {row.brandLogo && (
          <img src={row.brandLogo} alt="" className="h-8 w-auto object-contain shrink-0"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-bold m-0 truncate" style={{ color: "var(--text-heading)" }}>{row.brandName}</p>
          <p className="text-[10px] m-0 font-mono" style={{ color: "var(--text-muted)" }}>
            {row.brandCode} → {target || "—"} · {(row.targetFromReimburse || targetDirty) ? "(AP-4)" : "(จาก AP-1)"}
            {row.environment ? ` · ${row.environment === "Sandbox" ? "UAT" : "PROD"}` : ""}
          </p>
        </div>
        <StatusBadge ready={row.ready} />
      </div>

      {!row.active && (
        <p className="text-[11px] m-0 mb-3 px-3 py-2 rounded-lg"
          style={{ background: "var(--bg-badge)", color: "var(--text-muted)" }}>
          แบรนด์นี้ปิดใช้งานอยู่ในแท็บ “แบรนด์ที่เบิกได้” — ยังแก้ไขการตั้งค่าด้านล่างได้ตามปกติ
        </p>
      )}

      <div className="mb-3 pb-3" style={{ borderBottom: "1px solid var(--border-light)" }}>
        <FieldLabel>Company ปลายทาง (AP-4)</FieldLabel>
        <SearchableSelect
          value={targetSel}
          onChange={onTargetChange}
          options={companyOpts}
          placeholder="— เลือก Company —"
          emptyLabel="— เลือก Company —"
          searchPlaceholder="ค้นหา Company..."
          triggerBackground="var(--bg-card)"
        />
        <p className="text-[10px] m-0 mt-1" style={{ color: "var(--text-faint)" }}>BC: {bcLine}</p>
      </div>
      {target && !row.bcProfileComplete && (
        <p className="text-[11px] m-0 mb-3 px-3 py-2 rounded-lg"
          style={{ background: "var(--bg-info-yellow)", color: "var(--text-info-yellow)", border: "1px solid var(--border-info-yellow)" }}>
          ⚠️ การเชื่อมต่อ BC ของ Company นี้ยังไม่ครบ — ตั้งค่าที่ Accounting → Interface ERP ก่อน
        </p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="min-w-0">
          <FieldLabel>Bank Account (AP-4)</FieldLabel>
          <SearchableSelect value={bank} onChange={setBank} options={bankOpts}
            placeholder={noOpts ? "เลือกปลายทางก่อน" : "— เลือก Bank —"}
            emptyLabel={noOpts ? "เลือกปลายทางก่อน" : "— เลือก Bank —"}
            searchPlaceholder="ค้นหา Bank..." triggerBackground="var(--bg-card)" />
        </div>
        <div className="min-w-0">
          <FieldLabel>Branch (AP-4) · ไม่บังคับ</FieldLabel>
          <SearchableSelect value={branch} onChange={setBranch} options={branchOpts}
            placeholder={noOpts ? "เลือกปลายทางก่อน" : "— ไม่ระบุ · ใช้แผนกผู้ขอ —"}
            emptyLabel={noOpts ? "เลือกปลายทางก่อน" : "— ไม่ระบุ · ใช้แผนกผู้ขอ —"}
            searchPlaceholder="ค้นหา Branch..." triggerBackground="var(--bg-card)" />
          <p className="text-[10px] m-0 mt-0.5" style={{ color: "var(--text-faint)" }}>
            เลือก “— ไม่ระบุ —” เพื่อใช้แผนกของผู้ขอ (map HR→ERP)
          </p>
        </div>
        <div className="min-w-0">
          <FieldLabel>Journal Batch (AP-4)</FieldLabel>
          <SearchableSelect value={batch} onChange={setBatch} options={batchOpts}
            placeholder={noOpts ? "เลือกปลายทางก่อน" : "— เลือก Batch —"}
            emptyLabel={noOpts ? "เลือกปลายทางก่อน" : "— เลือก Batch —"}
            searchPlaceholder="ค้นหา Batch..." triggerBackground="var(--bg-card)" />
          {target && !noOpts && batchOpts.length === 0 && (
            <p className="text-[10px] m-0 mt-0.5" style={{ color: "var(--text-muted)" }}>
              ไม่พบ Journal Batch ของ {target} ใน ERP
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 mt-3 pt-3"
        style={{ borderTop: "1px solid var(--border-light)" }}>
        <p className="text-[10px] m-0" style={{ color: "var(--text-faint)" }}>
          AP-4 กำหนดเอง: Company ปลายทาง · Bank · Branch · Journal Batch
        </p>
        <Button variant="primary" icon={<Save size={15} />} onClick={saveAll}
          loading={busy} disabled={!anyDirty}>บันทึก</Button>
      </div>
    </div>
  );
}

/**
 * AP-4's Interface ERP tab — Task 2 of the ERP-settings-and-queue work.
 *
 * Reads/writes through `/api/request/reimburse/settings/erp-interface`
 * (Task 2's own route, `requireRole` on both methods — this tab is
 * deliberately not grantable, see `settings-tabs.ts`). Bank / Branch /
 * Journal Batch option lists are read from AP-2's existing
 * `/api/request/advance/settings/erp-master`, not a new AP-4 copy of it: that
 * endpoint reads `Rocks_ERP_Data` — Business Central's mirror, keyed by
 * Company and unrelated to which form is asking — the same way
 * `ReimburseBrandSettings` already reads AP-1's `all-brands` endpoint for the
 * brand master rather than duplicating it.
 *
 * **No Sync Vendor button, unlike AP-2's panel.** Vendor sync exists so AP-2's
 * Dr line can match a Business Central vendor at send time; AP-4 has no send
 * path yet at all, so there is nothing here for a synced vendor list to serve.
 *
 * **No brand Active toggle, unlike AP-2's panel.** AP-4 already has its own
 * "แบรนด์ที่เบิกได้" tab (`ReimburseBrandSettings`) that owns the complete
 * active set through `/api/request/reimburse/settings/brands`. Toggling a
 * brand from here too, through a second per-brand endpoint, would be a second
 * way to change the same flag — a deactivated brand still shows its saved
 * posting configuration here, dimmed, with a pointer to that tab instead.
 */
export function ReimburseErpInterfaceSettings() {
  const [rows, setRows] = useState<ConfigRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/request/reimburse/settings/erp-interface")
      .then((r) => r.json())
      .then((j: { ok: boolean; data?: ConfigRow[] }) => setRows(j.ok && j.data ? j.data : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => load(), [load]);

  const { data: erpData, isLoading: erpLoading, mutate: mutateErp } =
    useSWR<{ ok: boolean; data?: Record<string, CompanyErp> }>(
      "/api/request/advance/settings/erp-master",
      fetcher,
    );
  const erpByCompany = erpData?.data ?? {};

  const [refreshing, setRefreshing] = useState(false);
  async function refreshErp() {
    setRefreshing(true);
    try {
      await mutateErp();
      toast.success("รีเฟรชข้อมูล ERP แล้ว");
    } catch {
      toast.error("รีเฟรชไม่สำเร็จ");
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl px-4 py-3 flex flex-wrap items-start justify-between gap-3"
        style={{ background: "var(--nav-active-bg)", border: "1px solid var(--border-card)" }}>
        <div className="flex-1 min-w-[200px]">
          <p className="text-[13px] font-semibold m-0 flex items-center gap-1.5" style={{ color: "var(--text-heading)" }}>
            <Link2 size={15} style={{ color: "var(--nav-active-text)" }} /> Interface ERP (AP-4)
          </p>
          <p className="text-[11px] m-0 mt-1" style={{ color: "var(--text-muted)" }}>
            Bank · Branch · Journal Batch ดึงจาก Rocks_ERP_Data (ตาม Company) —
            การตั้งค่านี้เป็นการเตรียมข้อมูลไว้ล่วงหน้า AP-4 ยังไม่มีขั้นตอนส่งเข้า Business Central
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            type="button"
            variant="secondary"
            icon={<RefreshCw size={15} className={refreshing || erpLoading ? "animate-spin" : ""} />}
            onClick={() => void refreshErp()}
            loading={refreshing}
            disabled={rows.length === 0}
          >
            รีเฟรช
          </Button>
        </div>
      </div>

      {loading ? (
        <p className="text-[13px] py-8 text-center" style={{ color: "var(--text-muted)" }}>กำลังโหลด...</p>
      ) : rows.length === 0 ? (
        <p className="text-[13px] py-8 text-center" style={{ color: "var(--text-muted)" }}>
          ยังไม่มีแบรนด์ที่เบิกได้สำหรับ AP-4 (ตั้งค่าที่แท็บ “แบรนด์ที่เบิกได้”)
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((r) => (
            <BrandCard key={r.brandCode} row={r} erpByCompany={erpByCompany} onSaved={load} />
          ))}
        </div>
      )}
    </div>
  );
}
