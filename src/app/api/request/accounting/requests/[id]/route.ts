import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { getRequest, saveDraft, deleteDraft } from "@/lib/acc/request-service";
import type { SaveInput } from "@/lib/acc/request-service";
import { resolveLoginEmail } from "@/lib/auth-email";
import { authorizeAccRequest } from "@/lib/acc/request-acl";
import { statusForAccError } from "@/lib/acc/request-errors";
import { AP1_FORM_CODE } from "@/features/accounting/constants";

/* ── GET /api/request/accounting/requests/[id] ── */

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

  // The record carries the requester's name, department, travel detail, amounts
  // and the ids of their attachments, and the id is a small sequential integer.
  // Authorize the object before reading it, not just the session.
  //
  // Pinned to AP-1 like its five siblings: `AccRequest` holds every form, so an
  // AP-4 or AP-17 id was authorized here and then read by `getRequest`, which
  // finds no `AccTravelExpense` row and answers 404 — the right status by
  // accident rather than by rule. The pin makes the invariant those five
  // comments assert actually uniform.
  const gate = await authorizeAccRequest(session, id, "read", AP1_FORM_CODE);
  if (gate instanceof Response) return gate;

  try {
    const req = await getRequest(id);
    if (!req) {
      return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, data: req });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error";
    console.error("[api/request/accounting/requests/[id]] GET", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

/* ── PUT /api/request/accounting/requests/[id] ── */

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

  // The object ACL, which this route did not call at all. It adds two things
  // `saveDraft`'s own creator + `Draft`/`Returned` checks cannot: the UAT tester
  // barrier, and the form pin — without which a Draft the caller created under
  // AP-4 or AP-17 was rewritten here through AP-1's `resolveRequesterForActor`,
  // with `TotalAmount` replaced by AP-1's sum. On an AP-1 row owned by the
  // caller and still editable the verdict is `{ ok: true }`, so nothing that
  // used to succeed stops succeeding.
  // Inside the `try`, not in front of it. `authorizeAccRequest` reaches
  // `Rocks_Portal_HR` for the manager chain, so an HR outage **throws** out of
  // the gate rather than returning a Response — and outside the try that reaches
  // the client as a bare 500 with no `{ ok, error }` envelope, which the form
  // reports as "บันทึกไม่สำเร็จ" with no reason at all.
  try {
    const gate = await authorizeAccRequest(session, id, "mutate", AP1_FORM_CODE);
    if (gate instanceof Response) return gate;

    const body = (await req.json()) as SaveInput;
    body.id = id;
    const loginEmail = resolveLoginEmail(session.user, null, { email: session.user.email }) ?? "";
    await saveDraft(body, Number(session.user.id), loginEmail);
    return NextResponse.json({ ok: true, data: { id } });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error";
    // 400 for anything unrecognised, as before; 403/409 for the two error
    // classes that carry their own status, which collapsing to 400 turns into
    // the dialog's retryable phase.
    return NextResponse.json({ ok: false, error: message }, { status: statusForAccError(e) });
  }
}

/* ── DELETE /api/request/accounting/requests/[id] — remove an editable draft ── */

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

  // Same gate as PUT, and here it is the one standing between an AP-4 draft and
  // a cascading delete of `AccReimburse` / `AccReimburseItem` logged as an AP-1
  // deleteDraft. `deleteDraft` is pinned to `AP1_FORM_CODE` as well, so the two
  // agree rather than one relying on the other.
  // Inside the `try` for the reason PUT gives above.
  try {
    const gate = await authorizeAccRequest(session, id, "mutate", AP1_FORM_CODE);
    if (gate instanceof Response) return gate;

    await deleteDraft(id, Number(session.user.id));
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error";
    return NextResponse.json({ ok: false, error: message }, { status: statusForAccError(e) });
  }
}
