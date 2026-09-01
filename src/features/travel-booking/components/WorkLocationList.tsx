"use client";

import type { WorkLocationInput } from "@/features/travel-booking/hooks/useTravelBookingForm";
import { GooglePlaceField } from "./GooglePlaceField";

/** ข้อ9 — สถานที่ไปปฏิบัติงาน. A single ORS place (exactly one entry). */
export function WorkLocationList({
  items,
  onChange,
  hasError,
  country,
  placeholder = "เช่น สาขาเชียงใหม่ ถ.นิมมานเหมินท์",
}: {
  items: WorkLocationInput[];
  onChange: (items: WorkLocationInput[]) => void;
  hasError?: boolean;
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
      // The label was already committed by onChange above; this rewrites the
      // same row with the coordinates Google returned for it.
      onSelectPlace={(p) =>
        onChange([{ name: p.label, sortOrder: 0, lat: p.lat, lng: p.lng }])
      }
      country={country}
      placeholder={placeholder}
      hasError={!!hasError && !name.trim()}
    />
  );
}
