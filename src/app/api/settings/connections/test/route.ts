import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";
import { testMssqlConnection, type TestConnectionInput } from "@/lib/db/db-connection";

/**
 * POST /api/settings/connections/test
 * Test connection credentials before saving (no stored id required).
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireRole(["IT Admin", "System Admin"]);
    if (session instanceof Response) return session;

    const body = (await req.json()) as TestConnectionInput;
    if (!body.host?.trim()) {
      return NextResponse.json({ ok: false, error: "Host is required" }, { status: 400 });
    }
    if (!body.username?.trim()) {
      return NextResponse.json({ ok: false, error: "Username is required" }, { status: 400 });
    }
    if (!body.password) {
      return NextResponse.json({ ok: false, error: "Password is required" }, { status: 400 });
    }

    const result = await testMssqlConnection(body);
    return NextResponse.json({ ok: true, data: result });
  } catch (err) {
    console.error("[api/settings/connections/test] POST", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
