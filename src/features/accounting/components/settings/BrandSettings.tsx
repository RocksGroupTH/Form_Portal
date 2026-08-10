"use client";

import { useState, useEffect } from "react";
import useSWR from "swr";
import { Save } from "lucide-react";
import { toast } from "sonner";
import { SettingOption, SettingOptionGroup } from "@/components/settings/SettingOption";
import type { AccBrandOption } from "@/features/accounting/types";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface FormBrandRow {
  id: number;
  brandCode: string;
  isActive: boolean;
  sortOrder: number;
}

export function BrandSettings() {
  const { data, mutate } = useSWR<{ ok: boolean; data: FormBrandRow[] }>(
    "/api/request/accounting/settings/brands",
    fetcher,
  );
  const { data: allData } = useSWR<{ ok: boolean; data: AccBrandOption[] }>(
    "/api/request/accounting/options/all-brands",
    fetcher,
  );
  const allBrands = allData?.data ?? [];

  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [savedChecked, setSavedChecked] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (data?.data) {
      const activeCodes = new Set(
        data.data.filter((b) => b.isActive).map((b) => b.brandCode),
      );
      setSavedChecked(activeCodes);
      if (!initialized) {
        setChecked(activeCodes);
        setInitialized(true);
      }
    }
  }, [data, initialized]);

  const toggle = (code: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/request/accounting/settings/brands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandCodes: Array.from(checked) }),
      });
      const json = await res.json();
      if (json.ok) {
        toast.success("บันทึกสำเร็จ");
        setSavedChecked(new Set(checked));
        mutate();
      } else {
        toast.error(json.error ?? "บันทึกไม่สำเร็จ");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <SettingOptionGroup
        title="แบรนด์ที่เบิกได้"
        description="เลือกแบรนด์ที่พนักงานสามารถเลือกในฟอร์มเบิกค่าเดินทาง AP-1 — ติ๊กเพื่อเปิด/ปิด แล้วกดบันทึก"
      >
        {allBrands.map((brand) => {
          const active = checked.has(brand.brandCode);
          const wasSaved = savedChecked.has(brand.brandCode);
          const isDirty = active !== wasSaved;
          const rowStatus = isDirty ? "pending" : active ? "saved" : "default";
          return (
            <SettingOption
              key={brand.brandCode}
              variant="checkbox"
              checked={active}
              rowStatus={rowStatus}
              onChange={() => toggle(brand.brandCode)}
              label={brand.brandName}
              description={`รหัส ${brand.brandCode} — ${
                isDirty
                  ? active
                    ? "เลือกแล้ว — รอบันทึก"
                    : "ยกเลิกแล้ว — รอบันทึก"
                  : active
                    ? "อนุญาตให้เบิก"
                    : "ไม่อนุญาตให้เบิก"
              }`}
              leading={
                brand.brandLogo ? (
                  <img
                    src={brand.brandLogo}
                    alt=""
                    className="h-6 w-auto object-contain"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                ) : undefined
              }
            />
          );
        })}
      </SettingOptionGroup>

      {allBrands.length === 0 && (
        <p className="text-[12px] py-6 text-center" style={{ color: "var(--text-muted)" }}>
          ไม่พบแบรนด์
        </p>
      )}

      <p className="text-[11px] my-4" style={{ color: "var(--text-muted)" }}>
        เลือก {checked.size} จาก {allBrands.length} แบรนด์
      </p>

      <button
        onClick={handleSave}
        disabled={saving}
        className="flex items-center gap-2 px-5 py-2.5 rounded-xl cursor-pointer border-none text-[13px] font-bold"
        style={{
          background: "var(--color-action)",
          color: "#fff",
          opacity: saving ? 0.6 : 1,
        }}
      >
        <Save size={14} />
        {saving ? "กำลังบันทึก..." : "บันทึก"}
      </button>
    </div>
  );
}
