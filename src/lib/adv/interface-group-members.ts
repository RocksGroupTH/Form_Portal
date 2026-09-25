/**
 * Which members of an AP-2 Interface ERP group a save actually writes.
 *
 * The group dialog lists every brand mapped to a Company, **including ones
 * switched off** — deliberately, so "a group whose brands are switched off
 * explains a queue that looks empty" (see `AdvanceErpInterfaceSettings`). The
 * save then looped that same list and demanded a Bank Account for every entry,
 * so one disabled brand blocked the whole group. Reported by the user
 * 2026-09-25: *"ทำไมต้องเลือกครบทุกแบรนด์เบิกถึงจะบันทึกได้ เพราะบางแบรนด์ถูก
 * ปิดใช้งานอยู่"*.
 *
 * A brand that is switched off cannot be claimed against at all, so it needs no
 * posting account and must not hold the group hostage. But it is not simply
 * dropped either: **a disabled brand that already carries a Bank Account is
 * still written**, so the group's shared Journal Batch stays in step with it and
 * an edit made to it in the dialog is not silently discarded. Re-enabling such a
 * brand then finds its configuration current rather than stale.
 *
 * So the rule is: **active, or already configured.** Only a brand that is both
 * switched off and blank is skipped — and for that one there is nothing to
 * write, since the route refuses a blank Bank Account anyway.
 *
 * Pure and parameterised on `bankOf` because the dialog holds unsaved edits in a
 * draft: the value that decides this is the one on screen, not the one that was
 * loaded.
 */
export function membersToWrite<T extends { active: boolean }>(
  members: readonly T[],
  bankOf: (member: T) => string,
): T[] {
  return members.filter((m) => m.active || bankOf(m).trim() !== "");
}
