import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { getReimburseRequest } from "@/lib/acc/reimburse/request-service";
import { authorizeAccRequest } from "@/lib/acc/request-acl";
import { AP4_FORM_CODE } from "@/features/reimburse/constants";

/* ── GET /api/request/reimburse/requests/[id] ── */

export async function GET(
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

  // The record carries the requester's name, department, every line of what
  // they spent and the ids of their receipts, behind a small sequential
  // integer. Authorize the object before reading it, not just the session.
  // Pinned to AP-4: `AccRequest` holds every form, so an AP-1 id would
  // otherwise be authorized here and then read as a request that does not
  // exist. It answers 404, which is also the UAT barrier's answer.
  const gate = await authorizeAccRequest(session, id, "read", AP4_FORM_CODE);
  if (gate instanceof Response) return gate;

  try {
    const request = await getReimburseRequest(id);
    if (!request) {
      return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, data: request });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error";
    console.error("[api/request/reimburse/requests/[id]] GET", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
