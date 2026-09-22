/** A piece of refund evidence that is absent. */
export type RefundEvidenceGap = "date" | "amount" | "proof";

/**
 * Whether a clearing says the employee owes the company money without any
 * evidence that they returned it.
 *
 * The gap this closes is not a validation that was forgotten. `validateForSubmit`
 * asks for the transfer date, its amount and a slip whenever `refundToCompany`
 * is positive — but it asks at submit, about the sign the clearing had then.
 * Accounting disallows an expense at the ACCOUNT step, `persistClear`
 * recomputes `RefundToCompany` from the edited lines, and a clearing that was
 * "the company owes me" becomes "I owe the company". Nothing re-asks, and
 * nothing could usefully be typed in if it did: the employee has not
 * transferred the money, because until that edit they did not owe it.
 *
 * So this is not a field to fill. It is a request that has to go back to the
 * requester, who transfers the money and attaches the slip — which is why the
 * ACCOUNT step refuses to approve rather than refusing to save.
 *
 * Scoped to evidence that is absent, not evidence that disagrees: accounting
 * can also change what is owed after a slip was attached, and the detail card
 * already prints the expected figure beside the transferred one. Blocking on
 * that was considered and left alone (user, 2026-09-10).
 *
 * ## Why a list and not a union of combinations
 *
 * The transfer date, the transferred amount and the slip can each be absent on
 * their own. As a union of shapes that is seven members, and the message builder
 * then has seven branches to get right — which is how it ends up naming the
 * wrong thing. Reporting which pieces are missing keeps the message a join.
 *
 * The amount joined the list on 2026-09-23, when the ERP journal started posting
 * it (`clear-advance-erp-payload.ts`). Before that it was asked for at submit and
 * never re-asked, so a clearing that turned into a refund after accounting
 * disallowed an expense could reach the send with no figure at all.
 */
export function refundEvidenceMissing(clear: {
  refundToCompany: number | null | undefined;
  refundTransferDate: string | null | undefined;
  refundTransferAmount: number | null | undefined;
  proofCount: number;
}): RefundEvidenceGap[] | null {
  if (!(Number(clear.refundToCompany ?? 0) > 0)) return null;
  const gaps: RefundEvidenceGap[] = [];
  if (!(clear.refundTransferDate ?? "").trim()) gaps.push("date");
  if (!(Number(clear.refundTransferAmount ?? 0) > 0)) gaps.push("amount");
  if (!(clear.proofCount > 0)) gaps.push("proof");
  return gaps.length ? gaps : null;
}

/** What to tell the account officer, who cannot fix this from their own screen. */
export function refundEvidenceMessage(gaps: RefundEvidenceGap[]): string {
  const name: Record<RefundEvidenceGap, string> = {
    date: "วันที่โอนเงินคืน",
    amount: "ยอดเงินที่โอนคืน",
    proof: "หลักฐานการโอน",
  };
  const what = gaps.map((g) => name[g]).join(" · ");
  return (
    `ยอดที่แก้ไขทำให้ใบนี้กลายเป็น “พนักงานต้องโอนเงินคืนบริษัท” แต่ยังไม่มี${what} — ` +
    `กด “ส่งกลับแก้ไข” เพื่อให้ผู้ขอโอนเงินคืนแล้วแนบหลักฐาน จึงจะอนุมัติได้`
  );
}
