import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { saveDraft } from "@/lib/adv/advance-request-service";
import type { AdvanceSaveInput } from "@/features/advance/types";
import { resolveLoginEmail } from "@/lib/auth-email";

/* ── POST /api/request/advance/requests — create a draft ── */
export async function POST(req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  try {
    const body = (await req.json()) as AdvanceSaveInput;
    const loginEmail = resolveLoginEmail(session.user, null, { email: session.user.email }) ?? "";
    const id = await saveDraft(body, Number(session.user.id), loginEmail);
    return NextResponse.json({ ok: true, data: { id } });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
