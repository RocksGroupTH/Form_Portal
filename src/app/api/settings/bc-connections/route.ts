import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";
import { isEncryptionConfigured } from "@/lib/db/connection-crypto";
import { validateConnectionCode } from "@/lib/db/connection-code";
import {
  createBcConnection,
  listBcConnections,
  mapBcConnectionDbError,
  type BcConnectionInput,
} from "@/lib/bc/bc-connection";

export async function GET() {
  try {
    const session = await requireRole(["IT Admin", "System Admin"]);
    if (session instanceof Response) return session;

    const connections = await listBcConnections();
    return NextResponse.json({
      ok: true,
      data: {
        connections,
        encryptionConfigured: isEncryptionConfigured(),
      },
    });
  } catch (err) {
    console.error("[api/settings/bc-connections] GET", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

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

    const body = (await req.json()) as BcConnectionInput;
    const codeError = validateConnectionCode(body.code ?? "");
    if (codeError) {
      return NextResponse.json({ ok: false, error: codeError }, { status: 400 });
    }
    if (!body.name?.trim()) {
      return NextResponse.json({ ok: false, error: "Name is required" }, { status: 400 });
    }
    if (!body.oauthUrl?.trim()) {
      return NextResponse.json({ ok: false, error: "OAuth URL is required" }, { status: 400 });
    }
    if (!body.clientId?.trim()) {
      return NextResponse.json({ ok: false, error: "Client ID is required" }, { status: 400 });
    }
    if (!body.clientSecret?.trim()) {
      return NextResponse.json({ ok: false, error: "Client secret is required" }, { status: 400 });
    }
    if (!body.baseUrl?.trim()) {
      return NextResponse.json({ ok: false, error: "Base URL is required" }, { status: 400 });
    }

    const userId = Number(session.user?.id ?? 0);
    const connection = await createBcConnection(body, userId);
    return NextResponse.json({ ok: true, data: connection });
  } catch (err) {
    console.error("[api/settings/bc-connections] POST", err);
    const mapped = mapBcConnectionDbError(err);
    return NextResponse.json({ ok: false, error: mapped.message }, { status: mapped.status });
  }
}
