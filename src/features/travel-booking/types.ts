/**
 * AP-17 — Accommodation / Ticket Booking Request.
 * camelCase shapes mirroring the `AccTravelBooking*` tables (migration 048)
 * + `Rocks_Portal_Form.dbo.TravelProvince` (seeded into `Fast_Data` by
 * migration 049, moved here by 104/105).
 * See docs/superpowers/specs/2026-07-14-ap17-accommodation-ticket-booking-design.md §2, §3, §9.
 */

/** AccRequest.Status values used by AP-17 (mirrors the shared Acc* status machine, "Approved" renamed "Completed" for this form's semantics). */
export type TravelBookingStatus =
  | "Draft"
  | "Submitted"
  | "ManagerApproved"
  | "Completed"
  | "Rejected"
  | "Returned"
  | "Cancelled";

/**
 * `AccRequest.CurrentStepCode` — the step a live request is parked on.
 *
 * Load-bearing since the accounting step was added: `Status='ManagerApproved'`
 * no longer names one stage. It means Admin's booking fill-in (`'ADMIN'`) *or*
 * accounting's sign-off (`'ACCOUNT'`), and only this column tells them apart.
 * Every server predicate on that status pairs it with the step; the client
 * could not, because the read shape did not carry it.
 */
export type TravelBookingStepCode = "MANAGER" | "ADMIN" | "ACCOUNT";

/** Transport direction — go (ขาไป) / return (ขากลับ). */
export type TravelDirection = "go" | "return";

/** Admin-fill-in booking type (AccTravelBookingDetail.BookingType). */
export type BookingType = "room" | "ticket" | "rent";

/* ---- Settings option types (AccTravelReason / Accommodation / VehicleOption / RentVehicle) ---- */

interface TravelSettingsOption {
  id: number;
  name: string;
  isActive: boolean;
  sortOrder: number;
  /** When true, selecting this option requires the matching *CustomText field. */
  requiresCustomReason: boolean;
  /** Optional emoji shown on the option card / picker (like AP-1 AccVehicle.Icon). */
  icon: string | null;
}

/** ข้อ5 — เหตุผลการเดินทาง (AccTravelReason). */
export type TravelReasonOption = TravelSettingsOption;
/**
 * ข้อ10 — ที่พัก (AccTravelAccommodation). `needsRoomBooking` config drives the form:
 * selecting this accommodation flags the request for Admin room booking.
 */
export interface Accommodation extends TravelSettingsOption {
  needsRoomBooking: boolean;
}
/** One configured departure/place option for a vehicle (AccTravelVehiclePlace). */
export interface VehiclePlace {
  id: number;
  name: string;
  sortOrder: number;
}
/**
 * ข้อ12 — การเดินทาง (AccTravelVehicleOption). Beyond the shared option shape, a
 * vehicle carries the config that drives the requester form: whether it needs a
 * departure place (+ the pickable `places`), admin ticket booking, a depart time,
 * or a vehicle rental.
 */
export interface VehicleOption extends TravelSettingsOption {
  needsDepartureLocations: boolean;
  needsTicketBooking: boolean;
  needsDepartTime: boolean;
  needsVehicleRent: boolean;
  places: VehiclePlace[];
}
/**
 * ข้อ15 — เช่ายานพาหนะ (AccTravelRentVehicle). `needsRentBooking` config drives the form:
 * selecting this rental flags the request for Admin to arrange the rental.
 */
export interface RentVehicle extends TravelSettingsOption {
  needsRentBooking: boolean;
}

/** Rocks_Portal_Form.dbo.TravelProvince — ข้อ8 จังหวัด. */
export interface ProvinceOption {
  id: number;
  nameTh: string;
  nameEn: string | null;
}

/** ข้อ9 — สถานที่ไปปฏิบัติงาน (AccTravelWorkLocation), free-text multi-add. */
export interface WorkLocation {
  id: number;
  name: string;
  sortOrder: number;
}

/** ข้อ13 — จุดขึ้นรถ/ขึ้นเครื่อง per direction (AccTravelDepartureLocation), when *NeedsDepartureLocations. */
export interface DepartureLocation {
  id: number;
  direction: TravelDirection;
  name: string;
  sortOrder: number;
}

/** File attached to a request, a booking detail row, or the ID card (AccRequestFile). */
export interface TravelBookingFileMeta {
  id: number;
  refType: string;
  refId: number;
  fileName: string;
  fileSize: number;
  contentType: string;
}

/**
 * Admin fill-in booking row (AccTravelBookingDetail), 2.x.
 *
 * Five fields, not two, since migration 123: a hotel or ticket invoice states a
 * number, a price before VAT, the VAT, any discount and the total charged, and
 * accounting signs off against that paper. `totalAmount` is **stored, not
 * derived** — the arithmetic is a check on the invoice, not a substitute for it
 * (see `lib/booking-amounts.ts`). All four figures are null on every row written
 * before 123, which is honest: nobody recorded them at the time.
 *
 * One shape for all three booking kinds — `bookingType` discriminates them and
 * the fields are identical across them.
 */
export interface BookingDetail {
  id: number;
  bookingType: BookingType;
  bookingNo: string | null;
  priceExVat: number | null;
  vatAmount: number | null;
  discountAmount: number | null;
  totalAmount: number | null;
  files: TravelBookingFileMeta[];
}

/** One approval step instance against the shared AccApproval table (AP-17 only ever uses the MANAGER step). */
export interface TravelBookingApproval {
  id: number;
  requestId: number;
  stepCode: "MANAGER";
  stepOrder: number;
  assignedTo: number | null;
  assignedEmail: string | null;
  status: "Pending" | "Approved" | "Rejected" | "Returned";
  comment: string | null;
  isChecked: boolean | null;
  actionedByStaffId: number | null;
  actionedAt: string | null;
  createdAt: string;
  /** HR-enriched display names/emails (joined from Rocks_Portal_HR.Employee by StaffId), mirrors AP-1's AccApproval. */
  actionedByHrName: string | null;
  actionedByHrEmail: string | null;
  assignedToHrName: string | null;
  assignedToHrEmail: string | null;
  assignedToHrPhotoUrl: string | null;
}

/**
 * One tab/request — the join of AccRequest (header) + AccTravelBooking (AP-17 detail)
 * + its child rows. A multi-request submission produces N of these, sharing `groupKey`.
 */
export interface TravelBookingRequest {
  /** AccRequest.Id — absent for a tab that hasn't been persisted yet. */
  id?: number;
  requestNo: string | null;
  status: TravelBookingStatus;
  /**
   * `AccRequest.CurrentStepCode` — which step the request is parked on, NULL once
   * it is terminal. `status` alone cannot answer that: `ManagerApproved` spans
   * both the Admin booking stage and accounting's sign-off.
   */
  currentStepCode: TravelBookingStepCode | null;
  /** `AccRequest.BrandCode` — the company this booking is filed under. */
  brandCode: string | null;
  /**
   * `AccRequest.Currency` — the currency the **booking figures** on
   * `AccTravelBookingDetail` are recorded in. **Null and `"THB"` both mean
   * baht**, and a baht request leaves it null: nobody recorded a currency, and
   * writing `"THB"` would claim somebody had.
   *
   * Derived from the brand and written by the booking desk's save
   * (`admin-service.ts`), never posted by the requester — `TravelBookingTab`
   * has no money field at all.
   *
   * **It does not describe `perDiemTotal`, which is always baht** — and nor
   * does it describe `AccRequest.TotalAmount`, which for AP-17 holds the per
   * diem alone and is deliberately untouched by this feature.
   * `EmployeeAllowanceLog` has no currency column, so there is no data that
   * could make an allowance anything else.
   */
  currency: string | null;
  /**
   * THB per 1 unit of `currency`, as fetched when the desk last saved a booking
   * row. Null for a baht request.
   *
   * An **ECB mid-market reference rate** — `อัตราอ้างอิง`, never captioned as a
   * Bank of Thailand rate (spec §9.1). Display only: nothing multiplies it into
   * a stored column, because AP-17 stores no converted figure.
   */
  exchangeRate: number | null;
  /**
   * **Which day's rate `exchangeRate` is** — `YYYY-MM-DD` (migration 130) — and
   * where it came from.
   *
   * Not the day the desk saved the booking. The source publishes on working
   * days only, so a row saved on a Saturday carries Friday's rate and one saved
   * after a long weekend can carry a three-day-old one. That is correct; the
   * two dates are simply different facts, and only this one says what the
   * figures were priced at.
   *
   * Null on a baht request and on everything written before 130, which
   * backfilled nothing: nobody recorded it, and inventing a date would be worse
   * than admitting there is none.
   */
  rateAsOf: string | null;
  /** Where that rate came from — `"ECB"` today. See `rateAsOf`. */
  rateSource: string | null;
  /**
   * Where this trip's uncounted first day went, when `isContinuation` is set.
   *
   * A continuation trip departs on the day the one before it returned, and one
   * day cannot pay per diem twice — so the first day is dropped here and counted
   * there. `isContinuation` alone said a day had gone without saying where,
   * which on a one-day trip means the whole allowance reads as zero with no
   * explanation on the page.
   *
   * Null when the trip is not a continuation, and also when the sibling that
   * caused it cannot be found — a group edited by hand could leave the flag set
   * with nothing matching it, and the note then says less rather than lying.
   */
  continuationFromRequestNo: string | null;
  /** That request's id, so the number can be a link rather than a string to copy. */
  continuationFromRequestId: number | null;

  // requester snapshot (from AccRequest / AccTravelBooking)
  staffId: number | null;
  requesterFullName: string | null;
  requesterPhotoUrl: string | null;
  requesterEmail: string | null;
  requesterPosition: string | null;
  requesterDepartmentName: string | null;
  phone: string | null;
  allowanceSnapshot: number | null;

  // ข้อ5 — เหตุผลการเดินทาง
  reasonId: number | null;
  reasonName: string | null;
  reasonCustomText: string | null;

  // ข้อ7 — รายละเอียดการไปปฏิบัติงาน
  workDetail: string | null;

  // ข้อ8/9 — จังหวัด + สถานที่ปฏิบัติงาน
  provinceId: number | null;
  provinceName: string | null;
  workLocations: WorkLocation[];

  // ข้อ10 — ที่พักค้างคืน
  accommodationId: number | null;
  accommodationName: string | null;
  accommodationCustomText: string | null;
  needsRoomBooking: boolean;

  // ข้อ6 — วันเดินทาง (range)
  departDate: string | null;
  returnDate: string | null;
  // ข้อ11 — เวลา
  departTime: string | null; // 'HH:mm'
  returnTime: string | null; // 'HH:mm'

  // ข้อ12 — ยานพาหนะ ขาไป
  goVehicleId: number | null;
  goVehicleName: string | null;
  goVehicleCustomText: string | null;
  goNeedsDepartureLocations: boolean;
  goNeedsTicketBooking: boolean;
  goNeedsDepartTime: boolean;
  goNeedsVehicleRent: boolean;

  // ข้อ12 — ยานพาหนะ ขากลับ
  returnVehicleId: number | null;
  returnVehicleName: string | null;
  returnVehicleCustomText: string | null;
  returnNeedsDepartureLocations: boolean;
  returnNeedsTicketBooking: boolean;
  returnNeedsDepartTime: boolean;
  returnNeedsVehicleRent: boolean;

  // ข้อ13 — จุดขึ้นรถ/ขึ้นเครื่อง (both directions combined; filter by .direction)
  departureLocations: DepartureLocation[];

  // ข้อ15/16 — เช่ายานพาหนะ (captured once per request)
  rentVehicleId: number | null;
  rentVehicleName: string | null;
  rentVehicleCustomText: string | null;
  needsRentBooking: boolean;
  rentStartDate: string | null;
  rentEndDate: string | null;

  // ข้อ18
  notes: string | null;

  // multi-request chain / per-diem
  isContinuation: boolean;
  perDiemDays: number;
  perDiemTotal: number;

  paymentDate: string | null;
  submittedAt: string | null;

  groupKey: string | null;
  sortOrder: number;

  // ข้อ17 — แนบบัตรประชาชน (>=1)
  idCardFiles: TravelBookingFileMeta[];
  // Admin fill-in (2.x)
  bookingDetails: BookingDetail[];
  approvals: TravelBookingApproval[];
}

/** All tabs of one multi-request submission, keyed by their shared GroupKey. */
export interface TravelBookingGroup {
  groupKey: string;
  requests: TravelBookingRequest[];
}

/** Lightweight row for a draft-group picker (no child rows / files). */
export interface TravelBookingDraftSummary {
  groupKey: string;
  tabCount: number;
  /** Earliest DepartDate across the group's tabs. */
  departDate: string | null;
  /** Latest ReturnDate across the group's tabs. */
  returnDate: string | null;
  provinceName: string | null;
  workDetail: string | null;
  updatedAt: string;
}

/**
 * Writable subset of `TravelBookingRequest` for one tab — what the form posts on
 * save-draft/submit. Server-derived fields (names resolved from ids, requester
 * snapshot, isContinuation, perDiem*, paymentDate, submittedAt, requestNo, status,
 * approvals, bookingDetails) are omitted; the server fills those in.
 *
 * **The `needs*` booleans below are sent but ignored.** They are still on the
 * type because the form computes them to drive its own conditional inputs, and
 * because the same object shape round-trips through the draft. The server
 * re-derives every one of them from the selected accommodation, vehicle and
 * rent-vehicle rows on each save — see `@/lib/acc/travel-booking/derive-flags`
 * for what they decide and why trusting them let a request with a hotel booking
 * auto-complete without one.
 */
export interface SaveTravelBookingInput {
  /** AccRequest.Id — present when updating an existing tab within a draft group. */
  id?: number;

  /**
   * `AccRequest.BrandCode` — the company **this trip** is claimed against.
   *
   * Per trip, not per request: a group is one `AccRequest` row per tab, each
   * with its own `BrandCode`, and one journey can be for a different company
   * than the next. Nullable on a draft, required at submit.
   */
  brandCode: string | null;

  reasonId: number | null;
  reasonCustomText: string | null;

  workDetail: string | null;

  provinceId: number | null;
  workLocations: { name: string; sortOrder: number }[];

  accommodationId: number | null;
  accommodationCustomText: string | null;
  needsRoomBooking: boolean;

  departDate: string | null;
  returnDate: string | null;
  departTime: string | null;
  returnTime: string | null;

  goVehicleId: number | null;
  goVehicleCustomText: string | null;
  goNeedsDepartureLocations: boolean;
  goNeedsTicketBooking: boolean;
  goNeedsDepartTime: boolean;
  goNeedsVehicleRent: boolean;

  returnVehicleId: number | null;
  returnVehicleCustomText: string | null;
  returnNeedsDepartureLocations: boolean;
  returnNeedsTicketBooking: boolean;
  returnNeedsDepartTime: boolean;
  returnNeedsVehicleRent: boolean;

  departureLocations: { direction: TravelDirection; name: string; sortOrder: number }[];

  rentVehicleId: number | null;
  rentVehicleCustomText: string | null;
  needsRentBooking: boolean;
  rentStartDate: string | null;
  rentEndDate: string | null;

  notes: string | null;

  sortOrder: number;
}

/** One multi-request submission (save-draft or submit payload). */
export interface SaveTravelBookingGroupInput {
  /** Existing GroupKey when updating a previously-saved draft group; omitted for a new group. */
  id?: string;
  tabs: SaveTravelBookingInput[];
  /** Optional: open on behalf of a same-department colleague (their HR StaffId). */
  requesterStaffId?: number | null;
}

/**
 * Row returned by `GET /api/request/travel-booking/admin/queue` — a client-safe copy of
 * `AdminQueueItem` from `src/lib/acc/travel-booking/admin-service.ts` (server-only, so its
 * own interface can't be imported from a `"use client"` page).
 */
export interface TravelBookingAdminQueueItem {
  id: number;
  requestNo: string | null;
  /** `AccRequest.BrandCode` — per trip, so two rows of one group can differ. */
  brandCode: string | null;
  requesterFullName: string | null;
  requesterPosition: string | null;
  requesterDepartmentName: string | null;
  provinceName: string | null;
  departDate: string | null;
  returnDate: string | null;
  needsRoomBooking: boolean;
  needsTicketBooking: boolean;
  needsRentBooking: boolean;
  paymentDate: string | null;
  updatedAt: string;
}

/**
 * Row returned by `GET /api/request/travel-booking/account/queue` — a client-safe
 * copy of `AccountQueueItem` from `src/lib/acc/travel-booking/admin-service.ts`.
 */
export interface TravelBookingAccountQueueItem {
  id: number;
  requestNo: string | null;
  /** `AccRequest.BrandCode` — per trip, so two rows of one group can differ. */
  brandCode: string | null;
  requesterFullName: string | null;
  requesterPosition: string | null;
  requesterDepartmentName: string | null;
  provinceName: string | null;
  departDate: string | null;
  returnDate: string | null;
  perDiemDays: number;
  perDiemTotal: number;
  paymentDate: string | null;
  updatedAt: string;
  perDiemHistory: string[];
  /**
   * The trip whose fate this figure still hangs on, or null when nothing can
   * move it. `settled: false` means accounting must not sign this row yet — the
   * queue page disables its controls and `approveByAccount` refuses it. Copied
   * rather than imported for the reason above: this file has no imports, and
   * `PerDiemDependency` (`@/lib/acc/travel-booking/perdiem-dependency`) is the
   * server-side original the two must stay identical to.
   */
  perDiemDependency: {
    requestId: number;
    requestNo: string | null;
    status: string;
    settled: boolean;
  } | null;
}
