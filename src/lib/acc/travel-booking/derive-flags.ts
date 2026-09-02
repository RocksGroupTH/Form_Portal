/**
 * AP-17's booking flags, derived from the chosen options instead of trusted.
 *
 * ## What they decide
 *
 * `NeedsRoomBooking`, `GoNeedsTicketBooking`, `ReturnNeedsTicketBooking` and
 * `NeedsRentBooking` are the only thing that tells AP-17 whether an Admin has to
 * fill anything in. `approveByManager` reads exactly those four: all false and
 * the request skips the Admin step and closes straight to `Completed`, with the
 * per-diem payout date already set.
 *
 * ## Why they cannot come from the client
 *
 * They were writable fields on `SaveTravelBookingInput` and were persisted as
 * posted, while submit validation only checked the stored booleans against each
 * other — never that the selected accommodation or vehicle actually implied them.
 * A request posting `needsRoomBooking: false` alongside a hotel that requires a
 * room booking therefore validated, submitted, and auto-completed on the
 * manager's approval: a paid trip with no booking made and no Admin ever aware of
 * it. Nothing in the UI does that, and nothing needs to — the flags are a pure
 * function of four option ids, which is what makes deriving them the whole fix.
 *
 * The option rows are the authority (`AccTravelAccommodation.NeedsRoomBooking`,
 * `AccTravelVehicleOption.Needs*`, `AccTravelRentVehicle.NeedsRentBooking`) and
 * they are also where an inactive or nonexistent id is caught: this module is
 * given the rows that were found, so a missing one is a missing row here.
 */

/** One accommodation option, as far as flags are concerned. */
export interface AccommodationOption {
  id: number;
  isActive: boolean;
  needsRoomBooking: boolean;
}

/** One go/return vehicle option. */
export interface VehicleFlagOption {
  id: number;
  isActive: boolean;
  needsDepartureLocations: boolean;
  needsTicketBooking: boolean;
  needsDepartTime: boolean;
  needsVehicleRent: boolean;
}

/** One rent-vehicle option. */
export interface RentVehicleOption {
  id: number;
  isActive: boolean;
  needsRentBooking: boolean;
}

/** Every flag `AccTravelBooking` stores, and nothing else. */
export interface DerivedBookingFlags {
  needsRoomBooking: boolean;
  goNeedsDepartureLocations: boolean;
  goNeedsTicketBooking: boolean;
  goNeedsDepartTime: boolean;
  goNeedsVehicleRent: boolean;
  returnNeedsDepartureLocations: boolean;
  returnNeedsTicketBooking: boolean;
  returnNeedsDepartTime: boolean;
  returnNeedsVehicleRent: boolean;
  needsRentBooking: boolean;
}

export const NO_BOOKING_FLAGS: DerivedBookingFlags = {
  needsRoomBooking: false,
  goNeedsDepartureLocations: false,
  goNeedsTicketBooking: false,
  goNeedsDepartTime: false,
  goNeedsVehicleRent: false,
  returnNeedsDepartureLocations: false,
  returnNeedsTicketBooking: false,
  returnNeedsDepartTime: false,
  returnNeedsVehicleRent: false,
  needsRentBooking: false,
};

function vehicleFlags(option: VehicleFlagOption | null) {
  return {
    departureLocations: option?.needsDepartureLocations ?? false,
    ticketBooking: option?.needsTicketBooking ?? false,
    departTime: option?.needsDepartTime ?? false,
    vehicleRent: option?.needsVehicleRent ?? false,
  };
}

/**
 * The flags these options imply. A null option contributes nothing — an
 * unselected vehicle needs no ticket.
 */
export function deriveBookingFlags(options: {
  accommodation: AccommodationOption | null;
  goVehicle: VehicleFlagOption | null;
  returnVehicle: VehicleFlagOption | null;
  rentVehicle: RentVehicleOption | null;
}): DerivedBookingFlags {
  const go = vehicleFlags(options.goVehicle);
  const back = vehicleFlags(options.returnVehicle);

  return {
    needsRoomBooking: options.accommodation?.needsRoomBooking ?? false,
    goNeedsDepartureLocations: go.departureLocations,
    goNeedsTicketBooking: go.ticketBooking,
    goNeedsDepartTime: go.departTime,
    goNeedsVehicleRent: go.vehicleRent,
    returnNeedsDepartureLocations: back.departureLocations,
    returnNeedsTicketBooking: back.ticketBooking,
    returnNeedsDepartTime: back.departTime,
    returnNeedsVehicleRent: back.vehicleRent,
    // **The answer wins over the question.** A leg vehicle's `needsVehicleRent`
    // is what makes the form ASK about a rental (`TravelBookingTab.tsx`,
    // `showRentBlock`); `rentVehicle` is the requester's ANSWER. So a selected
    // option decides outright — including the `ไม่เช่า` row, whose whole meaning
    // is "no", and which carries `needsRentBooking = false` to say so.
    //
    // ORing the two conflated them, and the requester could not decline: flying
    // both ways (`เครื่องบิน`, `NeedsVehicleRent = 1`) and answering `ไม่เช่า`
    // still opened a rental group on the Admin panel with nothing to book.
    // Reported 2026-09-02 against TRL26-09007.
    //
    // The leg arms remain for the case they were built for — the question was
    // asked and **not answered**. The client validator requires an answer
    // whenever a leg implies a rental, so that is the path around it: a direct
    // POST, or a row written before the rule existed. Erring towards an Admin
    // step is the safe direction when nobody has said either way.
    needsRentBooking:
      options.rentVehicle !== null
        ? options.rentVehicle.needsRentBooking
        : go.vehicleRent || back.vehicleRent,
  };
}

/** True when any of the four flags the Admin step keys off is set. */
export function requiresAdminBooking(flags: DerivedBookingFlags): boolean {
  return (
    flags.needsRoomBooking ||
    flags.goNeedsTicketBooking ||
    flags.returnNeedsTicketBooking ||
    flags.needsRentBooking
  );
}

export interface OptionSelection {
  /** Field name for the error message, e.g. "accommodationId". */
  field: string;
  id: number | null;
  /** The row that was found for that id, or null when there is none. */
  option: { id: number; isActive: boolean } | null;
}

/**
 * The first selected option that does not exist or is no longer active.
 *
 * Submit validation checked "did you pick something", not "is what you picked
 * real". An id for a deleted accommodation stored a null name and no flags,
 * which then read as "nothing to book".
 */
export function firstInvalidOption(selections: readonly OptionSelection[]): OptionSelection | null {
  for (const selection of selections) {
    if (selection.id == null) continue;
    if (!selection.option) return selection;
    if (!selection.option.isActive) return selection;
  }
  return null;
}

/** Thai, user-facing — surfaces on the AP-17 form. */
export function invalidOptionMessage(selection: OptionSelection): string {
  const label = INVALID_OPTION_LABELS[selection.field] ?? "ตัวเลือก";
  return `${label}ที่เลือกไม่มีอยู่หรือถูกปิดใช้งานแล้ว — กรุณาเลือกใหม่`;
}

const INVALID_OPTION_LABELS: Record<string, string> = {
  reasonId: "เหตุผลการเดินทาง",
  accommodationId: "ที่พัก",
  goVehicleId: "ยานพาหนะขาไป",
  returnVehicleId: "ยานพาหนะขากลับ",
  rentVehicleId: "ยานพาหนะที่ต้องการเช่า",
};
