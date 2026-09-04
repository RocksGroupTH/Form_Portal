import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/api-auth";
import { listApiKeyLog, setApiKeyActive, updateApiKey } from "@/lib/api-keys/service";

/** GET — one key's change history. Carries no part of any value, by design. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(["IT Admin", "System Admin"]);
  if (session instanceof Response) return session;
  const { id: raw } = await params;
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id <= 0) {
    return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
  }
  try {
    return NextResponse.json({ ok: true, data: { log: await listApiKeyLog(id) } });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "error" },
      { status: 500 },
    );
  }
}

/**
 * PATCH — rename, change the expiry, replace the value, or activate/deactivate.
 *
 * A blank or absent `value` keeps the stored key. That is not leniency: the
 * browser is never sent the current value, so "leave it alone" has to be
 * expressible without echoing the secret out and posting it back in.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(["IT Admin", "System Admin"]);
  if (session instanceof Response) return session;
  const { id: raw } = await params;
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id <= 0) {
    return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
  }
  try {
    const body = (await req.json()) as {
      name?: string;
      value?: string | null;
      expiresAt?: string | null;
      isActive?: boolean;
    };

    // Removal is deactivation — there is no hard delete, so a key's history can
    // never be destroyed by removing the key. See migration 116's header.
    if (typeof body.isActive === "boolean") {
      await setApiKeyActive(id, body.isActive, Number(session.user.id));
      return NextResponse.json({ ok: true });
    }

    await updateApiKey(
      id,
      {
        name: body.name ?? "",
        // `in` rather than a truthiness test: absent keeps the stored date,
        // an explicit null clears it, and "" from a cleared date input means
        // the same as null. Without this, a PATCH carrying only `name` wiped
        // the expiry with nothing on screen to show it had happened.
        expiresAt: "expiresAt" in body ? body.expiresAt?.trim() || null : undefined,
        secret: body.value ?? null,
      },
      Number(session.user.id),
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "error" },
      { status: 400 },
    );
  }
}
