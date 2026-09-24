/**
 * A cancelled request's closed approval row is not a return, and must not be
 * labelled as one.
 *
 * ## The shape of the problem
 *
 * `CK_AccApproval_Status` permits `Pending`, `Approved`, `Rejected` and
 * `Returned` — **there is no `Cancelled`**. So every self-cancel path closes
 * whatever row was pending as `Returned`, stamping the requester as the actor:
 * `cancelByRequester` in `approval-engine.ts` (AP-1), the one in
 * `travel-booking/approval.ts` (AP-17), `cancelReimburseByRequester` (AP-4) and
 * AP-2's in `advance-approval-engine.ts`.
 *
 * Read literally, the timeline then tells the requester they "ส่งกลับแก้ไข"
 * their own request — that somebody sent it back for editing — which is the one
 * thing a cancellation is not. Reported by the user on 2026-09-24 against a
 * cancelled AP-1 claim whose ขั้นตอนการอนุมัติ block read **ส่งกลับแก้ไข ·
 * ส่งกลับโดย Sattawat Jaiyen** under a request whose own badge said ยกเลิก.
 *
 * ## The rule, and where the truth lives
 *
 * The **request's** status is the authority, never the row's: a request that is
 * `Cancelled` and carries a `Returned` approval row was withdrawn, and any
 * other combination is an ordinary return. That is why `withdrawn` is a
 * parameter rather than something inferred here — only the caller has the
 * request beside the row.
 *
 * AP-4 solved this inline first and this is that solution extracted, so the
 * four detail pages cannot drift; a rule spelled out per page is one that gets
 * fixed on one page.
 *
 * ## What is deliberately NOT done
 *
 * The row is **relabelled, not hidden**. An approval trail with a silent gap
 * where its last event should be is worse than one that says the wrong word:
 * the row carries who closed it and when, and that is the record of the
 * cancellation. It is also not rewritten in the database — a status value the
 * CHECK constraint does not permit cannot be stored, and widening that
 * constraint is a migration against both form databases for a display problem.
 */

/** The four statuses `CK_AccApproval_Status` permits, as the pages type them. */
export type WithdrawableApprovalStatus = "Pending" | "Approved" | "Rejected" | "Returned";

/**
 * True when this row is a cancellation wearing a `Returned` status.
 *
 * Both halves are required and neither implies the other: a `Returned` row on a
 * live request is a real return, and an `Approved` row on a cancelled one is a
 * real approval that happened before the withdrawal.
 */
export function isWithdrawnApproval(
  requestStatus: string | null | undefined,
  approvalStatus: string | null | undefined,
): boolean {
  return requestStatus === "Cancelled" && approvalStatus === "Returned";
}

/** What the chip on that row should say. `null` means "use the ordinary label". */
export function withdrawnApprovalLabel(
  requestStatus: string | null | undefined,
  approvalStatus: string | null | undefined,
): string | null {
  return isWithdrawnApproval(requestStatus, approvalStatus) ? "ยกเลิกโดยผู้ขอ" : null;
}

/**
 * The prefix before the actor's name on that row.
 *
 * Returns the ordinary wording for every other combination, so a caller can
 * hand it the row and the request and print the result without a branch of its
 * own — which is what stops the next page from inventing a fifth spelling.
 */
export function approvalActorPrefixFor(
  approvalStatus: string | null | undefined,
  requestStatus?: string | null,
): string {
  if (approvalStatus === "Approved") return "อนุมัติโดย";
  if (approvalStatus === "Rejected") return "ไม่อนุมัติโดย";
  if (approvalStatus === "Returned") {
    return isWithdrawnApproval(requestStatus, approvalStatus) ? "ยกเลิกโดย" : "ส่งกลับโดย";
  }
  return "รอดำเนินการโดย";
}
