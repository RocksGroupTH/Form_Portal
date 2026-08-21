"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { CheckCircle2, Circle, Link2, Save, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui";
import { SearchableSelect } from "@/features/accounting/components/settings/SearchableSelect";

interface ConfigRow {
  brandCode: string;
  brandName: string;
  brandLogo: string | null;
  interfaceTarget: string;
  targetFromAp2: boolean;
  bcName: string | null;
  bcConnectionName: string | null;
  bcProfileComplete: boolean;
  environment: string | null;
  branchCode: string | null;
  glAccountNo: string | null;
  bankAccountNo: string | null;
  journalBatchName: string | null;
  ready: boolean;
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

function ReadonlyField({ label, value }: { label: string; value: string | null | undefined }) {
  const empty = !value?.trim() || value === "—";
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-bold uppercase tracking-wide m-0 mb-0.5" style={{ color: "var(--text-faint)" }}>{label}</p>
      <p className="text-[12px] m-0 truncate font-medium"
        style={{ color: empty ? "var(--text-muted)" : "var(--text-primary)" }} title={value ?? ""}>
        {empty ? "—" : value}
      </p>
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] font-bold uppercase tracking-wide mb-1.5" style={{ color: "var(--text-faint)" }}>{children}</p>;
}

function StatusBadge({ ready }: { ready: boolean }) {
  const Icon = ready ? CheckCircle2 : Circle;
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full"
      style={ready
        ? { background: "rgba(79,163,122,0.15)", color: "var(--text-info-green)" }
        : { background: "var(--bg-badge)", color: "var(--text-muted)" }}>
      <Icon size={12} />{ready ? "พร้อมส่ง" : "ยังไม่ครบ"}
    </span>
  );
}

function BrandCard({ row, erpByCompany, onSaved }: {
  row: ConfigRow;
  erpByCompany: Record<string, CompanyErp>;
  onSaved: () => void;
}) {
  // AP-2 owns its target Company + G/L + Bank + Branch + Journal Batch.
  const [targetSel, setTargetSel] = useState(row.interfaceTarget ?? "");
  const [gl, setGl] = useState(row.glAccountNo ?? "");
  const [bank, setBank] = useState(row.bankAccountNo ?? "");
  const [branch, setBranch] = useState(row.branchCode ?? "");
  const [batch, setBatch] = useState(row.journalBatchName ?? "");
  const [busy, setBusy] = useState<string | null>(null);

  // Target Company options = the ERP interface companies that have master data.
  const companyOpts = useMemo(
    () => Object.keys(erpByCompany).sort().map((c) => ({ value: c, label: c })),
    [erpByCompany],
  );

  // Changing the target Company resets the four picks — accounts are
  // company-specific, so a G/L from the old Company must never be saved here.
  function onTargetChange(v: string) {
    if (v === targetSel) return;
    setTargetSel(v);
    setGl(""); setBank(""); setBranch(""); setBatch("");
  }

  // All four dropdowns read from Rocks_ERP_Data (via the erp-master endpoint),
  // keyed by the selected target Company: G/L · Bank · Branch · Journal Batch.
  const target = targetSel;
  const erp = erpByCompany[targetSel];
  const glOpts = useMemo(() => acctOptions(erp?.gl ?? [], gl), [erp, gl]);
  const bankOpts = useMemo(() => acctOptions(erp?.bank ?? [], bank), [erp, bank]);
  const branchOpts = useMemo(() => branchOptions(erp?.branch ?? [], branch), [erp, branch]);
  const batchOpts = useMemo(() => batchOptions(erp?.journalBatch ?? [], batch), [erp, batch]);

  const targetDirty = targetSel.trim() !== (row.interfaceTarget ?? "").trim();
  const glDirty = gl.trim() !== (row.glAccountNo ?? "").trim();
  const bankDirty = bank.trim() !== (row.bankAccountNo ?? "").trim();
  const branchDirty = branch.trim() !== (row.branchCode ?? "").trim();
  const batchDirty = batch.trim() !== (row.journalBatchName ?? "").trim();

  async function saveAll() {
    if (!targetSel.trim()) return toast.error("กรุณาเลือก Company ปลายทาง");
    if (!gl.trim()) return toast.error("กรุณาเลือก G/L Account");
    if (!bank.trim()) return toast.error("กรุณาเลือก Bank Account");
    setBusy("all");
    try {
      const res = await fetch("/api/request/advance/settings/erp-interface", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandCode: row.brandCode,
          interfaceBrandCode: targetSel.trim(),
          glAccountNo: gl.trim(),
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
      setBusy(null);
    }
  }

  const noOpts = !erp;
  const bcLine = [decode(row.bcName), row.bcConnectionName?.trim()].filter((v) => v && v !== "—").join(" · ") || "—";
  const anyDirty = targetDirty || glDirty || bankDirty || branchDirty || batchDirty;

  return (
    <div className="rounded-xl p-4"
      style={{
        background: anyDirty ? "var(--bg-info-yellow)" : "var(--bg-card-alt)",
        border: `1px solid ${anyDirty ? "var(--border-info-yellow)" : row.ready ? "var(--border-info-green)" : "var(--border-card)"}`,
      }}>
      {/* header */}
      <div className="flex items-center gap-3 mb-3">
        {row.brandLogo && (
          <img src={row.brandLogo} alt="" className="h-8 w-auto object-contain shrink-0"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-bold m-0 truncate" style={{ color: "var(--text-heading)" }}>{row.brandName}</p>
          <p className="text-[10px] m-0 font-mono" style={{ color: "var(--text-muted)" }}>
            {row.brandCode} → {target || "—"} · {(row.targetFromAp2 || targetDirty) ? "(AP-2)" : "(จาก AP-1)"}
            {row.environment ? ` · ${row.environment === "Sandbox" ? "UAT" : "PROD"}` : ""}
          </p>
        </div>
        <StatusBadge ready={row.ready} />
      </div>

      {/* AP-2's own target Company (was inherited from AP-1) */}
      <div className="mb-3 pb-3" style={{ borderBottom: "1px solid var(--border-light)" }}>
        <FieldLabel>Company ปลายทาง (AP-2)</FieldLabel>
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

      {/* editable: G/L + Bank + Branch + Journal Batch — one Save button per Company */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="min-w-0">
          <FieldLabel>G/L Account (AP-2)</FieldLabel>
          <SearchableSelect
            value={gl}
            onChange={setGl}
            options={glOpts}
            placeholder={noOpts ? "เลือกปลายทาง / Sync ERP ก่อน" : "— เลือก G/L —"}
            emptyLabel={noOpts ? "เลือกปลายทาง / Sync ERP ก่อน" : "— เลือก G/L —"}
            searchPlaceholder="ค้นหา G/L..."
            triggerBackground="var(--bg-card)"
          />
        </div>
        <div className="min-w-0">
          <FieldLabel>Bank Account (AP-2)</FieldLabel>
          <SearchableSelect value={bank} onChange={setBank} options={bankOpts}
            placeholder={noOpts ? "เลือกปลายทางก่อน" : "— เลือก Bank —"}
            emptyLabel={noOpts ? "เลือกปลายทางก่อน" : "— เลือก Bank —"}
            searchPlaceholder="ค้นหา Bank..." triggerBackground="var(--bg-card)" />
        </div>
        <div className="min-w-0">
          <FieldLabel>Branch (AP-2)</FieldLabel>
          <SearchableSelect value={branch} onChange={setBranch} options={branchOpts}
            placeholder={noOpts ? "เลือกปลายทางก่อน" : "— เลือก Branch —"}
            emptyLabel={noOpts ? "เลือกปลายทางก่อน" : "— เลือก Branch —"}
            searchPlaceholder="ค้นหา Branch..." triggerBackground="var(--bg-card)" />
        </div>
        <div className="min-w-0">
          <FieldLabel>Journal Batch (AP-2)</FieldLabel>
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
          AP-2 กำหนดเอง: Company ปลายทาง · G/L · Bank · Branch · Journal Batch
        </p>
        <Button variant="primary" icon={<Save size={15} />} onClick={saveAll}
          loading={busy === "all"} disabled={!anyDirty}>บันทึก</Button>
      </div>
    </div>
  );
}

export function AdvanceErpInterfaceSettings() {
  const [rows, setRows] = useState<ConfigRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/request/advance/settings/erp-interface")
      .then((r) => r.json())
      .then((j: { ok: boolean; data?: ConfigRow[] }) => setRows(j.ok && j.data ? j.data : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => load(), [load]);

  // G/L · Bank · Branch · Journal Batch — read straight from Rocks_ERP_Data
  // (4 Erp* tables), keyed by Company (interface target).
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
            <Link2 size={15} style={{ color: "var(--nav-active-text)" }} /> Interface ERP (AP-2)
          </p>
          <p className="text-[11px] m-0 mt-1" style={{ color: "var(--text-muted)" }}>
            G/L · Bank · Branch · Journal Batch ดึงจาก Rocks_ERP_Data (ตาม Company) — Company ใช้ร่วมกับ AP-1
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
          ยังไม่มีแบรนด์ที่ map Company (ตั้งค่าที่ Accounting → Interface ERP)
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
