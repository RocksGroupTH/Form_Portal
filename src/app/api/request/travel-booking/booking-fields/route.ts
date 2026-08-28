import { NextRequest, NextResponse } from "next/server";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { requireAuth } from "@/lib/api-auth";
import { guardVisionRequest, visionImageBlock } from "@/lib/acc/vision-guard";
import { statusForVisionError } from "@/lib/acc/vision-error";
import { admitModelCurrency, isBaht, THB } from "@/lib/acc/currency";
import { admitReadAmount } from "@/lib/acc/vision-amount";
import { resolveRate } from "@/lib/acc/fx";
import { getBrandClaimCurrencies } from "@/lib/brand-registry";
import { pdfPagesToPng } from "@/lib/pdf-to-image";
import { MAX_PDF_PAGES, sheetToText } from "@/lib/acc/sheet-text";
import {
  sanitizeBookingAmount,
  MAX_BOOKING_AMOUNT,
} from "@/features/travel-booking/lib/booking-amounts";
import {
  sanitizeBookingNo,
  MAX_BOOKING_NO_LENGTH,
} from "@/features/travel-booking/lib/booking-no";

/**
 * POST /api/request/travel-booking/booking-fields — read a booking confirmation
 * or supplier invoice into the five fields an AP-17 booking row carries.
 *
 * The shape is AP-1's `receipt-amount`: guard, build content per kind, ask once,
 * sanitize the answer. What differs is the question. AP-1 wants **one** figure
 * off a receipt; this wants a **breakdown** off a hotel or airline invoice — the
 * booking number, the price before VAT, the VAT, any discount, and the total
 * actually charged. Accounting signs off against that paper, so the row has to
 * be able to hold all five.
 *
 * **One route for all three booking kinds.** `AccTravelBookingDetail`
 * discriminates room / ticket / rental with `BookingType`, so the fields are
 * identical across them and there is nothing per-kind for this route to know.
 *
 * **Its own rate-limit bucket (`booking-fields:`).** Sharing AP-1's or the ID
 * card's would let one form's reads exhaust another's allowance — the reason is
 * written out in the AP-17 section of CLAUDE.md, and it matters most for the ID
 * card, which fails closed and so would become unattachable.
 *
 * A booking confirmation arrives as a PDF far more often than as a photo, and a
 * travel agent's statement arrives as a workbook, so `allowedKinds` takes all
 * three: `pdf-to-image` rasterises, `sheet-text` flattens, an image goes as
 * itself. Passed here rather than widened inside the guard, because AP-17's
 * ID-card check must go on refusing anything that is not an image.
 *
 * Nothing is stored. The file is uploaded to SharePoint separately, by the
 * attachment route, exactly as before.
 *
 * ── The currency, and why the brand code is a query parameter ──
 *
 * All four money fields used to be asserted to be Thai baht in both the prompt
 * and the schema, so a foreign invoice yielded bare numbers that AP-17 recorded
 * and totalled as baht. The currency is now asked for — but only where the
 * request's brand actually offers a choice.
 *
 * **The brand's currencies are resolved here, server-side, through
 * `getBrandClaimCurrencies`.** A currency posted by the caller would let somebody
 * shape their own request into having one accepted that the brand does not
 * offer; `?brandCode=` names a brand, and what that brand may be recorded in is
 * this side's decision alone. So this route **does** read the database — two of
 * them, through `listBrandRegistry` — which the note here denied until the
 * currency work landed. `getProductionFormPool()`, never `getAccPool()`:
 * `BrandCurrency` has no object in `Rocks_Portal_Form_UAT`.
 *
 * `ROUTE_RULES` needs no entry even so: the `/api/request/travel-booking`
 * prefix already classifies as `AP-17` (`src/lib/form-environment/classify-path.ts`),
 * and nothing read here is per-environment — `BrandCurrency` has one copy.
 */

/** The four money fields, whose descriptions are the only per-currency difference. */
const bookingNoField = z
  .string()
  .nullable()
  .describe("The booking / reservation / confirmation number printed on the document, or null.");

/**
 * The schema for a request whose brand offers no currency choice — **today's
 * schema, unchanged**, and the one almost every read uses.
 *
 * Such a request can only be recorded in baht: `AdminBookingPanel` renders no
 * currency toggle for it (`bookingCurrencyOptions` is empty), so there is no
 * control that could hold another answer, and asking for one would only give
 * the model something new to get wrong.
 */
const BahtAnswerSchema = z.object({
  bookingNo: bookingNoField,
  priceExVat: z
    .number()
    .nullable()
    .describe("The price BEFORE VAT in Thai baht, or null if it is not printed."),
  vat: z
    .number()
    .nullable()
    .describe("The VAT figure in Thai baht as printed, or null if it is not printed."),
  discount: z
    .number()
    .nullable()
    .describe("The discount in Thai baht as a positive number, or null if there is none."),
  total: z
    .number()
    .nullable()
    .describe("The grand total actually charged in Thai baht, or null."),
});

/** The schema for a brand whose currency an admin has configured and switched on. */
const MultiAnswerSchema = z.object({
  bookingNo: bookingNoField,
  priceExVat: z
    .number()
    .nullable()
    .describe("The price BEFORE VAT as printed, in the document's own currency, or null."),
  vat: z
    .number()
    .nullable()
    .describe("The VAT figure as printed, in the document's own currency, or null."),
  discount: z
    .number()
    .nullable()
    .describe("The discount as a positive number in the document's own currency, or null."),
  total: z
    .number()
    .nullable()
    .describe("The grand total actually charged, as printed and not converted, or null."),
  currency: z
    .string()
    .nullable()
    .describe("ISO-4217 code the four figures are in, or null if it cannot be told."),
});

const SHARED_RULES = [
  "- bookingNo: เลขที่การจอง / Booking No. / Reservation No. / Confirmation No.",
  "  ตามที่พิมพ์ไว้ ห้ามตอบเลขประจำตัวผู้เสียภาษี (13 หลัก) เลขที่ห้อง เลขเที่ยวบิน",
  "  เบอร์โทร หรือเลขที่บัญชีธนาคาร",
  `  ยาวไม่เกิน ${MAX_BOOKING_NO_LENGTH} ตัวอักษร`,
  "- priceExVat: ราคาก่อนภาษีมูลค่าเพิ่ม (มูลค่าที่คำนวณภาษี / Subtotal / Amount before VAT)",
  "- vat: บรรทัดภาษีมูลค่าเพิ่ม (VAT 7%) ตามที่พิมพ์ไว้",
  "- discount: ส่วนลด ตอบเป็น 'จำนวนบวก' เสมอ ห้ามใส่เครื่องหมายลบ",
  "- total: ยอดรวมสุทธิที่ต้องจ่ายจริง (จำนวนเงินทั้งสิ้น / Grand Total)",
  "",
  "ห้ามเด็ดขาด:",
  "- ห้ามคำนวณตัวเลขเอง ถ้าเอกสารไม่ได้พิมพ์ช่องไหนไว้ ให้ตอบ null เฉพาะช่องนั้น",
  "  เช่น เอกสารมีแต่ยอดรวม ก็ตอบ total อย่างเดียว ที่เหลือเป็น null",
  "- ห้ามเดา ช่องไหนอ่านไม่ออกหรือไม่แน่ใจ ให้ตอบ null",
];

const BAHT_PROMPT = [
  "เอกสารนี้คือใบยืนยันการจอง (โรงแรม / ตั๋วโดยสาร / รถเช่า) ใบแจ้งหนี้ หรือใบกำกับภาษี",
  "ให้อ่านข้อมูล 5 ช่องต่อไปนี้ตามที่พิมพ์อยู่บนเอกสาร",
  "",
  "กติกาของแต่ละช่อง:",
  ...SHARED_RULES,
  `- ตัวเลขเงินที่สมเหตุสมผลต้องไม่ติดลบ และไม่เกิน ${MAX_BOOKING_AMOUNT} บาท`,
].join("\n");

/**
 * The same five questions, plus which of the currencies the figures are in.
 *
 * Only the codes this request's brand actually carries are offered, plus baht.
 * Anything else is a misread rather than a discovery — the invoice is being
 * attached to a request against one company — and `admitModelCurrency` refuses
 * it whatever this prompt says.
 *
 * The ceiling is stated **after conversion**, because that is where it is
 * applied: bounding the raw figures would be the wrong measurement, in the
 * direction that loses real money (`vision-amount.ts`).
 */
function multiPrompt(brandCurrencies: readonly string[]): string {
  const allowed = brandCurrencies
    .concat([THB])
    .map((c) => `"${c}"`)
    .join(" หรือ ");
  return [
    "เอกสารนี้คือใบยืนยันการจอง (โรงแรม / ตั๋วโดยสาร / รถเช่า) ใบแจ้งหนี้ หรือใบกำกับภาษี",
    "ให้อ่านข้อมูล 6 ช่องต่อไปนี้ตามที่พิมพ์อยู่บนเอกสาร",
    "",
    "กติกาของแต่ละช่อง:",
    ...SHARED_RULES,
    "- ห้ามแปลงสกุลเงินเอง ให้ตอบตัวเลขตามที่พิมพ์บนเอกสาร",
    "",
    "สกุลเงิน:",
    `- currency: ตอบได้เฉพาะ ${allowed} เท่านั้น`,
    "  ดูจากสัญลักษณ์หรือรหัสสกุลเงินที่พิมพ์บนเอกสาร",
    "  ถ้าเอกสารเป็นสกุลเงินอื่น หรือระบุไม่ชัดเจน ให้ตอบ currency = null — อย่าเดา",
    `- ตัวเลขเงินที่สมเหตุสมผลต้องไม่ติดลบ และเมื่อคิดเป็นเงินบาทแล้วไม่เกิน ${MAX_BOOKING_AMOUNT} บาท`,
  ].join("\n");
}

/** What the client gets back. Every field is independently nullable. */
const EMPTY = {
  bookingNo: null,
  priceExVat: null,
  vat: null,
  discount: null,
  total: null,
  currency: null,
};

export async function POST(req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  // Read before the guard, used after it: a query parameter costs nothing, but
  // the brand lookup is a database read and an unauthenticated or rate-limited
  // caller must not be able to make this route do one.
  const brandCode = (req.nextUrl.searchParams.get("brandCode") ?? "").trim() || null;

  const guard = await guardVisionRequest(req, {
    userId: session.user.id,
    // Its own bucket. See the note at the top of this file.
    purpose: "booking-fields",
    unavailableError: "ยังไม่ได้เปิดใช้งานการอ่านข้อมูลจากใบยืนยันการจอง",
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
      // An empty workbook is "nothing legible", not a failure: the row still
      // gets its attachment, and the fields simply open blank — which is where
      // a null answer leaves the booking desk anyway. An error here would put a
      // red note on a perfectly good file.
      if (!sheet) return NextResponse.json({ ok: true, data: EMPTY });
      content = [{ type: "text", text: `${prompt}\n\n${sheet}` }];
    }

    const response = await guard.client.messages.parse({
      model: "claude-sonnet-5",
      max_tokens: 2048,
      messages: [{ role: "user", content: content as never }],
      output_config: {
        format: zodOutputFormat(brandCurrencies.length > 0 ? MultiAnswerSchema : BahtAnswerSchema),
      },
    });

    // The last gate, and the model is not trusted with the ceiling. Each field
    // is sanitized on its own rather than the whole answer being discarded over
    // one bad number — four good figures and a blank beat five blanks.
    // `sanitizeBookingAmount` keeps zero, unlike AP-1's: "no VAT" and "no
    // discount" are real answers a booking row must be able to record.
    const parsed = response.parsed_output as
      | {
          bookingNo?: unknown;
          priceExVat?: unknown;
          vat?: unknown;
          discount?: unknown;
          total?: unknown;
          currency?: string | null;
        }
      | null
      | undefined;
    const bookingNo = sanitizeBookingNo(parsed?.bookingNo);

    if (brandCurrencies.length === 0) {
      return NextResponse.json({
        ok: true,
        data: {
          bookingNo,
          priceExVat: sanitizeBookingAmount(parsed?.priceExVat),
          vat: sanitizeBookingAmount(parsed?.vat),
          discount: sanitizeBookingAmount(parsed?.discount),
          total: sanitizeBookingAmount(parsed?.total),
          currency: THB,
        },
      });
    }

    // A currency the brand does not offer, or none legible, means the desk
    // decides. **The booking number survives it**: it is not a money field, the
    // same reason each figure is already sanitized on its own rather than the
    // answer being discarded whole.
    const currency = admitModelCurrency(parsed?.currency, brandCurrencies);
    if (currency === null) {
      return NextResponse.json({ ok: true, data: { ...EMPTY, bookingNo } });
    }
    if (isBaht(currency)) {
      return NextResponse.json({
        ok: true,
        data: {
          bookingNo,
          priceExVat: sanitizeBookingAmount(parsed?.priceExVat),
          vat: sanitizeBookingAmount(parsed?.vat),
          discount: sanitizeBookingAmount(parsed?.discount),
          total: sanitizeBookingAmount(parsed?.total),
          currency: THB,
        },
      });
    }

    // The ceiling is a baht ceiling, so it is the CONVERTED figure that is
    // bounded. `sanitizeBookingAmount` is left exactly as it is — nine other
    // call sites read it, all of them in the claim's own currency — and
    // `admitReadAmount` moves which figure is measured, not what counts as
    // usable, so zero is still kept here and a negative still refused. No rate
    // means no bound can be applied, and unbounded figures are not offered: the
    // fields open blank.
    const fx = await resolveRate(currency);
    const rate = fx ? fx.rate : null;
    const priceExVat = admitReadAmount(parsed?.priceExVat, rate, sanitizeBookingAmount);
    const vat = admitReadAmount(parsed?.vat, rate, sanitizeBookingAmount);
    const discount = admitReadAmount(parsed?.discount, rate, sanitizeBookingAmount);
    const total = admitReadAmount(parsed?.total, rate, sanitizeBookingAmount);
    const anyAmount =
      priceExVat !== null || vat !== null || discount !== null || total !== null;
    return NextResponse.json({
      ok: true,
      data: {
        bookingNo,
        priceExVat,
        vat,
        discount,
        total,
        // Naming a currency beside five nulls would caption nothing.
        currency: anyAmount ? currency : null,
      },
    });
  } catch (err: unknown) {
    // Logged, not surfaced: the client opens the fields either way, and an
    // upstream message is no use to the person filling the form.
    console.error(
      "[api/request/travel-booking/booking-fields] POST",
      err instanceof Error ? err.message : err,
    );
    return NextResponse.json(
      { ok: false, error: "อ่านข้อมูลจากไฟล์แนบไม่สำเร็จ" },
      // 401/403/400 from upstream become 503 — a revoked key fails identically
      // forever and only an operator can fix it, so "try again" is advice that
      // cannot work. Not reimplemented here; one copy, unit-tested.
      { status: statusForVisionError(err) },
    );
  }
}
