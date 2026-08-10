"use client";

import { OrsPlaceField } from "./OrsPlaceField";
import { TimeRangeChips } from "./TimeRangeChips";
import { errLabelStyle, labelClass, requiredStar } from "./shared";
import type { DepartureLocationInput } from "@/features/travel-booking/hooks/useTravelBookingForm";
import type { TravelDirection, VehicleOption } from "@/features/travel-booking/types";
import { DIRECTION_LABEL_TH } from "@/features/travel-booking/constants";

/**
 * One direction's leg (ข้อ13/ข้อ11) — the departure place + time window for ขาไป or ขากลับ.
 * The vehicle is chosen once for the whole trip by the parent; this only renders the
 * per-direction inputs the selected vehicle's config asks for (place / time).
 */
export function TransportSection({
  direction,
  vehicle,
  time,
  departureLocations,
  onChangeTime,
  onChangeDepartureLocations,
  errorKeys,
}: {
  direction: TravelDirection;
  /** The trip's selected vehicle (source of the needs* flags + place suggestions). */
  vehicle: VehicleOption | undefined;
  time: string | null;
  departureLocations: DepartureLocationInput[];
  onChangeTime: (v: string | null) => void;
  onChangeDepartureLocations: (all: DepartureLocationInput[]) => void;
  errorKeys: Set<string>;
}) {
  const prefix = direction === "go" ? "go" : "return";
  const departureKey = `${prefix}DepartureLocations`;
  const timeKey = direction === "go" ? "departTime" : "returnTime";

  const needsDeparture = !!vehicle?.needsDepartureLocations;
  const placeSuggestions = (vehicle?.places ?? []).map((p) => p.name);
  const selectedPlace = departureLocations.find((d) => d.direction === direction)?.name ?? "";

  const setPlace = (name: string | null) => {
    const others = departureLocations.filter((d) => d.direction !== direction);
    onChangeDepartureLocations(name ? [...others, { direction, name, sortOrder: 0 }] : others);
  };

  return (
    <div
      className="rounded-xl px-4 py-3.5 flex flex-col gap-3"
      style={{ background: "var(--bg-card-alt)", border: "1px solid var(--border-card)" }}
    >
      <p className="text-[13px] font-bold m-0" style={{ color: "var(--text-heading)" }}>
        {DIRECTION_LABEL_TH[direction]}
      </p>

      {needsDeparture && (
        <div>
          <label className={labelClass} style={errLabelStyle(errorKeys.has(departureKey))}>
            จุดขึ้นรถ/ขึ้นเครื่อง{requiredStar}
          </label>
          <OrsPlaceField
            value={selectedPlace || null}
            onChange={setPlace}
            suggestions={placeSuggestions}
            hasError={errorKeys.has(departureKey)}
          />
        </div>
      )}

      {vehicle?.needsDepartTime && (
        <TimeRangeChips
          label={`เวลาออกเดินทาง${DIRECTION_LABEL_TH[direction]}`}
          value={time}
          onChange={onChangeTime}
          hasError={errorKeys.has(timeKey)}
        />
      )}
    </div>
  );
}
