import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";
import { isEncryptionConfigured } from "@/lib/db/connection-crypto";
import {
  deleteDbConnection,
  getDbConnectionById,
  mapConnectionDbError,
  toPublicConnection,
  updateDbConnection,
  validateConnectionCode,
  type ConnectionInput,
} from "@/lib/db/db-connection";
import { invalidateExternalPool } from "@/lib/db/external-pool";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * GET /api/settings/connections/[id]
 */
export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireRole(["IT Admin", "System Admin"]);
    if (session instanceof Response) return session;

    const { id: idStr } = await params;
    const id = Number(idStr);
    if (!id) {
      return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
    }

    const row = await getDbConnectionById(id);
    if (!row) {
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, data: toPublicConnection(row) });
  } catch (err) {
    console.error("[api/settings/connections/[id]] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

/**
 * PATCH /api/settings/connections/[id]
 */
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireRole(["IT Admin", "System Admin"]);
    if (session instanceof Response) return session;

    const body = (await req.json()) as ConnectionInput;
    const codeError = validateConnectionCode(body.code ?? "");
    if (codeError) {
      return NextResponse.json({ ok: false, error: codeError }, { status: 400 });
    }
    if (body.password && !isEncryptionConfigured()) {
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

    const userId = Number(session.user?.id ?? 0);
    const connection = await updateDbConnection(id, body, userId);
    if (!connection) {
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    }

    invalidateExternalPool(id);
    return NextResponse.json({ ok: true, data: connection });
  } catch (err) {
    console.error("[api/settings/connections/[id]] PATCH", err);
    const mapped = mapConnectionDbError(err);
    return NextResponse.json({ ok: false, error: mapped.message }, { status: mapped.status });
  }
}

/**
 * DELETE /api/settings/connections/[id] — soft delete (IsActive = 0)
 */
export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireRole(["IT Admin", "System Admin"]);
    if (session instanceof Response) return session;

    const { id: idStr } = await params;
    const id = Number(idStr);
    if (!id) {
      return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
    }

    const userId = Number(session.user?.id ?? 0);
    const deleted = await deleteDbConnection(id, userId);
    if (!deleted) {
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    }

    invalidateExternalPool(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/settings/connections/[id]] DELETE", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
