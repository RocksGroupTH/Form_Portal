"use client";

import { fmtYmdDisplay } from "@/features/accounting/lib/format-travel-dates";
import { DIRECTION_LABEL_TH } from "@/features/travel-booking/constants";
import type { OptionIconMaps } from "@/features/travel-booking/hooks/useOptionIcons";
import type { BookingType, TravelBookingRequest } from "@/features/travel-booking/types";

/* ── What Admin needs in front of them to actually place a booking ── */

export type InfoItem = { label: string; value: string; icon?: string | null };
/** A titled block of facts — ticket bookings use one block per direction (ขาไป / ขากลับ). */
export type InfoGroup = { title?: string; items: InfoItem[] };

const dash = (v: string | null | undefined) => (v && v.trim() ? v.trim() : "—");

/** "03/08/2569" or "03/08/2569 – 05/08/2569" (collapses when both ends are the same day). */
function fmtRange(from: string | null, to: string | null): string {
  const parts = [from, to].filter((d): d is string => !!d).map(fmtYmdDisplay);
  if (parts.length === 0) return "—";
  if (parts.length === 1 || parts[0] === parts[1]) return parts[0];
  return parts.join(" – ");
}

/** Whole nights between two YYYY-MM-DD days (local parsing — never toISOString). */
function nightsBetween(from: string | null, to: string | null): number | null {
  if (!from || !to) return null;
  const a = new Date(`${from}T00:00:00`);
  const b = new Date(`${to}T00:00:00`);
  const n = Math.round((b.getTime() - a.getTime()) / 86_400_000);
  return n > 0 ? n : null;
}

/** Inclusive day count — 01/07 → 03/07 is 3 วัน. */
function daysBetween(from: string | null, to: string | null): number | null {
  if (!from) return null;
  const nights = nightsBetween(from, to);
  return nights != null ? nights + 1 : 1;
}

/** Trip facts every booking needs, regardless of type. */
export function tripInfo(req: TravelBookingRequest): InfoGroup[] {
  const days = daysBetween(req.departDate, req.returnDate);
  return [
    {
      items: [
        {
          label: "วันเดินทาง",
          value: fmtRange(req.departDate, req.returnDate) + (days ? ` (${days} วัน)` : ""),
        },
        { label: "สถานที่ปฏิบัติงาน", value: dash(req.workLocations.map((w) => w.name).join(", ")) },
        // No จังหวัด/เมือง row. ข้อ8 was removed on 2026-09-01, so every request
        // filed since reads "—" here, and the ones before it say a province the
        // work location above already names better. The desk books against the
        // place and the pin below it, not against an administrative area.
      ],
    },
  ];
}

/**
 * Hoist facts that are identical on both legs (usually the vehicle — the form picks one for
 * the whole trip) into a shared block, so each direction only lists what differs.
 */
function mergeSharedLegItems(legs: InfoGroup[]): InfoGroup[] {
  if (legs.length !== 2) return legs;
  const [a, b] = legs;
  const sharedLabels: string[] = [];
  const shared: InfoItem[] = [];
  for (const item of a.items) {
    const twin = b.items.find((x) => x.label === item.label);
    if (twin && twin.value === item.value && (twin.icon ?? null) === (item.icon ?? null)) {
      shared.push(item);
      sharedLabels.push(item.label);
    }
  }
  if (shared.length === 0) return legs;
  const trimmed = legs
    .map((l) => ({ ...l, items: l.items.filter((i) => sharedLabels.indexOf(i.label) === -1) }))
    .filter((l) => l.items.length > 0);
  return [{ items: shared }, ...trimmed];
}

/** Extra facts specific to one booking type (room nights, ticket legs, rental window). */
export function typeInfo(req: TravelBookingRequest, type: BookingType, icons: OptionIconMaps): InfoGroup[] {
  if (type === "room") {
    const nights = nightsBetween(req.departDate, req.returnDate);
    return [
      {
        items: [
          { label: "เข้าพัก", value: fmtRange(req.departDate, req.returnDate) + (nights ? ` (${nights} คืน)` : "") },
          {
            label: "ประเภทที่พัก",
            value: dash(req.accommodationCustomText || req.accommodationName),
            icon: req.accommodationId != null ? icons.accommodation[req.accommodationId] : null,
          },
        ],
      },
    ];
  }

  if (type === "ticket") {
    // One block per direction — a single run-on line is unreadable once จุดขึ้น is long.
    const leg = (
      dir: "go" | "return",
      vehicleId: number | null,
      vehicle: string | null,
      date: string | null,
      time: string | null,
    ): InfoGroup => {
      const points = req.departureLocations
        .filter((l) => l.direction === dir)
        .map((l) => l.name)
        .join(", ");
      return {
        title: DIRECTION_LABEL_TH[dir],
        items: [
          { label: "ยานพาหนะ", value: dash(vehicle), icon: vehicleId != null ? icons.vehicle[vehicleId] : null },
          { label: "วัน–เวลา", value: [date ? fmtYmdDisplay(date) : null, time ? `${time} น.` : null].filter(Boolean).join(" · ") || "—" },
          { label: "จุดขึ้น", value: dash(points) },
        ],
      };
    };
    const out: InfoGroup[] = [];
    if (req.goNeedsTicketBooking) {
      out.push(leg("go", req.goVehicleId, req.goVehicleCustomText || req.goVehicleName, req.departDate, req.departTime));
    }
    if (req.returnNeedsTicketBooking) {
      out.push(leg("return", req.returnVehicleId, req.returnVehicleCustomText || req.returnVehicleName, req.returnDate, req.returnTime));
    }
    return mergeSharedLegItems(out);
  }

  // rent — ข้อ15/16: the rental window is captured separately, falling back to the trip dates.
  return [
    {
      items: [
        {
          label: "ประเภทรถเช่า",
          value: dash(req.rentVehicleCustomText || req.rentVehicleName),
          icon: req.rentVehicleId != null ? icons.rent[req.rentVehicleId] : null,
        },
        {
          label: "ช่วงเวลาเช่า",
          value: (() => {
            const from = req.rentStartDate ?? req.departDate;
            const to = req.rentEndDate ?? req.returnDate;
            const days = daysBetween(from, to);
            return fmtRange(from, to) + (days ? ` (${days} วัน)` : "");
          })(),
        },
        {
          // The place only. The province was appended here too until
          // 2026-09-01; on a request filed since it is null and contributed
          // nothing, and on an older one it repeated in coarser words what the
          // work location already said.
          label: "ใช้ที่",
          value: dash(req.workLocations.map((w) => w.name).join(", ")),
        },
      ],
    },
  ];
}

/** Compact label/value strip — read-only context, visually distinct from the fill-in fields. */
export function InfoStrip({ groups }: { groups: InfoGroup[] }) {
  const filled = groups.filter((g) => g.items.length > 0);
  if (filled.length === 0) return null;
  return (
    <div className="rounded-lg px-3.5 py-2.5 flex flex-col gap-2.5" style={{ background: "var(--bg-card-alt)" }}>
      {filled.map((g, gi) => (
        <div
          key={g.title ?? gi}
          className={gi > 0 ? "pt-2.5" : undefined}
          style={gi > 0 ? { borderTop: "1px dashed var(--border-light)" } : undefined}
        >
          {g.title && (
            <p className="text-[11px] font-bold m-0 mb-1.5" style={{ color: "var(--nav-active-text)" }}>
              {g.title}
            </p>
          )}
          <div className="flex flex-col gap-1.5">
            {g.items.map((it) => (
              <div key={it.label} className="flex flex-col sm:flex-row sm:items-baseline gap-0.5 sm:gap-2">
                <span className="text-[11px] font-semibold shrink-0 sm:w-32" style={{ color: "var(--text-muted)" }}>
                  {it.label}
                </span>
                <span className="text-[12.5px] min-w-0" style={{ color: "var(--text-primary)" }}>
                  {it.icon ? <span className="mr-1.5">{it.icon}</span> : null}
                  {it.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
