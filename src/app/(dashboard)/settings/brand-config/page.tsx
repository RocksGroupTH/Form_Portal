"use client";

import { useState, useEffect, useCallback } from "react";
import useSWR from "swr";
import Image from "next/image";
import { Layers, Loader2, Pencil, Save, X } from "lucide-react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeaderBar } from "@/components/layout/PageHeaderBar";
import { toast } from "sonner";
import { APP_DB_CONNECTION_ID } from "@/lib/db/app-connection";
import {
  SearchableSelect,
  type SearchableSelectOption,
} from "@/features/accounting/components/settings/SearchableSelect";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface BrandConfigRow {
  brandCode: string;
  brandName: string;
  brandLogo: string;
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
}: {
  config: BrandConfigRow;
  onEdit: () => void;
}) {
  const st = getConfigStatus(config);

  return (
    <div
      className="rounded-xl p-4 flex flex-col gap-3 transition-shadow hover:shadow-md"
      style={{
        background: "var(--bg-card)",
        border: `1px solid ${st.complete ? "var(--border-info-green)" : "var(--border-card)"}`,
        boxShadow: "var(--shadow-sm)",
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div
          className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: "var(--bg-card-alt)", border: "1px solid var(--border-card)" }}
        >
          <Image src={config.brandLogo} alt={config.brandName} width={36} height={36} className="rounded object-contain" />
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
}) {
  const set = (key: keyof FormState, value: string) => onChange({ ...form, [key]: value });
  const [bcStatus, erpStatus] = getGroupStatusesFromForm(form);

  return (
    <div className="app-overlay fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="rounded-2xl w-[480px] max-w-full max-h-[90vh] flex flex-col overflow-hidden"
        style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)", boxShadow: "var(--shadow-modal)" }}
      >
        <div className="px-5 py-4 shrink-0 flex items-center gap-3" style={{ borderBottom: "1px solid var(--border-card)" }}>
          <Image src={brand.brandLogo} alt={brand.brandName} width={32} height={32} className="rounded object-contain" />
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
          <button type="button" onClick={onSave} disabled={saving} className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-bold cursor-pointer border-none text-white ml-auto" style={{ background: "var(--color-action)" }}>
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
            <BrandConfigCard key={c.brandCode} config={c} onEdit={() => openEdit(c)} />
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
        />
      )}
    </PageContainer>
  );
}
