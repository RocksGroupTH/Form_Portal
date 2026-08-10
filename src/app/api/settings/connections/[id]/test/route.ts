import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";
import {
  recordConnectionTest,
  testMssqlConnection,
  testStoredConnectionWithOverrides,
  type TestConnectionInput,
} from "@/lib/db/db-connection";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/settings/connections/[id]/test
 * Test stored connection, or ad-hoc credentials in body before save.
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireRole(["IT Admin", "System Admin"]);
    if (session instanceof Response) return session;

    const { id: idStr } = await params;
    const id = Number(idStr);
    if (!id) {
      return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
    }

    const body = await req.json().catch(() => ({})) as Partial<TestConnectionInput>;

    let result: { ok: boolean; message: string };
    if (body.host && body.username && body.password) {
      result = await testMssqlConnection({
        host: body.host,
        port: body.port,
        databaseName: body.databaseName,
        username: body.username,
        password: body.password,
        encrypt: body.encrypt,
        trustServerCert: body.trustServerCert,
      });
      await recordConnectionTest(id, result.ok, result.message);
    } else if (body.host && body.username) {
      result = await testStoredConnectionWithOverrides(id, {
        host: body.host,
        port: body.port,
        databaseName: body.databaseName,
        username: body.username,
        encrypt: body.encrypt,
        trustServerCert: body.trustServerCert,
      });
    } else {
      result = await testStoredConnectionWithOverrides(id);
    }

    return NextResponse.json({ ok: true, data: result });
  } catch (err) {
    console.error("[api/settings/connections/[id]/test] POST", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
