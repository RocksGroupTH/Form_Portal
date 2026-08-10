import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { listMyRequests, saveDraft } from "@/lib/acc/request-service";
import type { SaveInput } from "@/lib/acc/request-service";
import { resolveLoginEmail } from "@/lib/auth-email";

/* ── GET /api/request/accounting/requests ── */

export async function GET(_req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const data = await listMyRequests(Number(session.user.id));
  return NextResponse.json({ ok: true, data });
}

/* ── POST /api/request/accounting/requests ── */

export async function POST(req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  try {
    const body = (await req.json()) as SaveInput;
    const loginEmail = resolveLoginEmail(session.user, null, { email: session.user.email }) ?? "";
    const id = await saveDraft(body, Number(session.user.id), loginEmail);
    return NextResponse.json({ ok: true, data: { id } });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
