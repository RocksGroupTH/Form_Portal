/** Which half of the refund evidence is absent, or null when nothing is owed
 *  or everything is there. */
export type RefundEvidenceGap = "date" | "proof" | "both";

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
 */
export function refundEvidenceMissing(clear: {
  refundToCompany: number | null | undefined;
  refundTransferDate: string | null | undefined;
  proofCount: number;
}): RefundEvidenceGap | null {
  if (!(Number(clear.refundToCompany ?? 0) > 0)) return null;
  const noDate = !(clear.refundTransferDate ?? "").trim();
  const noProof = !(clear.proofCount > 0);
  if (noDate && noProof) return "both";
  if (noDate) return "date";
  if (noProof) return "proof";
  return null;
}

/** What to tell the account officer, who cannot fix this from their own screen. */
export function refundEvidenceMessage(gap: RefundEvidenceGap): string {
  const what =
    gap === "both" ? "วันที่โอนเงินคืนและหลักฐานการโอน"
    : gap === "date" ? "วันที่โอนเงินคืน"
    : "หลักฐานการโอนเงินคืน";
  return (
    `ยอดที่แก้ไขทำให้ใบนี้กลายเป็น “พนักงานต้องโอนเงินคืนบริษัท” แต่ยังไม่มี${what} — ` +
    `กด “ส่งกลับแก้ไข” เพื่อให้ผู้ขอโอนเงินคืนแล้วแนบหลักฐาน จึงจะอนุมัติได้`
  );
}
