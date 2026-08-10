import { NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";
import { APP_DB_CONNECTION_ID, isAppDbConnection } from "@/lib/db/app-connection";
import { isEncryptionConfigured } from "@/lib/db/connection-crypto";
import { getDbConnectionById } from "@/lib/db/db-connection";
import { listConnectionDatabases } from "@/lib/db/list-databases";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: RouteParams) {
  try {
    const session = await requireRole(["IT Admin", "System Admin"]);
    if (session instanceof Response) return session;

    const { id: idStr } = await params;
    const id = Number(idStr);
    if (Number.isNaN(id) || id < APP_DB_CONNECTION_ID) {
      return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
    }

    if (isAppDbConnection(id)) {
      const databases = await listConnectionDatabases(id);
      return NextResponse.json({ ok: true, data: { databases } });
    }

    if (!isEncryptionConfigured()) {
      return NextResponse.json(
        { ok: false, error: "CONNECTION_ENCRYPTION_KEY is not configured" },
        { status: 503 },
      );
    }

    const row = await getDbConnectionById(id);
    if (!row || !row.IsActive) {
      return NextResponse.json({ ok: false, error: "Connection not found" }, { status: 404 });
    }

    const databases = await listConnectionDatabases(id);
    return NextResponse.json({ ok: true, data: { databases } });
  } catch (err) {
    console.error("[api/settings/connections/[id]/databases] GET", err);
    const message = err instanceof Error ? err.message : "Failed to list databases";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
