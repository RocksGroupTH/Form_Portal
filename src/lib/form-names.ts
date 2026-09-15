/**
 * Each Accounting form's English name, in one place.
 *
 * The Thai name is what every screen leads with and is not changing; this is
 * the second line under it (user, 2026-09-15: "form แต่ละอันอยากให้ใส่ชื่อ
 * ภาษาอังกฤษ เข้าไปด้วย"). Two of the five already carried one, smuggled into
 * the description field — AP-2's read "Advance · เงินทดรองจ่าย" and AP-3's
 * "Clear Advance · เคลียร์เงินทดรอง" — so the other three simply had none, and
 * the two that did could not be searched or styled as a name.
 *
 * **One table rather than a string on each card**, because the cards are not
 * one list: `ACCOUNTING_FORMS` (Home) and `REQUEST_CARDS` (the Request hub) are
 * two hand-kept arrays, and CLAUDE.md already records that a form added to one
 * alone appears on only one surface. A name typed into both would drift the
 * first time one was corrected.
 *
 * **The names are the repository's own**, taken from CLAUDE.md's own section
 * headings rather than invented here, so the form called "Staff Reimbursement"
 * in the guide is called that on the card a requester opens. Imports nothing,
 * so any surface can read it.
 */
export const FORM_NAMES_EN: Record<string, string> = {
  "AP-1": "Travel Expense Reimbursement",
  "AP-2": "Advance",
  "AP-3": "Clear Advance",
  "AP-4": "Staff Reimbursement",
  "AP-17": "Travel Booking",
};

/** The English name, or "" for a code this table does not know. */
export function formNameEn(code: string | null | undefined): string {
  return FORM_NAMES_EN[String(code ?? "").trim().toUpperCase()] ?? "";
}
