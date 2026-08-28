import { NextRequest, NextResponse } from "next/server";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { requireAuth } from "@/lib/api-auth";
import { guardVisionRequest, visionImageBlock } from "@/lib/acc/vision-guard";
import { statusForVisionError } from "@/lib/acc/vision-error";
import { sanitizeReceiptAmount, MAX_RECEIPT_AMOUNT } from "@/features/accounting/lib/receipt-amount";
import { admitModelCurrency, isBaht, THB } from "@/lib/acc/currency";
import { admitReadAmount } from "@/lib/acc/vision-amount";
import { resolveRate } from "@/lib/acc/fx";
import { getBrandClaimCurrencies } from "@/lib/brand-registry";
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
 * ── The currency, and why the brand code is a query parameter ──
 *
 * The answer used to be asserted to be Thai baht in both the prompt and the
 * schema, so a foreign receipt yielded a bare number that AP-1 stored and
 * totalled as baht. It now asks which currency the figure is in — but only
 * where there is an answer worth having.
 *
 * **The brand's currencies are resolved here, server-side, through
 * `getBrandClaimCurrencies`.** A currency posted by the caller would let somebody
 * shape their own request into having one accepted that the brand does not
 * offer; `?brandCode=` names a brand, and what that brand may claim in is this
 * side's decision alone. So this route **does** read the database — two of
 * them, through `listBrandRegistry` — which the note here denied until the
 * currency work landed. `getProductionFormPool()`, never `getAccPool()`:
 * `BrandCurrency` has no object in `Rocks_Portal_Form_UAT`.
 *
 * `ROUTE_RULES` needs no entry even so: the `/api/request/accounting` prefix
 * already classifies as `AP-1`, and nothing read here is per-environment —
 * `BrandCurrency` has exactly one copy.
 */

/**
 * The schema for a brand that offers no currency choice — **today's schema,
 * unchanged**, and the one almost every read uses.
 *
 * A brand with nothing configured can only claim in baht: AP-1 renders no
 * currency control for it (`claimCurrencyOptions` is empty), so there is no
 * field that could hold another answer, and asking for one would only give the
 * model something new to get wrong. A brand with no configured currency must
 * behave exactly as it did before this feature shipped, and this is where that
 * promise is kept.
 */
const BahtAnswerSchema = z.object({
  amount: z
    .number()
    .nullable()
    .describe("The grand total in Thai baht, or null if no total is legible."),
});

/** The schema for a brand whose currency an admin has configured and switched on. */
const MultiAnswerSchema = z.object({
  amount: z
    .number()
    .nullable()
    .describe(
      "The grand total as printed, in the document's own currency and not converted, or null if no total is legible.",
    ),
  currency: z
    .string()
    .nullable()
    .describe("ISO-4217 code of the currency that total is in, or null if it cannot be told."),
});

const BAHT_PROMPT = [
  "เอกสารนี้คือใบเสร็จรับเงิน สลิป ใบกำกับภาษี หรือใบแจ้งหนี้",
  "ให้ตอบเฉพาะ 'ยอดรวมสุทธิ' ที่ผู้จ่ายต้องจ่ายจริง เป็นตัวเลขบาท",
  "",
  "กติกา:",
  "- ถ้ามีทั้งยอดก่อนหักส่วนลดและยอดสุทธิ ให้เอายอดสุทธิ",
  "- ห้ามตอบเป็นเลขประจำตัวผู้เสียภาษี เลขที่ใบเสร็จ เบอร์โทร วันที่ เวลา หรือจำนวนชิ้น",
  "- ถ้าอ่านยอดไม่ออก หรือไม่แน่ใจ ให้ตอบ null — อย่าเดา",
  `- ยอดที่สมเหตุสมผลต้องมากกว่า 0 และไม่เกิน ${MAX_RECEIPT_AMOUNT} บาท`,
].join("\n");

/**
 * The same question, plus which of the currencies this claim may be in.
 *
 * Only the codes this brand actually carries are offered, plus baht. Anything
 * else is a misread rather than a discovery — the receipt is being attached to
 * a claim against one company — and `admitModelCurrency` refuses it whatever
 * this prompt says. Naming them here is what keeps that refusal rare rather
 * than routine.
 *
 * The ceiling is stated **after conversion**, because that is where it is
 * applied: bounding the raw figure would be the wrong measurement, in the
 * direction that loses real money (`vision-amount.ts`).
 */
function multiPrompt(brandCurrencies: readonly string[]): string {
  const allowed = brandCurrencies
    .concat([THB])
    .map((c) => `"${c}"`)
    .join(" หรือ ");
  return [
    "เอกสารนี้คือใบเสร็จรับเงิน สลิป ใบกำกับภาษี หรือใบแจ้งหนี้",
    "ให้ตอบ 'ยอดรวมสุทธิ' ที่ผู้จ่ายต้องจ่ายจริง และสกุลเงินของยอดนั้น",
    "",
    "กติกา:",
    "- ถ้ามีทั้งยอดก่อนหักส่วนลดและยอดสุทธิ ให้เอายอดสุทธิ",
    "- amount: ตอบตัวเลขตามที่พิมพ์บนเอกสาร ห้ามแปลงสกุลเงินเอง",
    "- ห้ามตอบเป็นเลขประจำตัวผู้เสียภาษี เลขที่ใบเสร็จ เบอร์โทร วันที่ เวลา หรือจำนวนชิ้น",
    "- ถ้าอ่านยอดไม่ออก หรือไม่แน่ใจ ให้ตอบ amount = null — อย่าเดา",
    `- currency: ตอบได้เฉพาะ ${allowed} เท่านั้น`,
    "  ดูจากสัญลักษณ์หรือรหัสสกุลเงินที่พิมพ์บนเอกสาร",
    "  ถ้าเอกสารเป็นสกุลเงินอื่น หรือระบุไม่ชัดเจน ให้ตอบ currency = null — อย่าเดา",
    `- ยอดที่สมเหตุสมผลต้องมากกว่า 0 และเมื่อคิดเป็นเงินบาทแล้วไม่เกิน ${MAX_RECEIPT_AMOUNT} บาท`,
  ].join("\n");
}

export async function POST(req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  // Read before the guard, used after it: a query parameter costs nothing, but
  // the brand lookup is a database read and an unauthenticated or rate-limited
  // caller must not be able to make this route do one.
  const brandCode = (req.nextUrl.searchParams.get("brandCode") ?? "").trim() || null;

  const guard = await guardVisionRequest(req, {
    userId: session.user.id,
    purpose: "receipt-amount",
    unavailableError: "ยังไม่ได้เปิดใช้งานการอ่านยอดจากใบเสร็จ",
    allowedKinds: ["image", "pdf", "spreadsheet"],
  });
  if (!guard.ok) return guard.response;

  try {
    // Null for every brand nobody has configured a currency for — which is all
    // of them until an admin turns one on — and for a caller that sent no brand
    // code at all. That is the baht path below, byte for byte what this route
    // did before.
    const brandCurrencies = await getBrandClaimCurrencies(brandCode);
    const prompt = brandCurrencies.length > 0 ? multiPrompt(brandCurrencies) : BAHT_PROMPT;

    // Built per kind and then asked the same question, so a new input kind
    // cannot arrive with its own idea of what an answer is.
    let content: Array<Record<string, unknown>>;
    if (guard.kind === "image") {
      content = [visionImageBlock(guard.bytes, guard.mediaType), { type: "text", text: prompt }];
    } else if (guard.kind === "pdf") {
      const pages = await pdfPagesToPng(guard.bytes, MAX_PDF_PAGES);
      content = [
        ...pages.map((page) => visionImageBlock(page, "image/png")),
        { type: "text", text: prompt },
      ];
    } else {
      const sheet = await sheetToText(guard.bytes);
      // An empty workbook is "nothing legible", not a failure: the field opens
      // blank and the requester types the figure, which is where a null answer
      // leaves them anyway. Returning an error instead would put a red note on
      // a perfectly good attachment.
      if (!sheet) return NextResponse.json({ ok: true, data: { amount: null, currency: null } });
      content = [{ type: "text", text: `${prompt}\n\n${sheet}` }];
    }

    const response = await guard.client.messages.parse({
      model: "claude-sonnet-5",
      max_tokens: 1024,
      messages: [{ role: "user", content: content as never }],
      output_config: {
        format: zodOutputFormat(brandCurrencies.length > 0 ? MultiAnswerSchema : BahtAnswerSchema),
      },
    });
    const parsed = response.parsed_output as
      | { amount?: unknown; currency?: string | null }
      | null
      | undefined;

    // `sanitizeReceiptAmount` is the last gate — a model can misread, and the
    // tax id on every Thai receipt is the number most likely to come back.
    if (brandCurrencies.length === 0) {
      const amount = sanitizeReceiptAmount(parsed?.amount);
      return NextResponse.json({ ok: true, data: { amount, currency: THB } });
    }

    // A currency the brand does not offer, or none legible, means the requester
    // decides — the same answer `sanitizeReceiptAmount` gives for a figure it
    // cannot trust. A blank editable field beats a figure whose currency is a
    // guess, on a form about to be submitted.
    const currency = admitModelCurrency(parsed?.currency, brandCurrencies);
    if (currency === null) {
      return NextResponse.json({ ok: true, data: { amount: null, currency: null } });
    }
    if (isBaht(currency)) {
      const amount = sanitizeReceiptAmount(parsed?.amount);
      return NextResponse.json({ ok: true, data: { amount, currency: THB } });
    }

    // The ceiling is a baht ceiling, so it is the CONVERTED figure that is
    // bounded. The sanitisers are left exactly as they are — `sanitizeBookingAmount`
    // alone answers nine other call sites that all deal in the claim's own
    // currency — and `admitReadAmount` moves which figure is measured, not what
    // counts as usable. No rate means no bound can be applied, and an unbounded
    // figure is not offered: the field opens blank.
    const fx = await resolveRate(currency);
    const amount = admitReadAmount(parsed?.amount, fx ? fx.rate : null, sanitizeReceiptAmount);
    return NextResponse.json({
      ok: true,
      data: { amount, currency: amount === null ? null : currency },
    });
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
