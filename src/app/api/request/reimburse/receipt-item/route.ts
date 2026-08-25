import { NextRequest, NextResponse } from "next/server";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { requireAuth } from "@/lib/api-auth";
import { guardVisionRequest, visionImageBlock } from "@/lib/acc/vision-guard";
import { statusForVisionError } from "@/lib/acc/vision-error";
import { pdfPagesToPng } from "@/lib/pdf-to-image";
import { loadXlsx } from "@/lib/xlsx";
import {
  listSuggestedExpenseAccounts,
  type ExpenseAccount,
} from "@/lib/acc/reimburse/expense-account-service";
import { MAX_RECEIPT_AMOUNT } from "@/features/accounting/lib/receipt-amount";
import { todayYmd } from "@/features/accounting/lib/thai-calendar";
import {
  MAX_DESCRIPTION_LENGTH,
  sanitizeReceiptFields,
  type ReceiptFields,
} from "@/features/reimburse/lib/receipt-fields";

/**
 * POST /api/request/reimburse/receipt-item — read one attached document into
 * AP-4 expense rows.
 *
 * AP-1's `receipt-amount` reads a single figure off a photo; this reads whole
 * rows off whatever the requester attached, because AP-4 no longer takes the
 * AP-4.1 workbook as a separate required file and the form has to hold what
 * that workbook held.
 *
 * **Three kinds in, rows out.** The response is always `{ rows: [...] }`:
 *
 * - **image** — one receipt, so zero or one row.
 * - **pdf** — rasterised to at most `MAX_PDF_PAGES` pages and sent as images,
 *   still one document, so zero or one row. A quotation or tax invoice runs to
 *   two pages routinely; a page cap is what stops one careless upload of a long
 *   statement becoming an unbounded, billed-per-image call.
 * - **spreadsheet** — many rows, because the AP-4.1 sheet *is* a table of
 *   lines. Collapsing it to one row would silently discard every line but one,
 *   which is worse than not reading it at all. It is sent as **text**, not as
 *   an image: cheaper, and a parsed cell cannot be misread the way a rendered
 *   one can.
 *
 * Auth, the rate limit and every upload guard live in `guardVisionRequest`,
 * shared with AP-1's receipt read and AP-17's ID-card check. `allowedKinds` is
 * passed **here** rather than widened inside the guard — AP-17 must go on
 * refusing anything that is not an image.
 *
 * Nothing is stored here. The file is uploaded to SharePoint separately, by
 * the save, exactly as a hand-attached document is.
 *
 * `ROUTE_RULES` needs no entry: the `/api/request/reimburse` prefix already
 * classifies as `AP-4`, and this route reads no database at all.
 */

/** Enough for the Thai documents this form sees; the call is billed per image. */
const MAX_PDF_PAGES = 3;

/**
 * How much of a workbook is sent.
 *
 * A sheet is text, so this is a character budget rather than a page count. It
 * is generous for an AP-4.1 summary and small enough that somebody attaching a
 * year-end export does not send a megabyte of cells.
 */
const MAX_SHEET_CHARS = 40_000;

/** No sheet of expense lines has more rows than this; the rest is a different document. */
const MAX_SHEET_ROWS = 100;

/**
 * One document is one row, and the code says so rather than only the prompt.
 *
 * A two-page PDF is sent as two images, and asking a model nicely not to read
 * them as two documents is a request, not a guarantee — the prompt does ask,
 * and this is what makes it true. The failure it prevents is quiet and costly:
 * two identical expense lines from one quotation, each carrying the full
 * amount, on a claim somebody then approves.
 */
const MAX_DOCUMENT_ROWS = 1;

const RowSchema = z.object({
  expenseDate: z
    .string()
    .nullable()
    .describe("The date on the document as YYYY-MM-DD in the Gregorian calendar, or null."),
  documentNo: z
    .string()
    .nullable()
    .describe("The receipt, invoice or quotation number printed on the document, or null."),
  branchName: z.string().nullable().describe("The vendor branch the document names, or null."),
  vendorTaxId: z
    .string()
    .nullable()
    .describe("The SELLER's 13-digit Thai tax id (เลขประจำตัวผู้เสียภาษี), or null."),
  vendorName: z
    .string()
    .nullable()
    .describe("The SELLER's company or personal name, or null."),
  vendorAddress: z.string().nullable().describe("The SELLER's address, or null."),
  accountNo: z
    .string()
    .nullable()
    .describe("The G/L account number chosen from the candidate list, or null if none fits."),
  description: z
    .string()
    .nullable()
    .describe("A short Thai description of what was bought and from whom, or null."),
  amount: z
    .number()
    .nullable()
    .describe("The VAT-inclusive grand total in Thai baht for this line, or null."),
  vat: z.number().nullable().describe("The VAT figure in baht if one is printed, or null."),
  withholdingTax: z
    .number()
    .nullable()
    .describe("The withholding tax figure in baht if one is printed, or null."),
});

const AnswerSchema = z.object({
  rows: z.array(RowSchema).describe("One entry per expense line found. Empty if none is legible."),
});

/**
 * The candidate-account block, appended only when there is history to draw on.
 *
 * **Empty history means the model is not asked about the account at all**, and
 * that is the point of choosing "accounts AP-4 has actually used" over "the
 * whole chart": a suggestion drawn from nothing is a guess, and a guessed G/L
 * account is a misposted expense nobody has a reason to re-check. On day one
 * every requester picks from the full picker; each pick becomes the history the
 * next read learns from.
 */
function accountRules(candidates: ExpenseAccount[]): string {
  if (candidates.length === 0) {
    return ["", "- accountNo: ให้ตอบ null เสมอ (ยังไม่มีรายการบัญชีให้เลือก)"].join("\n");
  }
  return [
    "",
    "- accountNo: เลือกบัญชีที่ตรงที่สุด **จากรายการข้างล่างนี้เท่านั้น**",
    "  ตอบเป็นเลขบัญชีเป๊ะ ๆ ตามที่อยู่ในรายการ ห้ามแต่งเลขขึ้นเอง",
    "  ถ้าไม่มีอันไหนตรงพอ ให้ตอบ null — การเดาบัญชีแย่กว่าการเว้นว่าง",
    "",
    "รายการบัญชีที่เลือกได้:",
    ...candidates.map((a) => `  ${a.accountNo}  ${a.displayName}`),
  ].join("\n");
}

/** Shared rules, so a document and a sheet are read to the same standard. */
const COMMON_RULES = [
  "กติกาของทุกช่อง:",
  "- expenseDate: วันที่บนเอกสาร ตอบเป็น YYYY-MM-DD แบบ ค.ศ. เท่านั้น",
  "  ถ้าเอกสารพิมพ์เป็น พ.ศ. ให้ลบ 543 ก่อนตอบ",
  "- documentNo: เลขที่เอกสารตามที่พิมพ์ไว้",
  "  ห้ามตอบเลขประจำตัวผู้เสียภาษี (13 หลัก) เป็นเลขที่เอกสาร",
  "- branchName: สาขาของผู้ขาย ถ้าไม่ระบุ ให้ตอบ null",
  "",
  "ข้อมูลผู้ขาย — เอาของ 'ผู้ขาย/ผู้ออกเอกสาร' เท่านั้น ห้ามเอาของ 'ลูกค้า/ผู้ซื้อ':",
  "- vendorTaxId: เลขประจำตัวผู้เสียภาษีของผู้ขาย 13 หลัก",
  "  เอกสารมักพิมพ์เลขของทั้งผู้ขายและลูกค้า ให้เอาของฝั่งผู้ขายเท่านั้น",
  "- vendorName: ชื่อบริษัทหรือชื่อ-สกุลของผู้ขาย",
  "- vendorAddress: ที่อยู่ของผู้ขาย",
  "- description: ซื้ออะไร จากร้านไหน สั้น ๆ เป็นภาษาไทย",
  `  ไม่เกิน ${MAX_DESCRIPTION_LENGTH} ตัวอักษร`,
  "- amount: ยอดรวมที่รวมภาษีมูลค่าเพิ่มแล้ว ก่อนหักภาษี ณ ที่จ่าย",
  "  ถ้าเอกสารแยก 'จำนวนเงินทั้งสิ้น' กับ 'จำนวนเงินที่ชำระ' ให้เอา 'จำนวนเงินทั้งสิ้น'",
  "  เพราะ 'จำนวนเงินที่ชำระ' คือยอดหลังหักภาษี ณ ที่จ่ายแล้ว",
  "- vat: บรรทัดภาษีมูลค่าเพิ่ม ถ้าไม่ได้พิมพ์แยกไว้ ให้ตอบ null อย่าคำนวณเอง",
  "- withholdingTax: บรรทัดหัก ณ ที่จ่าย ถ้าไม่ได้พิมพ์ไว้ ให้ตอบ null อย่าคำนวณเอง",
  "",
  "ห้ามเด็ดขาด:",
  "- ห้ามตอบเลขประจำตัวผู้เสียภาษี เลขที่เอกสาร เบอร์โทร หรือจำนวนชิ้น เป็นตัวเลขเงิน",
  `- ยอดเงินที่สมเหตุสมผลต้องมากกว่า 0 และไม่เกิน ${MAX_RECEIPT_AMOUNT} บาท`,
  "- ช่องไหนอ่านไม่ออกหรือไม่แน่ใจ ให้ตอบ null เฉพาะช่องนั้น อย่าเดา",
].join("\n");

function documentPrompt(candidates: ExpenseAccount[]): string {
  return [
    "รูปนี้คือเอกสารค่าใช้จ่าย 1 ฉบับ — ใบเสร็จรับเงิน ใบกำกับภาษี ใบเสนอราคา หรือสลิป",
    "ถ้ามีหลายรูป ทั้งหมดคือเอกสารฉบับเดียวกันคนละหน้า",
    "ให้ตอบ rows เป็น 1 รายการ (หรือ 0 รายการถ้าอ่านไม่ออกเลย)",
    "",
    COMMON_RULES,
    accountRules(candidates),
  ].join("\n");
}

function sheetPrompt(candidates: ExpenseAccount[]): string {
  return [
    "ข้างล่างนี้คือตารางค่าใช้จ่ายที่แปลงมาจากไฟล์ Excel",
    "ให้ตอบ rows 1 รายการต่อ 1 บรรทัดของค่าใช้จ่ายจริง",
    "ข้ามหัวตาราง บรรทัดว่าง และบรรทัดสรุป/ยอดรวมท้ายตาราง",
    "",
    COMMON_RULES,
    accountRules(candidates),
  ].join("\n");
}

/** The workbook's first sheet as tab-separated text, bounded. */
async function sheetToText(bytes: Buffer): Promise<string | null> {
  // `loadXlsx`, not a bare dynamic import: the package is CommonJS and its API
  // lands on `.default` under some loaders while the types advertise the named
  // exports either way, so `XLSX.read(...)` type-checks, builds, and throws.
  const XLSX = await loadXlsx();
  const wb = XLSX.read(bytes, { type: "buffer" });
  const first = wb.SheetNames[0];
  if (!first) return null;
  const text = XLSX.utils.sheet_to_csv(wb.Sheets[first], { FS: "\t", blankrows: false });
  const trimmed = text.trim();
  return trimmed ? trimmed.slice(0, MAX_SHEET_CHARS) : null;
}

export async function POST(req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  // A query parameter, not a multipart field: `guardVisionRequest` consumes the
  // body with its own `req.formData()`, and a request body can only be read
  // once. Absent brand simply means no suggestions — never an error, because
  // reading the document is still worth doing without one.
  const brand = req.nextUrl.searchParams.get("brand")?.trim() ?? "";

  const guard = await guardVisionRequest(req, {
    userId: session.user.id,
    purpose: "reimburse-item",
    unavailableError: "ยังไม่ได้เปิดใช้งานการอ่านข้อมูลจากเอกสาร",
    allowedKinds: ["image", "pdf", "spreadsheet"],
  });
  if (!guard.ok) return guard.response;

  try {
    // Built per kind, then read the same way: one schema, one sanitizer, one
    // response shape, so a new input kind cannot come with its own idea of
    // what a row is.
    // Accounts AP-4 has actually booked to before, narrowed to this brand.
    // Empty on day one and after a brand with no history, which
    // `accountRules` turns into "always answer null" rather than a guess.
    // Never fatal: a failure here costs the suggestion, not the read.
    const candidates = brand
      ? await listSuggestedExpenseAccounts(brand).catch((e) => {
          console.error("[receipt-item] account suggestions unavailable", e);
          return [] as ExpenseAccount[];
        })
      : [];

    let content: Array<Record<string, unknown>>;
    if (guard.kind === "image") {
      content = [
        visionImageBlock(guard.bytes, guard.mediaType),
        { type: "text", text: documentPrompt(candidates) },
      ];
    } else if (guard.kind === "pdf") {
      const pages = await pdfPagesToPng(guard.bytes, MAX_PDF_PAGES);
      content = [
        ...pages.map((p) => visionImageBlock(p, "image/png")),
        { type: "text", text: documentPrompt(candidates) },
      ];
    } else {
      const sheet = await sheetToText(guard.bytes);
      // An empty workbook is "nothing legible", not an error: the requester
      // still gets their row and their file is still kept as evidence.
      if (!sheet) return NextResponse.json({ ok: true, data: { rows: [] } });
      content = [{ type: "text", text: `${sheetPrompt(candidates)}\n\n${sheet}` }];
    }

    const response = await guard.client.messages.parse({
      model: "claude-sonnet-5",
      max_tokens: 8192,
      messages: [{ role: "user", content: content as never }],
      output_config: { format: zodOutputFormat(AnswerSchema) },
    });

    // The last gate. `sanitizeReceiptFields` nulls each field on its own rather
    // than discarding a whole row over one bad number, and the server's clock
    // decides "future" — it is the clock the row is stored against.
    const today = todayYmd();
    const raw = response.parsed_output?.rows ?? [];
    const cap = guard.kind === "spreadsheet" ? MAX_SHEET_ROWS : MAX_DOCUMENT_ROWS;
    // The account is checked against the candidate list rather than trusted.
    // A model asked to pick from a list can still answer with a number that is
    // not on it, and an invented G/L account is a misposted expense — so an
    // unrecognised answer becomes null, exactly as an unreadable total does.
    const offered = new Set(candidates.map((a) => a.accountNo));
    const rows: ReceiptFields[] = raw
      .slice(0, cap)
      .map((r) => ({
        ...sanitizeReceiptFields(
          {
            expenseDate: r.expenseDate ?? null,
            description: r.description ?? null,
            amount: r.amount ?? null,
            vat: r.vat ?? null,
            withholdingTax: r.withholdingTax ?? null,
            documentNo: r.documentNo ?? null,
            branchName: r.branchName ?? null,
            vendorTaxId: r.vendorTaxId ?? null,
            vendorName: r.vendorName ?? null,
            vendorAddress: r.vendorAddress ?? null,
          },
          today,
        ),
        accountNo: r.accountNo && offered.has(r.accountNo.trim()) ? r.accountNo.trim() : null,
      }))
      // A row where nothing survived sanitising is not a row — it would reach
      // the grid as a blank line the requester has to notice and delete.
      .filter((r) => r.expenseDate || r.description || r.amount !== null || r.documentNo);

    return NextResponse.json({ ok: true, data: { rows } });
  } catch (err: unknown) {
    // Logged, not surfaced: the client leaves the row editable either way, and
    // an upstream message is no use to the person filling the form.
    console.error(
      "[api/request/reimburse/receipt-item] POST",
      err instanceof Error ? err.message : err,
    );
    return NextResponse.json(
      { ok: false, error: "อ่านข้อมูลจากเอกสารไม่สำเร็จ" },
      { status: statusForVisionError(err) },
    );
  }
}
