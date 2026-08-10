import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";
import { env } from "@/env";
import { isEncryptionConfigured } from "@/lib/db/connection-crypto";
import {
  createDbConnection,
  listDbConnections,
  mapConnectionDbError,
  validateConnectionCode,
  type ConnectionInput,
} from "@/lib/db/db-connection";
/**
 * GET /api/settings/connections
 * List all external DB connections (passwords never returned).
 */
export async function GET() {
  try {
    const session = await requireRole(["IT Admin", "System Admin"]);
    if (session instanceof Response) return session;

    const connections = await listDbConnections();
    return NextResponse.json({
      ok: true,
      data: {
        connections,
        encryptionConfigured: isEncryptionConfigured(),
        appMssql: {
          host: env.MSSQL_HOST,
          port: env.MSSQL_PORT,
          coreDatabase: env.MSSQL_CORE_DATABASE,
          formDatabase: env.MSSQL_FORM_DATABASE,
          dataDatabase: env.MSSQL_DATA_DATABASE,
        },
      },
    });
  } catch (err) {
    console.error("[api/settings/connections] GET", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

/**
 * POST /api/settings/connections
 * Create a new external DB connection.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireRole(["IT Admin", "System Admin"]);
    if (session instanceof Response) return session;

    if (!isEncryptionConfigured()) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "CONNECTION_ENCRYPTION_KEY is not configured. Add it to .env.local (openssl rand -base64 32)",
        },
        { status: 503 },
      );
    }

    const body = (await req.json()) as ConnectionInput;
    const codeError = validateConnectionCode(body.code ?? "");
    if (codeError) {
      return NextResponse.json({ ok: false, error: codeError }, { status: 400 });
    }
    if (!body.name?.trim()) {
      return NextResponse.json({ ok: false, error: "Name is required" }, { status: 400 });
    }
    if (!body.host?.trim()) {
      return NextResponse.json({ ok: false, error: "Host is required" }, { status: 400 });
    }
    if (!body.username?.trim()) {
      return NextResponse.json({ ok: false, error: "Username is required" }, { status: 400 });
    }
    if (!body.password) {
      return NextResponse.json({ ok: false, error: "Password is required" }, { status: 400 });
    }

    const userId = Number(session.user?.id ?? 0);
    const connection = await createDbConnection(body, userId);
    return NextResponse.json({ ok: true, data: connection });
  } catch (err) {
    console.error("[api/settings/connections] POST", err);
    const mapped = mapConnectionDbError(err);
    return NextResponse.json({ ok: false, error: mapped.message }, { status: mapped.status });
  }
}
