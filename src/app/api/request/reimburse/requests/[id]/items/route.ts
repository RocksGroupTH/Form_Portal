import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { authorizeAccRequest } from "@/lib/acc/request-acl";
import { buildAccActor } from "@/lib/acc/actor-context";
import { setReimburseItemAccounts } from "@/lib/acc/reimburse/approval-service";
import { statusForAccError } from "@/lib/acc/request-errors";
import { parseItemAccountEdits } from "@/lib/acc/reimburse/item-account-edits";
import { AP4_FORM_CODE } from "@/features/reimburse/constants";

/* ── PATCH /api/request/reimburse/requests/[id]/items ── */

/**
 * Accounting corrects the AI-proposed G/L account on one or more expense
 * lines, from the accounting queue (`ReimburseApprovalQueue.tsx`).
 *
 * **Added — no existing route accepted this.** `saveReimburseDraft` (the
 * route this would most obviously reuse, `POST .../requests`) is
 * creator-only and `Draft`/`Returned`-only by its own checks — `ownerRow.
 * CreatedBy !== userId` and the status test both throw before an accounting
 * user's edit would ever reach `AccReimburseItem`. The generic object ACL's
 * `mutate` mode (`decideRequestMutate`) is the same rule restated: creator
 * only, editable statuses only. Neither is the right shape for "the
 * currently-assigned accounting approver may correct one column on a claim
 * they do not own and did not create."
 *
 * So this is its own route, gated the way the brief asked: the SAME check
 * `approveReimburseAccountCheck` makes for this exact step — see
 * `setReimburseItemAccounts`'s own docblock for why that is narrower than
 * the "read" ACL below, and why the narrower one is the one that has to
 * apply here specifically. The layering matches every other by-id route in
 * this app: `authorizeAccRequest("read")` first (confirms the row exists,
 * pins it to AP-4, and applies the UAT-tester barrier with its 404), then
 * the roster check — `requireApproverStaffId`, via `setReimburseItemAccounts`
 * — in the service, **before** the transaction: the roster is configuration,
 * not a value that can be raced, so unlike the state predicate it needs no
 * lock. The state predicate itself — whether this claim is still at the step
 * that makes it accounting's to correct — IS claimed inside the transaction
 * that writes, the same way `claimStep` claims a real transition; see that
 * function's own docblock for why a bare read would not have been enough.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
  }

  const gate = await authorizeAccRequest(session, id, "read", AP4_FORM_CODE);
  if (gate instanceof Response) return gate;

  const body = (await req.json().catch(() => null)) as { items?: unknown } | null;
  const parsed = parseItemAccountEdits(body?.items);
  if (parsed.error !== null) {
    return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  }

  const actor = await buildAccActor(Number(session.user.id), session.user.email ?? null);

  try {
    const updated = await setReimburseItemAccounts(id, actor, parsed.edits);
    return NextResponse.json({ ok: true, data: { updated } });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error";
    return NextResponse.json({ ok: false, error: message }, { status: statusForAccError(e) });
  }
}
