/**
 * `ชื่อไทย (English)` for a mail header — the admin-editable `AccFormMaster`
 * pair, formatted the way the user asked (2026-09-26: "ส่งเมล ปรับ header mail
 * ส่งชื่อ form thai (eng) ด้วย"), falling back to the hardcoded `MAIL_FORM_NAMES`
 * label from `mail-copy.ts` when that pair could not be read.
 *
 * **The English name is appended only when the Thai one does not already
 * carry one** (the user, seeing the first cut's nested brackets: "ต่ออังกฤษ
 * เฉพาะตอนที่ยังไม่มี"). Three of the five seeded forms already write their
 * English name into `FormNameTh` itself, in parentheses — AP-2's is
 * `แบบฟอร์มขอเบิกเงินทดรองจ่าย (Advance)`, AP-3's and AP-4's the same shape —
 * so appending unconditionally produced `(Advance) (Advance Request Form)`,
 * naming the same form twice in two different English words. AP-1 and AP-17
 * have no English segment in their Thai name today, so both still gain the
 * `(English)` suffix and both still end up with nested brackets of their own
 * (AP-1's Thai already ends `(ออฟฟิต)`, AP-17's English already ends `(for
 * working out of town)`) — shown to the user and kept on their own word,
 * fixable by editing either name at Settings → Form Environment.
 *
 * Pure and import-free except for `mail-copy.ts` itself, which is also
 * import-free — so this stays testable with no database, the same
 * policy/pool split `request-acl-policy.ts` + `request-acl.ts` already use.
 * The pool-reaching half is `mail-form-name-lookup.ts`, beside this file.
 */
import { MAIL_FORM_NAMES, type MailFormCode } from "@/lib/acc/mail-copy";

/** The two admin-editable columns, exactly as `AccFormMaster` stores them. */
export interface CanonicalFormName {
  nameTh: string;
  nameEn: string;
}

/**
 * True when `s` already carries an English word — the test used to decide
 * whether the Thai name needs `nameEn` appended at all.
 *
 * **Deliberately "does this contain any ASCII letter", not "does this contain
 * the English name as a substring".** A substring test looked like the more
 * precise rule and is the one that fails on the real data: AP-2's Thai reads
 * `…(Advance)` while its own `nameEn` is the *different* string
 * `Advance Request Form` — the Thai carries a short label, the English
 * column carries a fuller sentence, and Thai does not, and was never
 * expected to, quote it verbatim. A substring test finds no match there and
 * still appends, reproducing the exact bug this rule exists to fix. Any
 * Latin letter at all is a good enough signal that the Thai name has already
 * named the form in English once; digits and punctuation are not, so
 * `ฟอร์ม 2024` (a Thai name with a year in it, no English word) still gets
 * `nameEn` appended.
 */
function hasAsciiLetter(s: string): boolean {
  return /[A-Za-z]/.test(s);
}

/**
 * `ชื่อไทย (English)`, or just `ชื่อไทย` when it already carries an English
 * segment, or the hardcoded `MAIL_FORM_NAMES` label — falling back to the
 * bare code when even that does not know it — for the cases that count as
 * "the canonical name is unavailable": `canonical` itself is `null`/`undefined`
 * (the read failed, or the table has no row for this code); the Thai name is
 * blank (`FormNameTh` is `NOT NULL` in the database, so this is a defensive
 * case rather than one that happens in practice); the Thai name is present
 * but carries no English segment and `nameEn` is *also* blank, leaving
 * nothing to append and no name of its own to trust; or the caller asks about
 * a code neither table has ever heard of.
 */
export function mailFormName(
  code: string,
  canonical: CanonicalFormName | null | undefined,
): string {
  const th = canonical?.nameTh?.trim() ?? "";
  const en = canonical?.nameEn?.trim() ?? "";
  if (!th) return MAIL_FORM_NAMES[code as MailFormCode] ?? code;
  if (hasAsciiLetter(th)) return th;
  if (en) return `${th} (${en})`;
  return MAIL_FORM_NAMES[code as MailFormCode] ?? code;
}
