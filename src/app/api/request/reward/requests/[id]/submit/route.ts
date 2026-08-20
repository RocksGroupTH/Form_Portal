import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { resolveLoginEmail } from "@/lib/auth-email";
import { authorizeAccRequest } from "@/lib/acc/request-acl";
import { statusForAccError } from "@/lib/acc/request-errors";
import { submitRewardRequest } from "@/lib/acc/reward/request-service";
import { AP11_FORM_CODE } from "@/features/reward/constants";

/* ── POST /api/request/reward/requests/[id]/submit ── */

/**
 * Submitting takes stock, so the two ways this can fail are worth telling
 * apart, and `statusForAccError` does it:
 *
 * - **409** — somebody else took the last of it, or this draft was already
 *   submitted. The client must reload; a retry cannot succeed.
 * - **400** — the request itself is not ready (no reward chosen, no evidence
 *   attached, no manager in HR). Fixable in place.
 *
 * Answering 400 for both, as these routes used to, puts a retry button in front
 * of a person whose request can never go through.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
  }

  // Creator, and Draft/Returned only — the same gate the draft save uses.
  const gate = await authorizeAccRequest(session, id, "mutate", AP11_FORM_CODE);
  if (gate instanceof Response) return gate;

  try {
    const loginEmail = resolveLoginEmail(session.user, null, { email: session.user.email });
    const data = await submitRewardRequest(id, Number(session.user.id), loginEmail);
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("[api/request/reward/requests/[id]/submit] POST", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ ok: false, error: message }, { status: statusForAccError(err) });
  }
}
