"use client";

import type { ReactNode } from "react";
import { fmtYmdDisplay } from "@/features/accounting/lib/format-travel-dates";
import { Globe } from "lucide-react";
import { countryNameBoth, isKnownCountry } from "@/lib/acc/country-currency";
import { bookingBrandLabel, bookingCountryCode } from "@/features/travel-booking/lib/booking-context";
import type { AccBrandOption } from "@/features/accounting/types";
import { DIRECTION_LABEL_TH } from "@/features/travel-booking/constants";
import type { OptionIconMaps } from "@/features/travel-booking/hooks/useOptionIcons";
import type { BookingType, TravelBookingRequest } from "@/features/travel-booking/types";

/* ── What Admin needs in front of them to actually place a booking ── */

/**
 * `icon` is usually an emoji string — that is what `OptionIconMaps` holds and
 * what every `typeInfo` row uses — but it is typed as a `ReactNode` so the two
 * rows that need a real image can carry one.
 *
 * **The widening has one consequence, and it is a compile error rather than a
 * comment**: see `LegItem` below, which `mergeSharedLegItems` needs and which
 * deliberately keeps the narrow `string | null`.
 */
export type InfoItem = { label: string; value: string; icon?: ReactNode };
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

/**
 * Trip facts every booking needs, regardless of type.
 *
 * **แบรนด์ and ประเทศ lead**, in the order the request form asks them and the
 * order the detail page lists them. They are what the desk states to a supplier
 * before anything else: which company the booking is billed to, and where it is
 * going. The panel had neither, though it held both codes all along — one to
 * decide the currency toggle and one to tell the AI read which currencies a
 * document may be in.
 *
 * `brand` is optional because the panel learns it asynchronously: the codes are
 * on the request, the name and the logo are in the brand registry, and the fetch
 * that carries them can fail permanently (see `brandOption` in
 * `AdminBookingPanel`). Absent, the row reads the bare code with no mark — which
 * is what the detail page shows anyway — so this never renders blank and never
 * waits.
 *
 * **The whole option, not just its name**, because `brandLogo` comes with it:
 * that URL resolves an *uploaded* mark where a hardcoded
 * `/brandlogo/{code}-200.png` cannot, and it costs nothing extra since the
 * currency toggle has already fetched the object.
 */
export function tripInfo(req: TravelBookingRequest, brand?: AccBrandOption | null): InfoGroup[] {
  const days = daysBetween(req.departDate, req.returnDate);
  const country = bookingCountryCode(req.countryCode);
  return [
    {
      items: [
        {
          // `แบรนด์ที่เบิก`, the wording every other surface uses — the detail
          // page, AP-1's detail, the fill-in form and the report. The label
          // column is already sized for `สถานที่ปฏิบัติงาน`, so the longer
          // caption costs no width.
          label: "แบรนด์ที่เบิก",
          icon: brand?.brandLogo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={brand.brandLogo}
              alt=""
              className="h-5 w-auto object-contain shrink-0"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          ) : null,
          value: bookingBrandLabel(req.brandCode, brand?.brandName),
        },
        {
          label: "ประเทศ",
          // The SVG under `public/flags/`, not `countryFlag`'s regional-indicator
          // emoji. `public/flags/README.md` records the emoji as tried and
          // rejected: Windows ships no flag glyphs, so Chrome and Edge there
          // render the two bare letters as text — which is what this shipped with
          // for a few hours, and reads as a stray code beside a name that already
          // spells the country out.
          //
          // A globe ONLY where there is no flag to show. Every country
          // `COUNTRIES` offers has one — `flag-asset-coverage.test.ts` fails
          // otherwise — so this is for a code that is not on the list, which
          // `bookingCountryCode` deliberately passes through uncorrected rather
          // than silently calling Thailand. Decided on `isKnownCountry` rather
          // than on the image's `onError`, so the fallback is settled at render
          // instead of after a failed request and nothing flickers. Same rule and
          // same wording as AP-1's `CountryCodeBadge`.
          icon: isKnownCountry(country) ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/flags/${country.toLowerCase()}.svg`}
              alt=""
              aria-hidden
              className="shrink-0 h-[11px] w-[16px] rounded-[2px] object-cover"
              style={{ border: "1px solid var(--border-card)" }}
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          ) : (
            <Globe size={13} className="shrink-0" style={{ color: "var(--nav-active-text)" }} />
          ),
          value: countryNameBoth(country) ?? country,
        },
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
 * A leg's items, with a **narrower icon than `InfoItem`'s on purpose**.
 *
 * `mergeSharedLegItems` hoists by comparing icons with `===`, which is value
 * equality for a string and never true for two JSX elements, since each render
 * builds fresh objects. Typed `ReactNode` here, an element icon would compile
 * and then stop hoisting silently — and the damage is worse than one row
 * printing twice: ยานพาหนะ is the only leg row that ever hoists, so `shared`
 * would be empty and the early return below would drop the shared block
 * altogether. Narrowing makes that a type error where somebody would write it.
 *
 * The other fix not to make is dropping `icon` from the comparison: that hoists
 * two rows showing different marks and keeps whichever leg came first.
 */
type LegItem = { label: string; value: string; icon?: string | null };
type LegGroup = { title?: string; items: LegItem[] };

/**
 * Hoist facts that are identical on both legs (usually the vehicle — the form picks one for
 * the whole trip) into a shared block, so each direction only lists what differs.
 */
function mergeSharedLegItems(legs: LegGroup[]): InfoGroup[] {
  if (legs.length !== 2) return legs;
  const [a, b] = legs;
  const sharedLabels: string[] = [];
  const shared: LegItem[] = [];
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
    ): LegGroup => {
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
    const out: LegGroup[] = [];
    if (req.goNeedsTicketBooking) {
      out.push(leg("go", req.goVehicleId, req.goVehicleCustomText || req.goVehicleName, req.departDate, req.departTime));
    }
    if (req.returnNeedsTicketBooking) {
      out.push(leg("return", req.returnVehicleId, req.returnVehicleCustomText || req.returnVehicleName, req.returnDate, req.returnTime));
    }
    return mergeSharedLegItems(out);
  }

  // rent — ข้อ15/16.
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
          // **No fallback to the trip's dates.** This read
          // `req.rentStartDate ?? req.departDate`, so a request with no rental
          // window printed the trip's own dates under a rental caption — which
          // is what the desk saw on TRL26-09007 on 2026-09-02: `ไม่เช่า`, and
          // beneath it a confident "04/09/2026 – 06/09/2026 (3 วัน)" for a
          // rental that does not exist. A window is either recorded or it is
          // not, and `—` says which. The validator requires both dates for a
          // real rental, so the dash is reachable only where there is genuinely
          // nothing to show.
          value: (() => {
            const from = req.rentStartDate;
            const to = req.rentEndDate;
            if (!from && !to) return "—";
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
                  {/* `inline-flex items-center` so an image sits on the text's
                      centre line; a bare margin was enough while every icon was
                      an emoji glyph and is not once one is an `<img>`. */}
                  {it.icon ? (
                    <span className="mr-1.5 inline-flex items-center align-[-0.15em]">{it.icon}</span>
                  ) : null}
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
