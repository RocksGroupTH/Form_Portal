/** The pair of email fields a UAT-mail-redirect decision is judged against. */
export interface UatMailExemptRecord {
  email: string;
  managerEmail: string | null;
}

function normalizeEmail(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

/**
 * Whether a UAT-environment mail recipient should be delivered at their own
 * address instead of being rewritten to `UAT_MAIL_REDIRECT`.
 *
 * Exempt: the recipient is themself an active `UatTester` (matched on
 * `email`), or is named as an active tester's configured UAT manager (matched
 * on `managerEmail`). Every other address — including one that matches
 * nothing in `testers`, or a blank/missing recipient — is NOT exempt and
 * keeps the rewrite. This must fail closed: an empty `testers` list or an
 * unmatched recipient always returns false, never true, so an unrecognised
 * address can never reach a real inbox through this exception.
 *
 * Matching is case- and whitespace-insensitive, the same rule `UatTester`'s
 * own lookups use (`getActiveUatTester` in `src/lib/uat-tester/service.ts`).
 *
 * Pure: `testers` is gathered by the caller from the active rows of
 * `UatTester` (Fast_Core) — nothing here touches a database.
 */
export function isUatMailExempt(
  recipient: string | null | undefined,
  testers: readonly UatMailExemptRecord[],
): boolean {
  const target = normalizeEmail(recipient);
  if (!target) return false;

  for (const tester of testers) {
    if (normalizeEmail(tester.email) === target) return true;
    if (normalizeEmail(tester.managerEmail) === target) return true;
  }
  return false;
}
