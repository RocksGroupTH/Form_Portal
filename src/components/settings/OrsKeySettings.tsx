"use client";

import { useState, useEffect } from "react";
import { KeyRound, CheckCircle2, AlertCircle, Loader2, TestTube2, Save } from "lucide-react";
import { toast } from "sonner";

interface OrsStatus {
  configured: boolean;
  masked: string | null;
  source: "db" | "env" | null;
}

interface Props {
  /** Hide page-level intro when embedded in MapProviderSettings. */
  embedded?: boolean;
  onChanged?: () => void;
}

export function OrsKeySettings({ embedded, onChanged }: Props) {
  const [status, setStatus] = useState<OrsStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [newKey, setNewKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const fetchStatus = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/settings/ors");
      const json = await res.json();
      if (json.ok) {
        setStatus(json.data as OrsStatus);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/settings/ors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: newKey }),
      });
      const json = await res.json();
      if (json.ok) {
        toast.success("บันทึกแล้ว");
        setNewKey("");
        await fetchStatus();
        onChanged?.();
      } else {
        toast.error(json.error ?? "บันทึกไม่สำเร็จ");
      }
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      const res = await fetch("/api/settings/ors/test", {
        method: "POST",
      });
      const json = await res.json();
      if (json.ok) {
        toast.success(`เชื่อมต่อสำเร็จ (พบ ${json.data?.count ?? 0} ผลลัพธ์)`);
        onChanged?.();
      } else {
        toast.error(json.error ?? "เชื่อมต่อไม่สำเร็จ");
      }
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 size={20} className="animate-spin" style={{ color: "var(--text-muted)" }} />
      </div>
    );
  }

  const sourceLabel =
    status?.source === "db"
      ? "จากฐานข้อมูล"
      : status?.source === "env"
        ? "จาก .env"
        : null;

  return (
    <div>
      {!embedded && (
        <p className="text-[12px] mb-5" style={{ color: "var(--text-muted)" }}>
          API Key ระดับระบบสำหรับ OpenRouteService (คำนวณระยะทาง/ค้นหาสถานที่) ใช้ได้กับทุกฟอร์มที่ต้องการแผนที่
        </p>
      )}

      {/* Current status card */}
      <div
        className="rounded-xl p-4 mb-6 flex items-start gap-3"
        style={{ background: "var(--bg-card-alt)", border: "1px solid var(--border-card)" }}
      >
        <div className="shrink-0 mt-0.5">
          <KeyRound size={18} style={{ color: "var(--text-muted)" }} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-[13px] font-semibold" style={{ color: "var(--text-heading)" }}>
              สถานะ API Key
            </span>

            {status?.configured ? (
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold"
                style={{ background: "#d1fae5", color: "#065f46" }}
              >
                <CheckCircle2 size={11} />
                ตั้งค่าแล้ว
              </span>
            ) : (
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold"
                style={{ background: "#fef3c7", color: "#92400e" }}
              >
                <AlertCircle size={11} />
                ยังไม่ได้ตั้งค่า
              </span>
            )}
          </div>

          {status?.configured && status.masked && (
            <p
              className="text-[12px] font-mono mb-0.5 break-all"
              style={{ color: "var(--text-secondary)" }}
            >
              {status.masked}
            </p>
          )}

          {sourceLabel && (
            <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
              แหล่งที่มา: {sourceLabel}
              {status?.source === "env" && (
                <span className="ml-1">— การบันทึกใหม่จะ override ค่าจาก .env</span>
              )}
            </p>
          )}
        </div>
      </div>

      {/* Input + Save */}
      <div className="mb-4">
        <label
          className="block text-[12px] font-semibold mb-1.5"
          style={{ color: "var(--text-secondary)" }}
        >
          {status?.configured ? "เปลี่ยน API Key" : "กรอก API Key ใหม่"}
        </label>
        <div className="flex gap-2">
          <input
            type="password"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            placeholder={status?.configured ? "กรอกเพื่อเปลี่ยน key ใหม่" : "วาง API Key ที่นี่..."}
            className="flex-1 rounded-xl px-3 py-2.5 text-[13px] border outline-none"
            style={{
              background: "var(--bg-card-alt)",
              borderColor: "var(--border-card)",
              color: "var(--text-primary)",
            }}
            autoComplete="new-password"
          />
          <button
            onClick={handleSave}
            disabled={saving || !newKey.trim()}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl border-none text-[13px] font-bold cursor-pointer shrink-0"
            style={{
              background: "var(--color-action)",
              color: "#fff",
              opacity: saving || !newKey.trim() ? 0.5 : 1,
              cursor: saving || !newKey.trim() ? "not-allowed" : "pointer",
            }}
          >
            {saving ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Save size={14} />
            )}
            บันทึก
          </button>
        </div>

        {/* Clear note */}
        {status?.configured && (
          <p className="text-[11px] mt-1.5" style={{ color: "var(--text-muted)" }}>
            หากต้องการล้างค่าในฐานข้อมูลและใช้ .env แทน ให้บันทึกด้วยค่าว่าง
          </p>
        )}
      </div>

      {/* Test button */}
      <div className="mb-6">
        <button
          onClick={handleTest}
          disabled={testing || !status?.configured}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl border-none text-[13px] font-semibold cursor-pointer"
          style={{
            background: "var(--bg-badge)",
            color:
              !status?.configured
                ? "var(--text-muted)"
                : "var(--text-secondary)",
            opacity: testing ? 0.6 : 1,
            cursor:
              testing || !status?.configured ? "not-allowed" : "pointer",
          }}
        >
          {testing ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <TestTube2 size={14} />
          )}
          ทดสอบการเชื่อมต่อ
        </button>
        {!status?.configured && (
          <p className="text-[11px] mt-1.5" style={{ color: "var(--text-muted)" }}>
            บันทึก API Key ก่อนจึงจะทดสอบได้
          </p>
        )}
      </div>

      {/* Helper */}
      <div
        className="rounded-xl p-3.5 text-[12px]"
        style={{ background: "var(--bg-card-alt)", border: "1px solid var(--border-card)", color: "var(--text-muted)" }}
      >
        <span>ขอ key ฟรีได้ที่ </span>
        <a
          href="https://openrouteservice.org"
          target="_blank"
          rel="noreferrer"
          className="font-semibold underline"
          style={{ color: "var(--nav-active-text)" }}
        >
          openrouteservice.org
        </a>
        <span> → Dashboard → Tokens</span>
      </div>
    </div>
  );
}
