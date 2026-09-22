"use client";

import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { Briefcase, Calendar, Car, FileCheck, History, Hotel, Landmark, MapPin, StickyNote } from "lucide-react";
import { findDateOverlap, type OtherTrip } from "@/lib/acc/travel-booking/date-overlap";
import type { AccBrandOption } from "@/features/accounting/types";
import { NO_RENT_VEHICLE_NAME } from "@/features/travel-booking/constants";
import {
  hasUnratedDay,
  perDiemAttributionFootnote,
  perDiemAttributionNote,
  PER_DIEM_UNRATED_NOTE,
  roomBookingNote,
  type PerDiemAttribution,
} from "@/features/travel-booking/lib/perdiem-note";
import { ratedSegments, tripRateLead, unratedNote } from "@/features/travel-booking/lib/trip-rate-lead";
import { tripRateSegments } from "@/features/travel-booking/lib/trip-rate-segments";
import { TripRateHistoryModal } from "@/features/travel-booking/components/TripRateHistoryModal";
import { countryNameBoth } from "@/lib/acc/country-currency";
import { GooglePinView } from "./GooglePinView";
import { WorkLocationList } from "./WorkLocationList";
import { DateRangeField } from "./DateRangeField";
import { TransportSection } from "./TransportSection";
import { ORS_WORLDWIDE } from "@/lib/ors-scope";
import { countryNames } from "@/lib/acc/country-currency";
import {
  claimCountryOptions,
  effectiveClaimCountry,
} from "@/features/accounting/lib/claim-currency";
import { IdCardUpload } from "./IdCardUpload";
import { RoomShareControl } from "./RoomShareControl";
import {
  roomShareChoicePatch,
  roomShareClearPatch,
} from "@/features/travel-booking/lib/room-share-choice";
import type { RequesterOption } from "@/components/RequesterPickerModal";
import {
  OptionCardSelect,
  SectionCard,
  errInputStyle,
  errLabelStyle,
  fmtBaht,
  inputClass,
  inputStyle,
  labelClass,
  labelStyle,
  requiredStar,
} from "./shared";
import type {
  DepartureLocationInput,
  FieldIssue,
  TabFormState,
} from "@/features/travel-booking/hooks/useTravelBookingForm";
import type {
  Accommodation,
  RentVehicle,
  TravelDirection,
  TravelReasonOption,
  VehicleOption,
} from "@/features/travel-booking/types";
import { earliestTravelDate } from "@/features/travel-booking/lib/earliest-travel-date";
import type { ContinuationSource } from "@/features/travel-booking/lib/perdiem-estimate-inputs";

/**
 * The note under the date range when this trip's first day was already counted.
 *
 * It used to say only "ต่อเนื่องจากคำขอก่อนหน้า", which tells a requester a day
 * was deducted and gives them nothing to check it against. The detail page has
 * named the predecessor since 2026-09-22; this is the form catching up.
 *
 * **A sibling tab gets its own wording rather than a blank number.** A tab in
 * this same group carries an `AccRequest.Id` once saved but no `RequestNo`
 * until submit, so there is nothing to name — and rendering an empty slot
 * would read as a bug rather than as "the one next to this".
 */
function continuationHintText(source: ContinuationSource): string {
  const tail = "วันแรกนับ Per diem ให้แล้ว (-1 วัน)";
  if (source.kind === "request" && source.requestNo) {
    return `ต่อเนื่องจากคำขอ ${source.requestNo} — ${tail}`;
  }
  if (source.kind === "sibling") {
    return `ต่อเนื่องจากคำขอใบก่อนหน้าในชุดนี้ — ${tail}`;
  }
  return `ต่อเนื่องจากคำขอก่อนหน้า — ${tail}`;
}

/** Sentinel option name for AccTravelRentVehicle's default "no rental" choice — mirrors the server. */

interface TravelBookingTabProps {
  tab: TabFormState;
  /**
   * The brands this form may be claimed against.
   *
   * The *chosen* one is `tab.brandCode` — per trip, like every other field
   * here, because a group is one `AccRequest` row per tab and each carries its
   * own `BrandCode`. Only the option list is passed in, since it is the same
   * for every tab and fetching it per tab would repeat the request.
   */
  brands: AccBrandOption[];
  isContinuation: boolean;
  /**
   * WHICH trip already counted this tab's first day. Separate from
   * `isContinuation` rather than folded into it because the note needs the
   * identity and the deduction needs only the boolean — and a sibling tab in
   * this same group has no running number to show until submit.
   */
  continuationSource: ContinuationSource;
  perDiemEstimate: {
    days: number;
    total: number;
    groups: { rate: number; days: number }[];
    /** Which rate priced it, in the four states the card has to tell apart. */
    attribution: PerDiemAttribution;
    /** The configured country's own rates, so they can be named before any date is typed. */
    countryLog: readonly { effectiveDate: string; amount: number }[];
  };
  reasons: TravelReasonOption[];
  accommodations: Accommodation[];
  vehicles: VehicleOption[];
  rentVehicles: RentVehicle[];
  /** Days locked in the วันเดินทาง picker (already booked by other trips). */
  disabledTravelDates?: string[];
  /**
   * The requester's other saved AP-17 requests, shaped for `findDateOverlap`.
   *
   * `disabledTravelDates` (from `lockedTravelDates`) deliberately leaves a
   * boundary day open so a MULTI-day trip may continue from it — but a
   * SINGLE-day trip landing on that same day never gets that exemption
   * (`findDateOverlap`'s `touchesOnlyAtBoundary` refuses a same-day
   * candidate outright), so the picker's disabled-day set alone cannot catch
   * it. `handleDateRangeChange` below closes that one gap at the moment a
   * single day is committed.
   *
   * **It does not close every picker/`findDateOverlap` gap, and the largest
   * one is still open.** Measured (fix round 1, 2026-09-22): against a
   * two-day other trip, `lockedTravelDates` locks NOTHING at all — each
   * endpoint takes only one of its two half-slots, and a two-day range has no
   * interior day to take both — so 60 multi-day ranges the picker still
   * allows are ones `findDateOverlap` refuses. Other-trip lengths 1, 3 and 5
   * leave zero such ranges, so the ordinary overnight trip (two days) is the
   * ENTIRE residual, not an edge case. That gap is caught later — by
   * `validateTab`'s own `findDateOverlap` check at attempted submit, and by
   * the server regardless — not by anything in this component.
   */
  otherTrips?: readonly OtherTrip[];
  issues: FieldIssue[];
  /**
   * Whether this tab's booking selection asks for an ID/Passport scan (package
   * C, `AccTravel*.RequiresIdCard`).
   *
   * **Passed in rather than recomputed here.** `tabNeedsIdCard`
   * (`useTravelBookingForm.ts`) is the one caller of `deriveBookingFlags` on
   * this side, and the same value decides whether `validateTab` complains about
   * a missing card. Deriving it a second time in this component is how the
   * upload block and the complaint about its absence come to disagree — and the
   * expensive direction of that disagreement is a hidden block whose emptiness
   * still refuses the submit.
   */
  needsIdCard: boolean;
  triedSubmit: boolean;
  /** ผู้ขอเบิก (self = null) — keys the ID-card reuse/consent lookup. */
  requesterStaffId?: number | null;
  /**
   * The actor's own HR department, already loaded by the form — the list the
   * พักห้องเดียวกับ person picker opens on before anybody types (AP-17 package
   * E). Passed down rather than fetched here for the same reason `brands` is:
   * it is identical for every tab, and a per-tab fetch would repeat it.
   */
  colleagues: RequesterOption[];
  onChange: (patch: Partial<TabFormState>) => void;
  onSelectPendingIdCard: (file: File | null) => void;
  onRemoveIdCardFile: (fileId: number) => Promise<boolean>;
}

export function TravelBookingTab({
  tab,
  isContinuation,
  continuationSource,
  perDiemEstimate,
  reasons,
  accommodations,
  vehicles,
  rentVehicles,
  disabledTravelDates,
  otherTrips,
  issues,
  needsIdCard,
  triedSubmit,
  requesterStaffId,
  colleagues,
  brands,
  onChange,
  onSelectPendingIdCard,
  onRemoveIdCardFile,
}: TravelBookingTabProps) {
  const errorKeys = useMemo(() => new Set(issues.map((i) => i.key)), [issues]);
  const hasErr = (key: string) => triedSubmit && errorKeys.has(key);
  // TransportSection applies error styling unconditionally on the keys it's given,
  // so only hand it the issue set once the user has attempted a submit.
  const displayErrorKeys = useMemo(() => (triedSubmit ? errorKeys : new Set<string>()), [triedSubmit, errorKeys]);

  /**
   * The brand this trip is filed against, and the countries it offers.
   *
   * Both come from AP-1's own rules rather than a second copy: the brand rows
   * are the same `AccBrandOption` shape, so `claimCountryOptions` answers here
   * exactly what it answers there for the same brand.
   */
  const selectedBrand = brands.find((b) => b.brandCode === tab.brandCode) ?? null;
  const countryOptions = claimCountryOptions(selectedBrand);
  /**
   * The country this trip actually resolves to — the same value the server will
   * store, so the chips, the place search and the database cannot disagree.
   * Null only while no brand has been chosen, which is when the band is not
   * rendered either.
   */
  const tripCountry = tab.brandCode ? effectiveClaimCountry(tab.countryCode, selectedBrand) : null;

  /* The dated rates this trip's own days fall under — empty until both dates
     are chosen, which is what gates the whole rate block. `isContinuation` is
     passed so the segments count the same days `computePerDiem` charges. */
  const tripSegments = useMemo(
    () => tripRateSegments(tab.departDate, tab.returnDate, isContinuation, perDiemEstimate.countryLog),
    [tab.departDate, tab.returnDate, isContinuation, perDiemEstimate.countryLog],
  );
  /* Closed on every mount, and the tab remounts when the active trip changes, so
     opening the history on one trip does not open it on the next. */
  const [historyOpen, setHistoryOpen] = useState(false);

  /**
   * Wraps the date picker's own `onChange` to refuse a SINGLE-day pick that
   * lands exactly on another request's day — the one case
   * `disabledTravelDates` deliberately leaves open (see `otherTrips`' doc
   * comment above).
   *
   * **A multi-day range is deliberately NOT checked here**, and that is a gap
   * left open, not a case that cannot occur: against a two-day other trip the
   * picker allows 60 multi-day ranges `findDateOverlap` would refuse (see
   * `otherTrips`' doc comment for the measurement). Closing that at pick time
   * would mean running `findDateOverlap` on every date click while a range is
   * being built, not only at commit — a larger change than this fix round
   * makes. It is still caught: `validateTab`'s own `findDateOverlap` check
   * flags it if the requester tries to submit, and the server refuses it
   * regardless.
   *
   * Reverting to `{ departDate, returnDate: null }` rather than dropping the
   * change leaves the field exactly where a half-filled range already leaves
   * it — "แตะเลือกวันสิ้นสุด" if reopened, and the ordinary required-field
   * check catches it if the requester never returns to it.
   */
  const handleDateRangeChange = useCallback(
    (next: { departDate: string | null; returnDate: string | null }) => {
      if (next.departDate && next.returnDate && next.departDate === next.returnDate) {
        const clash = findDateOverlap(
          { departDate: next.departDate, returnDate: next.returnDate },
          otherTrips ?? [],
        );
        if (clash) {
          toast.error(`เลือกเป็นทริปวันเดียวไม่ได้ — ${clash.message}`);
          onChange({ departDate: next.departDate, returnDate: null });
          return;
        }
      }
      onChange(next);
    },
    [onChange, otherTrips],
  );


  const selectedReason = reasons.find((r) => r.id === tab.reasonId);
  const selectedAccommodation = accommodations.find((a) => a.id === tab.accommodationId);
  const selectedGoVehicle = vehicles.find((v) => v.id === tab.goVehicleId);
  const selectedReturnVehicle = vehicles.find((v) => v.id === tab.returnVehicleId);
  const selectedRentVehicle = rentVehicles.find((v) => v.id === tab.rentVehicleId);
  // Task 8 fix round 1: which of the two different ฿0s the per-diem summary
  // below might be showing — a settled "no room, no per diem" or a pending
  // "no accommodation chosen yet" — or null when the figure is not withheld.
  const roomNote = roomBookingNote(tab.accommodationId, tab.needsRoomBooking);

  // A card already on this tab — uploaded on an earlier save, or picked and
  // waiting for one. Either keeps the block on screen after the requirement has
  // gone away; see the เอกสารแนบ section below for why.
  const hasIdCardEvidence = tab.idCardFiles.length > 0 || !!tab.pendingIdCard;

  const showRentBlock = tab.goNeedsVehicleRent || tab.returnNeedsVehicleRent;
  const showRentDates = showRentBlock && !!selectedRentVehicle && selectedRentVehicle.name !== NO_RENT_VEHICLE_NAME;

  /**
   * One vehicle is chosen for the whole trip (ไป-กลับ) — it drives both directions.
   * Inherits the vehicle's admin config into both go/return flags and clears the
   * per-direction place/time so stale picks can't linger when the vehicle changes.
   */
  const selectVehicleBoth = (id: number | null) => {
    const v = id ? vehicles.find((x) => x.id === id) : undefined;
    const needDep = !!(v?.needsDepartureLocations && v.places.length);
    const needTime = !!v?.needsDepartTime;
    onChange({
      goVehicleId: id,
      returnVehicleId: id,
      goVehicleCustomText: null,
      returnVehicleCustomText: null,
      goNeedsDepartureLocations: needDep,
      returnNeedsDepartureLocations: needDep,
      goNeedsTicketBooking: !!v?.needsTicketBooking,
      returnNeedsTicketBooking: !!v?.needsTicketBooking,
      goNeedsDepartTime: needTime,
      returnNeedsDepartTime: needTime,
      goNeedsVehicleRent: !!v?.needsVehicleRent,
      returnNeedsVehicleRent: !!v?.needsVehicleRent,
      departTime: needTime ? tab.departTime : null,
      returnTime: needTime ? tab.returnTime : null,
      // Switching vehicle still clears both directions' places; it just no
      // longer refills either with a guess (2026-08-31).
      departureLocations: [],
      // **A rent answer belongs to the question that was asked.** The rent
      // block renders only while a leg vehicle carries `needsVehicleRent`
      // (`showRentBlock` above), so switching to one that does not takes the
      // control off the screen — and left alone, whatever was picked stays in
      // state, gets posted by `saveDraft`, and `deriveBookingFlags` reads it as
      // a live answer. The result is an Admin rental group for a rental the
      // requester cannot see, cannot unselect, and did not ask for: the same
      // symptom reported on 2026-09-02, reached by a different route.
      //
      // Cleared here rather than server-side because this is where it goes
      // stale. `deriveBookingFlags` deliberately still honours a rent option it
      // is given — an answer that IS present decides — and teaching it to
      // second-guess one would trade this bug for a rental somebody wanted
      // being silently dropped.
      ...(v?.needsVehicleRent
        ? {}
        : {
            rentVehicleId: null,
            rentVehicleCustomText: null,
            rentStartDate: null,
            rentEndDate: null,
          }),
    });
  };


  const reasonOptions = reasons.map((r) => ({ value: String(r.id), label: r.name, icon: r.icon }));
  const accommodationOptions = accommodations.map((a) => ({ value: String(a.id), label: a.name, icon: a.icon }));
  const vehicleOptions = vehicles.map((v) => ({ value: String(v.id), label: v.name, icon: v.icon }));
  const rentVehicleOptions = rentVehicles.map((v) => ({ value: String(v.id), label: v.name, icon: v.icon }));

  return (
    <div className="w-full max-w-full mx-auto flex flex-col gap-4 min-w-0">
      {/* เหตุผล + รายละเอียด + จังหวัด/สถานที่ */}
      <SectionCard dataTour="ap17-trip" icon={<Briefcase size={15} />} title="เหตุผลและรายละเอียดการเดินทาง">
        {/* Above the reason, and required — per trip, like everything else in
            this section. */}
        <div data-field="brand">
          <label className={labelClass} style={errLabelStyle(hasErr("brand"))}>
            แบรนด์ที่เบิก{requiredStar}
          </label>
          {brands.length === 0 ? (
            <p className="text-[13px] m-0 mt-1" style={{ color: "var(--text-faint)" }}>
              ยังไม่ได้ตั้งค่าแบรนด์ที่เบิกได้สำหรับฟอร์มนี้ — ติดต่อผู้ดูแลระบบ
            </p>
          ) : (
            <div className="flex flex-wrap gap-2 mt-1">
                {brands.map((b) => {
                  const active = tab.brandCode === b.brandCode;
                  return (
                    <button
                      key={b.brandCode}
                      type="button"
                      onClick={() => onChange({ brandCode: active ? null : b.brandCode })}
                      className="flex items-center gap-2 px-3 py-2 rounded-xl cursor-pointer text-[14px] font-semibold transition-all"
                      style={{
                        borderWidth: 2,
                        borderStyle: "solid",
                        borderColor: active ? "var(--nav-active-text)" : "var(--border-card)",
                        background: active ? "var(--nav-active-bg)" : "var(--bg-card-alt)",
                        color: active ? "var(--nav-active-text)" : "var(--text-secondary)",
                      }}
                    >
                      {/* Height-constrained with a natural width, exactly as
                          AP-1's chip renders it. BrandMark drew the logo into a
                          20x20 SQUARE, which squashes any mark that is not
                          square — and most brand logos are wider than they are
                          tall. Its code-letter fallback goes with it: AP-1 hides
                          a broken image rather than substituting text, and the
                          brand name is right there beside it either way. */}
                      {b.brandLogo && (
                        <img
                          src={b.brandLogo}
                          alt=""
                          className="h-5 w-auto object-contain"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                        />
                      )}
                      {b.brandName}
                    </button>
                  );
                })}
            </div>
          )}
        </div>

        {/* ประเทศที่เดินทาง — directly under the brand, above everything the trip
            is described with, because it bounds the place search below it and
            prices the per diem.

            **Shown only once a brand is chosen**, which is AP-1's rule for its
            own country band. It is also the honest order: the brand is the
            required field above, and offering a country before one is picked
            asks a question about a trip that has not started being described.

            **It also chooses the booking currency**, since 2026-09-02. The
            desk's toggle offers baht plus this destination's own currency and
            starts on baht — `booking-currency.ts` owns that. So the country
            picked here bounds what the invoice can later be recorded in, which
            it did not before: the brand used to decide, and got both the
            domestic and the foreign case wrong.

            **The countries the BRAND offers**, through AP-1's own
            `claimCountryOptions` — one rule, not a second copy of it. A brand
            configured for Thailand and England offers those two and nothing
            else, exactly as AP-1's band does for the same brand.

            The consequence to know: a brand with **no** `BrandCurrency` rows
            offers nothing, so this band does not render at all and every trip
            against it is Thailand. That is not a bug to work around — it is the
            configuration saying nobody has told the system this brand travels
            anywhere. Adding a country means adding its currency at Settings →
            ตั้งค่าแบบฟอร์มขอเดินทาง → แบรนด์ที่เบิกได้, the same place AP-1's
            countries come from. Per-diem-by-country only reaches a country this
            list offers, so a brand that travels needs its currencies set. */}
        {tab.brandCode && countryOptions.length > 0 && (
        <div data-field="country">
          <label className={labelClass}>ประเทศ</label>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {countryOptions.map((code) => {
              const c = { code, nameEn: countryNames(code)?.en ?? code, nameTh: countryNames(code)?.th ?? "" };
              // effectiveClaimCountry, not the raw stored value: a draft holding
              // a country the brand no longer offers resolves to one it does,
              // rather than leaving a selection with no chip to show it.
              const active = effectiveClaimCountry(tab.countryCode, selectedBrand) === c.code;
              const only = countryOptions.length === 1;
              return (
                <button
                  key={c.code}
                  type="button"
                  disabled={only}
                  onClick={() => {
                    if (c.code === tripCountry) return;
                    // A place is meaningless once the country changes — a Chiang
                    // Mai mall on a trip to England — and its coordinates would
                    // put the pin in the wrong country. Cleared together, because
                    // keeping the name without the pin is the worse half.
                    onChange({
                      countryCode: c.code,
                      workLocations: [{ name: "", sortOrder: 0, lat: null, lng: null }],
                    });
                  }}
                  className="px-2.5 py-1 rounded-lg text-[12.5px] font-semibold transition-all"
                  style={{
                    // One-pixel border and a smaller radius against the brand's
                    // two and its xl: the same family of control, plainly a rank
                    // below it. Same treatment AP-1's band uses.
                    borderWidth: 1,
                    borderStyle: "solid",
                    borderColor: active ? "var(--nav-active-text)" : "var(--border-card)",
                    background: active ? "var(--nav-active-bg)" : "var(--bg-card-alt)",
                    color: active ? "var(--nav-active-text)" : "var(--text-secondary)",
                  }}
                >
                  <span className="inline-flex items-center gap-1.5">
                    {/* Real SVGs from `public/flags`, lower-cased filenames.
                        Emoji flags do not work: Windows ships no flag glyphs, so
                        Chrome and Edge there render the two letters as text. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/flags/${c.code.toLowerCase()}.svg`}
                      alt=""
                      aria-hidden
                      className="shrink-0 h-[11px] w-[16px] rounded-[2px] object-cover"
                      style={{ border: "1px solid var(--border-card)" }}
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                    />
                    {/* English over Thai. Thai script is the wider of the two at
                        the same size, so stacking is what keeps a row of 25
                        countries from pushing the form sideways. */}
                    <span className="flex flex-col items-start leading-tight">
                      <span>{c.nameEn}</span>
                      <span
                        className="text-[10px] font-medium leading-none"
                        style={{ color: active ? "var(--nav-active-text)" : "var(--text-ghost)" }}
                      >
                        {c.nameTh}
                      </span>
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        )}

        <div data-field="reason">
          <label className={labelClass} style={errLabelStyle(hasErr("reason"))}>
            เหตุผลการเดินทาง{requiredStar}
          </label>
          <OptionCardSelect
            options={reasonOptions}
            value={tab.reasonId != null ? String(tab.reasonId) : ""}
            onChange={(v) => onChange({ reasonId: Number(v), reasonCustomText: tab.reasonCustomText })}
            hasError={hasErr("reason")}
          />
        </div>

        {selectedReason?.requiresCustomReason && (
          <div data-field="reasonCustom">
            <label className={labelClass} style={errLabelStyle(hasErr("reasonCustom"))}>
              ระบุเหตุผลเพิ่มเติม{requiredStar}
            </label>
            <input
              value={tab.reasonCustomText ?? ""}
              onChange={(e) => onChange({ reasonCustomText: e.target.value || null })}
              placeholder="ระบุรายละเอียด..."
              className={inputClass}
              style={{ ...inputStyle, ...errInputStyle(hasErr("reasonCustom")) }}
            />
          </div>
        )}

        <div data-field="workDetail">
          <label className={labelClass} style={errLabelStyle(hasErr("workDetail"))}>
            รายละเอียดการไปปฏิบัติงาน{requiredStar}
          </label>
          <textarea
            rows={3}
            value={tab.workDetail ?? ""}
            onChange={(e) => onChange({ workDetail: e.target.value || null })}
            placeholder="อธิบายจุดประสงค์การเดินทางและงานที่ไปปฏิบัติ..."
            className={inputClass}
            style={{ ...inputStyle, resize: "vertical", ...errInputStyle(hasErr("workDetail")) }}
          />
        </div>

        {/* Waits for the brand AND the country above it. Searching before
            either is answered means searching the whole world and then having
            the answer thrown away by the country change that follows, which is
            a billed Google call spent on a place nobody will keep. */}
        {tab.brandCode && tripCountry && (
        <div data-field="workLocations">
          <label className={labelClass} style={errLabelStyle(hasErr("workLocations"))}>
            <MapPin size={11} className="inline mr-1 -mt-0.5" />
            สถานที่ไปปฏิบัติงาน{requiredStar}
          </label>
          <WorkLocationList
            items={tab.workLocations}
            onChange={(workLocations) => onChange({ workLocations })}
            hasError={hasErr("workLocations")}
            // Search inside the country the trip is to. Without it a search for
            // "central" on a UK trip offers Central World in Bangkok, because
            // the location bias points at Bangkok for everybody. Null only while
            // no brand has been chosen, when the country band is not shown
            // either — the world is searched until there is a country to narrow
            // to.
            country={tripCountry}
          />
          {/* The pin, as soon as a place is picked — the requester sees where
              the booking desk will be sent before they submit, not only
              afterwards on the detail page. Renders nothing for a place typed
              rather than picked, which has no coordinates to pin. */}
          <div className="mt-2">
            <GooglePinView
              places={tab.workLocations.map((w) => ({
                name: w.name,
                lat: w.lat ?? null,
                lng: w.lng ?? null,
              }))}
              height={180}
            />
          </div>
        </div>
        )}

      </SectionCard>

      {/* วันเดินทาง + ที่พัก */}
      <SectionCard dataTour="ap17-schedule" icon={<Calendar size={15} />} title="วันเดินทางและที่พัก">
        <div data-field="dateRange">
          <DateRangeField
            label="วันเดินทาง (ไป–กลับ)"
            departDate={tab.departDate}
            returnDate={tab.returnDate}
            onChange={handleDateRangeChange}
            hasError={hasErr("dateRange")}
            minDate={earliestTravelDate(new Date())}
            disabledDates={disabledTravelDates}
            continuationHint={isContinuation ? continuationHintText(continuationSource) : null}
          />
        </div>

        {/* ที่พักค้างคืน, or the room share that REPLACES it.

            **The two are alternatives and only one is ever on screen** (AP-17
            package E, spec §1: a guest "books nothing themselves"). Rendering
            both would invite a tab claiming a room of its own *and* a share of
            somebody else's — a state nothing downstream knows how to price,
            since `roomBookedOrShared` would read true from either input while
            the Admin desk had a booking to make for a person who is not
            sleeping there.

            Hidden rather than disabled, which is package C's own ruling one
            card down: "a disabled control invites the question 'why can't
            I?'". The difference here is that the requester has just *caused*
            the disappearance, so the card that replaces the grid says in so
            many words that no accommodation is needed — an unexplained
            vanishing required field would be worse than either. Detaching
            brings the grid straight back. */}
        {!tab.isRoomShareGuest && (
          <>
            <div data-field="accommodation">
              <label className={labelClass} style={errLabelStyle(hasErr("accommodation"))}>
                <Hotel size={11} className="inline mr-1 -mt-0.5" />
                ที่พักค้างคืน{requiredStar}
              </label>
              <OptionCardSelect
                options={accommodationOptions}
                value={tab.accommodationId != null ? String(tab.accommodationId) : ""}
                onChange={(v) => {
                  const id = Number(v);
                  const a = accommodations.find((x) => x.id === id);
                  onChange({ accommodationId: id, accommodationCustomText: null, needsRoomBooking: !!a?.needsRoomBooking });
                }}
                hasError={hasErr("accommodation")}
              />
            </div>

            {selectedAccommodation?.needsRoomBooking && (
              <div
                className="flex items-center gap-2 text-[12px] font-medium rounded-lg px-3 py-2"
                style={{ background: "var(--nav-active-bg)", color: "var(--nav-active-text)" }}
              >
                <Hotel size={14} /> ทีม Admin จะจองห้องพักให้สำหรับที่พักนี้
              </div>
            )}
          </>
        )}

        {/* The attach/detach control. It renders the host card when this tab
            is a guest and the "หรือ พักห้องเดียวกับเพื่อนร่วมงาน" affordance
            when it is not, so it is mounted in both states rather than being
            the second arm of the condition above.

            **Attaching clears the accommodation in the same patch that sets
            the flag.** A stale `accommodationId` left behind is not inert: the
            grid is gone, so the requester cannot see or change it, and
            `buildSaveInput` posts it on the very next save, where
            `deriveBookingFlags` reads it as a live answer and books a room.
            Exactly the shape of bug `selectVehicleBoth` clears the rent fields
            to avoid, one section down.

            **And since final review I1 this patch is a MIRROR of the
            database, not the only copy of the rule.** `applyRoomShareSelection`
            clears the same four columns on the guest's own `AccTravelBooking`
            row inside the transaction that records the binding
            (`room-share-guest-room.ts`), which is what makes the invariant
            survive a reload — the case this comment described and did not
            cover. Since 2026-09-22 that transaction is the tab's own SAVE
            rather than a separate attach endpoint, which makes the patch below
            the more load-bearing of the two: between the pick and the save
            there is no stored row at all, so this is the only thing keeping the
            screen honest in the interval. */}
        <RoomShareControl
          requestId={tab.id ?? null}
          hostRequestId={tab.roomShareHostRequestId}
          colleagues={colleagues}
          // **Both patches come from `room-share-choice.ts` and neither is
          // typed out here.** `roomShareHostRequestId` and `isRoomShareGuest`
          // are two fields holding one fact, and the module's own docblock is
          // where the argument for keeping them in one place lives — along
          // with the reason the host's DATES travel with the choice (final
          // review I4: the picker matches on overlap, so a guest and its host
          // could disagree from the start, and the first cascade would then
          // replace the guest's whole span without warning).
          onChoose={(host) => onChange(roomShareChoicePatch(host))}
          // The accommodation is deliberately NOT restored to whatever it was
          // before: the requester is back at an unanswered required field,
          // which is the honest state, and resurrecting a choice they replaced
          // would re-book a room they had decided against. Since I1 that is
          // true of the stored row too — the attach really cleared it — so
          // this is no longer a screen state a reload would contradict.
          onClear={() => onChange(roomShareClearPatch())}
        />
      </SectionCard>

      {/* ยานพาหนะ (ไป-กลับ ตัวเดียว) + จุดขึ้น/เวลา แยกทิศ + เช่ารถ */}
      <SectionCard dataTour="ap17-vehicle" icon={<Car size={15} />} title="ยานพาหนะ">
        <div data-field="goVehicle">
          <label className={labelClass} style={errLabelStyle(hasErr("goVehicle"))}>
            เลือกยานพาหนะ (ใช้ทั้งขาไป–ขากลับ){requiredStar}
          </label>
          <OptionCardSelect
            options={vehicleOptions}
            value={tab.goVehicleId != null ? String(tab.goVehicleId) : ""}
            onChange={(v) => selectVehicleBoth(Number(v))}
            hasError={hasErr("goVehicle")}
          />
        </div>

        {selectedGoVehicle?.needsTicketBooking && (
          <div
            className="flex items-center gap-2 text-[12px] font-medium rounded-lg px-3 py-2"
            style={{ background: "var(--nav-active-bg)", color: "var(--nav-active-text)" }}
          >
            <Car size={14} /> ทีม Admin จะจองตั๋วให้สำหรับยานพาหนะนี้
          </div>
        )}

        {selectedGoVehicle && (selectedGoVehicle.needsDepartureLocations || selectedGoVehicle.needsDepartTime) && (
          <>
            <TransportSection
              direction="go"
              vehicle={selectedGoVehicle}
              time={tab.departTime}
              departureLocations={tab.departureLocations}
              onChangeTime={(v) => onChange({ departTime: v })}
              onChangeDepartureLocations={(all) => onChange({ departureLocations: all })}
              errorKeys={displayErrorKeys}
              country={tripCountry ?? ORS_WORLDWIDE}
            />
            <TransportSection
              direction="return"
              vehicle={selectedGoVehicle}
              time={tab.returnTime}
              departureLocations={tab.departureLocations}
              onChangeTime={(v) => onChange({ returnTime: v })}
              onChangeDepartureLocations={(all) => onChange({ departureLocations: all })}
              errorKeys={displayErrorKeys}
              country={tripCountry ?? ORS_WORLDWIDE}
            />
          </>
        )}

        {showRentBlock && (
          <div
            className="rounded-xl px-4 py-3.5 flex flex-col gap-3"
            style={{ background: "var(--bg-card-alt)", border: "1px solid var(--border-card)" }}
          >
            <p className="text-[13px] font-bold m-0" style={{ color: "var(--text-heading)" }}>
              เช่ายานพาหนะ
            </p>
            <div data-field="rentVehicle">
              <label className={labelClass} style={errLabelStyle(hasErr("rentVehicle"))}>
                เลือกยานพาหนะที่ต้องการเช่า{requiredStar}
              </label>
              <OptionCardSelect
                options={rentVehicleOptions}
                value={tab.rentVehicleId != null ? String(tab.rentVehicleId) : ""}
                onChange={(v) => {
                  const id = Number(v);
                  const rv = rentVehicles.find((x) => x.id === id);
                  onChange({ rentVehicleId: id, rentVehicleCustomText: null, needsRentBooking: !!rv?.needsRentBooking });
                }}
                hasError={hasErr("rentVehicle")}
              />
            </div>

            {selectedRentVehicle?.needsRentBooking && (
              <div
                className="flex items-center gap-2 text-[12px] font-medium rounded-lg px-3 py-2"
                style={{ background: "var(--nav-active-bg)", color: "var(--nav-active-text)" }}
              >
                <Car size={14} /> ทีม Admin จะจัดการเช่ายานพาหนะให้
              </div>
            )}

            {showRentDates && (
              <div data-field="rentDateRange">
                <DateRangeField
                  label="วันที่เช่ายานพาหนะ (ต้องอยู่ในช่วงวันเดินทาง)"
                  startLabel="เริ่มเช่า"
                  endLabel="คืนรถ"
                  departDate={tab.rentStartDate}
                  returnDate={tab.rentEndDate}
                  onChange={({ departDate, returnDate }) => onChange({ rentStartDate: departDate, rentEndDate: returnDate })}
                  hasError={hasErr("rentDateRange")}
                  minDate={tab.departDate}
                  maxDate={tab.returnDate}
                  disabled={!tab.departDate || !tab.returnDate}
                  disabledHint="กรุณาเลือกวันเดินทางก่อน"
                />
              </div>
            )}
          </div>
        )}
      </SectionCard>

      {/* เอกสารแนบ — hidden entirely unless this booking selection asks for a
          card, or the tab already carries one.

          **Hidden, not disabled** (spec §3): a disabled control invites the
          question "why can't I?"; an absent one matches "this booking does not
          need it".

          **`hasIdCardEvidence` is the second arm and it is not decoration.** A
          draft saved while a card was required and resumed after an admin
          un-ticked the option still has the file attached — a scan of the
          requester's own national ID, the most sensitive thing this app holds.
          Hiding the block would strand it: visible to the Admin desk and to the
          detail page, invisible to its owner, who could then neither see nor
          remove it. Showing it instead costs nothing, because the server only
          ever refuses a MISSING card where one is required and never an extra
          one. Same shape AP-1's expense row uses, where จำนวนเงิน appears once
          `amount > 0` even though the normal path reveals it another way. */}
      {(needsIdCard || hasIdCardEvidence) && (
        <SectionCard dataTour="ap17-idcard" icon={<FileCheck size={15} />} title="เอกสารแนบ">
          <div data-field="idCard">
            {!needsIdCard && (
              <div
                className="mb-2 text-[12px] font-medium rounded-lg px-3 py-2"
                style={{ background: "var(--bg-card-alt)", color: "var(--text-secondary)" }}
              >
                การจองที่เลือกไว้ไม่ได้กำหนดให้ต้องแนบบัตรประชาชน หรือ Passport แล้ว —
                ไฟล์ที่แนบหรือเลือกไว้ยังอยู่ ลบออกได้หากไม่ต้องการส่ง
              </div>
            )}
            <IdCardUpload
              files={tab.idCardFiles}
              requestId={tab.id ?? null}
              requesterStaffId={requesterStaffId}
              pendingFile={tab.pendingIdCard}
              onSelectPending={onSelectPendingIdCard}
              onRemove={onRemoveIdCardFile}
              hasError={hasErr("idCard")}
              required={needsIdCard}
            />
          </div>
        </SectionCard>
      )}

      {/* หมายเหตุ + สรุป Per diem */}
      <SectionCard icon={<StickyNote size={15} />} title="หมายเหตุและสรุป">
        <div>
          <label className={labelClass} style={labelStyle}>
            หมายเหตุ
          </label>
          <textarea
            rows={2}
            value={tab.notes ?? ""}
            onChange={(e) => onChange({ notes: e.target.value || null })}
            placeholder="ระบุหมายเหตุเพิ่มเติม (ถ้ามี)..."
            className={inputClass}
            style={{ ...inputStyle, resize: "vertical" }}
          />
        </div>

        <div
          className="rounded-xl px-4 py-3 flex items-center justify-between gap-3 flex-wrap"
          style={{ background: "var(--nav-active-bg)" }}
        >
          <span className="text-[12.5px] font-semibold" style={{ color: "var(--nav-active-text)" }}>
            สรุป Per diem (ประมาณการ)
          </span>
          <span className="text-[14px] font-bold" style={{ color: "var(--nav-active-text)" }}>
            {perDiemEstimate.groups.length > 0 ? (
              <>
                {perDiemEstimate.groups.map((g, i) => (
                  <span key={i}>
                    {i > 0 ? " + " : ""}
                    {g.days} วัน × ฿{fmtBaht(g.rate)}
                  </span>
                ))}
                {" = "}฿{fmtBaht(perDiemEstimate.total)}
              </>
            ) : (
              <>{perDiemEstimate.days} วัน = ฿{fmtBaht(perDiemEstimate.total)}</>
            )}
          </span>
        </div>
        {/* Which rate produced the figure above. The breakdown already showed
            the NUMBER — `N วัน × ฿2,500` — and said nothing about where it came
            from, while the footnote claimed HR for every trip, which is false
            for every one a configured country rate prices. */}
        <p className="text-[11.5px] m-0 flex items-center gap-1.5" style={{ color: "var(--text-muted)" }}>
          {perDiemEstimate.attribution.kind === "country" && <Landmark size={12} className="shrink-0" />}
          {perDiemAttributionNote(
            perDiemEstimate.attribution,
            perDiemEstimate.attribution.kind === "home"
              ? null
              : countryNameBoth(perDiemEstimate.attribution.countryCode),
          )}
        </p>
        {/* Which of two different ฿0s the summary above might be showing
            (Task 8 fix round 1). Before this, "chosen, books no room" and
            "no accommodation chosen yet" both rendered an identical bare ฿0
            with nothing saying why — "why is my per diem zero" is exactly
            the question this package exists to answer on screen. The
            no-room case is settled (text-warning, like the unrated-day note
            below); the not-yet-chosen case is only pending (text-muted). */}
        {roomNote && (
          <p
            className="text-[11.5px] m-0"
            style={{ color: tab.accommodationId == null ? "var(--text-muted)" : "var(--text-warning)" }}
          >
            {roomNote}
          </p>
        )}
        {/* The dated rates THIS TRIP falls under — and only once there is a trip
            to describe. Until both dates are typed `tripRateSegments` answers
            [], and the card says nothing about rates rather than describing a
            range nobody has chosen.

            **Segments, not `computePerDiem`'s `groups`.** Those group by the
            rate's AMOUNT, so two dated rates at the same figure collapse into
            one and none of them carries a date — see `trip-rate-segments.ts`.

            Nothing filters for active: `listPerDiemCountryRates` gives the
            client `IsActive = 1` rows only, so a deactivated rate never arrives
            here. */}
        {/* **Only when a country rate is what prices this trip.** Gating on
            `tripSegments.length` instead put a false line on every OTHER trip:
            `countryLog` is `[]` for `home`, `pending` and `unconfigured`, and a
            trip against an empty log is one null-dated ฿0 segment rather than no
            segments — so a domestic trip rendered `฿0.00 ต่อวัน` directly under a
            breakdown reading `3 วัน × ฿300.00`, two contradicting figures on one
            card. */}
        {perDiemEstimate.attribution.kind === "country" && tripSegments.length > 0 && (
          <>
            <div className="flex items-center gap-2 flex-wrap">
              {tripRateLead(tripSegments) && (
                <span className="text-[12px] font-semibold" style={{ color: "var(--nav-active-text)" }}>
                  เรทที่ใช้กับทริปนี้: {tripRateLead(tripSegments)}
                </span>
              )}
              {/* Counted on the RATED segments: a leading ฿0 stretch is the
                  absence of a rate, not one of them, so a trip that begins
                  before its only rate must not offer a dialog listing "two". */}
              {ratedSegments(tripSegments).length > 1 && (
                <button
                  type="button"
                  onClick={() => setHistoryOpen(true)}
                  className="inline-flex items-center gap-1 text-[11.5px] font-semibold cursor-pointer rounded-lg px-2 py-0.5"
                  style={{
                    color: "var(--nav-active-text)",
                    background: "var(--nav-active-bg)",
                    border: "1px solid var(--border-card)",
                  }}
                >
                  <History size={12} /> ดูเรททั้ง {ratedSegments(tripSegments).length} ช่วง
                </button>
              )}
            </div>
            {/* Days no rate reaches, named with the day the rate does start —
                read from the country's own list, since for a trip wholly before
                it no segment carries that date. */}
            {unratedNote(tripSegments, perDiemEstimate.countryLog) && (
              <p className="text-[11.5px] m-0" style={{ color: "var(--text-warning)" }}>
                {unratedNote(tripSegments, perDiemEstimate.countryLog)}
              </p>
            )}
            <TripRateHistoryModal
              open={historyOpen}
              onClose={() => setHistoryOpen(false)}
              segments={tripSegments}
              // Narrowed to `country` by the guard above, so the code is always
              // there and a `home` arm here would be unreachable.
              countryLabel={countryNameBoth(perDiemEstimate.attribution.countryCode)}
            />
          </>
        )}
        {/* The HR-log gap. Narrowed to the non-country case: a country trip's ฿0
            days are already explained by `unratedNote` above, with the date this
            one cannot name. */}
        {perDiemEstimate.attribution.kind !== "country" && hasUnratedDay(perDiemEstimate.groups) && (
          <p className="text-[11.5px] m-0" style={{ color: "var(--text-warning)" }}>
            {PER_DIEM_UNRATED_NOTE}
          </p>
        )}
        <p className="text-[11px] m-0" style={{ color: "var(--text-faint)" }}>
          {perDiemAttributionFootnote(perDiemEstimate.attribution)}
        </p>
      </SectionCard>
    </div>
  );
}
