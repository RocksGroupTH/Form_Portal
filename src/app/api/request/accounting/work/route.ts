import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { listMyWorkRows } from "@/lib/acc/report-service";
import { buildAccActor } from "@/lib/acc/actor-context";
import { sweepStaleRequests } from "@/lib/acc/stale-request-sweep";
import {
  shouldRunSweep,
  OPPORTUNISTIC_SWEEP_MIN_INTERVAL_MS,
} from "@/lib/acc/stale-sweep-schedule";

/* ── GET /api/request/accounting/work — requests I have a part in approving ── */

/**
 * When this process last started an opportunistic stale-request sweep.
 *
 * In-process, like `auth.ts`'s jwt cache: a second instance keeps its own, and
 * may sweep in the same window. That costs a duplicated scan, never a
 * duplicated cancel — the cancel is a conditional UPDATE whose loser matches no
 * rows.
 */
let lastSweepStartedAt: number | null = null;

/**
 * The opportunistic half of AP-1's auto-cancel (`stale-request-sweep.ts`); the
 * other half is `POST .../expire-stale`, for a scheduler.
 *
 * **Why this route.** It is the manager's own queue — the page that lists what
 * they have not actioned, which is precisely the inaction being corrected, so a
 * request that expires disappears from the very list the caller is loading. It
 * is on the nav, so it is hit reliably rather than only when somebody opens one
 * particular record, and it is already the app's heaviest cross-database read
 * (`queryBothPools`), so a sweep that also walks both databases adds a
 * proportionally small amount rather than doubling a cheap endpoint. The
 * alternatives were rejected for the opposite reasons: `requests/[id]` is per
 * record and far hotter, and Home's availability read is hit by people with no
 * stake in an AP-1 approval.
 *
 * **It is throttled**, so "hit regularly" does not become "on every page load":
 * `shouldRunSweep` allows one sweep per process per
 * OPPORTUNISTIC_SWEEP_MIN_INTERVAL_MS. A request that has waited a month will
 * still be waiting in ten minutes.
 *
 * **It is fire-and-forget and swallows everything**, the shape every
 * post-action `void processQueue().catch(() => {})` uses. Housekeeping must
 * never be able to fail somebody's queue: the response does not wait for it and
 * does not change because of it.
 */
function sweepStaleInBackground(): void {
  const now = Date.now();
  if (!shouldRunSweep(lastSweepStartedAt, now, OPPORTUNISTIC_SWEEP_MIN_INTERVAL_MS)) return;
  // Recorded at start, not completion, so a slow run is not re-entered.
  lastSweepStartedAt = now;
  void sweepStaleRequests().catch(() => {});
}

export async function GET(_req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  try {
    const actor = await buildAccActor(Number(session.user.id), session.user.email ?? null);
    const data = await listMyWorkRows(actor.staffId, session.user.email ?? null);
    sweepStaleInBackground();
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("[api/request/accounting/work] GET", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
