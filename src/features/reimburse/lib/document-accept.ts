/**
 * Is this something AP-4 will even try to read?
 *
 * **Not a control.** `checkAttachment` on the upload route sniffs magic bytes
 * and is what actually decides; a name and a browser-supplied MIME type are
 * both trivially wrong. This exists for one narrow job: keeping an obviously
 * unusable file out of the pending list when somebody drags a folder's worth
 * onto the drop zone, so they find out now rather than at the next save.
 *
 * The file picker gets the same answer for free through its `accept`
 * attribute. Drag-and-drop does not — `accept` filters the dialog and nothing
 * else — which is the reason this is written down rather than left implicit.
 *
 * Pure and unit-tested: the alternative to a test here is finding out from a
 * requester that their ordinary `.xlsx` was silently dropped.
 */

/** The extensions this form takes, matching the picker's `accept` list. */
const ACCEPTED_EXT = /\.(png|jpe?g|gif|webp|heic|heif|bmp|pdf|xlsx|xlsm|xls)$/i;

function typeIsAccepted(contentType: string): boolean {
  const t = contentType.toLowerCase();
  if (t.startsWith("image/")) return true;
  if (t === "application/pdf") return true;
  // Covers both the OOXML long form and the legacy `application/vnd.ms-excel`.
  return t.includes("spreadsheet") || t.includes("excel");
}

/**
 * `fileName` is consulted **second**, and it has to be: a drag from some file
 * managers, and a re-upload of something SharePoint served, arrive with an
 * empty type or `application/octet-stream`. Refusing on type alone would turn
 * an ordinary receipt away.
 */
export function isAcceptedDocument(fileName: string, contentType: string): boolean {
  if (typeIsAccepted(contentType)) return true;
  return ACCEPTED_EXT.test(fileName);
}
