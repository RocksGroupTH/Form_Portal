/**
 * Errors whose HTTP status is part of their meaning.
 *
 * The Accounting routes answer 400 for everything a service throws, which turns
 * "somebody else already submitted this" into the dialog's retryable phase: the
 * client offers a retry that cannot ever succeed. These two carry the status the
 * route should use instead.
 *
 * No imports on purpose — the routes and the services both reach for this, and
 * one of the services is imported by the environment resolver's neighbours.
 */

/**
 * The record moved between the read and the write: already submitted, already
 * actioned, already sent. The caller should reload, not retry. → 409.
 */
export class AccConflictError extends Error {
  readonly status = 409;
  constructor(message: string) {
    super(message);
    this.name = "AccConflictError";
  }
}

/** The caller may not do this to this record. → 403. */
export class AccForbiddenError extends Error {
  readonly status = 403;
  constructor(message: string) {
    super(message);
    this.name = "AccForbiddenError";
  }
}

/** The status an error should be answered with; 400 for anything unrecognised. */
export function statusForAccError(err: unknown): number {
  if (err instanceof AccConflictError || err instanceof AccForbiddenError) return err.status;
  return 400;
}

/** What a submit says when the claim finds the row already gone from Draft. */
export const SUBMIT_ALREADY_CLAIMED =
  "คำขอนี้ถูกส่งไปแล้ว หรือถูกแก้ไขโดยผู้อื่น — กรุณาโหลดหน้านี้ใหม่";
