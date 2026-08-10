import { NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";
import { isEncryptionConfigured } from "@/lib/db/connection-crypto";
import { refreshBcConnectionToken } from "@/lib/bc/bc-connection";

type RouteParams = { params: Promise<{ id: string }> };

/** Obtain or refresh OAuth access token (server-only; token never returned to client). */
export async function POST(_req: Request, { params }: RouteParams) {
  try {
    const session = await requireRole(["IT Admin", "System Admin"]);
    if (session instanceof Response) return session;

    if (!isEncryptionConfigured()) {
      return NextResponse.json(
        { ok: false, error: "CONNECTION_ENCRYPTION_KEY is not configured" },
        { status: 503 },
      );
    }

    const { id: idStr } = await params;
    const id = Number(idStr);
    if (!id) {
      return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
    }

    const result = await refreshBcConnectionToken(id);
    return NextResponse.json({ ok: true, data: result });
  } catch (err) {
    console.error("[api/settings/bc-connections/[id]/token] POST", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
