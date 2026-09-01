"use client";

import type { WorkLocationInput } from "@/features/travel-booking/hooks/useTravelBookingForm";
import { GooglePlaceField } from "./GooglePlaceField";

/** ข้อ9 — สถานที่ไปปฏิบัติงาน. A single ORS place (exactly one entry). */
export function WorkLocationList({
  items,
  onChange,
  hasError,
  onProvinceDetected,
  country,
  placeholder = "เช่น สาขาเชียงใหม่ ถ.นิมมานเหมินท์",
}: {
  items: WorkLocationInput[];
  onChange: (items: WorkLocationInput[]) => void;
  hasError?: boolean;
  /**
   * A picked place — the parent uses it to fill จังหวัด/เมือง.
   *
   * `region` is Google's SECONDARY text, which is where the place is. It used
   * to be handed the main text — the place's own name — so the auto-fill
   * silently matched nothing for every hotel and office anybody ever picked.
   */
  onProvinceDetected?: (place: { label: string; region: string | null }) => void;
  /** ISO-3166-1 alpha-2 to search inside — the trip's own country. */
  country?: string | null;
  placeholder?: string;
}) {
  const name = items[0]?.name ?? "";

  return (
    <GooglePlaceField
      value={name || null}
      // Typed, not picked — so no coordinates, and any the previous pick left
      // are dropped rather than kept against a different place.
      onChange={(v) => onChange([{ name: v ?? "", sortOrder: 0, lat: null, lng: null }])}
      withCoordinates
      // Google's secondary text is where the place is — "Chiang Mai, Thailand"
      // — which is what the parent matches against the จังหวัด/เมือง list. ORS
      // called the same thing `region`; the shape differs, the use does not.
      onSelectPlace={(p) => {
        // The label was already committed by onChange above; this adds the
        // coordinates to the row it just wrote.
        onChange([{ name: p.label, sortOrder: 0, lat: p.lat, lng: p.lng }]);
        onProvinceDetected?.({ label: p.label, region: p.secondaryText });
      }}
      country={country}
      placeholder={placeholder}
      hasError={!!hasError && !name.trim()}
    />
  );
}
