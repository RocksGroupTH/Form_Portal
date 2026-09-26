/**
 * Whether a person may open a form's Message settings tab — the one decision
 * shared by all five forms (AP-1, AP-17, AP-4, AP-2, AP-3), because the rule is
 * identical everywhere: an admin, or somebody whose own roster/access row
 * carries the tick.
 *
 * **The tick is a COLUMN on the roster row, not a `TabKey` row, and that is
 * load-bearing rather than an implementation detail.** `AccApproverSettingsTab`
 * / `AccBookingApproverTab` / `AccReimburseAccessTab` / `AccAdvClrAccessTab` are
 * all shared with ACC Portal, and every one of that app's own savers replaces
 * an approver's WHOLE tab set with only the keys its own list knows — so a
 * `messages` row written there would survive only until the next unrelated
 * settings-tab tick that person received over there, then vanish with no error
 * on either side. `CanMessage` (AP-1 / AP-17 / AP-4) and `CanAdvanceMessage` /
 * `CanClearMessage` (AP-2 / AP-3, which share one roster row) are columns ACC
 * Portal's own writers name explicitly in their `UPDATE` / `MERGE` statements —
 * verified against the sibling checkout before this shipped — so a column it
 * does not name is a column it never touches.
 *
 * **This is why `messages` / `advanceMessages` / `clearMessages` stay OUT of
 * every `TabKey` grantable list** (`GRANTABLE_SETTINGS_TABS`,
 * `GRANTABLE_BOOKING_TABS`, `GRANTABLE_REIMBURSE_TABS`,
 * `GRANTABLE_ADV_CLR_TABS`) even though the keys remain in each form's own
 * tab-ORDER array, which names a tab for the settings page's strip and nothing
 * about how it is granted. Putting the key back into a grantable-TabKey list
 * would resurrect the exact defect this module exists to avoid.
 *
 * Imports nothing, so it is unit-tested with no database: each form's
 * pool-bound resolver (`resolveApproverCanMessageByEmail`,
 * `resolveBookingApproverCanMessageByEmail`,
 * `resolveReimburseAccessCanMessageByEmail`,
 * `resolveAdvClrCanMessageByEmail`) reaches `@/lib/acc/pool` /
 * `@/lib/adv/pool`, which drags `@/env` in and throws at import in the test
 * runner.
 */
export function decideMessageTabAccess(isAdmin: boolean, canMessage: boolean): boolean {
  return isAdmin || !!canMessage;
}
