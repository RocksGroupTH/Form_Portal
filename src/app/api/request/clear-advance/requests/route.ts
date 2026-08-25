import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { saveDraft, listMyDrafts } from "@/lib/clr/clear-advance-request-service";
import type { ClearAdvanceSaveInput } from "@/features/clear-advance/types";
import { resolveLoginEmail } from "@/lib/auth-email";

/* ── GET /api/request/clear-advance/requests — editable AP-3 drafts ── */

export async function GET(_req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const data = await listMyDrafts(Number(session.user.id));
  return NextResponse.json({ ok: true, data });
}

/* ── POST /api/request/clear-advance/requests — create a draft ── */

export async function POST(req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  try {
    const body = (await req.json()) as ClearAdvanceSaveInput;
    const loginEmail = resolveLoginEmail(session.user, null, { email: session.user.email }) ?? "";
    const id = await saveDraft(body, Number(session.user.id), loginEmail);
    return NextResponse.json({ ok: true, data: { id } });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
