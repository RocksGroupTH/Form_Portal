"use client";

import { useState, useEffect } from "react";
import useSWR from "swr";
import {
  Plus,
  Pencil,
  Trash2,
  Server,
  PlugZap,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Loader2,
} from "lucide-react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeaderBar } from "@/components/layout/PageHeaderBar";
import { toast } from "sonner";
import { SettingOption, SettingOptionGroup } from "@/components/settings/SettingOption";
import { validateConnectionCode } from "@/lib/db/connection-code";
import { formatHostPort, parseDatabaseInput } from "@/lib/db/sql-port";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface Connection {
  id: number;
  code: string;
  name: string;
  host: string;
  port: number;
  databaseName: string | null;
  username: string;
  hasPassword: boolean;
  encrypt: boolean;
  trustServerCert: boolean;
  purpose: string | null;
  isActive: boolean;
  lastTestAt: string | null;
  lastTestOk: boolean | null;
  lastTestMessage: string | null;
}

interface AppMssqlInfo {
  host: string;
  port: number;
  coreDatabase: string;
  formDatabase: string;
  dataDatabase: string;
}

interface FormState {
  code: string;
  name: string;
  host: string;
  port: string;
  databaseName: string;
  username: string;
  password: string;
  purpose: string;
  encrypt: boolean;
  trustServerCert: boolean;
  isActive: boolean;
}

const inputCls =
  "w-full rounded-lg px-3 py-2 text-[12px] outline-none";
const inputStyle = {
  background: "var(--bg-input)",
  color: "var(--text-primary)",
  border: "1px solid var(--border-input)",
};

/** 0 = default instance (no port in connection string) */
function parsePortInput(value: string): number {
  if (value.trim() === "") return 1433;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 1433;
}

const emptyForm = (): FormState => ({
  code: "",
  name: "",
  host: "",
  port: "1433",
  databaseName: "",
  username: "",
  password: "",
  purpose: "",
  encrypt: true,
  trustServerCert: true,
  isActive: true,
});

function formFromConnection(c: Connection): FormState {
  return {
    code: c.code,
    name: c.name,
    host: c.host,
    port: String(c.port),
    databaseName: c.databaseName ?? "",
    username: c.username,
    password: "",
    purpose: c.purpose ?? "",
    encrypt: c.encrypt,
    trustServerCert: c.trustServerCert,
    isActive: c.isActive,
  };
}

function hasConnectionFormChanges(form: FormState, original: Connection | null, isEdit: boolean): boolean {
  if (!isEdit || !original) return true;
  if (form.code.trim().toUpperCase() !== original.code) return true;
  if (form.name !== original.name) return true;
  if (form.host !== original.host) return true;
  if (parsePortInput(form.port) !== original.port) return true;
  if (parseDatabaseInput(form.databaseName) !== (original.databaseName ?? null)) return true;
  if (form.username !== original.username) return true;
  if ((form.purpose || null) !== (original.purpose ?? null)) return true;
  if (form.encrypt !== original.encrypt) return true;
  if (form.trustServerCert !== original.trustServerCert) return true;
  if (form.isActive !== original.isActive) return true;
  if (form.password.trim()) return true;
  return false;
}

function formToBody(form: FormState, isEdit: boolean) {
  const body: Record<string, unknown> = {
    code: form.code.trim().toUpperCase(),
    name: form.name,
    host: form.host,
    port: parsePortInput(form.port),
    databaseName: parseDatabaseInput(form.databaseName),
    username: form.username,
    encrypt: form.encrypt,
    trustServerCert: form.trustServerCert,
    purpose: form.purpose || null,
    isActive: form.isActive,
  };
  if (form.password || !isEdit) body.password = form.password;
  return body;
}

function ConfirmModal({
  title,
  message,
  danger,
  confirmPhrase,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  danger?: boolean;
  confirmPhrase?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [typed, setTyped] = useState("");

  useEffect(() => {
    setTyped("");
  }, [confirmPhrase, title]);

  const canConfirm = !confirmPhrase || typed.trim() === confirmPhrase;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center" style={{ background: "var(--overlay-bg)" }}>
      <div
        className="rounded-2xl w-[400px] max-w-[90vw] overflow-hidden"
        style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)", boxShadow: "var(--shadow-modal)" }}
      >
        <div className="px-5 py-4">
          <h3 className="text-[14px] font-bold mb-2" style={{ color: "var(--text-heading)" }}>{title}</h3>
          <p className="text-[12px] mb-3" style={{ color: "var(--text-muted)" }}>{message}</p>
          {confirmPhrase && (
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>
                Type <span className="font-mono font-semibold" style={{ color: "var(--text-primary)" }}>{confirmPhrase}</span> to confirm
              </span>
              <input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                className={inputCls}
                style={inputStyle}
                placeholder={confirmPhrase}
                autoComplete="off"
                autoFocus
              />
            </label>
          )}
        </div>
        <div
          className="flex gap-2 px-5 py-3"
          style={{ borderTop: "1px solid var(--border-card)", background: "var(--bg-card-alt)" }}
        >
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 px-3 py-2 rounded-lg text-[12px] font-medium cursor-pointer"
            style={{ background: "var(--bg-badge)", color: "var(--text-secondary)", border: "none" }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!canConfirm}
            className="flex-1 px-3 py-2 rounded-lg text-[12px] font-bold cursor-pointer border-none text-white disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: danger ? "var(--color-danger)" : "var(--color-action)" }}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

function ConnectionFormModal({
  title,
  form,
  isEdit,
  saving,
  testing,
  saveTestStatus,
  onChange,
  onSave,
  onTest,
  onClose,
}: {
  title: string;
  form: FormState;
  isEdit: boolean;
  saving: boolean;
  testing: boolean;
  saveTestStatus: { ok: boolean; message: string } | null;
  onChange: (f: FormState) => void;
  onSave: () => void;
  onTest: () => void;
  onClose: () => void;
}) {
  const set = (key: keyof FormState, value: string | boolean) =>
    onChange({ ...form, [key]: value });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "var(--overlay-bg)" }}>
      <div
        className="rounded-2xl w-[520px] max-w-full max-h-[90vh] flex flex-col overflow-hidden"
        style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)", boxShadow: "var(--shadow-modal)" }}
      >
        <div className="px-5 py-4 shrink-0" style={{ borderBottom: "1px solid var(--border-card)" }}>
          <h2 className="text-[15px] font-bold" style={{ color: "var(--text-heading)" }}>{title}</h2>
        </div>
        <div className="px-5 py-4 flex flex-col gap-3 overflow-y-auto">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>Code *</span>
            <input
              value={form.code}
              onChange={(e) => set("code", e.target.value.toUpperCase())}
              className={inputCls}
              style={{ ...inputStyle, fontFamily: "monospace" }}
              placeholder="ROCKS_PC"
              autoComplete="off"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>Name *</span>
            <input value={form.name} onChange={(e) => set("name", e.target.value)} className={inputCls} style={inputStyle} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 col-span-2 sm:col-span-1">
              <span className="text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>Host *</span>
              <input value={form.host} onChange={(e) => set("host", e.target.value)} className={inputCls} style={inputStyle} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>Port</span>
              <input
                value={form.port}
                onChange={(e) => set("port", e.target.value)}
                className={inputCls}
                style={inputStyle}
                placeholder="1433 (0 = no port)"
              />
            </label>
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>Database</span>
            <input
              value={form.databaseName}
              onChange={(e) => set("databaseName", e.target.value)}
              className={inputCls}
              style={inputStyle}
              placeholder="optional (empty or - = server default)"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>Username *</span>
            <input value={form.username} onChange={(e) => set("username", e.target.value)} className={inputCls} style={inputStyle} autoComplete="off" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>
              Password {isEdit ? "(leave blank to keep)" : "*"}
            </span>
            <input type="password" value={form.password} onChange={(e) => set("password", e.target.value)} className={inputCls} style={inputStyle} autoComplete="new-password" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>Purpose</span>
            <input value={form.purpose} onChange={(e) => set("purpose", e.target.value)} className={inputCls} style={inputStyle} />
          </label>
          <SettingOptionGroup
            title="ตัวเลือกการเชื่อมต่อ"
            description="การตั้งค่า TLS และสถานะ connection"
          >
            <SettingOption
              checked={form.encrypt}
              onChange={(v) => set("encrypt", v)}
              label="Encrypt (TLS)"
              description="เข้ารหัสการเชื่อมต่อระหว่างแอปกับ SQL Server — แนะนำสำหรับ production และ Azure SQL"
            />
            <SettingOption
              checked={form.trustServerCert}
              onChange={(v) => set("trustServerCert", v)}
              label="Trust server certificate"
              description="ยอมรับ certificate ที่ไม่ผ่านการตรวจสอบ — ใช้เมื่อ dev หรือ self-signed cert"
            />
            {isEdit && (
              <SettingOption
                checked={form.isActive}
                onChange={(v) => set("isActive", v)}
                label="เปิดใช้งาน"
                description="ปิดเพื่อเก็บ connection ไว้โดยไม่ลบ — ระบบจะไม่อ้างอิง connection นี้"
              />
            )}
          </SettingOptionGroup>
        </div>
        <div
          className="flex flex-col gap-2 px-5 py-3 shrink-0"
          style={{ borderTop: "1px solid var(--border-card)", background: "var(--bg-card-alt)" }}
        >
          {saving && testing && !saveTestStatus && (
            <p className="text-[11px] text-right" style={{ color: "var(--text-muted)" }}>Testing connection…</p>
          )}
          <div className="flex flex-wrap gap-2 items-center">
            <button type="button" onClick={onClose} disabled={saving} className="px-3 py-2 rounded-lg text-[12px] font-medium cursor-pointer disabled:opacity-50" style={{ background: "var(--bg-badge)", color: "var(--text-secondary)", border: "none" }}>Cancel</button>
            <button type="button" onClick={onTest} disabled={testing || saving} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-medium cursor-pointer border-none" style={{ background: "var(--bg-badge)", color: "var(--text-primary)" }}>
              {testing && !saving ? <Loader2 size={14} className="animate-spin" /> : <PlugZap size={14} />} Test
            </button>
            <div className="flex-1 flex items-center justify-end gap-2 min-w-0 ml-auto">
              {saveTestStatus && <TestStatusLabel ok={saveTestStatus.ok} message={saveTestStatus.message} />}
              <button type="button" onClick={onSave} disabled={saving || testing} className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-[12px] font-bold cursor-pointer border-none text-white disabled:opacity-60" style={{ background: "var(--color-action)" }}>
                {saving && <Loader2 size={14} className="animate-spin" />}
                {saving && testing ? "Testing…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TestStatusLabel({
  ok,
  message,
}: {
  ok: boolean | null;
  message?: string | null;
}) {
  if (ok === null) return <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>Not tested</span>;
  if (ok) {
    return (
      <span className="flex items-center gap-1 text-[11px]" style={{ color: "#16a34a" }} title={message ?? ""}>
        <CheckCircle2 size={12} /> Connect
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-[11px]" style={{ color: "var(--color-danger)" }} title={message ?? ""}>
      <XCircle size={12} /> Failed
    </span>
  );
}

function TestBadge({ c }: { c: Connection }) {
  return <TestStatusLabel ok={c.lastTestOk} message={c.lastTestMessage} />;
}

function AppMssqlInfoCard({ app }: { app: AppMssqlInfo }) {
  const databases = [app.coreDatabase, app.formDatabase, app.dataDatabase].join(", ");

  return (
    <div
      className="rounded-xl p-4 flex flex-col gap-3 sm:col-span-2"
      style={{
        background: "var(--bg-card-alt)",
        border: "1px solid var(--border-card)",
        boxShadow: "var(--shadow-sm)",
      }}
    >
      <div className="flex items-start gap-3">
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: "var(--nav-active-bg)" }}
        >
          <Server size={18} style={{ color: "var(--nav-active-text)" }} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-[14px] font-bold" style={{ color: "var(--text-heading)" }}>
            App database (MSSQL_HOST)
          </h3>
          <p className="text-[11px] mt-0.5" style={{ color: "var(--text-muted)" }}>
            Server environment — change in <span className="font-mono">.env.local</span>, not editable here
          </p>
        </div>
      </div>
      <div className="flex flex-col gap-1 text-[11px]" style={{ color: "var(--text-muted)" }}>
        <div className="flex gap-2">
          <span className="shrink-0 w-16">Host</span>
          <span className="font-mono truncate" style={{ color: "var(--text-secondary)" }}>
            {formatHostPort(app.host, app.port)}
          </span>
        </div>
        <div className="flex gap-2">
          <span className="shrink-0 w-16">Database</span>
          <span className="truncate font-mono text-[10px]" style={{ color: "var(--text-secondary)" }} title={databases}>
            {databases}
          </span>
        </div>
      </div>
    </div>
  );
}

function ConnectionCard({
  connection: c,
  appMssql,
  testing,
  onTest,
  onEdit,
  onDelete,
}: {
  connection: Connection;
  appMssql: AppMssqlInfo | null;
  testing: boolean;
  onTest: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className="rounded-xl p-4 flex flex-col gap-3 transition-shadow hover:shadow-md"
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border-card)",
        boxShadow: "var(--shadow-sm)",
        opacity: c.isActive ? 1 : 0.55,
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-3 min-w-0">
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: "var(--nav-active-bg)" }}
          >
            <Server size={18} style={{ color: "var(--nav-active-text)" }} />
          </div>
          <div className="min-w-0">
            <h3 className="text-[14px] font-bold truncate" style={{ color: "var(--text-heading)" }}>{c.name}</h3>
            <p className="text-[11px] font-mono mt-0.5" style={{ color: "var(--text-muted)" }}>{c.code}</p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span
            className="text-[11px] px-2 py-0.5 rounded-full"
            style={
              c.isActive
                ? {
                    background: "var(--bg-info-green)",
                    color: "var(--text-info-green)",
                    border: "1px solid var(--border-info-green)",
                  }
                : { background: "var(--bg-badge)", color: "var(--text-muted)" }
            }
          >
            {c.isActive ? "Active" : "Inactive"}
          </span>
          <TestBadge c={c} />
        </div>
      </div>

      <div className="flex flex-col gap-1 text-[11px]" style={{ color: "var(--text-muted)" }}>
        {appMssql && (
          <div className="flex gap-2">
            <span className="shrink-0 w-16">App host</span>
            <span className="font-mono truncate" style={{ color: "var(--text-secondary)" }} title="MSSQL_HOST from .env">
              {formatHostPort(appMssql.host, appMssql.port)}
            </span>
          </div>
        )}
        <div className="flex gap-2">
          <span className="shrink-0 w-16">Host</span>
          <span className="font-mono truncate" style={{ color: "var(--text-secondary)" }}>{formatHostPort(c.host, c.port)}</span>
        </div>
        <div className="flex gap-2">
          <span className="shrink-0 w-16">Database</span>
          <span className="truncate" style={{ color: "var(--text-secondary)" }}>{c.databaseName ?? "—"}</span>
        </div>
        <div className="flex gap-2">
          <span className="shrink-0 w-16">User</span>
          <span className="truncate" style={{ color: "var(--text-secondary)" }}>{c.username}</span>
        </div>
        {c.purpose && (
          <div className="flex gap-2">
            <span className="shrink-0 w-16">Purpose</span>
            <span className="truncate" style={{ color: "var(--text-secondary)" }}>{c.purpose}</span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-1.5 pt-1 mt-auto" style={{ borderTop: "1px solid var(--border-card)" }}>
        <button
          type="button"
          onClick={onTest}
          disabled={testing}
          className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-medium cursor-pointer border-none"
          style={{ background: "var(--bg-badge)", color: "var(--text-secondary)" }}
        >
          {testing ? <Loader2 size={12} className="animate-spin" /> : <PlugZap size={12} />}
          Test
        </button>
        <button
          type="button"
          onClick={onEdit}
          className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-medium cursor-pointer border-none"
          style={{ background: "var(--bg-badge)", color: "var(--text-secondary)" }}
        >
          <Pencil size={12} /> Edit
        </button>
        {c.isActive && (
          <button
            type="button"
            onClick={onDelete}
            className="w-8 h-8 rounded-lg flex items-center justify-center cursor-pointer border-none shrink-0"
            style={{ background: "var(--bg-badge)", color: "var(--color-danger)" }}
            title="Deactivate"
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>
    </div>
  );
}

export default function DbConnectionsPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const isAdmin = session?.user?.role === "IT Admin" || session?.user?.role === "System Admin";

  const { data, mutate, isLoading } = useSWR<{
    ok: boolean;
    data: {
      connections: Connection[];
      encryptionConfigured: boolean;
      appMssql?: AppMssqlInfo;
    };
    error?: string;
  }>("/api/settings/connections", fetcher);

  const [modal, setModal] = useState<"create" | { edit: Connection } | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testingId, setTestingId] = useState<number | null>(null);
  const [saveTestStatus, setSaveTestStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [confirm, setConfirm] = useState<{
    title: string;
    message: string;
    confirmPhrase?: string;
    onConfirm: () => void;
  } | null>(null);

  useEffect(() => {
    if (status === "authenticated" && !isAdmin) router.replace("/");
  }, [status, isAdmin, router]);

  const connections = data?.data?.connections ?? [];
  const appMssql = data?.data?.appMssql ?? null;
  const encryptionConfigured = data?.data?.encryptionConfigured ?? false;
  const isEdit = modal !== null && modal !== "create";

  const openCreate = () => {
    setForm(emptyForm());
    setSaveTestStatus(null);
    setModal("create");
  };

  const openEdit = (c: Connection) => {
    setForm(formFromConnection(c));
    setSaveTestStatus(null);
    setModal({ edit: c });
  };

  const runTest = async (
    payload: Record<string, unknown>,
    id?: number,
    options?: { silent?: boolean },
  ): Promise<{ ok: boolean; message: string } | null> => {
    const url = id ? `/api/settings/connections/${id}/test` : "/api/settings/connections/test";
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (json.ok) {
      const r = json.data as { ok: boolean; message: string };
      if (!options?.silent) {
        if (r.ok) toast.success(r.message);
        else toast.error(r.message);
      }
      if (id) mutate();
      return r;
    }
    if (!options?.silent) toast.error(json.error ?? "Test failed");
    return null;
  };

  const handleTestForm = async () => {
    if (!form.password && !isEdit) {
      toast.error("Password is required to test");
      return;
    }
    if (!form.password && modal !== null && modal !== "create") {
      setTesting(true);
      try {
        await runTest(
          {
            host: form.host,
            port: parsePortInput(form.port),
            databaseName: parseDatabaseInput(form.databaseName),
            username: form.username,
            encrypt: form.encrypt,
            trustServerCert: form.trustServerCert,
          },
          modal.edit.id,
        );
      } finally {
        setTesting(false);
      }
      return;
    }
    setTesting(true);
    try {
      await runTest({
        host: form.host,
        port: parsePortInput(form.port),
        databaseName: parseDatabaseInput(form.databaseName),
        username: form.username,
        password: form.password,
        encrypt: form.encrypt,
        trustServerCert: form.trustServerCert,
      });
    } finally {
      setTesting(false);
    }
  };

  const handleTestRow = async (c: Connection) => {
    setTestingId(c.id);
    try {
      await runTest({}, c.id);
    } finally {
      setTestingId(null);
    }
  };

  const handleSave = async () => {
    const codeError = validateConnectionCode(form.code);
    if (codeError) {
      toast.error(codeError);
      return;
    }
    if (!form.name.trim() || !form.host.trim() || !form.username.trim()) {
      toast.error("Name, host, and username are required");
      return;
    }
    if (modal === "create" && !form.password) {
      toast.error("Password is required");
      return;
    }
    setSaving(true);
    try {
      const body = formToBody(form, isEdit);
      const url =
        modal === "create"
          ? "/api/settings/connections"
          : `/api/settings/connections/${(modal as { edit: Connection }).edit.id}`;
      const res = await fetch(url, {
        method: modal === "create" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.ok) {
        const savedId =
          modal === "create"
            ? (json.data as Connection).id
            : (modal as { edit: Connection }).edit.id;

        toast.success(modal === "create" ? "Connection created" : "Connection updated");

        const editRow = modal !== "create" ? (modal as { edit: Connection }).edit : null;
        const shouldTest = hasConnectionFormChanges(form, editRow, isEdit);

        if (shouldTest) {
          setTesting(true);
          const testResult = await runTest({}, savedId, { silent: true });
          if (testResult) {
            setSaveTestStatus(testResult);
            if (testResult.ok) toast.success(testResult.message);
            else toast.error(testResult.message);
            await mutate();
            await new Promise((r) => setTimeout(r, 800));
          }
        } else {
          await mutate();
        }
        setModal(null);
        setSaveTestStatus(null);
      } else {
        toast.error(json.error ?? "Failed");
      }
    } finally {
      setSaving(false);
      setTesting(false);
    }
  };

  const handleDelete = (c: Connection) => {
    setConfirm({
      title: "Deactivate connection?",
      message: `This will mark the connection as inactive. This action cannot be undone from the UI without re-activating.`,
      confirmPhrase: c.name,
      onConfirm: async () => {
        const res = await fetch(`/api/settings/connections/${c.id}`, { method: "DELETE" });
        const json = await res.json();
        if (json.ok) {
          toast.success("Connection deactivated");
          mutate();
        } else {
          toast.error(json.error ?? "Failed");
        }
        setConfirm(null);
      },
    });
  };

  if (status === "loading" || (status === "authenticated" && !isAdmin)) {
    return (
      <PageContainer className="py-12 flex justify-center">
        <Loader2 size={24} className="animate-spin" style={{ color: "var(--text-muted)" }} />
      </PageContainer>
    );
  }

  return (
    <PageContainer className="py-6 px-3 sm:px-0" maxWidth="2k">
      <PageHeaderBar
        icon={Server}
        title="Database Connections"
        subtitle="Manage external MSSQL servers"
        backHref="/settings"
        right={
          <button
            type="button"
            onClick={openCreate}
            disabled={!encryptionConfigured}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-bold cursor-pointer border-none text-white"
            style={{ background: encryptionConfigured ? "var(--color-action)" : "var(--bg-badge)", color: encryptionConfigured ? "#fff" : "var(--text-muted)" }}
          >
            <Plus size={14} /> Add connection
          </button>
        }
      />

      {!encryptionConfigured && (
        <div className="flex items-start gap-3 p-4 rounded-xl mb-5" style={{ background: "var(--bg-card-alt)", border: "1px solid var(--border-card)" }}>
          <AlertTriangle size={18} style={{ color: "var(--color-warning, #ca8a04)", flexShrink: 0 }} />
          <div>
            <p className="text-[13px] font-bold mb-1" style={{ color: "var(--text-heading)" }}>Encryption key required</p>
            <p className="text-[12px]" style={{ color: "var(--text-muted)" }}>
              Add <code className="text-[11px]">CONNECTION_ENCRYPTION_KEY</code> to .env.local. Generate:{" "}
              <code className="text-[11px]">openssl rand -base64 32</code>
            </p>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="py-12 flex justify-center">
          <Loader2 size={24} className="animate-spin" style={{ color: "var(--text-muted)" }} />
        </div>
      ) : connections.length === 0 && !appMssql ? (
        <p className="py-12 text-center text-[13px] rounded-xl" style={{ color: "var(--text-muted)", background: "var(--bg-card)", border: "1px solid var(--border-card)" }}>
          No connections yet
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {appMssql && <AppMssqlInfoCard app={appMssql} />}
          {connections.length === 0 ? (
            <p
              className="py-12 text-center text-[13px] rounded-xl sm:col-span-2"
              style={{ color: "var(--text-muted)", background: "var(--bg-card)", border: "1px solid var(--border-card)" }}
            >
              No external connections yet
            </p>
          ) : (
            connections.map((c) => (
              <ConnectionCard
                key={c.id}
                connection={c}
                appMssql={appMssql}
                testing={testingId === c.id}
                onTest={() => handleTestRow(c)}
                onEdit={() => openEdit(c)}
                onDelete={() => handleDelete(c)}
              />
            ))
          )}
        </div>
      )}

      {modal && (
        <ConnectionFormModal
          title={modal === "create" ? "Add connection" : `Edit: ${(modal as { edit: Connection }).edit.name}`}
          form={form}
          isEdit={isEdit}
          saving={saving}
          testing={testing}
          saveTestStatus={saveTestStatus}
          onChange={setForm}
          onSave={handleSave}
          onTest={handleTestForm}
          onClose={() => {
            if (saving) return;
            setModal(null);
            setSaveTestStatus(null);
          }}
        />
      )}

      {confirm && (
        <ConfirmModal
          title={confirm.title}
          message={confirm.message}
          confirmPhrase={confirm.confirmPhrase}
          danger
          onConfirm={confirm.onConfirm}
          onCancel={() => setConfirm(null)}
        />
      )}
    </PageContainer>
  );
}
