import { NextRequest, NextResponse } from "next/server";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { requireAuth } from "@/lib/api-auth";
import { guardVisionRequest, visionImageBlock, ID_CARD_VISION_MODEL } from "@/lib/acc/vision-guard";
import { statusForVisionError } from "@/lib/acc/vision-error";

/**
 * POST /api/request/travel-booking/id-card-check — is this image a Thai
 * national ID card, **or a passport**? AP-17 refuses to attach anything else.
 *
 * **The passport half was added 2026-09-22, by the user's ruling.** Package A
 * (2026-09-21) retitled the field `แนบรูปบัตรประชาชน หรือ Passport` and left
 * this check alone, which refused a passport four ways over — and because the
 * check **fails closed** and the attachment is required to submit, a passport
 * holder could not file AP-17 at all. Two things the user decided along with
 * it, both of which the prompt below has to keep saying:
 *
 * - **any country's passport counts**, not only a Thai one — AP-17 covers
 *   foreign travel and the purpose is proof of identity for a booking;
 * - **widening stops there.** A driving licence, an employee card or a student
 *   card is still refused. The reject list is doing a job; only `พาสปอร์ต`
 *   moved out of it.
 *
 * **This replaced a client-side tesseract heuristic that never worked.** That
 * check passed an image on either a 13-digit run or a Thai ID keyword, and a
 * Thai **tax id is also exactly 13 digits** — printed on every ใบกำกับภาษี. Its
 * digit pattern allowed a space or a dot between digits too, so a single line
 * of prices (`199.00 249.00 30.00`) matched as well. A receipt therefore
 * verified as a national ID card, which is what prompted the change on
 * 2026-08-24. No regex over OCR text can separate those two numbers; looking at
 * the image can.
 *
 * The image is a national ID or passport scan — the most sensitive thing this
 * application handles, and the reason `id-card-access.ts` restricts it to the
 * data subject alone. Sending it here was a decision taken deliberately, not a
 * default. Nothing is stored: read, sent, dropped. The document itself goes to
 * SharePoint separately, on save, exactly as before. **A passport carries more
 * than a card does** — number, name, nationality, date of birth — so the
 * prompt's closing instruction names those too rather than only the card's
 * fields.
 *
 * `ROUTE_RULES` needs no entry: `/api/request/travel-booking` already
 * classifies as `AP-17`, and this route reads no database at all.
 */

const AnswerSchema = z.object({
  isIdCard: z
    .boolean()
    .describe(
      "True only if the image shows one of exactly two documents: a Thai national ID card (บัตรประจำตัวประชาชน), or a passport issued by any country (พาสปอร์ต / หนังสือเดินทาง). False for every other document, including a driving licence, an employee card and a student card.",
    ),
  reason: z
    .string()
    .nullable()
    .describe("When false, one short Thai sentence naming what the image actually shows."),
});

/**
 * Written as "which of these two?", not as "a national ID card — oh, and a
 * passport". The check fails closed, so an instruction the model follows
 * inconsistently costs a requester their ability to file at all; the two
 * accepted documents are therefore stated as a list of equals, and the reject
 * list below is what carries the *narrowness* of the widening.
 */
const PROMPT = [
  "รูปนี้เป็นเอกสารยืนยันตัวตนที่ระบบรับได้หรือไม่ — รับเพียง 2 อย่างเท่านั้น",
  "",
  "เอกสารที่รับได้ (ตอบ true):",
  "1. บัตรประจำตัวประชาชนไทย — ด้านหน้าหรือด้านหลังก็ได้",
  "2. พาสปอร์ต (หนังสือเดินทาง) ของประเทศใดก็ได้ ไม่จำเป็นต้องเป็นของไทย — หน้าที่มีรูปถ่ายและข้อมูลผู้ถือ",
  "",
  "กติกา:",
  "- ถ้าเป็นอย่างใดอย่างหนึ่งใน 2 ข้อข้างบน ให้ตอบ true",
  "- นอกจาก 2 อย่างนี้ ให้ตอบ false ทั้งหมด เช่น ใบขับขี่ บัตรพนักงาน บัตรนักศึกษา ใบเสร็จ ใบกำกับภาษี สลิปโอนเงิน หรือรูปอื่น ๆ",
  "- เลข 13 หลักบนเอกสารไม่ได้แปลว่าเป็นบัตรประชาชน เลขประจำตัวผู้เสียภาษีก็มี 13 หลักเหมือนกัน",
  "- ถ้าเป็นบัตรประชาชนหรือพาสปอร์ตแต่เบลอหรืออ่านไม่ออก ให้ตอบ false และบอกว่าถ่ายไม่ชัด",
  "- ถ้าตอบ false ให้ reason เป็นภาษาไทยสั้น ๆ บอกว่ารูปนี้คืออะไร",
  "",
  "ห้ามอ่านหรือตอบข้อมูลส่วนบุคคลบนเอกสารกลับมา ไม่ว่าจะเป็นเลขบัตรประชาชน เลขพาสปอร์ต ชื่อ นามสกุล สัญชาติ วันเกิด หรือที่อยู่",
].join("\n");

const FALLBACK_REASON = "รูปนี้ไม่ใช่บัตรประจำตัวประชาชนหรือพาสปอร์ต";

export async function POST(req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const guard = await guardVisionRequest(req, {
    userId: session.user.id,
    purpose: "id-card-check",
    unavailableError: "ยังไม่ได้เปิดใช้งานการตรวจรูปบัตรประชาชน หรือ Passport",
  });
  if (!guard.ok) return guard.response;

  // Unreachable while this route passes no `allowedKinds` (the guard then
  // admits images only), and kept because that default is the *guard's*, not
  // this route's. A future caller widening it must not silently start sending
  // a PDF's bytes to an image content block.
  if (guard.kind !== "image") {
    return NextResponse.json({ ok: false, error: "รองรับเฉพาะไฟล์รูปภาพ" }, { status: 400 });
  }

  try {
    const response = await guard.client.messages.parse({
      model: ID_CARD_VISION_MODEL,
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [visionImageBlock(guard.bytes, guard.mediaType), { type: "text", text: PROMPT }],
        },
      ],
      output_config: { format: zodOutputFormat(AnswerSchema) },
    });

    const answer = response.parsed_output;
    // No answer is not a pass. The client decides what to do with a refusal it
    // could not obtain — see `idcard-check.ts` — but it must not be told "yes".
    if (!answer) {
      return NextResponse.json({ ok: false, error: "ตรวจรูปเอกสารไม่สำเร็จ" }, { status: 502 });
    }
    return NextResponse.json({
      ok: true,
      data: {
        isIdCard: answer.isIdCard === true,
        reason: answer.isIdCard ? null : (answer.reason?.trim() || FALLBACK_REASON),
      },
    });
  } catch (err: unknown) {
    console.error(
      "[api/request/travel-booking/id-card-check] POST",
      err instanceof Error ? err.message : err,
    );
    // 503 when only an operator can fix it (a bad key), 502 when a retry might
    // work. The client turns that into the difference between "tell IT" and
    // "try again", and with the check failing closed that copy is all the
    // requester has to go on.
    return NextResponse.json(
      { ok: false, error: "ตรวจรูปเอกสารไม่สำเร็จ" },
      { status: statusForVisionError(err) },
    );
  }
}
