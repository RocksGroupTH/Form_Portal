/** The one field a UAT-mail-redirect decision is judged against. */
export interface UatMailExemptRecord {
  email: string;
}

function normalizeEmail(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

/**
 * Whether a UAT-environment mail recipient should be delivered at their own
 * address instead of being rewritten to `UAT_MAIL_REDIRECT`.
 *
 * Exempt: the recipient holds an active `UatTester` row of their own. Every
 * other address — one that matches nothing in `activeTesters`, or a
 * blank/missing recipient — is NOT exempt and keeps the rewrite. This must
 * fail closed: an empty list or an unmatched recipient always returns false,
 * never true, so an unrecognised address can never reach a real inbox through
 * this exception.
 *
 * **A configured UAT manager is still exempt, through this same set rather
 * than through an arm of their own.** `/api/settings/uat-users` only accepts a
 * manager who is themself an active tester and stores that tester's own
 * `Email` as `ManagerEmail`, so an active manager's address is always in
 * `activeTesters` already. Matching `UatTester.ManagerEmail` directly, as this
 * predicate used to, kept exempting a manager after their own tester row was
 * deactivated: dependants' `ManagerEmail` copies are deliberately not rewritten
 * on deactivation, so the stale address survived and a `[UAT]` message could
 * still reach a real inbox. Intersecting that arm with the active-tester set —
 * which is what the exemption now is — closes that, and leaves nothing the
 * membership test below does not already decide.
 *
 * Matching is case- and whitespace-insensitive, the same rule `UatTester`'s
 * own lookups use (`getActiveUatTester` in `src/lib/uat-tester/service.ts`).
 *
 * Pure: `activeTesters` is gathered by the caller from the active rows of
 * `UatTester` (Fast_Core) — nothing here touches a database.
 */
export function isUatMailExempt(
  recipient: string | null | undefined,
  activeTesters: readonly UatMailExemptRecord[],
): boolean {
  const target = normalizeEmail(recipient);
  if (!target) return false;

  for (const tester of activeTesters) {
    if (normalizeEmail(tester.email) === target) return true;
  }
  return false;
}
