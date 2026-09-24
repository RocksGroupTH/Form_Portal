import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { getProductionFormPool, getUatFormPool } from "@/lib/db/mssql";
import { loadStepApprovers } from "@/lib/acc/step-approvers-load";
import type { StepApproverPayload } from "@/lib/acc/step-approvers";

/**
 * GET /api/request/accounting/step-approvers
 *
 * Who may approve a request sitting on a pool step, for the `รออนุมัติโดย`
 * tooltip on My Requests and My Work. See `step-approvers.ts` for the matching
 * rule and `step-approvers-load.ts` for how each of the five rosters is read.
 *
 * ## It is `requireAuth`, and that IS new reach — named rather than buried
 *
 * Before this, an ordinary requester could not see who the accounting approvers
 * of a form were. They can now, by hovering a row of their own. The user was
 * asked directly on 2026-09-24 and chose it, and chose **names only** over
 * names and addresses, which is why nothing here selects an email.
 *
 * What bounds it: active roster members only, of the five Accounting forms, as
 * display names — the same names those people already appear under on every
 * approval timeline the requester can open for their own requests. It grants
 * nothing; every action path re-decides its own authority.
 *
 * ## Both databases, keyed by environment
 *
 * `AccApprover`, `AccBookingApprover` and `AccReimburseApprover` are in
 * `MASTER_TABLES` and so identical in both, but `AccAdvanceApprover` and
 * `AccClearAdvanceApprover` are not and may genuinely differ. The lists this
 * feeds are merged from both databases by `query-both.ts` and every row carries
 * its own `environment`, so answering per environment costs one field and
 * removes the question. One database failing does not fail the other.
 */
export async function GET() {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  try {
    const [prod, uat] = await Promise.all([getProductionFormPool(), getUatFormPool()]);
    const settled = await Promise.allSettled([loadStepApprovers(prod), loadStepApprovers(uat)]);
    const data: Record<string, unknown> = {};
    const names = ["Production", "UAT"] as const;
    settled.forEach((s, i) => {
      if (s.status === "fulfilled") data[names[i]] = s.value;
      else console.error(`[api/request/accounting/step-approvers] ${names[i]} failed`, s.reason);
    });
    return NextResponse.json({ ok: true, data: data as StepApproverPayload });
  } catch (err) {
    console.error("[api/request/accounting/step-approvers] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
