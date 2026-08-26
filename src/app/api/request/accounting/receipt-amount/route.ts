import { NextRequest, NextResponse } from "next/server";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { requireAuth } from "@/lib/api-auth";
import { guardVisionRequest, visionImageBlock } from "@/lib/acc/vision-guard";
import { statusForVisionError } from "@/lib/acc/vision-error";
import { sanitizeReceiptAmount, MAX_RECEIPT_AMOUNT } from "@/features/accounting/lib/receipt-amount";
import { pdfPagesToPng } from "@/lib/pdf-to-image";
import { MAX_PDF_PAGES, sheetToText } from "@/lib/acc/sheet-text";

/**
 * POST /api/request/accounting/receipt-amount — read the total off a receipt
 * so AP-1 can prefill จำนวนเงิน.
 *
 * Takes **any document the Messages API can be shown**, not only a photo: a
 * PDF invoice is rasterised to at most `MAX_PDF_PAGES` pages, a workbook is
 * flattened to tab-separated text, and an image goes as itself. AP-1's
 * attachment slot has taken any file since 2026-08-26, and a slot that accepts
 * a PDF while the read beside it refuses one is worse than either rule alone.
 *
 * The question asked is still AP-1's, and it differs from AP-4's: **one grand
 * total for one row**, never a row per line. That is why this route is not
 * simply AP-4's with a different schema — only the file-to-content half is
 * shared, through `sheet-text.ts` and `pdf-to-image.ts`.
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
  "เอกสารนี้คือใบเสร็จรับเงิน สลิป ใบกำกับภาษี หรือใบแจ้งหนี้",
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
    allowedKinds: ["image", "pdf", "spreadsheet"],
  });
  if (!guard.ok) return guard.response;

  try {
    // Built per kind and then asked the same question, so a new input kind
    // cannot arrive with its own idea of what an answer is.
    let content: Array<Record<string, unknown>>;
    if (guard.kind === "image") {
      content = [visionImageBlock(guard.bytes, guard.mediaType), { type: "text", text: PROMPT }];
    } else if (guard.kind === "pdf") {
      const pages = await pdfPagesToPng(guard.bytes, MAX_PDF_PAGES);
      content = [
        ...pages.map((page) => visionImageBlock(page, "image/png")),
        { type: "text", text: PROMPT },
      ];
    } else {
      const sheet = await sheetToText(guard.bytes);
      // An empty workbook is "nothing legible", not a failure: the field opens
      // blank and the requester types the figure, which is where a null answer
      // leaves them anyway. Returning an error instead would put a red note on
      // a perfectly good attachment.
      if (!sheet) return NextResponse.json({ ok: true, data: { amount: null } });
      content = [{ type: "text", text: `${PROMPT}

${sheet}` }];
    }

    const response = await guard.client.messages.parse({
      model: "claude-sonnet-5",
      max_tokens: 1024,
      messages: [{ role: "user", content: content as never }],
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
