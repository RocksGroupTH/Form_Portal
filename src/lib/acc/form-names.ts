/**
 * **A short Thai name per Accounting form code — the fallback for a form the
 * viewer has no rows for.**
 *
 * The canonical name is `AccFormMaster.FormNameTh`, and every row already
 * carries it (`ReportRow.formName`), so this is not the usual source and must
 * not become one. It answers one case the rows cannot: **My Requests' and My
 * Work's form filter lists every form the viewer COULD file, not only the ones
 * they have filed** — so a form with nothing on screen had no name to show and
 * the dropdown printed a bare `AP-2` / `AP-3` beside four named entries.
 *
 * Measured 2026-09-24: `AccFormMaster` holds a Thai name for all seven codes in
 * both form databases, so nothing is missing at the source — the label simply
 * never reached a client that had no row to read it off.
 *
 * ## Why not the cards
 *
 * `REQUEST_CARDS` carries a label, but **several cards share one badge** — a
 * fill card and a management card — so a map built from it takes whichever was
 * declared last, which is arbitrary: AP-1 resolves to "เบิกค่าเดินทาง
 * (ออฟฟิต)", its Settings entry, rather than to the form. These names mirror
 * `ACCOUNTING_FORMS` in `HomeCatalogue.tsx`, which is one entry per code and is
 * the vocabulary Home already teaches people.
 *
 * ## Why not an endpoint
 *
 * It would be a new route, a new gate and a fetch on two pages, to answer five
 * short strings that change when a form is created — which is a migration, not
 * a runtime event. `/api/form-environment`, which both pages already fetch,
 * carries availability and no names.
 */
export const ACC_FORM_NAME_TH: Readonly<Record<string, string>> = {
  "AP-1": "เบิกค่าเดินทาง",
  "AP-2": "เบิกเงินทดรองจ่าย",
  "AP-3": "เคลียร์คืนเงินทดรองจ่าย",
  "AP-4": "ขอเบิกเงินคืนพนักงาน",
  "AP-17": "จองที่พัก/ตั๋วโดยสาร",
};

/**
 * `AP-2 · เบิกเงินทดรองจ่าย`, or the bare code when nothing names it.
 *
 * `preferred` is the row's own `FormNameTh` where the caller has one: the
 * canonical name wins, and this map only fills the gap. A code with neither —
 * AP-11 and AP-15 are registered in `AccFormMaster` and have no card — still
 * renders, as itself, rather than disappearing from a filter that would then
 * silently exclude its rows.
 */
export function formFilterLabel(code: string, preferred?: string | null): string {
  const name = preferred?.trim() || ACC_FORM_NAME_TH[code] || "";
  return name ? `${code} · ${name}` : code;
}
