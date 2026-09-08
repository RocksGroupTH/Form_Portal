import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { extractReceipt } from "@/lib/clr/slip-verify";
import { extractReceiptsWithAI } from "@/lib/clr/ai-receipt";
import { isPdfFile, pdfPagesToPng } from "@/lib/pdf-to-image";

type AiMedia = "image/png" | "image/jpeg" | "image/webp" | "image/gif";
function aiMediaType(type: string): AiMedia {
  if (type === "image/jpeg" || type === "image/jpg") return "image/jpeg";
  if (type === "image/webp") return "image/webp";
  if (type === "image/gif") return "image/gif";
  return "image/png";
}

/**
 * How many pages of one uploaded PDF are read.
 *
 * An AP-3 clearing is submitted as a bundle, not a single receipt: a BC payment
 * voucher, the AP-3.1 clearing form, a transfer slip and the receipts, in that
 * rough order. Page 1 is therefore never the receipt, and reading only it was
 * dropping the whole document silently.
 *
 * 15 is the size of the largest sample bundle that fits under the form's 4MB
 * attachment limit, so the cap covers every file that can physically be
 * uploaded. Each A4 page rasterised at scale 2 is ~2.6k vision tokens, so a
 * worst-case upload bills ~39k input tokens (about $0.04 on Haiku) — the cap is
 * what keeps one careless 89-page scan from becoming 89 billed images.
 */
const MAX_PDF_PAGES = 15;

/**
 * POST /api/request/clear-advance/verify-receipt
 * multipart: file (image or PDF). Returns one entry per receipt or transfer slip
 * found in the upload — a bundle of two invoices and a transfer slip pre-fills two
 * expense lines and the refund fields. Pages that are neither are not returned at
 * all, only counted in `skippedPages`.
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
    // PDF → rasterise its pages to PNG, then read them like any image.
    const raw = Buffer.from(await file.arrayBuffer());
    const mediaType: AiMedia = isPdf ? "image/png" : aiMediaType(file.type);
    const pages: Buffer[] = isPdf ? await pdfPagesToPng(raw, MAX_PDF_PAGES) : [raw];
    // pdfPagesToPng stops at the cap without saying whether more existed, so a
    // full run is reported as "may be truncated" rather than claimed complete.
    const maybeTruncated = isPdf && pages.length >= MAX_PDF_PAGES;

    // Claude vision first; fall back to Tesseract+regex when absent/failed. A read
    // that found only non-receipt pages still counts as a read — the skip count is
    // the answer, and Tesseract would only turn a voucher into a bogus row.
    const ai = await extractReceiptsWithAI(pages, mediaType);
    if (ai.docs.length > 0 || ai.skippedPages > 0) {
      return NextResponse.json({
        ok: true, data: ai.docs, source: "ai",
        pagesRead: pages.length, skippedPages: ai.skippedPages, maybeTruncated,
        // Document-level: the page naming the destination is usually the voucher,
        // which produces no row of its own, so this cannot ride on a row.
        branchHint: ai.branchHint,
      });
    }

    // Tesseract fallback — may fail if the CDN model is unavailable; treat as soft
    // failure. It reads one page and cannot classify, so it returns one receipt.
    try {
      const result = await extractReceipt(pages[0]);
      return NextResponse.json({
        ok: true, data: [{ ...result, kind: "receipt" as const }], source: "ocr",
        pagesRead: 1, skippedPages: 0, maybeTruncated, branchHint: null,
      });
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
