/**
 * Pages counted off the raw bytes, without a PDF library's help.
 *
 * Deliberately crude: every page object in a classic cross-reference PDF
 * announces itself as `/Type /Page` (not `/Pages`, the tree node). A file whose
 * page tree lives in a compressed object stream hides them, and that answers 0
 * — which is why the caller takes the MAXIMUM of this and what the loader said,
 * never this alone. It exists to catch the loader claiming fewer pages than are
 * plainly there, not to be a parser.
 */
export function countPdfPageObjects(buffer: Buffer): number {
  const text = buffer.toString("latin1");
  const matches = text.match(/\/Type\s*\/Page[^s]/g);
  return matches ? matches.length : 0;
}
