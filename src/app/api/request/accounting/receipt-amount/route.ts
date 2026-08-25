import { NextRequest, NextResponse } from "next/server";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { requireAuth } from "@/lib/api-auth";
import { guardVisionRequest, visionImageBlock } from "@/lib/acc/vision-guard";
import { statusForVisionError } from "@/lib/acc/vision-error";
import { sanitizeReceiptAmount, MAX_RECEIPT_AMOUNT } from "@/features/accounting/lib/receipt-amount";

/**
 * POST /api/request/accounting/receipt-amount — read the total off a receipt
 * image so AP-1 can prefill จำนวนเงิน.
 *
 * Auth, the rate limit and every upload guard live in `guardVisionRequest`,
 * shared with AP-17's ID-card check; see that file for why they run in the
 * order they do. Nothing is stored here — the bytes are read, sent and dropped.
 * They do leave the building. The receipt is uploaded to SharePoint separately,
 * by the save, exactly as before.
 *
 * `ROUTE_RULES` needs no entry: the `/api/request/accounting` prefix already
 * classifies as `AP-1`, and this route reads no database at all.
 */

const AnswerSchema = z.object({
  amount: z
    .number()
    .nullable()
    .describe("The grand total in Thai baht, or null if no total is legible."),
});

const PROMPT = [
  "รูปนี้คือใบเสร็จรับเงินหรือสลิป",
  "ให้ตอบเฉพาะ 'ยอดรวมสุทธิ' ที่ผู้จ่ายต้องจ่ายจริง เป็นตัวเลขบาท",
  "",
  "กติกา:",
  "- ถ้ามีทั้งยอดก่อนหักส่วนลดและยอดสุทธิ ให้เอายอดสุทธิ",
  "- ห้ามตอบเป็นเลขประจำตัวผู้เสียภาษี เลขที่ใบเสร็จ เบอร์โทร วันที่ เวลา หรือจำนวนชิ้น",
  "- ถ้าอ่านยอดไม่ออก หรือไม่แน่ใจ ให้ตอบ null — อย่าเดา",
  `- ยอดที่สมเหตุสมผลต้องมากกว่า 0 และไม่เกิน ${MAX_RECEIPT_AMOUNT} บาท`,
].join("\n");

export async function POST(req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const guard = await guardVisionRequest(req, {
    userId: session.user.id,
    purpose: "receipt-amount",
    unavailableError: "ยังไม่ได้เปิดใช้งานการอ่านยอดจากใบเสร็จ",
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

    // `sanitizeReceiptAmount` is the last gate — a model can misread, and the
    // tax id on every Thai receipt is the number most likely to come back.
    const amount = sanitizeReceiptAmount(response.parsed_output?.amount);
    return NextResponse.json({ ok: true, data: { amount } });
  } catch (err: unknown) {
    // Logged, not surfaced: the client shows an empty editable field either way,
    // and an upstream message is no use to the person filling the form.
    console.error(
      "[api/request/accounting/receipt-amount] POST",
      err instanceof Error ? err.message : err,
    );
    return NextResponse.json(
      { ok: false, error: "อ่านยอดจากใบเสร็จไม่สำเร็จ" },
      { status: statusForVisionError(err) },
    );
  }
}
