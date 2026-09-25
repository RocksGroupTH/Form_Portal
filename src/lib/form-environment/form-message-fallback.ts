/**
 * What each form shows when the database cannot answer, and the rule that
 * decides when that applies.
 *
 * Separate from `form-message.ts` because that module opens a pool, which
 * drags `@/env` in — and `npm test` runs with no env file, so a test importing
 * it never reaches its first assertion. This is the half worth testing.
 *
 * The three notice constants it imports have no runtime imports of their own,
 * which is what makes this module safe to load in a test.
 */
import { expandFormMessage } from "./form-message-text";
import type { FormOwnerRef } from "./form-owner-text";
import { AP1_HEADER_MESSAGE_LINES } from "@/features/accounting/constants";
import { AP17_HEADER_MESSAGE_LINES } from "@/features/travel-booking/constants";
import { REIMBURSE_NOTICE } from "@/features/reimburse/constants";

/**
 * What each form printed before this table existed.
 *
 * Used ONLY when the table itself is missing or a form has no row — never when
 * a row exists with an empty body, which means "this form shows no notice" and
 * is a decision an admin took. AP-2 and AP-3 have no entry because they have
 * no notice to fall back to.
 */
export const FORM_MESSAGE_FALLBACK: Readonly<Record<string, readonly string[]>> = Object.freeze({
  "AP-1": AP1_HEADER_MESSAGE_LINES,
  "AP-17": AP17_HEADER_MESSAGE_LINES,
  "AP-4": REIMBURSE_NOTICE,
});

/**
 * The bullets a reader sees, given what the table answered.
 *
 * Three cases, and the middle one is the one worth stating: a **missing table**
 * or a **missing row** falls back to the constant, while a **row with an empty
 * body** is `[]` — an admin who clears the message means it.
 */
export function resolveFormMessageBlocks(
  formCode: string,
  stored: Readonly<Record<string, string>> | null,
  owners: readonly FormOwnerRef[] | null | undefined,
): string[] {
  if (stored === null || !(formCode in stored)) {
    return expandFormMessage(
      Array.from(FORM_MESSAGE_FALLBACK[formCode] ?? []).join("\n\n"),
      owners,
    );
  }
  return expandFormMessage(stored[formCode], owners);
}
