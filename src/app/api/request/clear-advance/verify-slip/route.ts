import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { extractSlip } from "@/lib/clr/slip-verify";
import { extractSlipWithAI } from "@/lib/clr/ai-receipt";
import { isPdfFile, pdfFirstPageToPng } from "@/lib/pdf-to-image";

type AiMedia = "image/png" | "image/jpeg" | "image/webp" | "image/gif";
function aiMediaType(type: string): AiMedia {
  if (type === "image/jpeg" || type === "image/jpg") return "image/jpeg";
  if (type === "image/webp") return "image/webp";
  if (type === "image/gif") return "image/gif";
  return "image/png";
}

/**
 * POST /api/request/clear-advance/verify-slip
 * multipart: file (image or PDF) + expected (baht).
 * Claude vision reads amount + date first; falls back to Tesseract+regex.
 * Best-effort — never blocks the form.
 */
export async function POST(req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  try {
    const fd = await req.formData();
    const file = fd.get("file") as File | null;
    const expected = Number(fd.get("expected"));
    if (!file) return NextResponse.json({ ok: false, error: "No file provided" }, { status: 400 });
    const isPdf = isPdfFile(file);
    if (!file.type.startsWith("image/") && !isPdf) {
      return NextResponse.json({ ok: false, error: "รองรับเฉพาะไฟล์รูปภาพหรือ PDF" }, { status: 400 });
    }
    if (!Number.isFinite(expected) || expected <= 0) {
      return NextResponse.json({ ok: false, error: "expected amount required" }, { status: 400 });
    }
    let buffer: Buffer = Buffer.from(await file.arrayBuffer());
    let mediaType: AiMedia = aiMediaType(file.type);
    if (isPdf) { buffer = await pdfFirstPageToPng(buffer); mediaType = "image/png"; }

    // Claude vision first — reads amount + date from the slip.
    const ai = await extractSlipWithAI(buffer, mediaType);
    if (ai && (ai.amount != null || ai.date)) {
      const amounts = ai.amount != null ? [ai.amount] : [];
      const matchExact = ai.amount != null && Math.abs(ai.amount - expected) < 0.01;
      return NextResponse.json({
        ok: true,
        data: {
          configured: true,
          matched: matchExact,
          expected,
          bestAmount: ai.amount,
          date: ai.date,
          amounts,
          source: "ai",
        },
      });
    }

    // Tesseract fallback.
    try {
      const result = await extractSlip(buffer, expected);
      return NextResponse.json({ ok: true, data: { ...result, source: "ocr" } });
    } catch {
      return NextResponse.json({ ok: false, error: "อ่านสลิปไม่สำเร็จ — ไม่มีเครื่องมือ OCR" }, { status: 502 });
    }
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "verify failed" },
      { status: 502 },
    );
  }
}
