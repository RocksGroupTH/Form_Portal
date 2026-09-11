/**
 * AP-4's seller check: is the tax id usable, and does the name on the receipt
 * agree with what the Revenue Department holds for it?
 *
 * The RD's VAT-registrant lookup itself is AP-3's (`lookupVatRegistrant`,
 * `rd-vat-core.ts`) and is reused unchanged — it takes a tax id and knows
 * nothing about forms. What is here is the two decisions AP-4 makes with the
 * answer, both pure and both easy to get subtly wrong.
 *
 * **Comparing Thai company names is the hard half, and exact equality is the
 * wrong tool.** The same company reaches this screen written three ways: the RD
 * holds a title and a name in separate fields, the receipt prints them together
 * with whatever spacing the printer felt like, and the AI read reproduces that
 * spacing faithfully. Add the trading name in brackets that shops routinely put
 * after the registered one and no two of the three are ever string-equal.
 *
 * So the comparison normalises away everything that is not the identity —
 * whitespace, bracketed qualifiers, case — and then asks whether either side
 * contains the other. Containment rather than equality because the receipt's
 * version is usually the longer one, carrying a branch or a trading name the
 * register does not.
 *
 * **A mismatch is never an error.** It means "these two disagree, look at it" —
 * the screen offers the registered name and the requester decides. A receipt
 * can legitimately print a trading name the register has never heard of.
 */

/** A Thai tax id is exactly this many digits. */
export const TAX_ID_LENGTH = 13;

export const TAX_ID_LENGTH_ERROR = `เลขผู้เสียภาษีต้องเป็นตัวเลข ${TAX_ID_LENGTH} หลัก`;

/** Only the fields the comparison reads — the real registrant carries more. */
export interface RegistrantName {
  titleName: string | null;
  name: string | null;
}

export type VendorNameVerdict = "match" | "mismatch";

/** Digits only. Receipts print the number grouped, and the grouping is not part of it. */
export function taxIdDigits(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\D/g, "");
}

/**
 * What is wrong with this tax id, or null.
 *
 * **Empty is not wrong.** The red border is for a number that cannot be right,
 * not for one that has not been typed yet — a field that turns red the moment it
 * is focused teaches people to ignore red. The required-field check at submit is
 * what speaks to an empty one.
 */
export function taxIdProblem(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? "").trim();
  if (trimmed === "") return null;
  return taxIdDigits(trimmed).length === TAX_ID_LENGTH ? null : TAX_ID_LENGTH_ERROR;
}

/**
 * Everything that is not the company's identity.
 *
 * Bracketed qualifiers go first and whole: a trading name in brackets is the
 * commonest reason two spellings of one company differ, and removing the
 * brackets alone would leave their contents to be compared.
 */
function normalizeName(raw: string): string {
  return raw
    .replace(/[（(][^）)]*[）)]/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

/** The registered name as one line — the value the "use this" button offers. */
export function registrantDisplayName(r: RegistrantName): string {
  const name = (r.name ?? "").trim();
  // No name means nothing to offer. The title alone ("บริษัท") is not a name,
  // and a button offering it would put it in the field.
  if (name === "") return "";
  const title = (r.titleName ?? "").trim();
  return title === "" ? name : `${title} ${name}`;
}

/**
 * Does `typed` name the same company the register does?
 *
 * Compared against the title-and-name together AND the name alone, because
 * plenty of receipts print one without the other and neither omission makes it a
 * different company.
 */
export function compareVendorName(typed: string | null | undefined, r: RegistrantName): VendorNameVerdict {
  const a = normalizeName(typed ?? "");
  // Nothing claimed agrees with nothing: a blank must not read as "match", or
  // the prompt hides on exactly the rows that most need it.
  if (a === "") return "mismatch";

  const full = normalizeName(registrantDisplayName(r));
  const bare = normalizeName(r.name ?? "");
  // An empty register side can never match — otherwise `includes("")` is true
  // of every string and every row would read as agreeing.
  const candidates = [full, bare].filter((c) => c !== "");
  if (candidates.length === 0) return "mismatch";

  return candidates.some((c) => c.includes(a) || a.includes(c)) ? "match" : "mismatch";
}
