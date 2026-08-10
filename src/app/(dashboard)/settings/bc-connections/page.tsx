"use client";

import { useState, useEffect } from "react";
import useSWR from "swr";
import {
  Plus,
  Pencil,
  Trash2,
  Boxes,
  PlugZap,
  KeyRound,
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

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface BcConnection {
  id: number;
  code: string;
  name: string;
  oauthUrl: string;
  clientId: string;
  hasClientSecret: boolean;
  scope: string | null;
  username: string | null;
  hasPassword: boolean;
  baseUrl: string;
  hasToken: boolean;
  tokenExpiresAt: string | null;
  isActive: boolean;
  lastTestAt: string | null;
  lastTestOk: boolean | null;
  lastTestMessage: string | null;
}

interface FormState {
  code: string;
  name: string;
  oauthUrl: string;
  clientId: string;
  clientSecret: string;
  scope: string;
  username: string;
  password: string;
  baseUrl: string;
  isActive: boolean;
}

const inputCls =
  "w-full rounded-lg px-3 py-2 text-[12px] outline-none";
const inputStyle = {
  background: "var(--bg-input)",
  color: "var(--text-primary)",
  border: "1px solid var(--border-input)",
};

function formatTokenExpiry(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function tokenStatusLabel(c: BcConnection | null | undefined): string {
  if (!c?.hasToken) return "No token stored";
  const exp = c.tokenExpiresAt ? new Date(c.tokenExpiresAt) : null;
  if (exp && exp.getTime() < Date.now()) {
    return `Expired (${formatTokenExpiry(c.tokenExpiresAt)})`;
  }
  return `Valid until ${formatTokenExpiry(c.tokenExpiresAt)}`;
}

const emptyForm = (): FormState => ({
  code: "",
  name: "",
  oauthUrl: "",
  clientId: "",
  clientSecret: "",
  scope: "",
  username: "",
  password: "",
  baseUrl: "",
  isActive: true,
});

function formFromConnection(c: BcConnection): FormState {
  return {
    code: c.code,
    name: c.name,
    oauthUrl: c.oauthUrl,
    clientId: c.clientId,
    clientSecret: "",
    scope: c.scope ?? "",
    username: c.username ?? "",
    password: "",
    baseUrl: c.baseUrl,
    isActive: c.isActive,
  };
}

function hasBcFormChanges(form: FormState, original: BcConnection | null, isEdit: boolean): boolean {
  if (!isEdit || !original) return true;
  if (form.code.trim().toUpperCase() !== original.code) return true;
  if (form.name !== original.name) return true;
  if (form.oauthUrl !== original.oauthUrl) return true;
  if (form.clientId !== original.clientId) return true;
  if ((form.scope || null) !== (original.scope ?? null)) return true;
  if ((form.username || null) !== (original.username ?? null)) return true;
  if (form.baseUrl !== original.baseUrl) return true;
  if (form.isActive !== original.isActive) return true;
  if (form.clientSecret.trim()) return true;
  if (form.password.trim()) return true;
  return false;
}

function formToBody(form: FormState, isEdit: boolean) {
  const body: Record<string, unknown> = {
    code: form.code.trim().toUpperCase(),
    name: form.name,
    oauthUrl: form.oauthUrl,
    clientId: form.clientId,
    scope: form.scope || null,
    username: form.username || null,
    baseUrl: form.baseUrl,
    isActive: form.isActive,
  };
  if (form.clientSecret || !isEdit) body.clientSecret = form.clientSecret;
  if (form.password) body.password = form.password;
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
                Type <span className="font-semibold" style={{ color: "var(--text-primary)" }}>{confirmPhrase}</span> to confirm
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

function BcFormModal({
  title,
  form,
  isEdit,
  editRow,
  saving,
  testing,
  tokenLoading,
  saveTestStatus,
  onChange,
  onSave,
  onTest,
  onToken,
  onClose,
}: {
  title: string;
  form: FormState;
  isEdit: boolean;
  editRow: BcConnection | null;
  saving: boolean;
  testing: boolean;
  tokenLoading: boolean;
  saveTestStatus: { ok: boolean; message: string } | null;
  onChange: (f: FormState) => void;
  onSave: () => void;
  onTest: () => void;
  onToken: () => void;
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
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>OAuth URL *</span>
            <input
              value={form.oauthUrl}
              onChange={(e) => set("oauthUrl", e.target.value)}
              className={inputCls}
              style={inputStyle}
              placeholder="https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token"
            />
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>Client ID *</span>
              <input value={form.clientId} onChange={(e) => set("clientId", e.target.value)} className={inputCls} style={inputStyle} autoComplete="off" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>
                Client Secret {isEdit ? "(leave blank to keep)" : "*"}
              </span>
              <input type="password" value={form.clientSecret} onChange={(e) => set("clientSecret", e.target.value)} className={inputCls} style={inputStyle} autoComplete="new-password" />
            </label>
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>Scope</span>
            <input value={form.scope} onChange={(e) => set("scope", e.target.value)} className={inputCls} style={inputStyle} placeholder="https://api.businesscentral.dynamics.com/.default" />
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>User</span>
              <input value={form.username} onChange={(e) => set("username", e.target.value)} className={inputCls} style={inputStyle} autoComplete="off" placeholder="optional (password grant)" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>
                Password {isEdit ? "(leave blank to keep)" : ""}
              </span>
              <input type="password" value={form.password} onChange={(e) => set("password", e.target.value)} className={inputCls} style={inputStyle} autoComplete="new-password" />
            </label>
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>Base URL *</span>
            <input
              value={form.baseUrl}
              onChange={(e) => set("baseUrl", e.target.value)}
              className={inputCls}
              style={inputStyle}
              placeholder=".../v2.0/{tenant-id}/Production/api/v2.0/companies"
            />
          </label>
          {isEdit && (
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>Access Token (read-only)</span>
              <input
                readOnly
                value={tokenStatusLabel(editRow)}
                className={inputCls}
                style={{ ...inputStyle, opacity: 0.85, cursor: "not-allowed" }}
              />
            </label>
          )}
          {isEdit && (
            <SettingOptionGroup title="สถานะ" description="ควบคุมการใช้งาน BC Connection นี้">
              <SettingOption
                checked={form.isActive}
                onChange={(v) => set("isActive", v)}
                label="เปิดใช้งาน"
                description="ปิดเพื่อหยุดเรียก API / sync ชั่วคราว — ยังเก็บการตั้งค่าและ token ไว้ได้"
              />
            </SettingOptionGroup>
          )}
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
            {isEdit && (
              <button type="button" onClick={onToken} disabled={tokenLoading || saving || testing} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-medium cursor-pointer border-none" style={{ background: "var(--bg-badge)", color: "var(--text-primary)" }}>
                {tokenLoading ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />} Token
              </button>
            )}
            <button type="button" onClick={onTest} disabled={testing || saving || !isEdit} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-medium cursor-pointer border-none" style={{ background: "var(--bg-badge)", color: "var(--text-primary)" }} title={isEdit ? undefined : "Save first to test"}>
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

function TestStatusLabel({ ok, message }: { ok: boolean | null; message?: string | null }) {
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

function TestBadge({ c }: { c: BcConnection }) {
  return <TestStatusLabel ok={c.lastTestOk} message={c.lastTestMessage} />;
}

function BcConnectionCard({
  connection: c,
  testing,
  tokenLoading,
  onToken,
  onTest,
  onEdit,
  onDelete,
}: {
  connection: BcConnection;
  testing: boolean;
  tokenLoading: boolean;
  onToken: () => void;
  onTest: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const tokenExpired =
    c.hasToken && c.tokenExpiresAt && new Date(c.tokenExpiresAt).getTime() < Date.now();

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
            <Boxes size={18} style={{ color: "var(--nav-active-text)" }} />
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
        <div className="flex gap-2">
          <span className="shrink-0 w-14">Client</span>
          <span className="truncate font-mono text-[10px]" style={{ color: "var(--text-secondary)" }} title={c.clientId}>{c.clientId}</span>
        </div>
        <div className="flex gap-2">
          <span className="shrink-0 w-14">Base URL</span>
          <span className="truncate text-[10px]" style={{ color: "var(--text-secondary)" }} title={c.baseUrl}>{c.baseUrl}</span>
        </div>
        <div className="flex gap-2">
          <span className="shrink-0 w-14">Token</span>
          <span
            className="truncate"
            style={{ color: c.hasToken ? (tokenExpired ? "var(--color-danger)" : "var(--text-info-green)") : "var(--text-muted)" }}
            title={tokenStatusLabel(c)}
          >
            {c.hasToken ? formatTokenExpiry(c.tokenExpiresAt) : "—"}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-1.5 pt-1 mt-auto flex-wrap" style={{ borderTop: "1px solid var(--border-card)" }}>
        <button type="button" onClick={onToken} disabled={tokenLoading} className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-medium cursor-pointer border-none min-w-[72px]" style={{ background: "var(--bg-badge)", color: "var(--text-secondary)" }}>
          {tokenLoading ? <Loader2 size={12} className="animate-spin" /> : <KeyRound size={12} />} Token
        </button>
        <button type="button" onClick={onTest} disabled={testing} className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-medium cursor-pointer border-none min-w-[72px]" style={{ background: "var(--bg-badge)", color: "var(--text-secondary)" }}>
          {testing ? <Loader2 size={12} className="animate-spin" /> : <PlugZap size={12} />} Test
        </button>
        <button type="button" onClick={onEdit} className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-medium cursor-pointer border-none min-w-[72px]" style={{ background: "var(--bg-badge)", color: "var(--text-secondary)" }}>
          <Pencil size={12} /> Edit
        </button>
        {c.isActive && (
          <button type="button" onClick={onDelete} className="w-8 h-8 rounded-lg flex items-center justify-center cursor-pointer border-none shrink-0" style={{ background: "var(--bg-badge)", color: "var(--color-danger)" }} title="Deactivate">
            <Trash2 size={12} />
          </button>
        )}
      </div>
    </div>
  );
}

export default function BcConnectionsPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const isAdmin = session?.user?.role === "IT Admin" || session?.user?.role === "System Admin";

  const { data, mutate, isLoading } = useSWR<{
    ok: boolean;
    data: { connections: BcConnection[]; encryptionConfigured: boolean };
    error?: string;
  }>("/api/settings/bc-connections", fetcher);

  const [modal, setModal] = useState<"create" | { edit: BcConnection } | null>(null);
  const [tokenLoading, setTokenLoading] = useState(false);
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
  const encryptionConfigured = data?.data?.encryptionConfigured ?? false;
  const isEdit = modal !== null && modal !== "create";

  const openCreate = () => {
    setForm(emptyForm());
    setSaveTestStatus(null);
    setModal("create");
  };

  const openEdit = (c: BcConnection) => {
    setForm(formFromConnection(c));
    setSaveTestStatus(null);
    setModal({ edit: c });
  };

  const runTest = async (id: number, options?: { silent?: boolean }): Promise<{ ok: boolean; message: string } | null> => {
    const res = await fetch(`/api/settings/bc-connections/${id}/test`, { method: "POST" });
    const json = await res.json();
    if (json.ok) {
      const r = json.data as { ok: boolean; message: string };
      if (!options?.silent) {
        if (r.ok) toast.success(r.message);
        else toast.error(r.message);
      }
      mutate();
      return r;
    }
    if (!options?.silent) toast.error(json.error ?? "Test failed");
    return null;
  };

  const runToken = async (id: number) => {
    const res = await fetch(`/api/settings/bc-connections/${id}/token`, { method: "POST" });
    const json = await res.json();
    if (json.ok) {
      const r = json.data as { ok: boolean; message: string };
      if (r.ok) toast.success(r.message);
      else toast.error(r.message);
      mutate();
    } else {
      toast.error(json.error ?? "Token request failed");
    }
  };

  const handleTestForm = async () => {
    if (modal === null || modal === "create") {
      toast.error("Save the connection first, then test");
      return;
    }
    setTesting(true);
    try {
      await runTest(modal.edit.id);
    } finally {
      setTesting(false);
    }
  };

  const handleTokenForm = async () => {
    if (modal === null || modal === "create") {
      toast.error("Save the connection first");
      return;
    }
    setTokenLoading(true);
    try {
      await runToken(modal.edit.id);
    } finally {
      setTokenLoading(false);
    }
  };

  const handleTestRow = async (c: BcConnection) => {
    setTestingId(c.id);
    try {
      await runTest(c.id);
    } finally {
      setTestingId(null);
    }
  };

  const handleTokenRow = async (c: BcConnection) => {
    setTokenLoading(true);
    try {
      await runToken(c.id);
    } finally {
      setTokenLoading(false);
    }
  };

  const handleSave = async () => {
    const codeError = validateConnectionCode(form.code);
    if (codeError) {
      toast.error(codeError);
      return;
    }
    if (!form.name.trim() || !form.oauthUrl.trim() || !form.clientId.trim() || !form.baseUrl.trim()) {
      toast.error("Name, OAuth URL, Client ID, and Base URL are required");
      return;
    }
    if (modal === "create" && !form.clientSecret.trim()) {
      toast.error("Client secret is required");
      return;
    }
    setSaving(true);
    try {
      const body = formToBody(form, isEdit);
      const url =
        modal === "create"
          ? "/api/settings/bc-connections"
          : `/api/settings/bc-connections/${(modal as { edit: BcConnection }).edit.id}`;
      const res = await fetch(url, {
        method: modal === "create" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.ok) {
        const savedId =
          modal === "create"
            ? (json.data as BcConnection).id
            : (modal as { edit: BcConnection }).edit.id;

        toast.success(modal === "create" ? "BC connection created" : "BC connection updated");

        const editRow = modal !== "create" ? (modal as { edit: BcConnection }).edit : null;
        const shouldTest = hasBcFormChanges(form, editRow, isEdit);

        if (shouldTest) {
          setTesting(true);
          const testResult = await runTest(savedId, { silent: true });
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

  const handleDelete = (c: BcConnection) => {
    setConfirm({
      title: "Deactivate BC connection?",
      message: "This will mark the connection as inactive.",
      confirmPhrase: c.name,
      onConfirm: async () => {
        const res = await fetch(`/api/settings/bc-connections/${c.id}`, { method: "DELETE" });
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
        icon={Boxes}
        title="Business Central"
        subtitle="OAuth2 and API connection settings"
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
      ) : connections.length === 0 ? (
        <p className="py-12 text-center text-[13px] rounded-xl" style={{ color: "var(--text-muted)", background: "var(--bg-card)", border: "1px solid var(--border-card)" }}>
          No connections yet
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {connections.map((c) => (
            <BcConnectionCard
              key={c.id}
              connection={c}
              testing={testingId === c.id}
              tokenLoading={tokenLoading}
              onToken={() => handleTokenRow(c)}
              onTest={() => handleTestRow(c)}
              onEdit={() => openEdit(c)}
              onDelete={() => handleDelete(c)}
            />
          ))}
        </div>
      )}

      {modal && (
        <BcFormModal
          title={modal === "create" ? "Add BC connection" : `Edit: ${(modal as { edit: BcConnection }).edit.name}`}
          form={form}
          isEdit={isEdit}
          editRow={modal === "create" ? null : modal.edit}
          saving={saving}
          testing={testing}
          tokenLoading={tokenLoading}
          saveTestStatus={saveTestStatus}
          onChange={setForm}
          onSave={handleSave}
          onTest={handleTestForm}
          onToken={handleTokenForm}
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
