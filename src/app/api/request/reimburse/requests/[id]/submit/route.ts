import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import {
  getReimburseRequest,
  submitReimburseRequest,
} from "@/lib/acc/reimburse/request-service";
import { processQueue } from "@/lib/acc/email-queue";
import { isSharePointConfigured, moveSharePointFolder } from "@/lib/sharepoint";
import { buildAccFolderPath, yearFromRequestNo } from "@/lib/acc/sharepoint-path";
import { resolveFormEnvironment } from "@/lib/form-environment";
import { authorizeAccRequest } from "@/lib/acc/request-acl";
import { statusForAccError } from "@/lib/acc/request-errors";
import { getAllowedBrands } from "@/lib/acc/brand-options";
import { AP4_FORM_CODE } from "@/features/reimburse/constants";

/**
 * Refused when the claim names a brand `AccFormBrand` does not grant AP-4.
 *
 * Deliberately does not echo the offending code back: it came from the caller,
 * and repeating it is how an error message becomes a reflected-content sink.
 */
const ERR_BRAND_NOT_ALLOWED =
  "แบรนด์ที่เลือกไม่อยู่ในรายการที่อนุญาตให้เบิกในแบบฟอร์ม AP-4 — กรุณาเลือกแบรนด์ใหม่";

/* ── POST /api/request/reimburse/requests/[id]/submit ── */

export async function POST(
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

  // Owner and editable state before anything else runs. The service's claim
  // also asserts `CreatedBy` inside its transaction, so this is the second of
  // two independent checks rather than the only one — but it is the one that
  // refuses before a manager is resolved out of HR, and the one that carries
  // the UAT tester barrier.
  const gate = await authorizeAccRequest(session, id, "mutate", AP4_FORM_CODE);
  if (gate instanceof Response) return gate;

  try {
    // `BrandCode` must be one `AccFormBrand` actually grants AP-4. Until this
    // ran, the rule lived only in the form's picker, and a client-enforced
    // invariant is not one: the draft routes accept whatever `brandCode` they
    // are handed, so a request written before the allowlist existed — or by
    // anything that is not this form — carries a BrandGate cookie value
    // matching zero rows. `getAllowedBrands` reads through `getAccPool()`, so
    // it asks the same database this request resolved to.
    //
    // Checked here rather than inside `validateReimburseForSubmit`: that
    // function's module is settled, and this is the only submit path. It runs
    // before the service so nothing is claimed, numbered or mailed first.
    //
    // Draft saves are deliberately left alone. Retaining a dropped code on a
    // resumed request is what stops a claim being silently re-pointed at a
    // different company; submitting on one is what is refused.
    //
    // Only a brand that is *set and not granted* is answered here. No brand at
    // all falls through to the service's own `ERR_NO_BRAND`, which reports it
    // alongside every other missing field in one round trip rather than sending
    // the requester back for one thing at a time.
    const current = await getReimburseRequest(id);
    if (current?.brandCode) {
      const allowed = await getAllowedBrands(AP4_FORM_CODE);
      if (!allowed.some((b) => b.brandCode === current.brandCode)) {
        return NextResponse.json(
          { ok: false, error: ERR_BRAND_NOT_ALLOWED },
          { status: 400 },
        );
      }
    }

    await submitReimburseRequest(id, Number(session.user.id));

    // The service queues the manager notification; nothing sends it. Without
    // this drain the mail sits in AccEmailQueue until some other action
    // happens to flush it, which on a quiet day is hours.
    void processQueue().catch(() => {});

    const request = await getReimburseRequest(id);

    // Move the draft's SharePoint folder into {year}/{requestNo}, best-effort,
    // exactly as AP-1's submit does — otherwise every AP-4 attachment stays
    // filed under `_DRAFT/{id}` forever. Both ends need the same environment: a
    // UAT draft's files went under `_UAT`, so a move computed against the
    // production tree would look for a folder that is not there.
    const requestNo = request?.requestNo ?? null;
    if (isSharePointConfigured() && requestNo) {
      const environment = await resolveFormEnvironment();
      const from = buildAccFolderPath({
        requestNo: null,
        requestId: id,
        year: null,
        formCode: AP4_FORM_CODE,
        environment,
      });
      const to = buildAccFolderPath({
        requestNo,
        requestId: id,
        year: yearFromRequestNo(requestNo),
        formCode: AP4_FORM_CODE,
        environment,
      });
      void moveSharePointFolder(from, to);
    }

    return NextResponse.json({ ok: true, data: request });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error";
    // The service throws named Thai validation messages (400), and
    // `AccConflictError` when the claim finds the row already submitted (409)
    // — the client should reload rather than be offered a retry that cannot
    // succeed. Collapsing both to 400 is what `statusForAccError` exists to
    // stop.
    return NextResponse.json({ ok: false, error: message }, { status: statusForAccError(e) });
  }
}
