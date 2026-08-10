import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";
import { isEncryptionConfigured } from "@/lib/db/connection-crypto";
import { validateConnectionCode } from "@/lib/db/connection-code";
import {
  deleteBcConnection,
  getBcConnectionById,
  mapBcConnectionDbError,
  mapBcPublic,
  updateBcConnection,
  type BcConnectionInput,
} from "@/lib/bc/bc-connection";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireRole(["IT Admin", "System Admin"]);
    if (session instanceof Response) return session;

    const { id: idStr } = await params;
    const id = Number(idStr);
    if (!id) {
      return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
    }

    const row = await getBcConnectionById(id);
    if (!row) {
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, data: mapBcPublic(row) });
  } catch (err) {
    console.error("[api/settings/bc-connections/[id]] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireRole(["IT Admin", "System Admin"]);
    if (session instanceof Response) return session;

    const body = (await req.json()) as BcConnectionInput;
    const codeError = validateConnectionCode(body.code ?? "");
    if (codeError) {
      return NextResponse.json({ ok: false, error: codeError }, { status: 400 });
    }

    if (body.clientSecret && !isEncryptionConfigured()) {
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
    const connection = await updateBcConnection(id, body, userId);
    if (!connection) {
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, data: connection });
  } catch (err) {
    console.error("[api/settings/bc-connections/[id]] PATCH", err);
    const mapped = mapBcConnectionDbError(err);
    return NextResponse.json({ ok: false, error: mapped.message }, { status: mapped.status });
  }
}

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
    const deleted = await deleteBcConnection(id, userId);
    if (!deleted) {
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/settings/bc-connections/[id]] DELETE", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
