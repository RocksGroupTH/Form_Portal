"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import useSWR from "swr";

import { Layers, Loader2, Pencil, Save, Upload, X } from "lucide-react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeaderBar } from "@/components/layout/PageHeaderBar";
import { toast } from "sonner";
import { APP_DB_CONNECTION_ID } from "@/lib/db/app-connection";
import { BrandMark } from "@/components/BrandMark";

import {
  SearchableSelect,
  type SearchableSelectOption,
} from "@/features/accounting/components/settings/SearchableSelect";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface BrandConfigRow {
  brandCode: string;
  brandName: string;
  brandLogo: string | null;
  /** This app's own switch (BrandSetting), not BrandConfig.IsActive. */
  isEnabled: boolean;
  /** True when `brandLogo` is an uploaded one, so it can be removed. */
  hasUploadedLogo: boolean;
  bcId: string | null;
  bcName: string | null;
  bcConnectionId: number | null;
  bcConnectionName: string | null;
  dbConnectionId: number | null;
  dbConnectionCode: string | null;
  dbConnectionName: string | null;
  databaseName: string | null;
  dashboardDbConnectionId: number | null;
  dashboardDbConnectionCode: string | null;
  dashboardDbConnectionName: string | null;
  dashboardDatabaseName: string | null;
  isActive: boolean;
}

interface LookupItem {
  id: number;
  code: string;
  name: string;
}

/**
 * The two `dashboard*` fields are no longer editable here — the Master Dashboard
 * they configured lives in the Rocks Fast app, which still reads these columns.
 * They are carried through read → state → save untouched so a save from this
 * page cannot blank them out (`updateBrandConfig` always writes
 * `DashboardDbConnectionId`, so omitting it would NULL the column).
 */
type FormState = {
  bcId: string;
  bcName: string;
  bcConnectionId: string;
  dbConnectionId: string;
  databaseName: string;
  dashboardDbConnectionId: string;
  dashboardDatabaseName: string;
};

const inputCls = "w-full rounded-lg px-3 py-2 text-[12px] outline-none";
const inputStyle = {
  background: "var(--bg-input)",
  color: "var(--text-primary)",
  border: "1px solid var(--border-input)",
};

function formFromRow(c: BrandConfigRow): FormState {
  return {
    bcId: c.bcId ?? "",
    bcName: c.bcName ?? "",
    bcConnectionId: c.bcConnectionId != null ? String(c.bcConnectionId) : "",
    dbConnectionId: c.dbConnectionId != null ? String(c.dbConnectionId) : "",
    databaseName: c.databaseName ?? "",
    dashboardDbConnectionId:
      c.dashboardDbConnectionId != null ? String(c.dashboardDbConnectionId) : "",
    dashboardDatabaseName: c.dashboardDatabaseName ?? "",
  };
}

function hasDbServerSelected(dbConnectionId: string): boolean {
  return dbConnectionId !== "";
}

function connectionOptions(items: LookupItem[]): SearchableSelectOption[] {
  return items.map((x) => ({
    value: String(x.id),
    label: `[${x.id}] ${x.code} — ${x.name}`,
  }));
}

function databaseOptions(names: string[], current?: string): SearchableSelectOption[] {
  const seen = new Set<string>();
  const out: SearchableSelectOption[] = [];
  for (const name of names) {
    if (!seen.has(name)) {
      seen.add(name);
      out.push({ value: name, label: name });
    }
  }
  if (current && !seen.has(current)) {
    out.push({ value: current, label: current });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

type GroupKey = "bc" | "erp";

interface GroupStatus {
  key: GroupKey;
  label: string;
  complete: boolean;
  missing: string[];
}

function getBcGroupStatus(bcId: string | null | undefined, bcName: string | null | undefined): GroupStatus {
  const missing: string[] = [];
  if (!bcId?.trim()) missing.push("Id");
  if (!bcName?.trim()) missing.push("Name");
  return { key: "bc", label: "Config BC", complete: missing.length === 0, missing };
}

function getErpGroupStatus(
  dbConnectionId: number | string | null | undefined,
  databaseName: string | null | undefined,
): GroupStatus {
  const missing: string[] = [];
  const hasServer =
    typeof dbConnectionId === "string"
      ? hasDbServerSelected(dbConnectionId)
      : dbConnectionId != null;
  if (!hasServer) missing.push("SQL Server");
  if (!databaseName?.trim()) missing.push("Database");
  return { key: "erp", label: "Config Server (ERP)", complete: missing.length === 0, missing };
}

function getGroupStatusesFromRow(c: BrandConfigRow): GroupStatus[] {
  return [
    getBcGroupStatus(c.bcId, c.bcName),
    getErpGroupStatus(c.dbConnectionId, c.databaseName),
  ];
}

function getGroupStatusesFromForm(form: FormState): GroupStatus[] {
  return [
    getBcGroupStatus(form.bcId, form.bcName),
    getErpGroupStatus(form.dbConnectionId, form.databaseName),
  ];
}

function getConfigStatus(c: BrandConfigRow): { complete: boolean; groups: GroupStatus[] } {
  const groups = getGroupStatusesFromRow(c);
  return { complete: groups.every((g) => g.complete), groups };
}

function BrandConfigCard({
  config,
  onEdit,
  onToggleEnabled,
  toggling,
}: {
  config: BrandConfigRow;
  onEdit: () => void;
  onToggleEnabled: (next: boolean) => void;
  toggling: boolean;
}) {
  const st = getConfigStatus(config);

  return (
    <div
      className="rounded-xl p-4 flex flex-col gap-3 transition-shadow hover:shadow-md"
      style={{
        background: "var(--bg-card)",
        border: `1px solid ${st.complete ? "var(--border-info-green)" : "var(--border-card)"}`,
        boxShadow: "var(--shadow-sm)",
        // Dimmed rather than hidden: this page is where a brand is turned back
        // on, so it has to stay visible and legible while off.
        opacity: config.isEnabled ? 1 : 0.55,
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div
          className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: "var(--bg-card-alt)", border: "1px solid var(--border-card)" }}
        >
          <BrandMark src={config.brandLogo} alt={config.brandName} code={config.brandCode} size={36} rounded="rounded" />
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          {st.groups.map((g) => (
            <GroupStatusBadge key={g.key} status={g} short />
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-[14px] font-bold" style={{ color: "var(--text-heading)" }}>{config.brandName}</h3>
        <p className="text-[11px] font-mono mt-0.5" style={{ color: "var(--text-muted)" }}>{config.brandCode}</p>
      </div>

      {/* The switch acts immediately — it writes one boolean to this app's own
          BrandSetting row, not to the shared BrandConfig the Save button below
          edits, so folding it into that form would tie a quick toggle to a
          whole BC configuration. */}
      <label className="flex items-center justify-between gap-2 cursor-pointer">
        <span className="text-[12px] font-medium" style={{ color: "var(--text-secondary)" }}>
          {config.isEnabled ? "เปิดใช้งาน" : "ปิดอยู่"}
        </span>
        <span className="flex items-center gap-1.5">
          {toggling && <Loader2 size={12} className="animate-spin" style={{ color: "var(--text-muted)" }} />}
          <input
            type="checkbox"
            role="switch"
            checked={config.isEnabled}
            disabled={toggling}
            onChange={(e) => onToggleEnabled(e.target.checked)}
            aria-label={`เปิดใช้งานแบรนด์ ${config.brandName}`}
            className="cursor-pointer"
            style={{ width: 34, height: 18, accentColor: "var(--color-action)" }}
          />
        </span>
      </label>

      {!st.complete && (
        <div className="flex flex-col gap-1">
          {st.groups
            .filter((g) => !g.complete)
            .map((g) => (
              <p key={g.key} className="text-[10px] leading-snug" style={{ color: "var(--text-muted)" }}>
                <span className="font-medium">{g.label}:</span> {g.missing.join(", ")}
              </p>
            ))}
        </div>
      )}

      <button
        type="button"
        onClick={onEdit}
        className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold cursor-pointer border-none mt-auto"
        style={{
          background: st.complete ? "var(--bg-badge)" : "var(--color-action)",
          color: st.complete ? "var(--text-secondary)" : "#fff",
        }}
      >
        <Pencil size={13} />
        {st.complete ? "Edit" : "Configure"}
      </button>
    </div>
  );
}

const GROUP_SHORT: Record<GroupKey, string> = {
  bc: "BC",
  erp: "ERP",
};

function GroupStatusBadge({ status, short }: { status: GroupStatus; short?: boolean }) {
  const title = status.complete
    ? `${status.label} — complete`
    : `${status.label} — missing: ${status.missing.join(", ")}`;
  const text = short
    ? status.complete
      ? `${GROUP_SHORT[status.key]} ✓`
      : GROUP_SHORT[status.key]
    : status.complete
      ? "Complete"
      : "Incomplete";

  if (status.complete) {
    return (
      <span
        className="text-[10px] px-2 py-0.5 rounded-full whitespace-nowrap"
        style={{
          background: "var(--bg-info-green)",
          color: "var(--text-info-green)",
          border: "1px solid var(--border-info-green)",
        }}
        title={title}
      >
        {text}
      </span>
    );
  }
  return (
    <span
      className="text-[10px] px-2 py-0.5 rounded-full cursor-help whitespace-nowrap"
      style={{
        background: "rgba(202, 138, 4, 0.12)",
        color: "#b45309",
        border: "1px solid rgba(202, 138, 4, 0.35)",
      }}
      title={title}
    >
      {text}
    </span>
  );
}

function SectionHeader({ status }: { status: GroupStatus }) {
  return (
    <div className="flex items-center justify-between gap-2 mb-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
        {status.label}
      </p>
      <GroupStatusBadge status={status} />
    </div>
  );
}

function SqlServerSection({
  status,
  connectionId,
  databaseName,
  dbConnections,
  dbList,
  dbLoading,
  onConnectionChange,
  onDatabaseChange,
}: {
  status: GroupStatus;
  connectionId: string;
  databaseName: string;
  dbConnections: LookupItem[];
  dbList: string[];
  dbLoading: boolean;
  onConnectionChange: (id: string) => void;
  onDatabaseChange: (name: string) => void;
}) {
  return (
    <div>
      <SectionHeader status={status} />
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>SQL Server</span>
          <SearchableSelect
            value={connectionId}
            onChange={onConnectionChange}
            options={connectionOptions(dbConnections)}
            placeholder="— Select server —"
            emptyLabel="— Select server —"
            searchPlaceholder="ค้นหา server..."
            triggerBackground="var(--bg-input)"
          />
          {connectionId === String(APP_DB_CONNECTION_ID) && (
            <p className="text-[10px] leading-snug" style={{ color: "var(--text-muted)" }}>
              App server from <span className="font-mono">MSSQL_HOST</span> in .env — not editable here
            </p>
          )}
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>Database</span>
          <SearchableSelect
            value={databaseName}
            onChange={onDatabaseChange}
            options={databaseOptions(dbList, databaseName)}
            placeholder={
              dbLoading
                ? "Loading…"
                : hasDbServerSelected(connectionId)
                  ? "— Select database —"
                  : "Select server first"
            }
            emptyLabel={
              dbLoading
                ? "Loading…"
                : hasDbServerSelected(connectionId)
                  ? "— Select database —"
                  : "Select server first"
            }
            searchPlaceholder="ค้นหา database..."
            triggerBackground="var(--bg-input)"
            disabled={!hasDbServerSelected(connectionId) || dbLoading}
          />
        </label>
      </div>
    </div>
  );
}

function BrandConfigModal({
  brand,
  form,
  dbConnections,
  bcConnections,
  erpDbList,
  erpDbLoading,
  saving,
  onChange,
  onErpServerChange,
  onSave,
  onClose,
  onLogoChanged,
}: {
  brand: BrandConfigRow;
  form: FormState;
  dbConnections: LookupItem[];
  bcConnections: LookupItem[];
  erpDbList: string[];
  erpDbLoading: boolean;
  saving: boolean;
  onChange: (f: FormState) => void;
  onErpServerChange: (connectionId: string) => void;
  onSave: () => void;
  onClose: () => void;
  /** Refetch after an upload or a removal — the URL carries a cache buster. */
  onLogoChanged: () => Promise<unknown>;
}) {
  const set = (key: keyof FormState, value: string) => onChange({ ...form, [key]: value });
  const [bcStatus, erpStatus] = getGroupStatusesFromForm(form);
  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const [logoBusy, setLogoBusy] = useState(false);

  // The upload is its own request, applied at once, not folded into Save. Save
  // writes the shared Fast_Core config row; the logo is this app's own, and a
  // picture the admin has just chosen should appear immediately rather than
  // waiting on a form they may still be filling in.
  const uploadLogo = async (file: File) => {
    setLogoBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/settings/brand-config/${brand.brandCode}/logo`, {
        method: "POST",
        body: fd,
      });
      const json = await res.json().catch(() => null);
      if (!json?.ok) {
        // The server's own reason: "แนบได้เฉพาะไฟล์รูปภาพเท่านั้น", a size
        // refusal, and so on. A generic message here would send somebody
        // hunting for a problem the answer already named.
        toast.error(json?.error ?? "อัปโหลดโลโก้ไม่สำเร็จ");
        return;
      }
      toast.success("อัปโหลดโลโก้แล้ว");
      await onLogoChanged();
    } catch {
      toast.error("อัปโหลดโลโก้ไม่สำเร็จ");
    } finally {
      setLogoBusy(false);
      if (logoInputRef.current) logoInputRef.current.value = "";
    }
  };

  const removeLogo = async () => {
    setLogoBusy(true);
    try {
      const res = await fetch(`/api/settings/brand-config/${brand.brandCode}/logo`, {
        method: "DELETE",
      });
      const json = await res.json().catch(() => null);
      if (!json?.ok) {
        toast.error(json?.error ?? "ลบโลโก้ไม่สำเร็จ");
        return;
      }
      toast.success("ลบโลโก้แล้ว");
      await onLogoChanged();
    } catch {
      toast.error("ลบโลโก้ไม่สำเร็จ");
    } finally {
      setLogoBusy(false);
    }
  };

  return (
    <div className="app-overlay fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="rounded-2xl w-[480px] max-w-full max-h-[90vh] flex flex-col overflow-hidden"
        style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)", boxShadow: "var(--shadow-modal)" }}
      >
        <div className="px-5 py-4 shrink-0 flex items-center gap-3" style={{ borderBottom: "1px solid var(--border-card)" }}>
          <BrandMark src={brand.brandLogo} alt={brand.brandName} code={brand.brandCode} size={32} rounded="rounded" />
          <div className="flex-1 min-w-0">
            <h2 className="text-[15px] font-bold" style={{ color: "var(--text-heading)" }}>{brand.brandName}</h2>
            <p className="text-[11px] font-mono" style={{ color: "var(--text-muted)" }}>{brand.brandCode}</p>
          </div>
          <button type="button" onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center border-none cursor-pointer" style={{ background: "var(--bg-badge)", color: "var(--text-muted)" }}>
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-4 flex flex-col gap-4 overflow-y-auto">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide mb-2" style={{ color: "var(--text-muted)" }}>
              โลโก้
            </p>
            <div className="flex items-center gap-3">
              <div
                className="w-14 h-14 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: "var(--bg-card-alt)", border: "1px solid var(--border-card)" }}
              >
                <BrandMark
                  src={brand.brandLogo}
                  alt={brand.brandName}
                  code={brand.brandCode}
                  size={40}
                  rounded="rounded"
                />
              </div>
              <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <input
                    ref={logoInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void uploadLogo(f);
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => logoInputRef.current?.click()}
                    disabled={logoBusy}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold cursor-pointer border-none disabled:opacity-60"
                    style={{ background: "var(--bg-badge)", color: "var(--text-secondary)" }}
                  >
                    {logoBusy ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                    {brand.hasUploadedLogo ? "เปลี่ยนโลโก้" : "อัปโหลดโลโก้"}
                  </button>
                  {brand.hasUploadedLogo && (
                    <button
                      type="button"
                      onClick={() => void removeLogo()}
                      disabled={logoBusy}
                      className="px-3 py-1.5 rounded-lg text-[12px] font-semibold cursor-pointer border-none disabled:opacity-60"
                      style={{ background: "var(--btn-danger-bg)", color: "var(--btn-danger-text)" }}
                    >
                      ลบ
                    </button>
                  )}
                </div>
                <p className="text-[10px] leading-snug m-0" style={{ color: "var(--text-muted)" }}>
                  {brand.hasUploadedLogo
                    ? "ใช้โลโก้ที่อัปโหลดไว้ · ลบแล้วจะกลับไปใช้ไฟล์ในระบบถ้ามี"
                    : "ยังไม่มีโลโก้ที่อัปโหลด — ตอนนี้ใช้ไฟล์ในระบบหรือแสดงเป็นตัวย่อ"}
                </p>
              </div>
            </div>
          </div>

          <div>
            <SectionHeader status={bcStatus} />
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>Id</span>
                <input value={form.bcId} onChange={(e) => set("bcId", e.target.value)} className={inputCls} style={inputStyle} placeholder="BC Company Id" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>Name</span>
                <input value={form.bcName} onChange={(e) => set("bcName", e.target.value)} className={inputCls} style={inputStyle} placeholder="BC Company Name" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>BC Connection</span>
                <SearchableSelect
                  value={form.bcConnectionId}
                  onChange={(v) => set("bcConnectionId", v)}
                  options={connectionOptions(bcConnections)}
                  placeholder="— Select BC connection —"
                  emptyLabel="— Select BC connection —"
                  searchPlaceholder="ค้นหา connection..."
                  triggerBackground="var(--bg-input)"
                />
              </label>
            </div>
          </div>

          <div className="pt-1" style={{ borderTop: "1px solid var(--border-card)" }}>
          <SqlServerSection
            status={erpStatus}
            connectionId={form.dbConnectionId}
            databaseName={form.databaseName}
            dbConnections={dbConnections}
            dbList={erpDbList}
            dbLoading={erpDbLoading}
            onConnectionChange={onErpServerChange}
            onDatabaseChange={(name) => set("databaseName", name)}
          />
          </div>
        </div>

        <div className="flex gap-2 px-5 py-3 shrink-0" style={{ borderTop: "1px solid var(--border-card)", background: "var(--bg-card-alt)" }}>
          <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg text-[12px] font-medium cursor-pointer border-none" style={{ background: "var(--bg-badge)", color: "var(--text-secondary)" }}>Cancel</button>
          <button type="button" onClick={onSave} disabled={saving} className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-bold cursor-pointer border-none text-white ml-auto" style={{ background: "var(--btn-primary-bg)", color: "var(--btn-primary-text)", border: "1px solid var(--btn-primary-border)" }}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

export default function BrandConfigPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const isAdmin =
    session?.user?.role === "IT Admin" || session?.user?.role === "System Admin";

  const { data, mutate, isLoading } = useSWR<{
    ok: boolean;
    data: {
      configs: BrandConfigRow[];
      lookups: { dbConnections: LookupItem[]; bcConnections: LookupItem[] };
    };
  }>("/api/settings/brand-config", fetcher);

  const [togglingCode, setTogglingCode] = useState<string | null>(null);

  /**
   * Turn a brand on or off.
   *
   * Its own endpoint, and its own `mutate()`: this writes
   * `Rocks_Portal_Form.dbo.BrandSetting`, while the Save button in the dialog
   * writes the shared `Fast_Core.dbo.BrandConfig` row. No optimistic update —
   * the switch governs who can work under a brand, so it should read the
   * server's answer rather than its own guess.
   */
  const toggleEnabled = useCallback(
    async (row: BrandConfigRow, next: boolean) => {
      setTogglingCode(row.brandCode);
      try {
        const res = await fetch(`/api/settings/brand-config/${row.brandCode}/enabled`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isEnabled: next }),
        });
        const json = await res.json().catch(() => null);
        if (!json?.ok) {
          toast.error(json?.error ?? "บันทึกไม่สำเร็จ");
          return;
        }
        toast.success(next ? `เปิดใช้งาน ${row.brandName}` : `ปิด ${row.brandName}`);
        await mutate();
      } catch {
        toast.error("บันทึกไม่สำเร็จ");
      } finally {
        setTogglingCode(null);
      }
    },
    [mutate],
  );

  const [editing, setEditing] = useState<BrandConfigRow | null>(null);
  const [form, setForm] = useState<FormState>({
    bcId: "",
    bcName: "",
    bcConnectionId: "",
    dbConnectionId: "",
    databaseName: "",
    dashboardDbConnectionId: "",
    dashboardDatabaseName: "",
  });
  const [erpDbList, setErpDbList] = useState<string[]>([]);
  const [erpDbLoading, setErpDbLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const configs = data?.data?.configs ?? [];
  const dbConnections = data?.data?.lookups?.dbConnections ?? [];
  const bcConnections = data?.data?.lookups?.bcConnections ?? [];
  const completeCount = configs.filter((c) => getConfigStatus(c).complete).length;
  const incompleteCount = configs.length - completeCount;

  useEffect(() => {
    if (status === "authenticated" && !isAdmin) router.replace("/");
  }, [status, isAdmin, router]);

  const loadDatabases = useCallback(async (connectionId: string) => {
    if (!connectionId) {
      setErpDbList([]);
      return;
    }
    setErpDbLoading(true);
    try {
      const res = await fetch(`/api/settings/connections/${connectionId}/databases`);
      const json = await res.json();
      if (json.ok) {
        setErpDbList((json.data as { databases: string[] }).databases);
      } else {
        toast.error(json.error ?? "Failed to load databases");
        setErpDbList([]);
      }
    } finally {
      setErpDbLoading(false);
    }
  }, []);

  const openEdit = (c: BrandConfigRow) => {
    setForm(formFromRow(c));
    setEditing(c);
    if (c.dbConnectionId != null) {
      void loadDatabases(String(c.dbConnectionId));
    } else {
      setErpDbList([]);
    }
  };

  const handleErpServerChange = (connectionId: string) => {
    setForm((prev) => ({ ...prev, dbConnectionId: connectionId, databaseName: "" }));
    void loadDatabases(connectionId);
  };

  const handleSave = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/settings/brand-config/${editing.brandCode}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bcId: form.bcId || null,
          bcName: form.bcName || null,
          bcConnectionId: form.bcConnectionId ? Number(form.bcConnectionId) : null,
          dbConnectionId: hasDbServerSelected(form.dbConnectionId) ? Number(form.dbConnectionId) : null,
          databaseName: hasDbServerSelected(form.dbConnectionId) ? form.databaseName || null : null,
          // Not editable here — echoed back exactly as the API returned them so
          // Rocks Fast's Master Dashboard config survives a save from this page.
          dashboardDbConnectionId: form.dashboardDbConnectionId
            ? Number(form.dashboardDbConnectionId)
            : null,
          dashboardDatabaseName: form.dashboardDatabaseName || null,
        }),
      });
      const json = await res.json();
      if (json.ok) {
        toast.success(`${editing.brandCode} saved`);
        setEditing(null);
        mutate();
      } else {
        toast.error(json.error ?? "Save failed");
      }
    } finally {
      setSaving(false);
    }
  };

  if (status === "loading" || (status === "authenticated" && !isAdmin)) {
    return (
      <PageContainer className="py-12 flex justify-center">
        <Loader2 size={24} className="animate-spin" style={{ color: "var(--text-muted)" }} />
      </PageContainer>
    );
  }

  return (
    <PageContainer className="py-6 px-3 sm:px-0">
      <PageHeaderBar
        icon={Layers}
        title="Brand Configuration"
        subtitle="Configure BC and ERP SQL for each brand"
        backHref="/settings"
      />

      {!isLoading && configs.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          <span className="text-[11px] px-2.5 py-1 rounded-full" style={{ background: "var(--bg-info-green)", color: "var(--text-info-green)", border: "1px solid var(--border-info-green)" }}>
            {completeCount} complete
          </span>
          <span className="text-[11px] px-2.5 py-1 rounded-full" style={{ background: "rgba(202, 138, 4, 0.12)", color: "#b45309", border: "1px solid rgba(202, 138, 4, 0.35)" }}>
            {incompleteCount} incomplete
          </span>
        </div>
      )}

      {isLoading ? (
        <div className="py-12 flex justify-center">
          <Loader2 size={24} className="animate-spin" style={{ color: "var(--text-muted)" }} />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {configs.map((c) => (
            <BrandConfigCard
              key={c.brandCode}
              config={c}
              onEdit={() => openEdit(c)}
              onToggleEnabled={(next) => void toggleEnabled(c, next)}
              toggling={togglingCode === c.brandCode}
            />
          ))}
        </div>
      )}

      {editing && (
        <BrandConfigModal
          brand={editing}
          form={form}
          dbConnections={dbConnections}
          bcConnections={bcConnections}
          erpDbList={erpDbList}
          erpDbLoading={erpDbLoading}
          saving={saving}
          onChange={setForm}
          onErpServerChange={handleErpServerChange}
          onSave={handleSave}
          onClose={() => setEditing(null)}
          onLogoChanged={async () => {
            const next = await mutate();
            // Keep the open dialog's header in step with the new logo.
            const fresh = next?.data?.configs.find((c) => c.brandCode === editing.brandCode);
            if (fresh) setEditing(fresh);
          }}
        />
      )}
    </PageContainer>
  );
}
