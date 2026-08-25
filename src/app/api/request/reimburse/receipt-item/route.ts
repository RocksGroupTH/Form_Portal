import { NextRequest, NextResponse } from "next/server";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { requireAuth } from "@/lib/api-auth";
import { guardVisionRequest, visionImageBlock } from "@/lib/acc/vision-guard";
import { statusForVisionError } from "@/lib/acc/vision-error";
import { MAX_RECEIPT_AMOUNT } from "@/features/accounting/lib/receipt-amount";
import { todayYmd } from "@/features/accounting/lib/thai-calendar";
import {
  MAX_DESCRIPTION_LENGTH,
  sanitizeReceiptFields,
} from "@/features/reimburse/lib/receipt-fields";

/**
 * POST /api/request/reimburse/receipt-item — read one receipt so an AP-4
 * expense row can be prefilled.
 *
 * AP-1's `receipt-amount` reads a single figure; this reads the whole row,
 * because an AP-4 line carries a date, a description and three money columns
 * and typing all five off a phone photo is the work being removed.
 *
 * Auth, the rate limit and every upload guard live in `guardVisionRequest`,
 * shared with AP-1's receipt read and AP-17's ID-card check — one copy,
 * because each step there is either a cost control or an upload guard and two
 * copies would drift. The `purpose` string keys its own rate-limit bucket:
 * sharing AP-1's would let a requester spend their allowance reading travel
 * receipts and then be unable to read a reimbursement one.
 *
 * Nothing is stored here — the bytes are read, sent and dropped. The image is
 * uploaded to SharePoint separately, by the save, exactly as a hand-attached
 * receipt is.
 *
 * `ROUTE_RULES` needs no entry: the `/api/request/reimburse` prefix already
 * classifies as `AP-4`, and this route reads no database at all.
 */

const AnswerSchema = z.object({
  expenseDate: z
    .string()
    .nullable()
    .describe("The date printed on the receipt as YYYY-MM-DD in the Gregorian calendar, or null."),
  description: z
    .string()
    .nullable()
    .describe("A short Thai description of what was bought and from whom, or null."),
  amount: z
    .number()
    .nullable()
    .describe("The grand total in Thai baht that the payer actually paid, or null."),
  vat: z.number().nullable().describe("The VAT line in baht if one is printed, or null."),
  withholdingTax: z
    .number()
    .nullable()
    .describe("The withholding tax line in baht if one is printed, or null."),
  documentNo: z
    .string()
    .nullable()
    .describe("The receipt or tax-invoice number printed on the document, or null."),
  branchName: z
    .string()
    .nullable()
    .describe("The vendor branch the receipt names, or null."),
});

const PROMPT = [
  "รูปนี้คือใบเสร็จรับเงิน ใบกำกับภาษี หรือสลิป",
  "ให้อ่านข้อมูลสำหรับกรอกรายการค่าใช้จ่าย 1 บรรทัด",
  "",
  "กติกา:",
  "- expenseDate: วันที่บนใบเสร็จ ตอบเป็น YYYY-MM-DD แบบ ค.ศ. เท่านั้น",
  "  ถ้าใบเสร็จพิมพ์เป็น พ.ศ. ให้ลบ 543 ก่อนตอบ",
  "- description: ซื้ออะไร จากร้านไหน สั้น ๆ เป็นภาษาไทย",
  `  ไม่เกิน ${MAX_DESCRIPTION_LENGTH} ตัวอักษร`,
  "- amount: ยอดรวมสุทธิที่ผู้จ่ายต้องจ่ายจริง ถ้ามีทั้งยอดก่อนและหลังส่วนลด ให้เอายอดสุทธิ",
  "- vat: บรรทัดภาษีมูลค่าเพิ่ม ถ้าไม่ได้พิมพ์แยกไว้ ให้ตอบ null อย่าคำนวณเอง",
  "- withholdingTax: บรรทัดหัก ณ ที่จ่าย ถ้าไม่ได้พิมพ์ไว้ ให้ตอบ null อย่าคำนวณเอง",
  "- documentNo: เลขที่ใบเสร็จ/ใบกำกับภาษี ตามที่พิมพ์ไว้",
  "  ห้ามตอบเลขประจำตัวผู้เสียภาษี (13 หลัก) เป็นเลขที่เอกสาร",
  "- branchName: สาขาของร้าน/ผู้ขาย ถ้าใบเสร็จระบุไว้ ถ้าไม่ระบุ ให้ตอบ null",
  "",
  "ห้ามเด็ดขาด:",
  "- ห้ามตอบเลขประจำตัวผู้เสียภาษี เลขที่ใบเสร็จ เบอร์โทร หรือจำนวนชิ้น เป็นตัวเลขเงิน",
  `- ยอดเงินที่สมเหตุสมผลต้องมากกว่า 0 และไม่เกิน ${MAX_RECEIPT_AMOUNT} บาท`,
  "- ช่องไหนอ่านไม่ออกหรือไม่แน่ใจ ให้ตอบ null เฉพาะช่องนั้น อย่าเดา",
].join("\n");

export async function POST(req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const guard = await guardVisionRequest(req, {
    userId: session.user.id,
    purpose: "reimburse-item",
    unavailableError: "ยังไม่ได้เปิดใช้งานการอ่านข้อมูลจากใบเสร็จ",
  });
  if (!guard.ok) return guard.response;

  try {
    const response = await guard.client.messages.parse({
      model: "claude-sonnet-5",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [visionImageBlock(guard.bytes, guard.mediaType), { type: "text", text: PROMPT }],
        },
      ],
      output_config: { format: zodOutputFormat(AnswerSchema) },
    });

    // The last gate. A model can misread, and `sanitizeReceiptFields` nulls
    // each field on its own rather than discarding the whole answer over one
    // bad number. The server's clock decides "future", not the browser's — it
    // is the clock the row is stored against.
    const parsed = response.parsed_output;
    const data = sanitizeReceiptFields(
      {
        expenseDate: parsed?.expenseDate ?? null,
        description: parsed?.description ?? null,
        amount: parsed?.amount ?? null,
        vat: parsed?.vat ?? null,
        withholdingTax: parsed?.withholdingTax ?? null,
        documentNo: parsed?.documentNo ?? null,
        branchName: parsed?.branchName ?? null,
      },
      todayYmd(),
    );
    return NextResponse.json({ ok: true, data });
  } catch (err: unknown) {
    // Logged, not surfaced: the client leaves the row editable either way, and
    // an upstream message is no use to the person filling the form.
    console.error(
      "[api/request/reimburse/receipt-item] POST",
      err instanceof Error ? err.message : err,
    );
    return NextResponse.json(
      { ok: false, error: "อ่านข้อมูลจากใบเสร็จไม่สำเร็จ" },
      { status: statusForVisionError(err) },
    );
  }
}
