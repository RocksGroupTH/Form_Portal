import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { getRequest, saveDraft, deleteDraft } from "@/lib/adv/advance-request-service";
import type { AdvanceSaveInput } from "@/features/advance/types";
import { resolveLoginEmail } from "@/lib/auth-email";

function parseId(rawId: string): number | null {
  const id = Number(rawId);
  return Number.isNaN(id) ? null : id;
}

/* ── GET /api/request/advance/requests/[id] ── */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const { id: rawId } = await params;
  const id = parseId(rawId);
  if (id === null) return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });

  try {
    const req = await getRequest(id);
    if (!req) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    return NextResponse.json({ ok: true, data: req });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error";
    console.error("[api/request/advance/requests/[id]] GET", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

/* ── PUT /api/request/advance/requests/[id] — update a draft ── */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const { id: rawId } = await params;
  const id = parseId(rawId);
  if (id === null) return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });

  try {
    const body = (await req.json()) as AdvanceSaveInput;
    body.id = id;
    const loginEmail = resolveLoginEmail(session.user, null, { email: session.user.email }) ?? "";
    await saveDraft(body, Number(session.user.id), loginEmail);
    return NextResponse.json({ ok: true, data: { id } });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}

/* ── DELETE /api/request/advance/requests/[id] — remove an editable draft ── */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const { id: rawId } = await params;
  const id = parseId(rawId);
  if (id === null) return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });

  try {
    await deleteDraft(id, Number(session.user.id));
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
