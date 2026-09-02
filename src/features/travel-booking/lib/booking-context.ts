import { BOOKING_DEFAULT_COUNTRY } from "@/lib/acc/travel-booking/booking-country";

/**
 * The two request-level facts the Admin booking desk needs in front of it: which
 * company the booking is billed to, and where the trip goes.
 *
 * Both are small, and both are here rather than inline in `BookingInfoStrip`
 * because of what they have to agree with — the brand label degrades through a
 * fetch that can fail permanently, and the country's null has one correct
 * reading that two other screens already apply. Neither is testable inside a
 * `.tsx`; no test in this repo imports one.
 */

function norm(v: string | null | undefined): string {
  return (v ?? "").trim();
}

/**
 * `"Potato Corner TH (PCTH)"` — the name a supplier is told, beside the code
 * every other screen in this app shows.
 *
 * **The name is optional and the code is not.** The codes travel on the request;
 * the names live in the brand registry, which `AdminBookingPanel` fetches
 * asynchronously for the currency toggle and which can stay null for the
 * component's life on a failed fetch or a de-granted brand. So an absent name
 * falls back to the bare code — exactly what the detail page shows — and the row
 * never waits for a fetch and never renders blank.
 *
 * No brand at all is a dash rather than a bare name or an empty parenthesis: a
 * booking has to be billed to somebody, and a row that quietly shows a company
 * name with no code behind it would read as though it were.
 *
 * **A name that is just the code is printed once, not twice.** `ROCKS (ROCKS)`
 * is reachable two ways and neither is exotic: `brand-registry.ts:228` falls
 * back to `name: b.Name ?? b.Code` for a brand the Codex master has no name for,
 * and `brand-options.ts:49` falls back again to
 * `brandName: b?.brandName ?? row.BrandCode` for one the registry does not carry
 * at all. The duplicate therefore appears exactly for the brands nobody has
 * finished configuring — the ones somebody is most likely to be checking.
 * Compared case-insensitively, since the code is uppercased here and the name is
 * not; `countryNameBoth` collapses its two halves for the same reason.
 */
export function bookingBrandLabel(
  code: string | null | undefined,
  name: string | null | undefined,
): string {
  const brand = norm(code).toUpperCase();
  if (brand === "") return "—";
  const label = norm(name);
  if (label === "" || label.toUpperCase() === brand) return brand;
  return `${label} (${brand})`;
}

/**
 * The country to render for a request — **null reads as Thailand**.
 *
 * That is what `resolveBookingCountry` stores for an unanswered country, and
 * most AP-17 requests predate `AccRequest.CountryCode` (2026-08-31) with every
 * one of them a Thai trip. `TravelBookingDetail` applies the same rule, and a
 * reader must not find two screens disagreeing about where a request is going.
 *
 * A code the 25-entry country list has never heard of is returned as it stands
 * rather than corrected. `CountryCode` is `CHAR(2)` with no CHECK, so a direct
 * SQL edit can put anything there; showing what is actually stored is what lets
 * somebody find it, where displaying "ไทย" for a row that says `XX` would hide
 * the fault on the one screen that could report it.
 */
export function bookingCountryCode(code: string | null | undefined): string {
  return norm(code).toUpperCase() || BOOKING_DEFAULT_COUNTRY;
}
