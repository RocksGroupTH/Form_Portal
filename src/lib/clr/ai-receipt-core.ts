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

/**
 * How Thai paperwork writes a date. Spelled out because the model was reading
 * "6 ม.ค. 69" as 2026-04-06 — day and month swapped — and a slip's date becomes
 * the journal's Posting Date for a Refund (§3.2), so a swap posts months into the
 * wrong period. Shared by the receipt and the slip prompt: same documents.
 */
export const THAI_DATE_RULES = [
  "Thai dates are written DAY month YEAR, never month/day: 6 ม.ค. 69 is the 6th of January,",
  "not the 1st of June. 23/12/2568 is the 23rd of December.",
  "The month is usually a Thai abbreviation: ม.ค.=01 ก.พ.=02 มี.ค.=03 เม.ย.=04 พ.ค.=05",
  "มิ.ย.=06 ก.ค.=07 ส.ค.=08 ก.ย.=09 ต.ค.=10 พ.ย.=11 ธ.ค.=12.",
  "The year is Buddhist (พ.ศ.) — subtract 543 to get the Christian year. A two-digit year is",
  "the tail of the Buddhist year: 69 → 2569 → 2026. A four-digit year is Buddhist too:",
  "2568 → 2025. Only a year already below 2400 is Christian and stays as it is.",
  'Always answer with "YYYY-MM-DD" in the Christian era (ค.ศ.).',
].join("\n");

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
  '- date: the document date. For a "slip" this is the transfer date.',
  "- description: if the document lists one line item, use its description. If it lists",
  "  several, read the AMOUNT printed on each line, find the single highest one, and copy",
  "  THAT line as it is printed — its own wording in its own language, including any",
  "  reference or tracking code on it. Never answer with the wording that appears on the",
  "  most lines: on a shipping receipt of thirty lines at 19.00 and one line at 165.00,",
  "  the 165.00 line is the answer and the repeated 19.00 wording is the wrong one.",
  "- docNo: that document's own document / tax-invoice number; for a slip, its reference no.",
  "- amountBeforeVat, vat, wht: numbers in THB (no commas). If the document lists several",
  "  line items, amountBeforeVat and vat must reflect the TOTAL of that WHOLE document (the",
  "  grand total across all its lines) — NOT just the amount of the largest line item chosen",
  '  above for description. wht = ภาษีหัก ณ ที่จ่าย amount. For a "slip", amountBeforeVat is',
  "  the transferred amount and vat and wht are null.",
  "- taxId: payee 13-digit tax id, digits only.",
  "- payeeName, payeeAddress: the seller/payee name and address (original language).",
  "Reading a date:",
  THAI_DATE_RULES,
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

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

/**
 * A date the model read, or null. Nothing here can catch a swapped day and month
 * — 2026-04-06 is a perfectly good date — but a date that cannot exist, or that
 * has not happened yet, is certainly a misread. An empty field the user fills in
 * is cheap; a wrong Posting Date on a Refund journal (§3.2) is not.
 */
export function toDate(v: unknown, now: Date = new Date()): string | null {
  const m = toStr(v)?.match(ISO_DATE);
  if (!m) return null;
  let year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  // The prompt asks for the Christian era, but a Buddhist year is unmistakable
  // and is the conversion the model was asked to make — finish it rather than
  // throw the date away as "600 years in the future".
  if (year >= 2400) year -= 543;
  const d = new Date(Date.UTC(year, month - 1, day));
  // Round-trip: Date rolls 2026-02-30 forward into March instead of refusing it.
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return null;
  }
  // No one clears an advance against paperwork dated a year out.
  if (d.getTime() > now.getTime() + 366 * DAY_MS) return null;
  return `${String(year).padStart(4, "0")}-${m[2]}-${m[3]}`;
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
    date: toDate(entry.date),
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
