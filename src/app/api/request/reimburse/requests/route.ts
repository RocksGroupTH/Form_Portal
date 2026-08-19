import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { saveReimburseDraft } from "@/lib/acc/reimburse/request-service";
import { listActiveRules } from "@/lib/acc/reimburse/settings-service";
import { authorizeAccRequest } from "@/lib/acc/request-acl";
import { statusForAccError } from "@/lib/acc/request-errors";
import {
  AP4_FORM_CODE,
  RULE_ACK_UNKNOWN_ERROR,
  unknownRuleAckIds,
} from "@/features/reimburse/constants";
import type { SaveInput } from "@/features/reimburse/types";

/**
 * Rule ids, coerced at the boundary.
 *
 * `persistRuleAcks` filters on `Number.isFinite(n)`, which does not coerce, so
 * a JSON body of `["1","2"]` — what a checkbox group serialises to without
 * care — silently acknowledges nothing. The requester then ticks every box,
 * saves, submits, and is told to tick every box. The service is deliberately
 * strict rather than lenient; converting is this layer's job, because this is
 * where untrusted JSON stops being untrusted.
 */
function coerceRuleAckIds(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const out: number[] = [];
  for (const v of raw) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) out.push(n);
  }
  return out;
}

/* ── POST /api/request/reimburse/requests — create or update an AP-4 draft ── */

export async function POST(req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  let body: SaveInput;
  try {
    body = (await req.json()) as SaveInput;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });
  }

  // Updating an existing draft reaches an AccRequest by id, so it goes through
  // the object ACL like every other such path — `requireAuth()` proves a
  // session, not a right to this record. The service checks creator and status
  // too; this adds the UAT tester barrier and its 404, and refuses before any
  // HR lookup rather than inside the write transaction.
  const existingId = Number(body?.id ?? 0);
  if (existingId > 0) {
    const gate = await authorizeAccRequest(session, existingId, "mutate", AP4_FORM_CODE);
    if (gate instanceof Response) return gate;
  }

  try {
    const ackedRuleIds = coerceRuleAckIds(body?.ackedRuleIds);
    // Checked here, before the save transaction, because the alternative is the
    // FK answering — and it answers with an English constraint violation and a
    // 500. A deactivated rule does not violate it at all, so this is the only
    // layer that can refuse one. See `unknownRuleAckIds`.
    if (ackedRuleIds.length > 0) {
      const active = await listActiveRules();
      const unknown = unknownRuleAckIds(ackedRuleIds, active.map((r) => r.id));
      if (unknown.length > 0) {
        return NextResponse.json({ ok: false, error: RULE_ACK_UNKNOWN_ERROR }, { status: 400 });
      }
    }

    const input: SaveInput = { ...body, ackedRuleIds };
    const id = await saveReimburseDraft(input, Number(session.user.id));
    return NextResponse.json({ ok: true, data: { id } });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error";
    return NextResponse.json({ ok: false, error: message }, { status: statusForAccError(e) });
  }
}
