import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";
import { sweepStaleRequests } from "@/lib/acc/stale-request-sweep";

/**
 * POST /api/request/accounting/expire-stale
 *
 * Cancels every AP-1 request still sitting on the manager's step more than a
 * month after it was submitted, in BOTH form databases — a request submitted in
 * UAT lives in the UAT database, which a production-scoped sweep would never
 * see. Same shape as `email/process`, and for the same reason.
 *
 * Guard:
 *   - A valid CRON_SECRET header bypasses the role check, for a scheduled job.
 *   - Otherwise IT Admin or System Admin.
 *
 * **`CRON_SECRET` is deliberately not in `src/env.ts`.** That file validates
 * the whole environment at import time, so requiring it would take the app down
 * wherever it is unset — which is everywhere today. Unset, the comparison is
 * `header !== undefined`: a caller that sends no header gets `null !==
 * undefined`, and one that sends any string gets that string `!== undefined`.
 * Both are true, so the bypass simply never opens and every caller falls
 * through to `requireRole`. Keep that shape — a `==` here, or a truthiness
 * check on the header, would turn an unconfigured secret into an open endpoint.
 */
export async function POST(req: NextRequest) {
  const cronSecret = req.headers.get("x-cron-secret");
  if (cronSecret !== process.env.CRON_SECRET) {
    const session = await requireRole(["IT Admin", "System Admin"]);
    if (session instanceof Response) return session;
  }

  try {
    const result = await sweepStaleRequests();
    return NextResponse.json({ ok: true, data: result });
  } catch (err) {
    console.error("[api/request/accounting/expire-stale] POST", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
