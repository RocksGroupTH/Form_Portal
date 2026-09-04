"use client";

import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import {
  AlertTriangle,
  Clock,
  Download,
  History,
  Infinity as InfinityIcon,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  PlugZap,
  BookOpen,
  ExternalLink,
  CheckCircle2,
  Power,
  PowerOff,
} from "lucide-react";
import { Button, Dialog } from "@/components/ui";
import { describeExpiry, expiryLabel, type ExpiryTone } from "@/lib/api-keys/expiry";
import {
  TESTABLE_CODES,
  KNOWN_CODE_USAGE,
  IMPORT_NAMES,
  normalizeApiKeyCode,
  API_KEY_CODE_MAX,
  API_KEY_NAME_MAX,
} from "@/lib/api-keys/codes";
import { KEY_GUIDES, applyGuideOrigin } from "@/lib/api-keys/guides";
import { parseGuideText, type GuideToken } from "@/lib/api-keys/guide-text";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface ApiKeyListItem {
  id: number;
  code: string;
  name: string;
  masked: string | null;
  unreadable: boolean;
  expiresAt: string | null;
  isActive: boolean;
  updatedAt: string;
  updatedByName: string | null;
}

interface LogItem {
  id: number;
  action: string;
  detail: string | null;
  changedAt: string;
  changedByName: string | null;
}

const ACTION_LABEL: Record<string, string> = {
  created: "เพิ่ม key",
  renamed: "เปลี่ยนชื่อ",
  expiry_changed: "เปลี่ยนวันหมดอายุ",
  secret_rotated: "เปลี่ยนค่า key",
  deactivated: "ปิดใช้งาน",
  reactivated: "เปิดใช้งาน",
};

/** Chip colours per tone. Only `warn` and `danger` shout. */
const TONE_STYLE: Record<ExpiryTone, { bg: string; fg: string }> = {
  none: { bg: "var(--bg-card-alt)", fg: "var(--text-muted)" },
  ok: { bg: "var(--bg-card-alt)", fg: "var(--text-secondary)" },
  warn: { bg: "var(--bg-info-yellow)", fg: "var(--text-info-yellow)" },
  danger: { bg: "var(--btn-danger-bg)", fg: "var(--btn-danger-text)" },
  expired: { bg: "var(--btn-danger-bg)", fg: "var(--btn-danger-text)" },
};

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  // Local getters, never toISOString — the server runs Thai time.
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* ─────────────────────────── setup guide ─────────────────────────── */

function InlineText({ text }: { text: string }) {
  const origin = typeof window !== "undefined" ? window.location.origin : "https://your-domain";
  const tokens: GuideToken[] = parseGuideText(applyGuideOrigin(text, origin));
  return (
    <>
      {tokens.map((t, i) => {
        if (t.kind === "bold") return <strong key={i} style={{ color: "var(--text-heading)" }}>{t.text}</strong>;
        if (t.kind === "code") {
          return (
            <code key={i} className="mx-0.5 px-1 rounded font-mono text-[11px]" style={{ background: "var(--bg-badge)" }}>
              {t.text}
            </code>
          );
        }
        if (t.kind === "link") {
          return (
            <a
              key={i}
              href={t.href}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-0.5 font-semibold underline underline-offset-2"
              style={{ color: "var(--nav-active-text)" }}
            >
              {t.text}
              <ExternalLink size={10} />
            </a>
          );
        }
        return <span key={i}>{t.text}</span>;
      })}
    </>
  );
}

/**
 * The "where do I get this key" manual for one code. Content lives in
 * `lib/api-keys/guides.ts` as data — this only knows how to draw it, so a new
 * provider needs no change here.
 */
function KeyGuidePanel({ code }: { code: string }) {
  const guide = KEY_GUIDES[code];
  if (!guide) return null;
  return (
    <div
      className="rounded-xl p-4 text-[12px] flex flex-col gap-3"
      style={{ background: "var(--bg-card-alt)", border: "1px solid var(--border-card)", color: "var(--text-muted)" }}
    >
      <p className="font-semibold m-0" style={{ color: "var(--text-heading)" }}>{guide.title}</p>
      <ol className="list-decimal pl-4 space-y-2 m-0">
        {guide.steps.map((step, i) => (
          <li key={i} className="leading-relaxed"><InlineText text={step} /></li>
        ))}
      </ol>
      {guide.notes && guide.notes.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {guide.notes.map((note, i) => (
            <p
              key={i}
              className="text-[11px] leading-relaxed rounded-lg px-3 py-2 m-0"
              style={{ background: "var(--bg-badge)", color: "var(--text-secondary)" }}
            >
              <InlineText text={note} />
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── add / edit dialog ─────────────────────────── */

interface DraftState {
  code: string;
  name: string;
  value: string;
  expiresAt: string;
  nonExpiry: boolean;
}

function KeyDialog({
  editing,
  onClose,
  onSaved,
}: {
  /** null = adding. */
  editing: ApiKeyListItem | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<DraftState>({
    code: editing?.code ?? "",
    name: editing?.name ?? "",
    value: "",
    expiresAt: editing?.expiresAt ?? "",
    // No date stored is exactly what "Non expiry" means — there is no separate
    // flag to read, so the tick derives from the date and cannot contradict it.
    nonExpiry: !editing?.expiresAt,
  });
  const [saving, setSaving] = useState(false);

  const set = (patch: Partial<DraftState>) => setDraft((d) => ({ ...d, ...patch }));

  const submit = async () => {
    if (!draft.nonExpiry && !draft.expiresAt) {
      toast.error("เลือกวันหมดอายุ หรือติ๊ก Non expiry");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        code: draft.code,
        name: draft.name,
        value: draft.value,
        expiresAt: draft.nonExpiry ? null : draft.expiresAt,
      };
      const res = editing
        ? await fetch(`/api/settings/api-keys/${editing.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch("/api/settings/api-keys", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
      const json = await res.json();
      if (!json.ok) {
        toast.error(json.error ?? "บันทึกไม่สำเร็จ");
        return;
      }
      toast.success(editing ? "บันทึกแล้ว" : "เพิ่ม key แล้ว");
      onSaved();
      onClose();
    } catch {
      toast.error("บันทึกไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  };

  const inputClass = "w-full rounded-lg px-3 py-2 text-[14px] outline-none";
  const inputStyle = {
    background: "var(--bg-input)",
    color: "var(--text-primary)",
    border: "1px solid var(--border-input)",
  };
  const labelClass = "block text-[12px] font-semibold mb-1.5";

  return (
    <Dialog
      open
      onOpenChange={(v) => { if (!v && !saving) onClose(); }}
      title={editing ? `แก้ไข ${editing.code}` : "เพิ่ม API Key"}
      uniformSurface
    >
      <div className="flex flex-col gap-3.5 mb-6">
        <div>
          <label className={labelClass} style={{ color: "var(--text-secondary)" }}>CODE</label>
          <input
            value={draft.code}
            // Uppercased as it is typed, so what you see is what is stored, and
            // through the SAME function the service uses — this was a second copy
            // of that regex, and `codes.ts` exists to stop exactly that.
            //
            // It is the only thing that really uppercases: `CK_ApiKey_CodeUpper`
            // is `Code = UPPER(Code)`, which is true of every string under this
            // database's case-insensitive collation (measured 2026-09-04). The
            // constraint is there for a case-sensitive one, not for this one.
            onChange={(e) => set({ code: normalizeApiKeyCode(e.target.value) })}
            maxLength={API_KEY_CODE_MAX}
            disabled={!!editing}
            placeholder="ANTHROPIC_API_KEY"
            list="api-key-codes"
            className={`${inputClass} font-mono tracking-wide disabled:opacity-60`}
            style={inputStyle}
          />
          {/* The three the app reads. Free text is still allowed — this is a
              registry, and an unknown code is stored and served the same. */}
          <datalist id="api-key-codes">
            {Object.keys(KEY_GUIDES).map((c) => <option key={c} value={c} />)}
          </datalist>
          {editing && (
            <p className="text-[11.5px] mt-1 m-0" style={{ color: "var(--text-muted)" }}>
              CODE เปลี่ยนไม่ได้ — เป็นชื่อที่โค้ดใช้เรียก
            </p>
          )}
        </div>

        <div>
          <label className={labelClass} style={{ color: "var(--text-secondary)" }}>Name</label>
          <input
            value={draft.name}
            onChange={(e) => set({ name: e.target.value })}
            maxLength={API_KEY_NAME_MAX}
            placeholder="Anthropic — อ่านใบเสร็จและตรวจบัตร"
            className={inputClass}
            style={inputStyle}
          />
        </div>

        <div>
          <label className={labelClass} style={{ color: "var(--text-secondary)" }}>KEY</label>
          <input
            type="password"
            value={draft.value}
            onChange={(e) => set({ value: e.target.value })}
            placeholder={editing ? "เว้นว่างไว้ = ใช้ค่าเดิม" : "วางค่า key ที่นี่"}
            autoComplete="off"
            className={`${inputClass} font-mono`}
            style={inputStyle}
          />
          {editing && (
            <p className="text-[11.5px] mt-1 m-0" style={{ color: "var(--text-muted)" }}>
              ค่าเดิมดูไม่ได้ — ระบบไม่ส่งค่า key กลับมาที่หน้าจอ กรอกใหม่เท่ากับเขียนทับ
            </p>
          )}
        </div>

        <div>
          <label className={labelClass} style={{ color: "var(--text-secondary)" }}>วันหมดอายุ</label>
          <input
            type="date"
            value={draft.expiresAt}
            onChange={(e) => set({ expiresAt: e.target.value, nonExpiry: false })}
            disabled={draft.nonExpiry}
            className={`${inputClass} disabled:opacity-50`}
            style={inputStyle}
          />
          <label className="flex items-center gap-2 mt-2 text-[13px] cursor-pointer" style={{ color: "var(--text-secondary)" }}>
            <input
              type="checkbox"
              checked={draft.nonExpiry}
              // Ticking clears the date rather than keeping it hidden, so the two
              // controls can never disagree about what will be saved.
              onChange={(e) => set({ nonExpiry: e.target.checked, expiresAt: e.target.checked ? "" : draft.expiresAt })}
              className="w-4 h-4 cursor-pointer"
            />
            Non expiry — ไม่มีวันหมดอายุ
          </label>
          <p className="text-[11.5px] mt-2 m-0 leading-relaxed" style={{ color: "var(--text-muted)" }}>
            วันนี้เป็นบันทึกของเราเอง ไม่ได้เชื่อมกับวันหมดอายุจริงของผู้ให้บริการ —
            ระบบจะเตือนเมื่อใกล้ถึง แต่<b>ไม่หยุดใช้ key</b>
          </p>
        </div>
      </div>

      {/* Shown as soon as the CODE is recognised — the steps are needed while the
          key is being fetched, not after the dialog has been closed. */}
      {KEY_GUIDES[draft.code] && (
        <div className="mb-6">
          <KeyGuidePanel code={draft.code} />
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={saving}>ยกเลิก</Button>
        <Button onClick={submit} disabled={saving}>
          {saving && <Loader2 size={14} className="animate-spin" />}
          {editing ? "บันทึก" : "เพิ่ม key"}
        </Button>
      </div>
    </Dialog>
  );
}

/* ─────────────────────────── log panel ─────────────────────────── */

function LogPanel({ apiKeyId }: { apiKeyId: number }) {
  const { data, error } = useSWR<{ ok: boolean; data?: { log: LogItem[] } }>(
    `/api/settings/api-keys/${apiKeyId}`,
    fetcher,
  );
  if (!data && !error) {
    return <p className="text-[12.5px] m-0 py-2" style={{ color: "var(--text-muted)" }}>กำลังโหลดประวัติ...</p>;
  }
  // **A failed read is not an empty history.** Falling through to the
  // "ยังไม่มีประวัติ" line below told the admin that nobody had ever changed
  // this key, when the truth was that we could not find out — the opposite
  // answer, on the one screen whose entire job is to say who changed what.
  //
  // Both arms are needed. `fetcher` is `fetch().then(r => r.json())`, which does
  // not throw on a non-2xx, so a 500 arrives as `data = { ok: false }` with
  // `error` unset; only a network failure sets `error`.
  if (error || !data?.ok) {
    return (
      <p className="text-[12.5px] m-0 py-2" style={{ color: "var(--text-danger)" }}>
        อ่านประวัติไม่สำเร็จ — ลองใหม่อีกครั้ง
      </p>
    );
  }
  const log = data.data?.log ?? [];
  if (log.length === 0) {
    return <p className="text-[12.5px] m-0 py-2" style={{ color: "var(--text-muted)" }}>ยังไม่มีประวัติ</p>;
  }
  return (
    <div className="flex flex-col gap-1.5 py-1">
      {log.map((l) => (
        <div key={l.id} className="flex items-baseline gap-2 text-[12.5px]">
          <span className="font-semibold shrink-0" style={{ color: "var(--text-primary)" }}>
            {ACTION_LABEL[l.action] ?? l.action}
          </span>
          {l.detail && <span className="truncate" style={{ color: "var(--text-secondary)" }}>{l.detail}</span>}
          <span className="ml-auto shrink-0" style={{ color: "var(--text-muted)" }}>
            {l.changedByName ?? "-"} · {fmtDateTime(l.changedAt)}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ─────────────────────────── page body ─────────────────────────── */

export function ApiKeySettings() {
  const { data, error, isLoading, mutate } = useSWR<{
    ok: boolean;
    data?: { keys: ApiKeyListItem[]; encryptionReady: boolean };
    error?: string;
  }>("/api/settings/api-keys", fetcher, { revalidateOnFocus: false });

  const [dialog, setDialog] = useState<{ editing: ApiKeyListItem | null } | null>(null);
  const [openLogId, setOpenLogId] = useState<number | null>(null);
  const [openGuideId, setOpenGuideId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [importing, setImporting] = useState(false);
  const [testingId, setTestingId] = useState<number | null>(null);
  const [testResult, setTestResult] = useState<Record<number, { ok: boolean; message: string }>>({});

  const keys = data?.data?.keys ?? [];
  const encryptionReady = data?.data?.encryptionReady ?? true;
  const today = new Date();

  const registeredCodes = keys.map((k) => k.code);
  const importable = Object.keys(KNOWN_CODE_USAGE).filter((c) => registeredCodes.indexOf(c) < 0);

  const toggleActive = async (k: ApiKeyListItem) => {
    setBusyId(k.id);
    try {
      const res = await fetch(`/api/settings/api-keys/${k.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !k.isActive }),
      });
      const json = await res.json();
      if (!json.ok) {
        toast.error(json.error ?? "ทำรายการไม่สำเร็จ");
        return;
      }
      toast.success(k.isActive ? "ปิดใช้งานแล้ว" : "เปิดใช้งานแล้ว");
      await mutate();
    } finally {
      setBusyId(null);
    }
  };

  const runTest = async (k: ApiKeyListItem) => {
    setTestingId(k.id);
    // Clear the previous verdict first: a stale green beside a spinner reads as
    // "passed" while the new call is still deciding.
    setTestResult((r) => ({ ...r, [k.id]: { ok: false, message: "" } }));
    try {
      const res = await fetch(`/api/settings/api-keys/${k.id}/test`, { method: "POST" });
      const json = await res.json();
      const result = json.ok
        ? (json.data as { ok: boolean; message: string })
        : { ok: false, message: json.error ?? "ทดสอบไม่สำเร็จ" };
      setTestResult((r) => ({ ...r, [k.id]: result }));
    } catch {
      setTestResult((r) => ({ ...r, [k.id]: { ok: false, message: "เรียกทดสอบไม่สำเร็จ" } }));
    } finally {
      setTestingId(null);
    }
  };

  const importAll = async () => {
    setImporting(true);
    let moved = 0;
    try {
      for (const code of importable) {
        const res = await fetch("/api/settings/api-keys", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "import", code, name: IMPORT_NAMES[code] ?? code }),
        });
        const json = await res.json();
        if (json.ok && json.data?.imported) moved++;
      }
      toast[moved > 0 ? "success" : "info"](
        moved > 0 ? `นำเข้า ${moved} key แล้ว` : "ไม่พบ key ในที่เก็บเดิม",
      );
      await mutate();
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Saving is impossible without this, so say so before the Add button is
          pressed rather than after. */}
      {!encryptionReady && (
        <div
          className="rounded-xl px-4 py-3 flex items-start gap-2.5 text-[13px] leading-relaxed"
          style={{ background: "var(--bg-info-yellow)", color: "var(--text-info-yellow)", border: "1px solid var(--border-card)" }}
        >
          <AlertTriangle size={16} className="shrink-0 mt-0.5" />
          <span>
            ยังไม่ได้ตั้ง <code>CONNECTION_ENCRYPTION_KEY</code> — เพิ่มหรือแก้ key ไม่ได้
            เพราะระบบจะไม่ยอมเก็บ key แบบไม่เข้ารหัส สร้างด้วย{" "}
            <code>openssl rand -base64 32</code> แล้วใส่ใน environment ของเซิร์ฟเวอร์
          </span>
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <Button onClick={() => setDialog({ editing: null })} disabled={!encryptionReady}>
          <Plus size={14} /> Add
        </Button>
        {importable.length > 0 && (
          <Button variant="secondary" onClick={importAll} disabled={!encryptionReady || importing}>
            {importing ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            นำเข้าจากที่เก็บเดิม ({importable.length})
          </Button>
        )}
      </div>

      <p className="text-[12px] m-0 -mt-2" style={{ color: "var(--text-muted)" }}>
        key ที่ยังไม่ได้เพิ่มที่นี่ ระบบยังอ่านจากที่เก็บเดิมและ .env ได้ตามปกติ
      </p>

      {isLoading ? (
        <div className="py-10 flex justify-center">
          <Loader2 size={22} className="animate-spin" style={{ color: "var(--text-muted)" }} />
        </div>
      ) : error || !data?.ok ? (
        <p className="text-[13px] py-6 text-center m-0" style={{ color: "var(--color-danger)" }}>
          {data?.error ?? "โหลดรายการไม่สำเร็จ"}
        </p>
      ) : keys.length === 0 ? (
        <div
          className="rounded-xl px-4 py-8 text-center text-[13px]"
          style={{ background: "var(--bg-card-alt)", color: "var(--text-muted)" }}
        >
          ยังไม่มี key ในระบบ — กด Add เพื่อเพิ่ม หรือนำเข้าจากที่เก็บเดิม
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {keys.map((k) => {
            const status = describeExpiry(k.expiresAt, today);
            const tone = TONE_STYLE[status.tone];
            return (
              <div
                key={k.id}
                className="rounded-xl px-4 py-3 flex flex-col gap-2"
                style={{
                  background: "var(--bg-card)",
                  border: "1px solid var(--border-card)",
                  opacity: k.isActive ? 1 : 0.6,
                }}
              >
                {/* Line 1 — what this key IS. Code leads because it is the name
                    the code uses; everything else on the line qualifies it. */}
                <div className="flex items-center gap-2.5 min-w-0">
                  <KeyRound size={15} className="shrink-0" style={{ color: "var(--nav-active-text)" }} />
                  <span className="font-mono font-bold text-[13.5px] tracking-wide shrink-0" style={{ color: "var(--text-primary)" }}>
                    {k.code}
                  </span>
                  <span className="text-[13px] truncate" style={{ color: "var(--text-secondary)" }}>{k.name}</span>
                  {!k.isActive && (
                    <span
                      className="px-2 py-0.5 rounded-md text-[11px] font-semibold shrink-0"
                      style={{ background: "var(--bg-card-alt)", color: "var(--text-muted)" }}
                    >
                      ปิดใช้งาน
                    </span>
                  )}
                  <span
                    className="ml-auto inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11.5px] font-semibold shrink-0"
                    style={{ background: tone.bg, color: tone.fg }}
                  >
                    {status.tone === "none" ? <InfinityIcon size={11} /> : <Clock size={11} />}
                    {expiryLabel(status)}
                  </span>
                  <span className="font-mono text-[12.5px] shrink-0 tabular-nums" style={{ color: "var(--text-muted)" }}>
                    {k.unreadable ? "อ่านค่าไม่ได้" : k.masked}
                  </span>
                </div>

                {/* Line 2 — what it is FOR. Suppressed when the Name already
                    says it, which is what an early import made it do. */}
                {KNOWN_CODE_USAGE[k.code] && KNOWN_CODE_USAGE[k.code] !== k.name && (
                  <p className="m-0 text-[11.5px] pl-[25px]" style={{ color: "var(--text-muted)" }}>
                    ใช้กับ {KNOWN_CODE_USAGE[k.code]}
                  </p>
                )}

                {/* Line 3 — provenance on the left, actions on the right. */}
                <div className="flex items-center gap-2 flex-wrap pl-[25px]">
                  <span className="text-[11.5px]" style={{ color: "var(--text-muted)" }}>
                    แก้ไขล่าสุด {k.updatedByName ?? "-"} · {fmtDateTime(k.updatedAt)}
                  </span>
                  <div className="ml-auto flex items-center gap-1.5 shrink-0">
                    {TESTABLE_CODES.indexOf(k.code) >= 0 && (
                      <Button variant="secondary" size="sm" onClick={() => runTest(k)} disabled={testingId === k.id || k.unreadable}>
                        {testingId === k.id ? <Loader2 size={13} className="animate-spin" /> : <PlugZap size={13} />}
                        ทดสอบการเชื่อมต่อ
                      </Button>
                    )}
                    {KEY_GUIDES[k.code] && (
                      <Button variant="secondary" size="sm" onClick={() => setOpenGuideId(openGuideId === k.id ? null : k.id)}>
                        <BookOpen size={13} /> คู่มือ
                      </Button>
                    )}
                    <Button variant="secondary" size="sm" onClick={() => setOpenLogId(openLogId === k.id ? null : k.id)}>
                      <History size={13} /> ประวัติ
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => setDialog({ editing: k })} disabled={!encryptionReady}>
                      <Pencil size={13} /> แก้ไข
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => toggleActive(k)} disabled={busyId === k.id}>
                      {busyId === k.id ? <Loader2 size={13} className="animate-spin" />
                        : k.isActive ? <PowerOff size={13} /> : <Power size={13} />}
                      {k.isActive ? "ปิดใช้งาน" : "เปิดใช้งาน"}
                    </Button>
                  </div>
                </div>

                {/* The result stays on screen instead of a toast that vanishes —
                    this is the one thing somebody presses the button to read. */}
                {testResult[k.id] && (
                  <p
                    className="m-0 text-[12px] pl-[25px] flex items-center gap-1.5"
                    style={{ color: testResult[k.id].ok ? "var(--color-success)" : "var(--color-danger)" }}
                  >
                    {testResult[k.id].ok ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
                    {testResult[k.id].message}
                  </p>
                )}

                {k.unreadable && (
                  <p className="text-[12px] m-0 pl-[25px]" style={{ color: "var(--color-danger)" }}>
                    ถอดรหัสค่า key นี้ไม่ได้ — CONNECTION_ENCRYPTION_KEY อาจถูกเปลี่ยน กรอกค่า key ใหม่เพื่อแก้
                  </p>
                )}

                {openGuideId === k.id && (
                  <div className="pt-2" style={{ borderTop: "1px solid var(--border-light)" }}>
                    <KeyGuidePanel code={k.code} />
                  </div>
                )}

                {openLogId === k.id && (
                  <div className="pt-2" style={{ borderTop: "1px solid var(--border-light)" }}>
                    <LogPanel apiKeyId={k.id} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {dialog && (
        <KeyDialog editing={dialog.editing} onClose={() => setDialog(null)} onSaved={() => void mutate()} />
      )}
    </div>
  );
}
