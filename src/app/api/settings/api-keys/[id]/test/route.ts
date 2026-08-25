import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/api-auth";
import { getApiKeySecret } from "@/lib/api-keys/service";
import { testApiKeyConnection } from "@/lib/api-keys/test-connection";

/**
 * POST — call the provider with this row's key and report whether it worked.
 *
 * The response says only whether the call succeeded and why not. It carries no
 * part of the key, like every other endpoint in this area.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(["IT Admin", "System Admin"]);
  if (session instanceof Response) return session;

  const { id: raw } = await params;
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id <= 0) {
    return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
  }

  try {
    const found = await getApiKeySecret(id);
    if (!found) return NextResponse.json({ ok: false, error: "ไม่พบ API key นี้" }, { status: 404 });

    const result = await testApiKeyConnection(found.code, found.value);
    // 200 either way: "the key is rejected" is a successful test, not a broken
    // request, and the client shows the message rather than an error toast.
    return NextResponse.json({ ok: true, data: result });
  } catch (e) {
    // Only reached when the row itself could not be read — a wrong
    // CONNECTION_ENCRYPTION_KEY, most likely.
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "ทดสอบไม่สำเร็จ" },
      { status: 500 },
    );
  }
}
