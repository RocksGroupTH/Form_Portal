import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { isLookupResource, runLookup, LookupError } from "@/lib/new-item-inventory/lookup";

/**
 * GET /api/request/new-item-inventory/lookup/[resource]?brand=PCTH&q=abc
 * Serves brand-scoped lookup options for the New Item Inventory form.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ resource: string }> },
) {
  try {
    const session = await requireAuth();
    if (session instanceof Response) return session;

    const { resource } = await params;
    if (!isLookupResource(resource)) {
      return NextResponse.json(
        { ok: false, error: `Unknown lookup resource: ${resource}` },
        { status: 404 },
      );
    }

    const brand = req.nextUrl.searchParams.get("brand")?.trim() ?? "";
    if (!brand) {
      return NextResponse.json(
        { ok: false, error: "brand query parameter is required" },
        { status: 400 },
      );
    }

    const q = req.nextUrl.searchParams.get("q") ?? "";
    const data = await runLookup(resource, brand, q);
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    if (err instanceof LookupError) {
      return NextResponse.json(
        { ok: false, error: err.message, code: err.code },
        { status: err.status },
      );
    }
    console.error("[api/request/new-item-inventory/lookup] GET", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}
