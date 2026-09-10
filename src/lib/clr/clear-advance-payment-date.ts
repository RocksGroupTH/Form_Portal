/**
 * What the payment date on an AP-3 clearing should be, and whether the account
 * step may proceed with it.
 *
 * Which rule applies depends on which way the money goes, which is the part
 * AP-2 never has to decide — an advance only ever pays out.
 *
 *   refund < 0  the company owes the employee. The money leaves on treasury's
 *               own run, so the date must be one of the payment rounds (the
 *               2nd and 4th Friday, shifted back off holidays). Required.
 *   refund > 0  the employee has transferred money back. The date is the day
 *               their transfer cleared, which is whatever day they sent it —
 *               holding that to a treasury calendar would reject every honest
 *               one. Taken from the stored transfer date, not from the caller.
 *   refund = 0  nothing moves and there is nothing to date.
 *
 * `refundTransferDate` is required at submit whenever refund > 0
 * (clear-advance-request-service.ts), so the refund branch can never find
 * nothing to take.
 *
 * `allowedRounds` is read only on the company-pays branch, so a caller that
 * has already established the sign may pass an empty array on the others
 * rather than reach for the holiday table it will not use.
 *
 * Pure on purpose: the rule is worth testing without a database, and the
 * calendar it is checked against is somebody else's job.
 */
export type ClrPaymentDateDecision =
  | { ok: true; paymentDate: string | null }
  | { ok: false; error: string };

export function resolveClrPaymentDate(input: {
  refundToCompany: number | null | undefined;
  refundTransferDate: string | null | undefined;
  /** What the browser sent. Honoured only where the caller is allowed to choose. */
  submitted: string | null | undefined;
  allowedRounds: readonly string[];
}): ClrPaymentDateDecision {
  const refund = Number(input.refundToCompany ?? 0);
  const submitted = (input.submitted ?? "").trim();

  if (refund < 0) {
    if (!submitted) {
      return { ok: false, error: "กรณีบริษัทต้องจ่ายเพิ่ม กรุณาระบุวันจ่าย (Payment Date)" };
    }
    if (!input.allowedRounds.includes(submitted)) {
      // The same sentence AP-2 throws for the same rule, so an accountant who
      // works both forms is told the same thing.
      return { ok: false, error: "วันที่จ่ายไม่อยู่ในรอบที่กำหนด (ศุกร์ที่ 2 หรือ 4)" };
    }
    return { ok: true, paymentDate: submitted };
  }

  if (refund > 0) {
    /* Derived, never accepted. The screen shows this read-only and the journal
       reads `refundTransferDate` first regardless, so a value that disagreed
       with it could only ever be a stored lie. */
    return { ok: true, paymentDate: (input.refundTransferDate ?? "").trim() || null };
  }

  return { ok: true, paymentDate: submitted || null };
}
