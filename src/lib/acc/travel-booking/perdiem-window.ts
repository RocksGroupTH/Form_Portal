/**
 * May this request's per-diem figure still be rewritten?
 *
 * `Completed` means accounting has signed it — see `approveByAccount`. From
 * there the figure is a decision somebody made, and a predecessor cancelled
 * afterwards is a thing for a person to look at, not for a transaction to
 * silently correct. `Cancelled` and `Rejected` are not going to be paid at all.
 *
 * **An allow-list, so an unknown status is refused.** A status added later is
 * far more likely to be another terminal state than another editable one, and
 * overwriting a figure somebody has already been paid on is the expensive
 * direction to be wrong in.
 *
 * Pure and import-free so it is unit-tested without a database.
 */
const WRITABLE: readonly string[] = ["Draft", "Submitted", "ManagerApproved", "Returned"];

export function perDiemWritable(status: string): boolean {
  return WRITABLE.indexOf(status) !== -1;
}
