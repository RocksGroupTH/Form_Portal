import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { authorizeAccRequest } from "@/lib/acc/request-acl";
import { AP2_FORM_CODE } from "@/features/advance/constants";
import { listAttempts } from "@/lib/adv/advance-erp-attempt-service";

/** GET — send-attempt history (ADV↔PV mapping) for one AP-2 request. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAuth();
  if (session instanceof Response) return session;
  const { id } = await params;
  const rid = Number(id);
  if (!Number.isFinite(rid)) {
    return NextResponse.json({ ok: false, error: "bad id" }, { status: 400 });
  }

  // The attempt history names the Business Central PV document a request became,
  // plus the error text of every failed send — it hangs off the request, so it
  // takes the request's own read ACL rather than `requireAuth()` alone.
  const gate = await authorizeAccRequest(session, rid, "read", AP2_FORM_CODE);
  if (gate instanceof Response) return gate;

  try {
    const data = await listAttempts(rid);
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}
