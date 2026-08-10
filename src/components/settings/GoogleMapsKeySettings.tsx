"use client";

import { useState, useEffect } from "react";
import {
  KeyRound,
  CheckCircle2,
  AlertCircle,
  Loader2,
  TestTube2,
  Save,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import { testGoogleMapsKeyInBrowser } from "@/lib/google-maps-client";

interface MapsKeyStatus {
  configured: boolean;
  masked: string | null;
  source: "db" | "env" | null;
}

interface Props {
  embedded?: boolean;
  onChanged?: () => void;
}

export function GoogleMapsKeySettings({ embedded, onChanged }: Props) {
  const [status, setStatus] = useState<MapsKeyStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [newKey, setNewKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const fetchStatus = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/settings/google-maps");
      const json = await res.json();
      if (json.ok) setStatus(json.data as MapsKeyStatus);
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
      const res = await fetch("/api/settings/google-maps", {
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
      const cfgRes = await fetch("/api/maps/config");
      const cfgJson = await cfgRes.json();
      if (!cfgJson.ok || !cfgJson.data?.apiKey) {
        toast.error("ยังไม่มี API Key — บันทึกก่อนทดสอบ");
        return;
      }

      const count = await testGoogleMapsKeyInBrowser(cfgJson.data.apiKey as string);

      await fetch("/api/settings/google-maps/test", { method: "POST" });
      toast.success(`เชื่อมต่อสำเร็จ (พบ ${count} ผลลัพธ์)`);
      onChanged?.();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "เชื่อมต่อไม่สำเร็จ";
      toast.error(msg);
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
          API Key ระดับระบบสำหรับ Google Maps (ค้นหาสถานที่ · คำนวณระยะทาง) ใช้กับฟอร์ม AP-1
          และฟิลด์เส้นทางในฟอร์มสำนักงาน
        </p>
      )}

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
            <p className="text-[12px] font-mono mb-0.5 break-all" style={{ color: "var(--text-secondary)" }}>
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

      <div className="mb-4">
        <label className="block text-[12px] font-semibold mb-1.5" style={{ color: "var(--text-secondary)" }}>
          {status?.configured ? "เปลี่ยน API Key" : "กรอก API Key ใหม่"}
        </label>
        <div className="flex gap-2">
          <input
            type="password"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            placeholder={status?.configured ? "กรอกเพื่อเปลี่ยน key ใหม่" : "วาง Google Maps API Key ที่นี่..."}
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
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            บันทึก
          </button>
        </div>
        {status?.configured && (
          <p className="text-[11px] mt-1.5" style={{ color: "var(--text-muted)" }}>
            หากต้องการล้างค่าในฐานข้อมูลและใช้ .env แทน ให้บันทึกด้วยค่าว่าง
          </p>
        )}
      </div>

      <div className="mb-6">
        <button
          onClick={handleTest}
          disabled={testing || !status?.configured}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl border-none text-[13px] font-semibold cursor-pointer"
          style={{
            background: "var(--bg-badge)",
            color: !status?.configured ? "var(--text-muted)" : "var(--text-secondary)",
            opacity: testing ? 0.6 : 1,
            cursor: testing || !status?.configured ? "not-allowed" : "pointer",
          }}
        >
          {testing ? <Loader2 size={14} className="animate-spin" /> : <TestTube2 size={14} />}
          ทดสอบการเชื่อมต่อ
        </button>
        {!status?.configured && (
          <p className="text-[11px] mt-1.5" style={{ color: "var(--text-muted)" }}>
            บันทึก API Key ก่อนจึงจะทดสอบได้
          </p>
        )}
      </div>

      <div
        className="rounded-xl p-4 text-[12px] space-y-3"
        style={{ background: "var(--bg-card-alt)", border: "1px solid var(--border-card)", color: "var(--text-muted)" }}
      >
        <p className="font-semibold" style={{ color: "var(--text-heading)" }}>
          วิธีตั้งค่า Google Maps API
        </p>
        <ol className="list-decimal pl-4 space-y-2">
          <li>
            เปิด{" "}
            <a
              href="https://console.cloud.google.com/google/maps-apis/overview"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-0.5 font-semibold underline"
              style={{ color: "var(--nav-active-text)" }}
            >
              Google Cloud Console <ExternalLink size={11} />
            </a>{" "}
            และเลือกโปรเจกต์ (หรือสร้างใหม่)
          </li>
          <li>เปิดใช้งาน APIs: <strong>Maps JavaScript API</strong>, <strong>Places API (New)</strong>, <strong>Directions API</strong>, <strong>Geocoding API</strong></li>
          <li>ไปที่ APIs &amp; Services → Credentials → Create credentials → <strong>API key</strong></li>
          <li>
            จำกัด Key (แนะนำ): Application restrictions = <strong>HTTP referrers</strong> — เพิ่ม
            <code className="mx-1 px-1 rounded" style={{ background: "var(--bg-badge)" }}>
              {typeof window !== "undefined" ? `${window.location.origin}/*` : "https://your-domain/*"}
            </code>
            และ <code className="mx-1 px-1 rounded" style={{ background: "var(--bg-badge)" }}>http://localhost:3021/*</code> สำหรับ dev
          </li>
          <li>
            API restrictions: จำกัดเฉพาะ Maps JavaScript, Places (New), Directions, Geocoding
          </li>
          <li>วาง API Key ด้านบนแล้วกด <strong>บันทึก</strong> → <strong>ทดสอบการเชื่อมต่อ</strong> (ทดสอบจากเบราว์เซอร์ — ตรงกับการใช้งานจริงใน AP-1)</li>
        </ol>
        <p className="text-[11px] rounded-lg px-3 py-2 m-0" style={{ background: "var(--bg-badge)", color: "var(--text-secondary)" }}>
          <strong>ทำไมเคย error REQUEST_DENIED?</strong> ปุ่มทดสอบเดิมเรียก Geocoding จาก server
          แต่ HTTP referrer ใช้ได้เฉพาะ request จากเว็บ (เช่น <code>localhost:3021</code>) — ตอนนี้ทดสอบจากเบราว์เซอร์แล้ว
          หากยัง error ให้ตรวจ: เปิด Billing, เปิด Geocoding API, และเพิ่ม Geocoding ใน API restrictions
        </p>
        <p className="text-[11px]">
          หมายเหตุ: Google Maps ต้องเปิด Billing ในโปรเจกต์ Cloud (มี free tier รายเดือน) — ดูรายละเอียดที่{" "}
          <a
            href="https://developers.google.com/maps/billing-and-pricing/pricing"
            target="_blank"
            rel="noreferrer"
            className="underline"
            style={{ color: "var(--nav-active-text)" }}
          >
            ราคา Google Maps Platform
          </a>
        </p>
      </div>
    </div>
  );
}
