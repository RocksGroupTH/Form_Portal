import { NextRequest, NextResponse } from "next/server";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { requireAuth } from "@/lib/api-auth";
import { guardVisionRequest, visionImageBlock } from "@/lib/acc/vision-guard";
import { statusForVisionError } from "@/lib/acc/vision-error";

/**
 * POST /api/request/travel-booking/id-card-check — is this image a Thai
 * national ID card? AP-17 refuses to attach anything else.
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
 * The image is a national ID scan — the most sensitive thing this application
 * handles, and the reason `id-card-access.ts` restricts it to the data subject
 * alone. Sending it here was a decision taken deliberately, not a default.
 * Nothing is stored: read, sent, dropped. The card itself goes to SharePoint
 * separately, on save, exactly as before.
 *
 * `ROUTE_RULES` needs no entry: `/api/request/travel-booking` already
 * classifies as `AP-17`, and this route reads no database at all.
 */

const AnswerSchema = z.object({
  isIdCard: z
    .boolean()
    .describe("True only if the image shows a Thai national ID card (บัตรประจำตัวประชาชน)."),
  reason: z
    .string()
    .nullable()
    .describe("When false, one short Thai sentence naming what the image actually shows."),
});

const PROMPT = [
  "รูปนี้เป็น 'บัตรประจำตัวประชาชนไทย' หรือไม่",
  "",
  "กติกา:",
  "- ตอบ true เฉพาะเมื่อเห็นว่าเป็นบัตรประชาชนไทยจริง ๆ (ด้านหน้าหรือด้านหลังก็ได้)",
  "- ใบเสร็จ ใบกำกับภาษี สลิปโอนเงิน บัตรพนักงาน ใบขับขี่ พาสปอร์ต หรือรูปอื่น ๆ ให้ตอบ false",
  "- เลข 13 หลักบนเอกสารไม่ได้แปลว่าเป็นบัตรประชาชน เลขประจำตัวผู้เสียภาษีก็มี 13 หลักเหมือนกัน",
  "- ถ้าเป็นบัตรประชาชนแต่เบลอหรืออ่านไม่ออก ให้ตอบ false และบอกว่าถ่ายไม่ชัด",
  "- ถ้าตอบ false ให้ reason เป็นภาษาไทยสั้น ๆ บอกว่ารูปนี้คืออะไร",
  "",
  "ห้ามอ่านหรือตอบเลขบัตร ชื่อ หรือที่อยู่บนบัตรกลับมา",
].join("\n");

const FALLBACK_REASON = "รูปนี้ไม่ใช่บัตรประจำตัวประชาชน";

export async function POST(req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const guard = await guardVisionRequest(req, {
    userId: session.user.id,
    purpose: "id-card-check",
    unavailableError: "ยังไม่ได้เปิดใช้งานการตรวจรูปบัตรประชาชน",
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

    const answer = response.parsed_output;
    // No answer is not a pass. The client decides what to do with a refusal it
    // could not obtain — see `idcard-check.ts` — but it must not be told "yes".
    if (!answer) {
      return NextResponse.json({ ok: false, error: "ตรวจรูปบัตรไม่สำเร็จ" }, { status: 502 });
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
      { ok: false, error: "ตรวจรูปบัตรไม่สำเร็จ" },
      { status: statusForVisionError(err) },
    );
  }
}
