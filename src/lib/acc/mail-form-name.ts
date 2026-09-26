/**
 * `ชื่อไทย (English)` for a mail header — the admin-editable `AccFormMaster`
 * pair, formatted the way the user asked (2026-09-26: "ส่งเมล ปรับ header mail
 * ส่งชื่อ form thai (eng) ด้วย"), falling back to the hardcoded `MAIL_FORM_NAMES`
 * label from `mail-copy.ts` when that pair could not be read.
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
 * `ชื่อไทย (English)`, or the hardcoded `MAIL_FORM_NAMES` label — falling back
 * to the bare code when even that does not know it — for three cases that all
 * count as "the canonical name is unavailable": `canonical` itself is
 * `null`/`undefined` (the read failed, or the table has no row for this code);
 * one of the two names is blank (the pair is `NOT NULL` in the database, so
 * this is a defensive case rather than one that happens in practice — but a
 * lone name with no partner reads as `ชื่อไทย ()`, which is worse than the
 * fallback); or the caller asks about a code neither table has ever heard of.
 */
export function mailFormName(
  code: string,
  canonical: CanonicalFormName | null | undefined,
): string {
  const th = canonical?.nameTh?.trim() ?? "";
  const en = canonical?.nameEn?.trim() ?? "";
  if (th && en) return `${th} (${en})`;
  return MAIL_FORM_NAMES[code as MailFormCode] ?? code;
}
