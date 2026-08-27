import { NextRequest, NextResponse } from "next/server";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { requireAuth } from "@/lib/api-auth";
import { guardVisionRequest, visionImageBlock } from "@/lib/acc/vision-guard";
import { statusForVisionError } from "@/lib/acc/vision-error";
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
 * `ROUTE_RULES` needs no entry: the `/api/request/travel-booking` prefix already
 * classifies as `AP-17` (`src/lib/form-environment/classify-path.ts`), and this
 * route reads no database at all.
 */

const AnswerSchema = z.object({
  bookingNo: z
    .string()
    .nullable()
    .describe("The booking / reservation / confirmation number printed on the document, or null."),
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

const PROMPT = [
  "เอกสารนี้คือใบยืนยันการจอง (โรงแรม / ตั๋วโดยสาร / รถเช่า) ใบแจ้งหนี้ หรือใบกำกับภาษี",
  "ให้อ่านข้อมูล 5 ช่องต่อไปนี้ตามที่พิมพ์อยู่บนเอกสาร",
  "",
  "กติกาของแต่ละช่อง:",
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
  `- ตัวเลขเงินที่สมเหตุสมผลต้องไม่ติดลบ และไม่เกิน ${MAX_BOOKING_AMOUNT} บาท`,
].join("\n");

/** What the client gets back. Every field is independently nullable. */
const EMPTY = { bookingNo: null, priceExVat: null, vat: null, discount: null, total: null };

export async function POST(req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const guard = await guardVisionRequest(req, {
    userId: session.user.id,
    // Its own bucket. See the note at the top of this file.
    purpose: "booking-fields",
    unavailableError: "ยังไม่ได้เปิดใช้งานการอ่านข้อมูลจากใบยืนยันการจอง",
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
      // An empty workbook is "nothing legible", not a failure: the row still
      // gets its attachment, and the fields simply open blank — which is where
      // a null answer leaves the booking desk anyway. An error here would put a
      // red note on a perfectly good file.
      if (!sheet) return NextResponse.json({ ok: true, data: EMPTY });
      content = [{ type: "text", text: `${PROMPT}\n\n${sheet}` }];
    }

    const response = await guard.client.messages.parse({
      model: "claude-sonnet-5",
      max_tokens: 2048,
      messages: [{ role: "user", content: content as never }],
      output_config: { format: zodOutputFormat(AnswerSchema) },
    });

    // The last gate, and the model is not trusted with the ceiling. Each field
    // is sanitized on its own rather than the whole answer being discarded over
    // one bad number — four good figures and a blank beat five blanks.
    // `sanitizeBookingAmount` keeps zero, unlike AP-1's: "no VAT" and "no
    // discount" are real answers a booking row must be able to record.
    const parsed = response.parsed_output;
    return NextResponse.json({
      ok: true,
      data: {
        bookingNo: sanitizeBookingNo(parsed?.bookingNo),
        priceExVat: sanitizeBookingAmount(parsed?.priceExVat),
        vat: sanitizeBookingAmount(parsed?.vat),
        discount: sanitizeBookingAmount(parsed?.discount),
        total: sanitizeBookingAmount(parsed?.total),
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
