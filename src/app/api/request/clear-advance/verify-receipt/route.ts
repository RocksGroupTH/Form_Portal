import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { extractReceipt } from "@/lib/clr/slip-verify";
import { extractReceiptWithAI } from "@/lib/clr/ai-receipt";
import { isPdfFile, pdfFirstPageToPng } from "@/lib/pdf-to-image";

type AiMedia = "image/png" | "image/jpeg" | "image/webp" | "image/gif";
function aiMediaType(type: string): AiMedia {
  if (type === "image/jpeg" || type === "image/jpg") return "image/jpeg";
  if (type === "image/webp") return "image/webp";
  if (type === "image/gif") return "image/gif";
  return "image/png";
}

/**
 * POST /api/request/clear-advance/verify-receipt
 * multipart: file (image or PDF). Extracts the fields to pre-fill an expense line.
 * If ANTHROPIC_API_KEY is set, Claude vision reads the image; otherwise (or on any
 * failure) it falls back to the free local Tesseract+regex path. Best-effort — never
 * blocks the form; the user edits every value.
 */
export async function POST(req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  try {
    const fd = await req.formData();
    const file = fd.get("file") as File | null;
    if (!file) return NextResponse.json({ ok: false, error: "No file provided" }, { status: 400 });
    const isPdf = isPdfFile(file);
    if (!file.type.startsWith("image/") && !isPdf) {
      return NextResponse.json({ ok: false, error: "รองรับเฉพาะไฟล์รูปภาพหรือ PDF" }, { status: 400 });
    }
    // PDF → rasterise the first page to PNG, then read it like any image.
    let buffer: Buffer = Buffer.from(await file.arrayBuffer());
    let mediaType: AiMedia = aiMediaType(file.type);
    if (isPdf) { buffer = await pdfFirstPageToPng(buffer); mediaType = "image/png"; }

    // Claude vision first; fall back to Tesseract+regex when absent/failed.
    const ai = await extractReceiptWithAI(buffer, mediaType);
    const aiUsable = !!ai && !!(ai.date || ai.docNo || ai.description || ai.beforeVat != null || ai.payeeName);
    if (aiUsable) return NextResponse.json({ ok: true, data: ai!, source: "ai" });

    // Tesseract fallback — may fail if the CDN model is unavailable; treat as soft failure.
    try {
      const result = await extractReceipt(buffer);
      return NextResponse.json({ ok: true, data: result, source: "ocr" });
    } catch {
      return NextResponse.json({ ok: false, error: "อ่านใบเสร็จไม่สำเร็จ — ไม่มีเครื่องมือ OCR" }, { status: 502 });
    }
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "verify failed" },
      { status: 502 },
    );
  }
}
