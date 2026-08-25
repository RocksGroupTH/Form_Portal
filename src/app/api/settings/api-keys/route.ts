import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/api-auth";
import { isEncryptionConfigured } from "@/lib/db/connection-crypto";
import { createApiKey, importLegacyKey, listApiKeys } from "@/lib/api-keys/service";

/**
 * Settings → API Keys.
 *
 * **No response from this file ever carries a key value.** `listApiKeys`
 * returns a mask; there is no endpoint that reveals one. Changing a key means
 * writing a new value over it, never reading the old one back — which is also
 * why the edit form treats a blank KEY field as "leave it alone".
 */

/** GET — the registry, masked, plus whether saving is possible at all. */
export async function GET() {
  const session = await requireRole(["IT Admin", "System Admin"]);
  if (session instanceof Response) return session;
  try {
    const keys = await listApiKeys();
    return NextResponse.json({
      ok: true,
      // Reported rather than discovered on a failed save: without this the page
      // offers an Add button that can only ever answer with an error.
      data: { keys, encryptionReady: isEncryptionConfigured() },
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "error" },
      { status: 500 },
    );
  }
}

/** POST — add a key, or import one that still lives in the old store. */
export async function POST(req: NextRequest) {
  const session = await requireRole(["IT Admin", "System Admin"]);
  if (session instanceof Response) return session;
  try {
    const body = (await req.json()) as {
      action?: "import";
      code?: string;
      name?: string;
      value?: string;
      expiresAt?: string | null;
    };

    // Importing exists because the value is only ever shown masked: an admin
    // moving Google Maps or OpenRouteService onto this page by hand would have
    // to already know the key, and generally does not. The value is read and
    // re-encrypted server-side and never passes through the browser.
    if (body.action === "import") {
      const moved = await importLegacyKey(
        body.code ?? "",
        body.name?.trim() || (body.code ?? ""),
        Number(session.user.id),
      );
      return NextResponse.json({ ok: true, data: { imported: moved } });
    }

    const id = await createApiKey(
      {
        code: body.code ?? "",
        name: body.name ?? "",
        secret: body.value ?? "",
        // "Non expiry" is the absence of a date, not a flag beside one.
        expiresAt: body.expiresAt?.trim() || null,
      },
      Number(session.user.id),
    );
    return NextResponse.json({ ok: true, data: { id } });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "error" },
      { status: 400 },
    );
  }
}
