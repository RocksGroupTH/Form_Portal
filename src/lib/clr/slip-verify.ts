import { readImageText } from "@/lib/ocr";

/** Candidate baht amounts found in OCR text (e.g. "1,234.56", "500.00"). Largest first. */
export function extractAmounts(text: string): number[] {
  const out = new Set<number>();
  // Grouped-thousands with optional decimals, OR a plain decimal amount.
  const re = /(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+\.\d{2})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const n = Number(m[1].replace(/,/g, ""));
    if (Number.isFinite(n) && n > 0) out.add(Math.round(n * 100) / 100);
  }
  return Array.from(out).sort((a, b) => b - a);
}

const THAI_MONTHS: Record<string, number> = {
  "มกราคม": 1, "ม.ค.": 1, "กุมภาพันธ์": 2, "ก.พ.": 2, "มีนาคม": 3, "มี.ค.": 3,
  "เมษายน": 4, "เม.ย.": 4, "พฤษภาคม": 5, "พ.ค.": 5, "มิถุนายน": 6, "มิ.ย.": 6,
  "กรกฎาคม": 7, "ก.ค.": 7, "สิงหาคม": 8, "ส.ค.": 8, "กันยายน": 9, "ก.ย.": 9,
  "ตุลาคม": 10, "ต.ค.": 10, "พฤศจิกายน": 11, "พ.ย.": 11, "ธันวาคม": 12, "ธ.ค.": 12,
};
const ENG_MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** Buddhist/2-digit year → Gregorian 4-digit. */
function toCe(y: number): number {
  if (y < 100) y = 2500 + y;      // 2-digit slips are Buddhist (68 → 2568)
  return y > 2400 ? y - 543 : y;  // Buddhist Era → Gregorian
}
function fmtDate(y: number, mo: number, d: number): string | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const ce = toCe(y);
  if (ce < 2000 || ce > 2100) return null;
  return `${ce}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Levenshtein edit distance (for OCR-tolerant month matching). */
function editDist(a: string, b: string): number {
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

/**
 * Nearest month key within 1 edit (unique winner) — recovers OCR slips such as
 * ก.ย.→"กุย" (spurious vowel) or a dropped/extra glyph, without the collisions a
 * blanket vowel-strip would cause (มี.ค.↔ม.ค., เม.ย.↔มิ.ย.).
 */
function fuzzyMonth(key: string, dict: Map<string, number>): number | undefined {
  if (key.length < 2) return undefined;
  let best = 99, second = 99, bestMo: number | undefined;
  dict.forEach((v, k) => {
    const d = editDist(key, k);
    if (d < best) { second = best; best = d; bestMo = v; }
    else if (d < second) { second = d; }
  });
  return best <= 1 && best < second ? bestMo : undefined;
}

/**
 * First plausible transfer date in OCR text → YYYY-MM-DD. Handles numeric
 * dd/mm/yyyy, ISO yyyy-mm-dd, Thai month names (ส.ค./สิงหาคม), and English
 * month abbreviations (Aug) — with Buddhist-year conversion.
 */
export function extractDate(text: string): string | null {
  // ISO yyyy-mm-dd (check first to avoid mis-parsing as dd/mm)
  const iso = text.match(/(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})/);
  if (iso) { const r = fmtDate(+iso[1], +iso[2], +iso[3]); if (r) return r; }

  // numeric dd/mm/yyyy | dd-mm-yyyy | dd.mm.yyyy
  const reNum = /(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/g;
  let m: RegExpExecArray | null;
  while ((m = reNum.exec(text)) !== null) {
    const r = fmtDate(+m[3], +m[2], +m[1]); if (r) return r;
  }

  // dd <Thai month> yyyy — OCR-tolerant: capture the Thai token, strip spaces/dots,
  // then match a normalized month dictionary (so "ส.ค.", "ส.ค", "สค", "ส ค" all work).
  const normThai = new Map<string, number>();
  for (const [name, mo] of Object.entries(THAI_MONTHS)) {
    normThai.set(name.replace(/[\s.]/g, ""), mo);
  }
  // Keep day, month and year on the SAME line ([ \t] not \s) — otherwise a stray
  // number on a preceding line (e.g. a doc-no ending in digits) can grab the day
  // that belongs to the real date on the next line.
  const reThai = /(\d{1,2})[ \t]*([ก-๏][ก-๏. \t]{0,9})[ \t.]*(\d{2,4})/g;
  let mt: RegExpExecArray | null;
  while ((mt = reThai.exec(text)) !== null) {
    const key = mt[2].replace(/[\s.]/g, "");
    // Exact first; else fuzzy (≤1 edit, unique) to survive OCR slips like ก.ย.→กุย.
    const mo = normThai.get(key) ?? fuzzyMonth(key, normThai);
    if (mo) { const r = fmtDate(+mt[3], mo, +mt[1]); if (r) return r; }
  }

  // dd <Eng month> yyyy
  const e = text.match(/(\d{1,2})\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*(\d{2,4})/i);
  if (e) { const r = fmtDate(+e[3], ENG_MONTHS[e[2].toLowerCase()], +e[1]); if (r) return r; }

  return null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Largest amount on the first line that matches a label (e.g. a "VAT" row). */
function labeledAmount(text: string, label: RegExp): number | null {
  for (const line of text.split(/\r?\n/)) {
    if (label.test(line)) {
      const nums = extractAmounts(line);
      if (nums.length) return nums[0];
    }
  }
  return null;
}

/** Document number off a เลขที่/No./Invoice label (OCR-tolerant, best-effort). */
function extractDocNo(text: string): string | null {
  // เลขที่? — OCR often drops the ่ tone mark ("เลขที่" → "เลขที").
  // Capture allows . _ # ( ) besides - / AND one internal space group, so numbers
  // like "INV.2024/0781-A", "IV68.09.00123" or "Quo 26-08-0548" aren't cut short.
  const m = text.match(
    /(?:เลขที่?(?:ใบกำกับ(?:ภาษี)?|เอกสาร)?|quotation\s*no|tax\s*invoice(?:\s*no)?\.?|invoice(?:\s*no)?\.?|no\.?|เลขที่?)\s*[:#]?\s*([A-Za-z0-9][A-Za-z0-9._#/()\-]{1,29}(?:\s[A-Za-z0-9][A-Za-z0-9._#/()\-]{1,29})?)/i,
  );
  if (!m) return null;
  return m[1].replace(/[.\-/#(\s]+$/, "").trim() || null;
}

/**
 * Thai OCR frequently inserts a space between every glyph ("ร า ย ก า ร"), which
 * breaks label/word matching. Join whitespace that sits between two Thai
 * characters (digits/Latin boundaries are left intact so dates/amounts survive).
 */
function normalizeThaiSpacing(text: string): string {
  const once = (s: string) => s.replace(/([฀-๿])[ \t]+(?=[฀-๿])/g, "$1");
  return once(once(text));
}

/** Tidy a candidate description: collapse spaces, drop a trailing amount, cap length. */
function cleanDesc(s: string): string | null {
  let v = s.replace(/\s{2,}/g, " ").trim();
  v = v.replace(/\s*[\d,]+\.\d{2}\s*$/, "").trim(); // strip a trailing "1,234.56"
  v = v.replace(/^[:：\-–\s]+/, "").trim();
  return v.length >= 2 ? v.slice(0, 200) : null;
}

/**
 * Item / description text (Thai or English). Prefers a รายการ/รายละเอียด/Item/
 * Description-labelled line; else the longest line that carries letters and isn't
 * a header / total / tax / id / address line. Best-effort — the user edits it.
 */
function extractDescription(text: string, amounts: number[]): string | null {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  // 1) Explicit label on the line.
  for (const line of lines) {
    const m = line.match(
      /(?:รายละเอียด|รายการสินค้า|รายการ|สินค้า\/บริการ|สินค้า|description|item|particulars?)\s*[:：]?\s*(.+)/i,
    );
    if (m) {
      const v = cleanDesc(m[1]);
      if (v) return v;
    }
  }

  // 2) The line that carries the top amount is usually the product/item row —
  //    strip its numbers and use the descriptive text.
  const top = amounts[0];
  if (top != null) {
    const topStr = top.toLocaleString("en-US", { minimumFractionDigits: 2 });
    for (const line of lines) {
      if (!line.includes(topStr)) continue;
      const v = cleanDesc(line.replace(/[\d,]+\.\d{2}/g, " ").replace(/\s{2,}/g, " "));
      if (v && /[A-Za-z฀-๿]{3,}/.test(v)) return v.slice(0, 200);
    }
  }

  // 3) Fallback: longest content line that isn't a header / total / id / terms line.
  const skip =
    /(tax\s*invoice|ใบกำกับ|ใบเสร็จ|receipt|invoice|เลขที่|no\.|vat|ภาษี|total|รวม|subtotal|ยอด|จำนวนเงิน|date|วันที่|tel|โทร|address|ที่อยู่|เลขประจำตัว|tax\s*id|remark|signature|ลายเซ็น|เงื่อนไข|ยกเลิก|รับผิดชอบ|หมายเหตุ|บริษัท|จำกัด|^[«•*])/i;
  let best: string | null = null;
  for (const line of lines) {
    if (skip.test(line) || line.length > 90) continue; // long lines = paragraphs/terms
    if (!/[A-Za-z฀-๿]/.test(line)) continue;
    const v = cleanDesc(line);
    if (v && (!best || v.length > best.length)) best = v;
  }
  return best;
}

/** Thai 13-digit tax ID (grouped "1-2345-67890-12-3" or plain), if present. */
function extractTaxId(text: string): string | null {
  for (const c of text.match(/\d[\d\s-]{11,20}\d/g) ?? []) {
    const d = c.replace(/\D/g, "");
    if (d.length === 13) return d;
  }
  return null;
}

/** Payee / vendor name. Prefers the FIRST company-marker line (usually the seller
 *  at the top of the doc), then an explicit payee/vendor label — NOT a bare "Name:"
 *  (which is often the salesperson or the customer). */
function extractPayeeName(text: string): string | null {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  // Double comma etc. from OCR: "CO,, LTD" → co[.,\s]*ltd. Truncate at the legal
  // suffix so trailing OCR junk ("… LTD. Date : 13 Aug") doesn't ride along.
  const company = /(บริษัท|ห้างหุ้นส่วน|co[.,\s]*ltd|company\s*limited|partnership)/i;
  const suffix = /(จำกัด(?:\s*\(มหาชน\))?|ห้างหุ้นส่วนจำกัด|co[.,\s]*ltd\.?|company\s*limited|limited)/i;
  const labelPrefix = /^(?:ในนาม|ผู้ขาย|ผู้รับเงิน|ชื่อผู้เสียภาษี|ชื่อผู้รับ(?:เงิน)?|ชื่อ)\s*[:：]?\s*/;
  for (const line of lines) {
    if (!company.test(line)) continue;
    const s = line.match(suffix);
    const cut = s ? line.slice(0, s.index! + s[0].length) : line;
    const v = cleanDesc(cut.replace(labelPrefix, ""));
    if (v) return v;
  }
  for (const line of lines) {
    const m = line.match(
      /(?:ในนาม|ชื่อผู้เสียภาษี|ชื่อผู้รับ(?:เงิน)?|ผู้รับเงิน|ผู้ขาย|payee|vendor|supplier)\s*[:：]?\s*(.+)/i,
    );
    if (m) { const v = cleanDesc(m[1]); if (v) return v; }
  }
  return null;
}

export interface ReceiptExtractResult {
  /** Transaction date read from the document (YYYY-MM-DD), if any — Thai or English. */
  date: string | null;
  /** Item / expense description read from the document (Thai or English). */
  description: string | null;
  /** Document / tax-invoice number, if found. */
  docNo: string | null;
  /** Withholding-tax amount if a หัก ณ ที่จ่าย / WHT line is present. */
  wht: number | null;
  /** Payee 13-digit tax ID, if present. */
  taxId: string | null;
  /** Payee / vendor name (best-effort). */
  payeeName: string | null;
  /** Payee address — regex can't reliably read this (null); the AI path fills it. */
  payeeAddress: string | null;
  /** Grand total (incl. VAT) — the largest amount read. */
  total: number | null;
  /** VAT amount if detected (labeled or ≈ total×7/107). */
  vat: number | null;
  /** Amount before VAT = total − vat (or total when no VAT detected). */
  beforeVat: number | null;
  /** All amounts read (fallback / display). */
  amounts: number[];
}

/**
 * OCR a receipt / tax invoice (free, local Tesseract) and pull out the fields
 * needed to pre-fill an expense line: date, doc no., amount-before-VAT and VAT.
 * All best-effort — the user reviews and edits every value. Throws only on a real
 * OCR error, which the route turns into a non-blocking skip.
 */
export async function extractReceipt(buffer: Buffer): Promise<ReceiptExtractResult> {
  const raw = await readImageText(buffer);
  // Thai OCR spaces glyphs apart — normalize before any label/word matching.
  const text = normalizeThaiSpacing(raw);
  const amounts = extractAmounts(text); // largest first
  const date = extractDate(text);
  const docNo = extractDocNo(text);
  const description = extractDescription(text, amounts);
  const taxId = extractTaxId(text);
  const payeeName = extractPayeeName(text);
  // WHT amount off a หัก ณ ที่จ่าย / WHT / ภ.ง.ด. line (distinct from VAT).
  // Tolerant of dropped tone marks / joined spacing: หัก ณ … จ(่)าย.
  const wht = labeledAmount(text, /(หัก\s*ณ.{0,4}จ่?าย|withholding|wht|ภ\.?ง\.?ด\.?|ภาษีหัก)/i);
  let total = amounts[0] ?? null;

  let vat: number | null = null;
  let beforeVat: number | null = total;
  if (total != null && total > 0) {
    // Prefer an amount sitting on a VAT-labeled line; else the one closest to 7/107.
    const labeled = labeledAmount(text, /(vat|ภาษีมูลค่าเพิ่ม|ภาษีมูล|ภ\.?พ\.?|ภาษี\s*7)/i);
    const target = round2((total * 7) / 107);
    const byRatio = amounts.find((a) => a !== total && Math.abs(a - target) <= Math.max(0.5, total * 0.01)) ?? null;
    const cand = labeled != null && labeled < total ? labeled : byRatio;
    if (cand != null && cand > 0 && cand < total) {
      // The top amount is VAT-inclusive → split off the VAT.
      vat = cand;
      beforeVat = round2(total - cand);
    } else {
      // No VAT line. If the top amount is a labelled pre-VAT SUBTOTAL (no bigger
      // grand-total present), add 7% VAT (e.g. a quotation "Subtotal 64,450" → VAT
      // 4,511.50, total 68,961.50). Otherwise leave it as-is (vat = 0).
      const subtotal = labeledAmount(text, /(subtotal|มูลค่าสินค้า|มูลค่าบริการ|ยอดก่อน(?:\s*(?:ภาษี|vat))?|ราคาสินค้า)/i);
      if (subtotal != null && Math.abs(subtotal - total) < 0.01) {
        beforeVat = total;
        vat = round2(total * 0.07);
        total = round2(total + vat);
      }
    }
  }
  return { date, description, docNo, wht, taxId, payeeName, payeeAddress: null, total, vat, beforeVat, amounts };
}

export interface SlipExtractResult {
  /** Always true (OCR is always available); kept for the client contract. */
  configured: boolean;
  /** true = the expected refund amount was found in the slip. */
  matched: boolean;
  expected: number;
  /** Best guess for the transferred amount (the expected value if present, else the largest). */
  bestAmount: number | null;
  /** Transfer date read from the slip (YYYY-MM-DD), if any. */
  date: string | null;
  /** All amounts read (for display). */
  amounts: number[];
}

/**
 * OCR a refund-transfer slip (free, local Tesseract) and pull out the amount + date
 * to pre-fill the form, plus a match check against the required refund.
 * Throws only on a real OCR error — the route turns that into a non-blocking skip.
 */
export async function extractSlip(buffer: Buffer, expected: number): Promise<SlipExtractResult> {
  const text = normalizeThaiSpacing(await readImageText(buffer));
  const amounts = extractAmounts(text);
  const date = extractDate(text);
  const matchExact = amounts.find((a) => Math.abs(a - expected) < 0.01) ?? null;
  const matched = matchExact !== null;
  const bestAmount = matchExact ?? amounts[0] ?? null;
  return { configured: true, matched, expected, bestAmount, date, amounts };
}
