import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { getRequest, saveDraft, deleteDraft } from "@/lib/clr/clear-advance-request-service";
import type { ClearAdvanceSaveInput } from "@/features/clear-advance/types";
import { resolveLoginEmail } from "@/lib/auth-email";
import { authorizeAccRequest } from "@/lib/acc/request-acl";
import { AP3_FORM_CODE } from "@/features/clear-advance/constants";

/* ── GET /api/request/clear-advance/requests/[id] ── */

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const { id: rawId } = await params;
  const id = Number(rawId);
  if (Number.isNaN(id)) {
    return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
  }

  // The record carries the settled advance, every expense line and the payee's
  // banking detail. `requireAuth()` alone let any signed-in session read all of
  // it by guessing a small integer. Pinned to AP-3, which is also what
  // `getRequest` scopes to.
  const gate = await authorizeAccRequest(session, id, "read", AP3_FORM_CODE);
  if (gate instanceof Response) return gate;

  try {
    const req = await getRequest(id);
    if (!req) {
      return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, data: req });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error";
    console.error("[api/request/clear-advance/requests/[id]] GET", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

/* ── PUT /api/request/clear-advance/requests/[id] ── */

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const { id: rawId } = await params;
  const id = Number(rawId);
  if (Number.isNaN(id)) {
    return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
  }

  // Creator + Draft/Returned, before the body is read. `saveDraft` asserts the
  // same two things inside its transaction and still does; this moves the
  // refusal in front of the JSON parse and answers 403 rather than 400.
  const gate = await authorizeAccRequest(session, id, "mutate", AP3_FORM_CODE);
  if (gate instanceof Response) return gate;

  try {
    const body = (await req.json()) as ClearAdvanceSaveInput;
    body.id = id;
    const loginEmail = resolveLoginEmail(session.user, null, { email: session.user.email }) ?? "";
    await saveDraft(body, Number(session.user.id), loginEmail);
    return NextResponse.json({ ok: true, data: { id } });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}

/* ── DELETE /api/request/clear-advance/requests/[id] — remove an editable draft ── */

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const { id: rawId } = await params;
  const id = Number(rawId);
  if (Number.isNaN(id)) {
    return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
  }

  // `deleteDraft` cascades through six tables. The gate runs before any of it.
  const gate = await authorizeAccRequest(session, id, "mutate", AP3_FORM_CODE);
  if (gate instanceof Response) return gate;

  try {
    await deleteDraft(id, Number(session.user.id));
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
