import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { getUploadedBrandLogo } from "@/lib/brand-registry";
import { attachmentResponseHeaders } from "@/lib/acc/attachment-guard";

/**
 * GET /api/brand-logo/[code] — serve a brand's uploaded logo.
 *
 * **The bytes are re-sniffed on the way out**, by the same
 * `attachmentResponseHeaders` every attachment download uses. That is what
 * makes serving a stored image safe: a raster image goes out `inline` with its
 * true type, and anything else — including bytes that were somehow written past
 * the upload guard — goes out as `attachment` with `nosniff` and a
 * `default-src 'none'; sandbox` CSP, so it cannot execute on this origin. The
 * stored `LogoContentType` is deliberately not echoed.
 *
 * Signed-in only. A brand logo is not a secret, but this app has no anonymous
 * surface and adding one for an image is not worth the exception.
 *
 * `ROUTE_RULES` needs no entry: `/api/brand-logo` is not under `/api/request`,
 * and the read is pinned to the production form database by
 * `getProductionFormPool()` regardless of who is asking.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const { code } = await params;
  const brandCode = decodeURIComponent(code).trim().toUpperCase();
  if (!brandCode) {
    return NextResponse.json({ ok: false, error: "Invalid brand" }, { status: 400 });
  }

  try {
    const logo = await getUploadedBrandLogo(brandCode);
    if (!logo) {
      return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    }

    const headers = attachmentResponseHeaders({
      bytes: logo.bytes,
      fileName: `${brandCode.toLowerCase()}-logo`,
    });

    // The URL carries `?v={LogoUpdatedAt}`, so a stored logo is immutable at
    // any given URL and can be cached hard. `private` because the response is
    // behind a session.
    return new NextResponse(new Uint8Array(logo.bytes), {
      status: 200,
      headers: { ...headers, "Cache-Control": "private, max-age=86400, immutable" },
    });
  } catch (err) {
    console.error("[api/brand-logo] GET", err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
