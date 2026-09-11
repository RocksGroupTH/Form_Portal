import type { ReceiptExtractResult } from "./slip-verify";
import { resolveSellerTaxId } from "@/lib/clr/seller-tax-id";

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
  /**
   * The date as the model copied it off the page, before any conversion.
   *
   * Shown beside the date in the confirm modal, because the failure that
   * survives every rule on our side is the model misreading the characters
   * themselves: a UAT slip printed "08 ก.ย. 2026" was copied back as
   * "08 ก.ค. 2026" — ย read as ค, September become July. No parser can catch
   * that; a reviewer glancing at what the AI thinks it saw can, without opening
   * the attachment. Absent on the non-AI (Tesseract) path.
   */
  dateText?: string | null;
  /**
   * The seller's branch exactly as printed — "สำนักงานใหญ่", "สาขาที่ 00001".
   * `taxBranchCode()` turns it into the five-digit code BC keeps; the raw
   * wording is carried so a reviewer can see what was read.
   */
  taxBranchText?: string | null;
  /**
   * How many model entries were folded into this row. Absent on a document that
   * arrived as one entry; set when a multi-page document was answered per page,
   * so the confirm modal can tell the reviewer the row is a merge of several.
   */
  mergedEntries?: number;
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
  /**
   * The model's reply ran out of room before it finished the array. Complete
   * entries before the cut are real; everything after is simply gone, and a
   * short read must not be presented as a whole one.
   */
  replyTruncated?: boolean;
  /**
   * Wording from anywhere in the upload that names which store the spend was
   * FOR — "ค่าอุปกรณ์ Dec'25 สำหรับCentral Khonkaen2". Document-level, not per
   * row: a bundle covers one trip or one delivery run, and the reviewer sets any
   * line that differs.
   *
   * Gathered from every page including the ones classified "other" — the payment
   * voucher that names the destination is exactly such a page, so the hint has to
   * outlive the row that page never becomes. It fills one field; it is not a
   * line item, so "other" still yields no row (decision: 2026-09-02).
   */
  branchHint: string | null;
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
  'Only "receipt" and "slip" are read. For an "other" entry return ONLY the keys "kind",',
  '"pages" and "branchHint" — no description, no numbers, no names. Never describe or total',
  'a page you labelled "other": it is counted, not read.',
  "Return one array entry per distinct document across all the pages.",
  "A single document printed over several pages is ONE entry — take its totals from the page",
  "that carries the grand total, not from each page.",
  "Never merge two invoice numbers into one entry, and never split one invoice into two.",
  "Rules for EACH entry:",
  "- pages: how many pages of this upload the document covers (1 unless it runs over several).",
  '- date: the document date. For a "slip" this is the transfer date.',
  "- dateText: that same date copied from the page character for character, exactly as it is",
  "  printed — \"08 ก.ย. 2026\", \"23/12/2568\". Do not reformat it, translate it or convert the",
  "  year. This is read by rule on our side, so a faithful copy is worth more than a tidy one.",
  "- description: what the money was spent on, short enough to ride on a journal line.",
  "  ONE line item on the document → copy its wording exactly as printed, in its own",
  "  language and script, including any reference or tracking code on it.",
  "  SEVERAL line items → do NOT copy any one of them, not even the largest. Say in a",
  "  few Thai words what the whole document was for, grouped from what its lines",
  "  actually name: \"ค่าอุปกรณ์สำนักงาน\", \"ค่าวัสดุตกแต่งร้าน\", \"ค่าอาหารและเครื่องดื่ม\",",
  "  \"ค่าอะไหล่และงานซ่อม\". One purchase of thirty shipping lines is a delivery charge,",
  "  not thirty descriptions and not the most expensive of them.",
  "  Group only from the goods named on the page. A category the lines do not support is",
  "  worse than a plain one — \"ค่าใช้จ่ายเบ็ดเตล็ด\" is a fair answer when the lines have",
  "  nothing in common, and an invented one is not.",
  "  Keep it under about 40 characters. It is appended to a journal line description",
  "  capped at 100, after the advance number and the requester's name, so a long answer",
  "  is not a fuller answer — it is the only part that gets cut.",
  "- docNo: the TAX INVOICE number — the one labelled เลขที่ใบกำกับ, เลขที่ใบกำกับภาษี",
  "  or \"Tax Invoice No.\". It is what the Revenue Department files this document under,",
  "  and it is usually short and prefixed, like \"IV26080177\".",
  "  Many invoices also print a separate system reference — เลขที่เอกสาร, \"Document No.\",",
  "  \"Ref\" — a long code such as \"260818NRSH6Y8Q\". That is NOT this field. When the",
  "  page shows both, answer the tax invoice number every time.",
  "  For a slip, its reference no.",
  "- amountBeforeVat, vat, wht: numbers in THB (no commas). If the document lists several",
  "  line items, amountBeforeVat and vat must reflect the TOTAL of that WHOLE document (the",
  "  grand total across all its lines) — never the amount of any one line, whose wording is",
  '  not what description answers either. wht = ภาษีหัก ณ ที่จ่าย amount. For a "slip",',
  "  amountBeforeVat is",
  "  the transferred amount and vat and wht are null.",
  "- sellerBlock, buyerBlock: COPY THESE FIRST, before answering anything else about",
  "  the document. A Thai tax invoice is laid out the same way every time, and every",
  "  field below comes out of one of these two blocks:",
  "      sellerBlock = every line printed ABOVE the title \"ใบกำกับภาษี\" /",
  "                    \"Tax Invoice\" — the letterhead. This is the SELLER.",
  "      buyerBlock  = every line under the heading \"ลูกค้า\" / \"Customer\" /",
  "                    \"Bill To\". This is the BUYER, the company paying.",
  "  Copy each verbatim, line by line, exactly as printed. Do not summarise, and do",
  "  not decide yet which line is a name or a number — just transcribe.",
  "  Position and the heading are the signal, never size: the letterhead is often",
  "  the smaller and plainer of the two, set in small type across the top, while the",
  "  customer's block is large and left-aligned with its own heading.",
  "  If the page has no customer block, buyerBlock is null.",
  "- payeeName, payeeAddress: the SELLER — the business that issued this invoice",
  "  and is being paid. Its name and address, in the original language.",
  "  Take BOTH out of sellerBlock, and only out of sellerBlock. Everything the",
  "  seller answers — name, address, tax id, branch — comes from those lines you",
  "  just copied. A value that is not in sellerBlock is null here; never borrow it",
  "  from buyerBlock.",
  "  payeeName is the COMPANY NAME ONLY, and payeeAddress the STREET ADDRESS only.",
  "  A Thai letterhead prints the branch against the name, in brackets or on its own",
  "  line, and it is neither of those two fields. Split it off:",
  "      printed: บริษัท ทดสอบ จำกัด (สำนักงานใหญ่)",
  "      payeeName      = บริษัท ทดสอบ จำกัด",
  "      taxBranchText  = สำนักงานใหญ่",
  "      printed: บริษัท ทดสอบ จำกัด (สาขาที่ 00012 บางนา)",
  "      payeeName      = บริษัท ทดสอบ จำกัด",
  "      taxBranchText  = สาขาที่ 00012 บางนา",
  "  Never leave the bracket inside payeeName and never put a branch in",
  "  payeeAddress — both lose it, and the branch is filed with the Revenue",
  "  Department.",
  "  Copy the branch you actually see. The customer block usually says",
  "  \"สำนักงานใหญ่\"; answering that for a seller whose letterhead says a numbered",
  "  branch is the one mistake here that cannot be spotted later.",
  "- taxId: the 13-digit tax id inside sellerBlock — the same lines you took",
  "  payeeName from. Digits only.",
  "  A tax invoice prints two of these and they are easy to swap. The other one sits",
  "  in the customer block and belongs to the company PAYING, not the one being paid.",
  "  Never answer with that number.",
  "  Check yourself before answering: the number you give here must be printed in the",
  "  same block as the name you gave in payeeName. Two blocks, one answer each.",
  "  If you cannot tell which of the two belongs to the seller, answer null: a wrong tax",
  "  id here is filed with the Revenue Department against the wrong company.",
  "- buyerTaxId: the OTHER one — the 13-digit tax id inside buyerBlock, the company",
  "  being billed. Digits only.",
  "  A Thai tax invoice normally carries TWO 13-digit tax ids: the seller's in the",
  "  letterhead and the customer's in the block addressed to them. Look for both before",
  "  answering either, including on a page that is rotated or lightly scanned — they are",
  "  often set in small type. Fill both fields whenever both are on the page; we check",
  "  them against each other, so an extra number costs nothing and a missing one loses",
  "  the check.",
  "  If you find only one and cannot tell whose it is, put it in buyerTaxId and leave",
  "  taxId null. Naming it as the seller's when it is not is the one answer that does",
  "  damage.",
  "  Two numbers on the page and only one in your answer means you read one block",
  "  twice. A filled taxId next to a null buyerTaxId, on a page that plainly carries",
  "  both, is the shape that mistake takes — go back and find the second one before",
  "  you answer either.",
  "- taxBranchText: the branch of that same seller, copied exactly as printed —",
  "  \"สำนักงานใหญ่\", \"สาขาที่ 00001\", \"Head Office\". It sits with the seller's name,",
  "  address and tax id, usually in the letterhead — very often in brackets straight",
  "  after the company name, like \"บริษัท ก จำกัด (สำนักงานใหญ่)\", and just as often on",
  "  a line of its own labelled \"สาขา\" or \"Branch\". Both forms are this field. This is",
  "  the branch that ISSUED the invoice.",
  "  The customer block carries one too, in the same shape, and that one is the buyer's.",
  "  Take the one attached to the name you answered in payeeName. If the page shows only",
  "  one \"สาขา\" line and it sits with the seller, it is the seller's — answer it.",
  "  Answer null only when the page prints no branch at all, or when two are printed and",
  "  you cannot tell which is the seller's: a wrong branch here goes onto a tax filing.",
  "- branchHint: EVERY entry may carry this, including an \"other\" one. Copy any wording on",
  "  the page that says which shop, store, site or outlet the spending was FOR — a purpose",
  '  line such as "ค่าอุปกรณ์ Dec\'25 สำหรับ Central Khonkaen2", a project or destination',
  "  name, a delivery address that is one of the company's own shops. Copy it verbatim in",
  "  its own language and script; do not translate or expand it. null when the page names",
  "  no such place.",
  '  NEVER take branchHint from a "สาขา" / "Branch" field printed on a tax invoice or',
  "  receipt. That field is a Revenue Department registration — whose, depends on which",
  "  party it is printed beside — and never the shop the money was spent for. It is not",
  "  ignored: it is taxBranchText's field, and only branchHint must keep out of it.",
  "Reading a date:",
  THAI_DATE_RULES,
].join("\n");

export const RECEIPT_USER_TEXT =
  "Extract every document in these pages. Return only a JSON array; each entry has the keys: " +
  "sellerBlock, buyerBlock, kind, pages, date, description, docNo, amountBeforeVat, vat, wht, " +
  "taxId, buyerTaxId, payeeName, payeeAddress, taxBranchText, branchHint " +
  '(an "other" entry has kind, pages and branchHint only).\n\n' +
  /* The operative half of the two-block rule, repeated here and nowhere else in
     the message. It is in the user turn on purpose: the same words in the system
     prompt were read, obeyed to the letter of transcribing, and still produced a
     sellerBlock that was the seller's name glued to the buyer's address and tax
     id, with buyerBlock null. Last thing before generation is what made the
     reader look at the page twice (measured against this invoice, 2026-09-12). */
  "Before you answer anything else about a receipt, transcribe its two party blocks:\n" +
  '- sellerBlock: every line printed ABOVE the title "ใบกำกับภาษี" / "Tax Invoice",\n' +
  "  copied verbatim.\n" +
  '- buyerBlock: every line under the heading "ลูกค้า" / "Customer" / "Bill To",\n' +
  "  copied verbatim.\n" +
  "Then take payeeName, payeeAddress, taxBranchText and taxId ONLY from the text you\n" +
  "put in sellerBlock, and buyerTaxId ONLY from the text you put in buyerBlock. If a\n" +
  "value is not present in that block, it is null — do not borrow it from the other.\n" +
  "Put sellerBlock and buyerBlock in each entry, first.";

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

/** A branch (BU) the request's brand may charge — ErpDimensionValue BRANCH rows. */
export interface BranchCandidate {
  code: string;
  /** "SHORTCODE-ชื่อไทย", e.g. "CKK2-เซนทรัล ขอนแก่น 2". */
  name: string | null;
}

export const BRANCH_SUGGEST_SYSTEM = [
  "You map a short Thai/English note about what an expense was FOR to ONE branch (shop)",
  "from a fixed list. Each list line is: CODE = SHORTCODE-ชื่อไทย.",
  "The note and the list are often in different languages or scripts: an English or",
  'transliterated name in the note ("Central Khonkaen2") is the same place as the Thai name',
  'in the list ("CKK2-เซนทรัล ขอนแก่น 2"). Match on the place, not on the characters.',
  'Return ONE JSON object only, no prose and no markdown fences: {"code": ..., "close": ...}',
  "- code: the branch code, copied EXACTLY from the list. Use \"\" only when the note fits",
  "  none of them at all.",
  "- close: true when other branches on the list were nearly as good a fit as the one you",
  "  chose — several branches in the same town differing only by a suffix or a number",
  "  (Khonkaen vs Khonkaen 2 vs Khonkaen Campus), or a note too vague to separate them.",
  "  false when the note names your branch beyond doubt.",
  "Always give your best branch in code even when close is true — the person reviewing can",
  "change it, and close is what tells them to look. Never put more than one code in code,",
  "and never explain your choice.",
].join("\n");

export function buildBranchSuggestUserText(hint: string, candidates: BranchCandidate[]): string {
  const list = candidates.map((c) => `${c.code} = ${c.name ?? ""}`).join("\n");
  return `What the expense was for:\n${hint}\n\nBranches:\n${list}\n\nAnswer with the JSON object.`;
}

/** What the branch suggester settled on, after the answer was checked back
 *  against the candidate list. */
export interface BranchSuggestion {
  /** "" when the model declined or answered something not on the list. */
  code: string;
  /** The model reported other branches fitted nearly as well — the modal marks
   *  the field so the reviewer's eye lands on it. Only ever the model's own
   *  signal; never inferred here. */
  close: boolean;
}

/**
 * The chosen branch, but only if it is one of the candidates. The code must be
 * the whole `code` value, not a token found somewhere in the reply: a hedged
 * answer names two codes, and scanning prose would turn "either of these" into a
 * confident pick with no marker on it.
 */
export function pickSuggestedBranch(raw: string, allowed: readonly string[]): BranchSuggestion {
  const none: BranchSuggestion = { code: "", close: false };
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return none;
  let json: unknown;
  try {
    json = JSON.parse(m[0]);
  } catch {
    return none;
  }
  if (!json || typeof json !== "object") return none;
  const j = json as { code?: unknown; close?: unknown };
  const answer = (typeof j.code === "string" ? j.code : "").trim().toUpperCase();
  const code = allowed.find((c) => c.trim().toUpperCase() === answer) ?? "";
  // A "close" on a discarded code marks nothing — there is no field to mark.
  return { code, close: code !== "" && j.close === true };
}

type AiJson = {
  kind?: string | null;
  pages?: number | string | null;
  date?: string | null;
  /** The date as printed, unconverted — see `thaiPrintedDate`. */
  dateText?: string | null;
  description?: string | null;
  docNo?: string | null;
  amountBeforeVat?: number | string | null;
  vat?: number | string | null;
  wht?: number | string | null;
  taxId?: string | null;
  buyerTaxId?: string | null;
  payeeName?: string | null;
  taxBranchText?: string | null;
  payeeAddress?: string | null;
  branchHint?: string | null;
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
/** Bangkok is UTC+7 all year. Shifting the clock by it and reading the UTC parts
 *  gives the Thai calendar date whatever timezone the process happens to run in
 *  — the server's own date would be a day out for every evening upload. */
const THAI_OFFSET_MS = 7 * 60 * 60 * 1000;

/** Today in Bangkok, as the UTC midnight the parsed date is compared against. */
function thaiToday(now: Date): number {
  const t = new Date(now.getTime() + THAI_OFFSET_MS);
  return Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate());
}

/**
 * A date the model read, or null. Nothing here can catch a swapped day and month
 * — 2026-04-06 is a perfectly good date — but a date that cannot exist, or that
 * has not happened yet, is certainly a misread. An empty field the user fills in
 * is cheap; a wrong Posting Date on a Refund journal (§3.2) is not.
 *
 * "Not yet" is judged in Thai local time: the user, the document and the posting
 * period are all Bangkok.
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
  // A receipt or a transfer slip documents something that has already happened,
  // so tomorrow is a misread, not a document date. A slip's date becomes the
  // Posting Date of the Refund journal (§3.2): accepting it would post a
  // transfer that has not been made.
  if (d.getTime() > thaiToday(now)) return null;
  return `${String(year).padStart(4, "0")}-${m[2]}-${m[3]}`;
}

/**
 * Thai month names, abbreviated and full, in calendar order. The abbreviations
 * are the whole reason this exists: a UAT slip printed "08 ก.ย. 2026" came back
 * from the model as 2026-02-08 — ก.ย. (September) read as ก.พ. (February) —
 * even though THAI_DATE_RULES spells the entire table out for it. The pairs
 * differ by one character and several of them rhyme, so the mapping belongs in
 * code where it is a lookup, not a recollection.
 */
const THAI_MONTHS: readonly (readonly string[])[] = [
  ["ม.ค.", "มกราคม"],
  ["ก.พ.", "กุมภาพันธ์"],
  ["มี.ค.", "มีนาคม"],
  ["เม.ย.", "เมษายน"],
  ["พ.ค.", "พฤษภาคม"],
  ["มิ.ย.", "มิถุนายน"],
  ["ก.ค.", "กรกฎาคม"],
  ["ส.ค.", "สิงหาคม"],
  ["ก.ย.", "กันยายน"],
  ["ต.ค.", "ตุลาคม"],
  ["พ.ย.", "พฤศจิกายน"],
  ["ธ.ค.", "ธันวาคม"],
];

/** A Buddhist year — two-digit tail or four digits — as its Christian year. */
function christianYear(raw: number): number {
  const year = raw < 100 ? 2500 + raw : raw;
  return year >= 2400 ? year - 543 : year;
}

/** Build "YYYY-MM-DD", or null when those parts are not a real calendar date. */
function ymd(year: number, month: number, day: number): string | null {
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return null;
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * The date as the document itself prints it, read by rule rather than by model.
 *
 * The model is asked for `dateText` — the date copied character for character —
 * alongside its own `date`. When this can read that text, its answer wins:
 * mapping a Thai month to a number is a table lookup, and a slip's date becomes
 * the Posting Date of a Refund journal (§3.2), so a month read wrong is a
 * journal in the wrong period.
 *
 * Thai only, deliberately. An English month is left to the model — there is no
 * confusable pair to protect against there, and half a parser is worse than
 * none.
 *
 * Returns null on anything it cannot read with certainty, which hands the
 * decision back to the model's own answer rather than to a guess.
 */
export function thaiPrintedDate(v: unknown): string | null {
  const text = toStr(v);
  if (!text) return null;

  // "8 ก.ย. 2026", "15 กันยายน 2569" — day, Thai month, year. The month class is
  // the whole Thai block, not ก-ฮ: เม.ย. and เมษายน lead with a vowel (เ), which
  // sits outside the consonant range and would drop April alone.
  const named = text.match(/(\d{1,2})\s*([฀-๿.]+?)\s*(\d{2,4})/);
  if (named) {
    const word = named[2].replace(/\s+/g, "");
    const index = THAI_MONTHS.findIndex(([abbr, full]) => word === abbr || word === full);
    if (index >= 0) {
      return ymd(christianYear(Number(named[3])), index + 1, Number(named[1]));
    }
  }

  // "23/12/2568", "06-01-2026" — day first, always: Thai paperwork does not
  // write month/day, so there is nothing ambiguous to resolve here.
  const numeric = text.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (numeric) {
    const month = Number(numeric[2]);
    if (month >= 1 && month <= 12) {
      return ymd(christianYear(Number(numeric[3])), month, Number(numeric[1]));
    }
  }

  return null;
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
    // The printed text wins where we can read it: mapping a Thai month is a
    // table lookup here and a recollection in the model. Both answers still go
    // through toDate, which rejects an impossible or future date either way.
    date: toDate(thaiPrintedDate(entry.dateText) ?? entry.date),
    dateText: toStr(entry.dateText),
    description: toStr(entry.description),
    docNo: toStr(entry.docNo),
    wht: toNum(entry.wht),
    taxId: resolveSellerTaxId(entry.taxId, entry.buyerTaxId),
    payeeName: toStr(entry.payeeName),
    // Kept verbatim; taxBranchCode() turns it into the five-digit code, the
    // way thaiPrintedDate() handles the printed date.
    taxBranchText: toStr(entry.taxBranchText),
    payeeAddress: toStr(entry.payeeAddress),
    total: beforeVat != null ? Math.round((beforeVat + (vat ?? 0)) * 100) / 100 : null,
    vat,
    beforeVat,
    amounts: [beforeVat, vat].filter((n): n is number => n != null),
  };
}

/**
 * A document number as an identity, not as printed. OCR breaks a long number
 * apart at random — "KEX1001273 07371" for KEX100127307371 — and the same
 * number in two cases is the same document.
 *
 * Deliberately exact after that: a one-character misread (EBYC25120005297 vs
 * EBYC2512Q005297) stays a separate row, because a rule loose enough to join
 * those two would also join two genuinely different invoices, and the reviewer
 * can merge them by hand in the confirm modal (decision: QA, 2026-09-02).
 */
export function normalizeDocNo(docNo: string): string {
  return docNo.replace(/\s+/g, "").toUpperCase();
}

/**
 * What makes two entries the same document. The payee is in the key because two
 * vendors do issue an invoice "001": without it the second one silently vanishes
 * into the first, and a lost expense line is worse than a duplicate row the user
 * deletes. Null for an entry with no number — those never merge.
 */
function docKey(d: ReceiptDoc): string | null {
  if (!d.docNo) return null;
  return `${d.kind}|${normalizeDocNo(d.docNo)}|${(d.payeeName ?? "").replace(/\s+/g, " ").trim().toUpperCase()}`;
}

/**
 * One row per document. A four-page invoice answered per page arrives as four
 * entries carrying 19, 19, 19 and 1031 — only the last page prints the grand
 * total — so the group is merged onto its LARGEST beforeVat rather than its
 * first: a grand total is never smaller than one page's partial. Keeping the
 * first entry was throwing 1031 away and clearing 19 baht.
 */
function mergeDocs(docs: ReceiptDoc[]): ReceiptDoc[] {
  const out: ReceiptDoc[] = [];
  const at = new Map<string, number>();
  for (const doc of docs) {
    const key = docKey(doc);
    const i = key == null ? undefined : at.get(key);
    if (i === undefined) {
      if (key != null) at.set(key, out.length);
      out.push(doc);
      continue;
    }
    const kept = out[i];
    // The winning entry supplies every field — its description, date, docNo and
    // vat belong to the same page as its total.
    const winner = (doc.beforeVat ?? 0) > (kept.beforeVat ?? 0) ? doc : kept;
    out[i] = { ...winner, mergedEntries: (kept.mergedEntries ?? 1) + 1 };
  }
  return out;
}

/**
 * Validate a model reply into one row per document. Anything unparseable
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
  let branchHint: string | null = null;
  const docs: ReceiptDoc[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as AiJson;
    const kind = toKind(e.kind);
    // Read the hint off every entry, "other" included and BEFORE the skip: the
    // page that names the destination is usually the payment voucher, which is
    // exactly the page that produces no row. First one wins — the bundle is one
    // spend, and the voucher that states its purpose leads the file.
    branchHint ??= toStr(e.branchHint);
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

  return { docs: mergeDocs(docs), skippedPages, branchHint };
}
