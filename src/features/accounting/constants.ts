export const REQUEST_STATUSES = [
  "Draft","Submitted","ManagerApproved","Approved","Rejected","Returned","Cancelled",
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const STEP_CODES = ["MANAGER","ACCOUNT"] as const;
export type StepCode = (typeof STEP_CODES)[number];

export const TRAVEL_ITEM_TYPES = ["fare","toll","parking"] as const;
export type TravelItemType = (typeof TRAVEL_ITEM_TYPES)[number];

/** Thai labels for travel expense item types (used for filenames + display). */
export const TRAVEL_ITEM_TYPE_LABEL_TH: Record<TravelItemType, string> = {
  fare: "ค่าโดยสาร",
  toll: "ค่าผ่านทาง",
  parking: "ค่าจอดรถ",
};

export const DIRECTIONS = ["round","onward","return"] as const;
export type Direction = (typeof DIRECTIONS)[number];

export const AP1_FORM_CODE = "AP-1";

export const STATUS_LABEL_TH: Record<RequestStatus, string> = {
  Draft: "ฉบับร่าง", Submitted: "รออนุมัติ (ผู้จัดการ)",
  ManagerApproved: "รออนุมัติ (บัญชี)", Approved: "อนุมัติแล้ว",
  Rejected: "ไม่อนุมัติ", Returned: "ส่งกลับแก้ไข", Cancelled: "ยกเลิก",
};

/** UI label — collapse "รออนุมัติ (...)" to "รออนุมัติ". */
export function statusLabelDisplay(status: string): string {
  const label = STATUS_LABEL_TH[status as RequestStatus] ?? status;
  if (label.startsWith("รออนุมัติ")) return "รออนุมัติ";
  return label;
}

export function isPendingApprovalStatus(status: string): boolean {
  return status === "Submitted" || status === "ManagerApproved";
}

/** Report status filter — one option per UI label (pending = both approval steps). */
export const REPORT_STATUS_FILTER_GROUPS = [
  { id: "pending", label: "รออนุมัติ", match: isPendingApprovalStatus },
  { id: "Approved", label: "อนุมัติแล้ว", match: (s: string) => s === "Approved" },
  { id: "Rejected", label: "ไม่อนุมัติ", match: (s: string) => s === "Rejected" },
  { id: "Returned", label: "ส่งกลับแก้ไข", match: (s: string) => s === "Returned" },
  { id: "Cancelled", label: "ยกเลิก", match: (s: string) => s === "Cancelled" },
] as const;

export type ReportStatusFilterId = (typeof REPORT_STATUS_FILTER_GROUPS)[number]["id"];

export function reportStatusFilterLabel(id: string): string {
  const group = REPORT_STATUS_FILTER_GROUPS.find((g) => g.id === id);
  return group?.label ?? id;
}

export function rowMatchesReportStatusFilter(
  rowStatus: string,
  selectedGroupIds: string[],
): boolean {
  return selectedGroupIds.some((id) => {
    const group = REPORT_STATUS_FILTER_GROUPS.find((g) => g.id === id);
    return group ? group.match(rowStatus) : false;
  });
}

export const ERP_PREP_STATUSES = ["ready", "incomplete"] as const;
export type ErpPrepStatus = (typeof ERP_PREP_STATUSES)[number];

export const ERP_PREP_LABEL_TH: Record<ErpPrepStatus, string> = {
  ready: "พร้อมส่ง",
  incomplete: "ข้อมูลไม่ครบ",
};

export const ERP_INTERFACE_STATUSES = ["Pending", "Sent", "Failed"] as const;
export type ErpInterfaceStatus = (typeof ERP_INTERFACE_STATUSES)[number];

export const ERP_INTERFACE_LABEL_TH: Record<ErpInterfaceStatus, string> = {
  Pending: "กำลังส่ง",
  Sent: "ส่งสำเร็จ",
  Failed: "ส่งไม่สำเร็จ",
};

/** Shown when Google Maps is not configured or cannot load (AP-1 vehicle / route picker). */
export const MAPS_UNAVAILABLE_USER_MESSAGE =
  "ไม่สามารถใช้แผนที่ Google Maps ได้ในขณะนี้ — กรุณาติดต่อ IT";

/**
 * The notice at the top of AP-1's form, mirroring AP-17's
 * `AP17_HEADER_MESSAGE_LINES`.
 *
 * **This is process copy, not a description of what the code computes.** The
 * payment *dates* are: `shiftPaymentDay` picks the next 2nd or 4th Friday and
 * walks backward past weekends and `Rocks_Codex.Holiday`, set when **accounting**
 * approves. The Monday-noon cut-off in the first line is the accounting team's
 * own, applied to when a manager-approved claim is picked up — AP-1 has no
 * `weekMondayNoon` the way `reimburse/payment-calendar.ts` does, so nothing here
 * enforces it. If it is ever meant to be enforced, this copy is not the change
 * to make; the calendar is.
 */
export const AP1_HEADER_MESSAGE_LINES: string[] = [
  "รอบการเบิกจ่ายค่าเดินทาง — ตัดรอบวันจันทร์ (อนุมัติแล้ว) และจ่ายตามปฏิทินการชำระของบริษัท (ทุกศุกร์ที่ 2 และศุกร์ที่ 4 ของเดือน)",
  "ถ้า ผจก. อนุมัติก่อนเที่ยง เข้ารอบจ่ายถัดไป · ตั้งแต่เที่ยงเป็นต้นไป ข้ามไปอีกหนึ่งรอบ",
  "พนักงานออฟฟิศที่กลับบ้านเกิน 21.00 น. หรือมีชั่วโมงทำงานเกิน 8 ชั่วโมง เบิกค่าเดินทางกลับบ้านได้",
];
