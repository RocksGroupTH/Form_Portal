import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { extractSlip } from "@/lib/clr/slip-verify";
import { isPdfFile, pdfFirstPageToPng } from "@/lib/pdf-to-image";

/**
 * POST /api/request/clear-advance/verify-slip
 * multipart: file (image) + expected (baht). OCRs the refund slip via Azure
 * Document Intelligence and reports whether the expected refund amount is present.
 * Best-effort — never blocks the form; unconfigured → { configured: false }.
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
    if (isPdf) buffer = await pdfFirstPageToPng(buffer);
    const result = await extractSlip(buffer, expected);
    return NextResponse.json({ ok: true, data: result });
  } catch (e) {
    // OCR failure shouldn't break the flow — report it, the UI treats it as "unavailable".
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "verify failed" },
      { status: 502 },
    );
  }
}
