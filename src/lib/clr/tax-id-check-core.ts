import { normalizeTaxIdInput, taxIdChecksumOk } from "@/lib/clr/seller-tax-id";

/**
 * The rows whose seller tax id cannot be a tax id, by its own check digit.
 *
 * The same test the cell has shown under the box since the check digit went in,
 * gathered for the account step. A yellow border on one cell among fifteen is
 * not what an approver reads; the row of buttons at the bottom is, so the
 * finding is counted and put there (user, 2026-09-14).
 *
 * It warns and never blocks. A clearing held over a digit is a clearing not
 * paid, and the approver has the number, the receipt and the seller's name in
 * front of them at once — more than this rule has. What it is for is the
 * evidence that they do not currently catch these: four of the eleven sellers
 * in this form's own approved history carry a tax id that fails here, which is
 * how a wrong number reaches a VAT filing with a signature already on it.
 *
 * Only a complete number is judged. An empty box belongs to the requester's
 * form, which decides when a tax id is required at all; a half-typed one has
 * its own notice under the cell and is somebody mid-keystroke, not a mistake.
 */
export function linesWithBadTaxId(
  items: readonly { taxId?: string | null }[],
): number[] {
  const rows: number[] = [];
  items.forEach((it, i) => {
    const d = normalizeTaxIdInput(it.taxId ?? "");
    if (d.length === 13 && !taxIdChecksumOk(d)) rows.push(i + 1);
  });
  return rows;
}
