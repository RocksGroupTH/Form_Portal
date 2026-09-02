import type { TravelBookingStatus, TravelDirection } from "@/features/travel-booking/types";

export const AP17_FORM_CODE = "AP-17";
export const RUNNING_PREFIX = "TRL";

/** AccRequestFile.RefType values used by AP-17. */
export const FILE_REFTYPES = {
  ID_CARD: "idcard",
  BOOKING_ROOM: "booking_room",
  BOOKING_TICKET: "booking_ticket",
  BOOKING_RENT: "booking_rent",
} as const;
export type FileRefType = (typeof FILE_REFTYPES)[keyof typeof FILE_REFTYPES];

/** AccSetting key for "may this requester's ID card be reused on future requests?" (per HR StaffId). */
export const idCardReuseConsentKey = (staffId: number) => `ap17.idcard.reuse.${staffId}`;

/** Maps a booking detail's BookingType to its AccRequestFile.RefType. */
export const BOOKING_TYPE_REFTYPE: Record<"room" | "ticket" | "rent", FileRefType> = {
  room: FILE_REFTYPES.BOOKING_ROOM,
  ticket: FILE_REFTYPES.BOOKING_TICKET,
  rent: FILE_REFTYPES.BOOKING_RENT,
};

export const TRAVEL_BOOKING_STATUSES: TravelBookingStatus[] = [
  "Draft", "Submitted", "ManagerApproved", "Completed", "Rejected", "Returned", "Cancelled",
];

export const STATUS_LABEL_TH: Record<TravelBookingStatus, string> = {
  Draft: "ฉบับร่าง",
  Submitted: "รออนุมัติ (ผู้จัดการ)",
  /**
   * Stage-neutral on purpose. `ManagerApproved` used to mean one thing — waiting
   * for Admin — and this label said so. It now spans Admin's booking fill-in and
   * accounting's sign-off, so the *status* can only honestly say the manager has
   * approved; which of the two stages it is sitting on is `CurrentStepCode`'s
   * answer, given by `travelBookingStatusLabel` below.
   */
  ManagerApproved: "ผู้จัดการอนุมัติแล้ว",
  Completed: "เสร็จสิ้น",
  Rejected: "ไม่อนุมัติ",
  Returned: "ส่งกลับแก้ไข",
  Cancelled: "ยกเลิก",
};

/** Per-stage labels for `ManagerApproved`, keyed on `AccRequest.CurrentStepCode`. */
const MANAGER_APPROVED_STEP_LABEL_TH: Record<string, string> = {
  ADMIN: "รอ Admin จองให้",
  ACCOUNT: "รอบัญชีตรวจสอบ",
};

/**
 * Full status label, told apart by step where the status alone is ambiguous.
 *
 * Pass `currentStepCode` wherever the caller has it — a reader of a
 * `ManagerApproved` request otherwise cannot tell "Admin has yet to book this"
 * from "Admin booked it, accounting has yet to sign it off", which is half that
 * status's life.
 */
export function travelBookingStatusLabel(status: string, currentStepCode?: string | null): string {
  if (status === "ManagerApproved" && currentStepCode) {
    const stepLabel = MANAGER_APPROVED_STEP_LABEL_TH[currentStepCode];
    if (stepLabel) return stepLabel;
  }
  return STATUS_LABEL_TH[status as TravelBookingStatus] ?? status;
}

/** UI label — collapse every still-pending stage to a single pending label. */
export function statusLabelDisplay(status: string, currentStepCode?: string | null): string {
  if (isPendingTravelBookingStatus(status)) return "รอดำเนินการ";
  return travelBookingStatusLabel(status, currentStepCode);
}

export function isPendingTravelBookingStatus(status: string): boolean {
  return status === "Submitted" || status === "ManagerApproved";
}

export const DIRECTIONS: TravelDirection[] = ["go", "return"];

export const DIRECTION_LABEL_TH: Record<TravelDirection, string> = {
  go: "ขาไป",
  return: "ขากลับ",
};

/**
 * Header message shown on the AP-17 form (spec §1), verbatim.
 * Rendered as separate lines/bullets by the form UI.
 */
export const AP17_HEADER_MESSAGE_LINES: string[] = [
  "กรุณาแจ้งข้อมูลการเดินทางล่วงหน้าอย่างน้อย 3 วันทำการ — ทีม Admin ตรวจสอบรายการจองทุกวันจันทร์–ศุกร์ เวลา 16.00",
  "หากระยะเวลาเดินทางไม่ถึง 7 วัน และสัมภาระที่ซื้อเพิ่มไม่เกี่ยวข้องกับการทำงาน ผู้ขอเบิกรับผิดชอบค่ากระเป๋าเพิ่มเอง (กรณีซื้อกระเป๋าเพิ่ม กรุณากรอกในแบบฟอร์มครั้งแรก)",
  "กรณีเช่ารถและต้องการประกันภัยส่วนเพิ่ม พนักงานรับผิดชอบค่าประกันเอง",
];

/**
 * The `AccTravelRentVehicle` row whose whole meaning is "no rental" (spec §2.4),
 * seeded by migration 048 and excluded from 054's backfill so it alone carries
 * `NeedsRentBooking = 0`.
 *
 * **It is identified by its NAME, and nothing in the schema enforces that.**
 * There is no id pin, no CHECK and no flag distinguishing it from an ordinary
 * option — three call sites each held their own copy of this string until
 * 2026-09-02, so renaming the row in settings (a trailing space is enough) would
 * have silently turned every one of them off at once: the form would start
 * demanding rental dates for it, and the submit validator would agree.
 *
 * One copy is not a fix for that, only a smaller target. The fix is
 * `rentBookingContradictsNoRent`, which refuses the state that actually breaks
 * things, and which the settings service calls on every write.
 */
export const NO_RENT_VEHICLE_NAME = "ไม่เช่า";

/**
 * Whether this rent-vehicle row claims to need a booking while calling itself
 * "no rental" — a contradiction the settings editor could write freely.
 *
 * Since 2026-09-02 a selected rent option decides `NeedsRentBooking` outright
 * (`derive-flags.ts`), so ticking `ให้ Admin เช่ายานพาหนะ` on this one row
 * reproduces the exact bug that change fixed: every requester answering "ไม่เช่า"
 * gets an Admin rental group for a rental nobody wants, and the request cannot
 * be closed until somebody invents a booking for it.
 *
 * Compared on the trimmed name, because the editor does not trim and a stored
 * `"ไม่เช่า "` is the same row to a reader.
 */
export function rentBookingContradictsNoRent(
  name: string | null | undefined,
  needsRentBooking: boolean,
): boolean {
  return needsRentBooking && (name ?? "").trim() === NO_RENT_VEHICLE_NAME;
}
