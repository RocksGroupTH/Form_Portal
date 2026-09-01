import type { ReceiptExtractResult } from "./slip-verify";

/**
 * Pure prompt text + response parsing for AI receipt reading — no IO, no
 * server-only guard, so it can be unit-tested (see ai-receipt.test.ts).
 *
 * ai-receipt.ts (server-only) wraps this with the real Claude vision call.
 */

/** What a page actually is. The user does not tell us which upload box holds a
 *  slip and which holds a receipt — the model classifies each page on what it
 *  shows, and this is what routes the row (decision: 2026-09-01). */
export type ReceiptKind = "receipt" | "slip";

/** The model also labels pages that are neither. Those never become a row — see
 *  ReceiptRead.skippedPages. */
type RawKind = ReceiptKind | "other";

const KINDS: readonly RawKind[] = ["receipt", "slip", "other"];

/** One document read off an upload. A single file routinely holds several. */
export interface ReceiptDoc extends ReceiptExtractResult {
  kind: ReceiptKind;
}

/** Everything one upload yielded. */
export interface ReceiptRead {
  docs: ReceiptDoc[];
  /**
   * Pages that were neither a receipt nor a slip. Only the count survives: the
   * reviewer must know pages were dropped, but on an internal form the model
   * invents descriptions that appear nowhere in the document, so a list of junk
   * rows is worse than no rows at all (decision: 2026-09-01).
   */
  skippedPages: number;
}

export const RECEIPT_SYSTEM = [
  "You read Thai/English accounting paperwork and return ONE JSON array only.",
  "No prose, no markdown fences. Use null when a value is not present — never guess.",
  "You may be given several images. They are the consecutive PAGES of ONE upload, in order.",
  "One uploaded file normally MIXES several kinds of page — a cover voucher, an internal",
  "clearing form, a bank transfer slip and one or more receipts, in any order. That is the",
  "normal case, not an exception. Judge every page by what it actually shows, never by where",
  "it sits in the file.",
  "Classify each document you find with a \"kind\":",
  '- "receipt": a receipt, tax invoice, ใบเสร็จรับเงิน or ใบกำกับภาษี from a seller.',
  '- "slip": a bank transfer / payment slip (PromptPay, mobile banking, โอนเงินสำเร็จ).',
  '- "other": ANY page that is neither of those — payment vouchers, internal clearing or',
  "  approval forms, handwritten summaries, blank or unreadable scans.",
  'Only "receipt" and "slip" are read. For an "other" entry return ONLY the keys "kind" and',
  '"pages" — no description, no numbers, no names. Never describe or total a page you',
  'labelled "other": it is counted, not read.',
  "Return one array entry per distinct document across all the pages.",
  "A single document printed over several pages is ONE entry — take its totals from the page",
  "that carries the grand total, not from each page.",
  "Never merge two invoice numbers into one entry, and never split one invoice into two.",
  "Rules for EACH entry:",
  "- pages: how many pages of this upload the document covers (1 unless it runs over several).",
  '- date: the document date as "YYYY-MM-DD". Convert Buddhist year (พ.ศ.) to CE (−543).',
  '  For a "slip" this is the transfer date.',
  "- description: if that document lists several line items, use the description of the",
  "  single line item with the LARGEST amount (keep original language). If there is only",
  "  one item, use that item's description.",
  "- docNo: that document's own document / tax-invoice number; for a slip, its reference no.",
  "- amountBeforeVat, vat, wht: numbers in THB (no commas). If the document lists several",
  "  line items, amountBeforeVat and vat must reflect the TOTAL of that WHOLE document (the",
  "  grand total across all its lines) — NOT just the amount of the largest line item chosen",
  '  above for description. wht = ภาษีหัก ณ ที่จ่าย amount. For a "slip", amountBeforeVat is',
  "  the transferred amount and vat and wht are null.",
  "- taxId: payee 13-digit tax id, digits only.",
  "- payeeName, payeeAddress: the seller/payee name and address (original language).",
].join("\n");

export const RECEIPT_USER_TEXT =
  "Extract every document in these pages. Return only a JSON array; each entry has the keys: " +
  "kind, pages, date, description, docNo, amountBeforeVat, vat, wht, taxId, payeeName, payeeAddress " +
  '(an "other" entry has kind and pages only).';

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
  kind?: string | null;
  pages?: number | string | null;
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

function toKind(v: unknown): RawKind {
  const k = typeof v === "string" ? v.trim().toLowerCase() : "";
  // An unlabelled entry is treated as a receipt: that is what the expense table
  // is for, and the reviewer can re-label it in the confirm modal either way.
  return (KINDS as readonly string[]).includes(k) ? (k as RawKind) : "receipt";
}

/** Pages one entry covers. Capped so a bad number cannot inflate the skip count
 *  past what a single upload can hold (MAX_PDF_PAGES in the verify route). */
function toPages(v: unknown): number {
  const n = toNum(v);
  return n != null && n >= 1 ? Math.min(Math.round(n), 50) : 1;
}

function toDoc(entry: AiJson, kind: ReceiptKind): ReceiptDoc {
  const beforeVat = toNum(entry.amountBeforeVat);
  const vat = toNum(entry.vat);
  return {
    kind,
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
export function parseReceiptDocs(raw: string): ReceiptRead {
  const json = extractJson(raw);
  const list: unknown[] = Array.isArray(json)
    ? json
    : json && typeof json === "object"
      ? Array.isArray((json as { documents?: unknown }).documents)
        ? ((json as { documents: unknown[] }).documents)
        : [json]
      : [];

  let skippedPages = 0;
  const docs: ReceiptDoc[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as AiJson;
    const kind = toKind(e.kind);
    if (kind === "other") {
      skippedPages += toPages(e.pages);
      continue;
    }
    const doc = toDoc(e, kind);
    // An entry with nothing identifying on it is noise, not a document.
    if (doc.date || doc.docNo || doc.description || doc.beforeVat != null || doc.payeeName) {
      docs.push(doc);
    }
  }

  // One row per invoice number: a document read off four consecutive pages must
  // not come back four times if the model answers per page after all.
  const seen = new Set<string>();
  return {
    docs: docs.filter((d) => {
      if (!d.docNo) return true;
      const key = `${d.kind}|${d.docNo}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
    skippedPages,
  };
}
