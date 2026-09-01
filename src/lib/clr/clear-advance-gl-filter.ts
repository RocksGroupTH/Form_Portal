/** HQ takes the head-office accounts; a PC branch takes only the "สาขา" ones.
 *  A line with no branch picked yet is treated as HQ so the list is never empty. */
export function isHqBranch(branchCode: string | null | undefined): boolean {
  const b = (branchCode ?? "").trim().toUpperCase();
  return b === "" || b.startsWith("HQ");
}
