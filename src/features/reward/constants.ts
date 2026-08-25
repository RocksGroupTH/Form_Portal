import type { RewardRequestStatus } from "@/features/reward/types";

export const AP11_FORM_CODE = "AP-11";
export const RUNNING_PREFIX = "OPR";

/** `AccRequestFile.RefType` for AP-11's evidence attachments (brief §5). */
export const REWARD_FILE_REFTYPE = "reward_doc";

/**
 * Step codes on `AccApproval`. Two steps: the requester's HR manager, then the
 * Assist AP team.
 *
 * `REWARD` rather than `ACCOUNT` on purpose — AP-1's ACCOUNT step is actioned
 * by `AccApprover`, and AP-11's second step is a different roster
 * (`AccRewardOfficer`). Sharing the code would make the two indistinguishable
 * in `AccApproval` and in the activity log.
 */
export const REWARD_STEP_CODES = ["MANAGER", "REWARD"] as const;
export type RewardStepCode = (typeof REWARD_STEP_CODES)[number];

export const REWARD_REQUEST_STATUSES: RewardRequestStatus[] = [
  "Draft",
  "Submitted",
  "ManagerApproved",
  "Approved",
  "Ready",
  "Received",
  "Rejected",
  "Returned",
];

export const STATUS_LABEL_TH: Record<RewardRequestStatus, string> = {
  Draft: "ฉบับร่าง",
  Submitted: "รออนุมัติ (ผู้จัดการ)",
  ManagerApproved: "รออนุมัติ (Assist AP)",
  Approved: "อนุมัติแล้ว — รอจัดของ",
  Ready: "จัดของเรียบร้อย — รอรับของ",
  Received: "รับของแล้ว",
  Rejected: "ไม่อนุมัติ",
  Returned: "ส่งกลับแก้ไข",
};

/** UI label — collapse the two "รออนุมัติ (...)" variants to one word. */
export function statusLabelDisplay(status: string): string {
  const label = STATUS_LABEL_TH[status as RewardRequestStatus] ?? status;
  if (label.startsWith("รออนุมัติ")) return "รออนุมัติ";
  return label;
}

export function isPendingRewardStatus(status: string): boolean {
  return status === "Submitted" || status === "ManagerApproved";
}

/**
 * Statuses in which the reward's stock is still held by this request.
 *
 * Everything from submit up to and including `Ready`: the goods are spoken for
 * but have not left the counter. `Received` moves the quantity from
 * `LockedQty` to `IssuedQty`, and `Rejected` releases it. `Returned` is in the
 * list deliberately — the owner's rule is that only a Reject returns stock, so
 * a request sitting with the requester for edits keeps its hold.
 */
export const STOCK_HOLDING_STATUSES: readonly string[] = [
  "Submitted",
  "ManagerApproved",
  "Approved",
  "Ready",
  "Returned",
];

/** Statuses a requester may still edit and resubmit. Mirrors the shared ACL. */
export const EDITABLE_STATUSES: readonly string[] = ["Draft", "Returned"];

/**
 * Header copy, shown on the form and in the notification mails.
 *
 * The cut-off and pickup times are copy, not logic: nothing computes a pickup
 * date from them. If that changes, it should follow AP-1's `PaymentDate` — a
 * stamped column with a calendar helper — rather than being inferred in the UI.
 */
export const REWARD_FORM_MESSAGE_TH = [
  "ใช้สำหรับเบิกของรางวัลสำหรับทีม OP",
  "ตัดรอบการเบิก (คำขอที่ผ่านการอนุมัติ) ทุกวันศุกร์ 16.00 น.",
  "รับของรางวัลที่บัญชีทุกวันจันทร์ หลัง 13.00 น. เป็นต้นไป",
] as const;

/** Report status filter — one option per UI label. */
export const REPORT_STATUS_FILTER_GROUPS = [
  { id: "pending", label: "รออนุมัติ", match: isPendingRewardStatus },
  { id: "Approved", label: "รอจัดของ", match: (s: string) => s === "Approved" },
  { id: "Ready", label: "รอรับของ", match: (s: string) => s === "Ready" },
  { id: "Received", label: "รับของแล้ว", match: (s: string) => s === "Received" },
  { id: "Rejected", label: "ไม่อนุมัติ", match: (s: string) => s === "Rejected" },
  { id: "Returned", label: "ส่งกลับแก้ไข", match: (s: string) => s === "Returned" },
] as const;

export type ReportStatusFilterId = (typeof REPORT_STATUS_FILTER_GROUPS)[number]["id"];

export function rowMatchesReportStatusFilter(
  rowStatus: string,
  selectedGroupIds: string[],
): boolean {
  return selectedGroupIds.some((id) => {
    const group = REPORT_STATUS_FILTER_GROUPS.find((g) => g.id === id);
    return group ? group.match(rowStatus) : false;
  });
}

/** Attachment kinds the evidence upload admits — screenshots, plus PDF as AP-17 does. */
export const REWARD_ALLOWED_ATTACHMENT_KINDS = ["image", "pdf"] as const;
