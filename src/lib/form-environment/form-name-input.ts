/**
 * What a form may be renamed to — the rule, with no database attached.
 *
 * `AccFormMaster.FormNameTh` and `FormNameEn` are both `nvarchar(200) NOT NULL`,
 * and until 2026-09-24 nothing in this application wrote either: the names came
 * with the seed and could only be changed with SQL. The user asked for them to
 * be editable at Settings → Form Environment, which is the page that already
 * lists every form and both of its names.
 *
 * Pure and import-free so the bound can be asserted without a pool — the
 * service beside it reaches two of them, because `AccFormMaster` is dual-written
 * and the two databases must not disagree about what a form is called.
 *
 * **Both names are required.** The column is `NOT NULL`, and a blank English
 * name is not a tidy empty state: it is what `formNameEn` falls back through on
 * the My Requests / My Work filter, which would then read `ชื่อไทย ()`.
 *
 * **Over-long is refused rather than truncated.** SQL Server truncates silently
 * into a `nvarchar(200)` on some paths and raises an untranslated driver error
 * on others; neither is an answer an admin can act on, and a name cut at 200
 * characters is a name nobody chose. Same reasoning `api-keys/codes.ts` records
 * for `Name`.
 */

/** The column bound, both names. */
export const FORM_NAME_MAX = 200;

export interface FormNameInput {
  nameTh?: unknown;
  nameEn?: unknown;
}

export type FormNameParse =
  | { ok: true; nameTh: string; nameEn: string }
  | { ok: false; error: string };

export function parseFormNames({ nameTh, nameEn }: FormNameInput): FormNameParse {
  const th = typeof nameTh === "string" ? nameTh.trim() : "";
  const en = typeof nameEn === "string" ? nameEn.trim() : "";

  if (!th) return { ok: false, error: "กรุณากรอกชื่อฟอร์ม (ไทย)" };
  if (!en) return { ok: false, error: "กรุณากรอกชื่อฟอร์ม (อังกฤษ)" };
  if (th.length > FORM_NAME_MAX) {
    return { ok: false, error: `ชื่อฟอร์ม (ไทย) ยาวเกิน ${FORM_NAME_MAX} ตัวอักษร` };
  }
  if (en.length > FORM_NAME_MAX) {
    return { ok: false, error: `ชื่อฟอร์ม (อังกฤษ) ยาวเกิน ${FORM_NAME_MAX} ตัวอักษร` };
  }
  return { ok: true, nameTh: th, nameEn: en };
}
