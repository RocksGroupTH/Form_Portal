import type { ReceiptExtractResult } from "./slip-verify";

/**
 * Pure prompt text + response parsing for AI receipt reading — no IO, no
 * server-only guard, so it can be unit-tested (see ai-receipt.test.ts).
 *
 * ai-receipt.ts (server-only) wraps this with the real Claude vision call.
 */

/** One document read off an uploaded image. A single photo can hold several. */
export type ReceiptDoc = ReceiptExtractResult;

export const RECEIPT_SYSTEM = [
  "You read Thai/English receipts & tax invoices and return ONE JSON array only.",
  "No prose, no markdown fences. Use null when a value is not present — never guess.",
  "An image can hold SEVERAL documents. Return one array entry per document / tax-invoice",
  "number you can see. An image with a single invoice returns an array of one entry.",
  "Never merge two invoice numbers into one entry, and never split one invoice into two.",
  "Rules for EACH entry:",
  '- date: that document\'s date as "YYYY-MM-DD". Convert Buddhist year (พ.ศ.) to CE (−543).',
  "- description: if that document lists several line items, use the description of the",
  "  single line item with the LARGEST amount (keep original language). If there is only",
  "  one item, use that item's description.",
  "- docNo: that document's own document / tax-invoice number.",
  "- amountBeforeVat, vat, wht: numbers in THB (no commas). If the document lists several",
  "  line items, amountBeforeVat and vat must reflect the TOTAL of that WHOLE document (the",
  "  grand total across all its lines) — NOT just the amount of the largest line item chosen",
  "  above for description. wht = ภาษีหัก ณ ที่จ่าย amount.",
  "- taxId: payee 13-digit tax id, digits only.",
  "- payeeName, payeeAddress: the seller/payee name and address (original language).",
].join("\n");

export const RECEIPT_USER_TEXT =
  "Extract every document in this image. Return only a JSON array; each entry has the keys: " +
  "date, description, docNo, amountBeforeVat, vat, wht, taxId, payeeName, payeeAddress.";

/** An account the line's branch is allowed to charge (§6 decides the set). */
export interface GlCandidate {
  glAccountNo: string;
  nameTh: string | null;
  nameEn: string | null;
}

export const GL_SUGGEST_SYSTEM = [
  "You map a Thai/English expense description to ONE expense G/L account.",
  "You are given the complete list of accounts this expense line is allowed to charge.",
  "Answer with the account number alone — no prose, no punctuation, no explanation.",
  "The number MUST be copied from that list. If none of them fits, answer with nothing at all.",
].join("\n");

export function buildGlSuggestUserText(description: string, candidates: GlCandidate[]): string {
  const list = candidates
    .map((c) => `${c.glAccountNo} = ${c.nameTh ?? c.nameEn ?? ""}`)
    .join("\n");
  return `Expense description:\n${description}\n\nAllowed accounts:\n${list}\n\nAnswer with one account number from the list, or nothing.`;
}

/**
 * The account number the model chose, but only if it is one of the candidates.
 * Anything else — an invented number, a refusal, an explanation — becomes "" so
 * the user is never offered an account they could not have picked by hand.
 */
export function pickSuggestedGl(raw: string, allowed: readonly string[]): string {
  const set = new Set(allowed);
  for (const token of raw.match(/[A-Za-z0-9._-]+/g) ?? []) {
    if (set.has(token)) return token;
  }
  return "";
}

type AiJson = {
  date?: string | null;
  description?: string | null;
  docNo?: string | null;
  amountBeforeVat?: number | string | null;
  vat?: number | string | null;
  wht?: number | string | null;
  taxId?: string | null;
  payeeName?: string | null;
  payeeAddress?: string | null;
};

export function toNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

export function toStr(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s.slice(0, 300) : null;
}

/** First JSON value in a model reply — array preferred, single object accepted. */
function extractJson(raw: string): unknown {
  const text = raw.replace(/```[a-z]*\n?/gi, "");
  const shapes = [text.match(/\[[\s\S]*\]/), text.match(/\{[\s\S]*\}/)];
  for (const m of shapes) {
    if (!m) continue;
    try {
      return JSON.parse(m[0]);
    } catch {
      // Try the other shape before giving up — a reply can contain both.
    }
  }
  return null;
}

function toDoc(entry: AiJson): ReceiptDoc {
  const beforeVat = toNum(entry.amountBeforeVat);
  const vat = toNum(entry.vat);
  return {
    date: toStr(entry.date),
    description: toStr(entry.description),
    docNo: toStr(entry.docNo),
    wht: toNum(entry.wht),
    taxId: entry.taxId ? String(entry.taxId).replace(/\D/g, "").slice(0, 13) || null : null,
    payeeName: toStr(entry.payeeName),
    payeeAddress: toStr(entry.payeeAddress),
    total: beforeVat != null ? Math.round((beforeVat + (vat ?? 0)) * 100) / 100 : null,
    vat,
    beforeVat,
    amounts: [beforeVat, vat].filter((n): n is number => n != null),
  };
}

/**
 * Validate a model reply into one row per invoice number. Anything unparseable
 * yields no rows, so the caller falls back rather than showing invented values.
 */
export function parseReceiptDocs(raw: string): ReceiptDoc[] {
  const json = extractJson(raw);
  const list: unknown[] = Array.isArray(json)
    ? json
    : json && typeof json === "object"
      ? Array.isArray((json as { documents?: unknown }).documents)
        ? ((json as { documents: unknown[] }).documents)
        : [json]
      : [];
  return list
    .filter((e): e is AiJson => !!e && typeof e === "object")
    .map(toDoc)
    // An entry with nothing identifying on it is noise, not a receipt.
    .filter((d) => d.date || d.docNo || d.description || d.beforeVat != null || d.payeeName);
}
