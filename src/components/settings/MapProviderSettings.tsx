"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Map as MapIcon } from "lucide-react";
import { GoogleMapsKeySettings } from "@/components/settings/GoogleMapsKeySettings";
import type { MapProviderStatus } from "@/lib/map-provider";

function providerLabel(provider: MapProviderStatus["activeProvider"]): string {
  if (provider === "google") return "Google Maps";
  return "ยังไม่พร้อม";
}

export function MapProviderSettings() {
  const [status, setStatus] = useState<MapProviderStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/maps/status");
      const json = await res.json();
      if (json.ok) setStatus(json.data as MapProviderStatus);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  return (
    <div className="space-y-6">
      <p className="text-[12px]" style={{ color: "var(--text-muted)" }}>
        ตั้งค่า <strong>Google Maps API Key</strong> สำหรับแผนที่และคำนวณระยะทาง
        ใช้กับฟอร์มเบิกค่าเดินทาง AP-1 และฟิลด์เส้นทางในฟอร์มสำนักงาน
      </p>

      <div
        className="rounded-xl px-4 py-3 text-[12px] flex flex-wrap items-center gap-2"
        style={{ background: "var(--bg-info-green)", border: "1px solid var(--border-info-green)", color: "var(--text-info-green)" }}
      >
        <span className="font-semibold">สถานะ:</span>
        {loading ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <span className="font-bold">{providerLabel(status?.activeProvider ?? null)}</span>
        )}
        {!loading && status?.google.configured && !status.google.ready && (
          <span className="opacity-80">(ตั้งค่า key แล้ว — ทดสอบการเชื่อมต่อจากเบราว์เซอร์)</span>
        )}
      </div>

      <section
        className="rounded-2xl p-5"
        style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}
      >
        <div className="flex items-center gap-2 mb-4">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: "var(--nav-active-bg)" }}
          >
            <MapIcon size={16} style={{ color: "var(--nav-active-text)" }} />
          </div>
          <div>
            <h2 className="text-[14px] font-bold" style={{ color: "var(--text-heading)" }}>
              Google Maps
            </h2>
            <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
              ค้นหาสถานที่ · คำนวณระยะทาง · แสดงแผนที่
            </p>
          </div>
        </div>
        <GoogleMapsKeySettings embedded onChanged={refreshStatus} />
      </section>
    </div>
  );
}
