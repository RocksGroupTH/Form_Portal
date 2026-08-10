"use client";

import type { WorkLocationInput } from "@/features/travel-booking/hooks/useTravelBookingForm";
import { OrsPlaceField } from "./OrsPlaceField";

/** ข้อ9 — สถานที่ไปปฏิบัติงาน. A single ORS place (exactly one entry). */
export function WorkLocationList({
  items,
  onChange,
  hasError,
  onProvinceDetected,
  placeholder = "เช่น สาขาเชียงใหม่ ถ.นิมมานเหมินท์",
}: {
  items: WorkLocationInput[];
  onChange: (items: WorkLocationInput[]) => void;
  hasError?: boolean;
  /** A picked ORS place (label + region) — parent uses it to set จังหวัด. */
  onProvinceDetected?: (place: { label: string; region: string | null }) => void;
  placeholder?: string;
}) {
  const name = items[0]?.name ?? "";

  return (
    <OrsPlaceField
      value={name || null}
      onChange={(v) => onChange([{ name: v ?? "", sortOrder: 0 }])}
      onSelectPlace={(p) => onProvinceDetected?.({ label: p.label, region: p.region ?? null })}
      placeholder={placeholder}
      hasError={!!hasError && !name.trim()}
    />
  );
}
