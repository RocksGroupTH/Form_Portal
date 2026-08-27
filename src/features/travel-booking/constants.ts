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
 * Default จุดขึ้นรถ/ขึ้นเครื่อง for ขาไป — nearly every trip starts from head
 * office. ขากลับ has no constant: its default is the province being travelled
 * to. Spelt as the province master spells it (migration 049), not the everyday
 * short "กรุงเทพ", so the two directions read alike.
 */
export const GO_DEFAULT_DEPARTURE_PLACE = "กรุงเทพมหานคร";

/**
 * Header message shown on the AP-17 form (spec §1), verbatim.
 * Rendered as separate lines/bullets by the form UI.
 */
export const AP17_HEADER_MESSAGE_LINES: string[] = [
  "กรุณาแจ้งข้อมูลการเดินทางล่วงหน้าอย่างน้อย 3 วันทำการ — ทีม Admin ตรวจสอบรายการจองทุกวันจันทร์–ศุกร์ เวลา 16.00",
  "หากระยะเวลาเดินทางไม่ถึง 7 วัน และสัมภาระที่ซื้อเพิ่มไม่เกี่ยวข้องกับการทำงาน ผู้ขอเบิกรับผิดชอบค่ากระเป๋าเพิ่มเอง (กรณีซื้อกระเป๋าเพิ่ม กรุณากรอกในแบบฟอร์มครั้งแรก)",
  "กรณีเช่ารถและต้องการประกันภัยส่วนเพิ่ม พนักงานรับผิดชอบค่าประกันเอง",
];
