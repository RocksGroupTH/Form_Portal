/**
 * The sentence at the foot of every form telling a requester who to ask.
 *
 * Pure and import-free, so the wording can be asserted without a database —
 * `form-owner.ts` beside it reaches a pool, and this is the half that decides
 * what a reader actually sees.
 *
 * The line existed before the owners did, as the bare "กรณีต้องการยกเลิก
 * ติดต่อเจ้าของฟอร์ม", which told somebody to contact a person the page did not
 * name. The user asked on 2026-09-24 for the names and addresses to be appended
 * to it.
 */

/** The shape `listFormOwners` returns, restated so this module imports nothing. */
export interface FormOwnerRef {
  email: string;
  displayName?: string | null;
}

/** What the line says when nobody has been named — the wording it had before. */
export const FORM_OWNER_FALLBACK = "กรณีต้องการยกเลิกติดต่อเจ้าของฟอร์ม";

/** `Somebody Name (them@rocksgroup.com)`, or the bare address when unnamed. */
export function formatFormOwner(owner: FormOwnerRef): string {
  const name = owner.displayName?.trim();
  const email = owner.email.trim();
  if (!name) return email;
  return `${name} (${email})`;
}

/**
 * The whole line.
 *
 * **Falls back to the bare sentence rather than to an empty one**, which is the
 * case that actually happens: migration 163 seeds nothing, so every form has no
 * owner on the day it lands and stays that way until an admin names one. A line
 * that vanished would take the instruction with it — the requester still needs
 * telling that cancelling late means asking somebody, even while the page
 * cannot say who.
 *
 * An owner row with no usable address is dropped rather than rendered as an
 * empty bracket. It cannot be written through the settings page, which requires
 * a directory pick, but the column is nullable and this line is not the place
 * to find that out.
 */
export function formOwnerNotice(owners: readonly FormOwnerRef[] | null | undefined): string {
  const parts = (owners ?? [])
    .filter((o) => o.email?.trim())
    .map(formatFormOwner);
  if (parts.length === 0) return FORM_OWNER_FALLBACK;
  return `${FORM_OWNER_FALLBACK}: ${parts.join(", ")}`;
}
