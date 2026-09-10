import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { getRequest } from "@/lib/acc/request-service";
import { authorizeAccRequest } from "@/lib/acc/request-acl";
import { AP1_FORM_CODE } from "@/features/accounting/constants";
import { getADUserByEmail, getADUserPhoto } from "@/lib/graph";

/* ── GET /api/request/accounting/requests/[id]/people ──
   Enrich requester + manager with AD photo / name / title (by their stored emails).

   **`authorizeAccRequest` before anything is read.** Until 2026-09-10 this
   route called `requireAuth()` and stopped, so any signed-in session could walk
   small integers and collect who filed each travel claim and who approves it —
   name, job title and photograph. That is the gap the convention exists to
   close: `requireAuth()` proves *a* session, not a right to *this* record.

   Pinned to `AP1_FORM_CODE` too. `AccRequest` holds every form's header, and an
   unpinned route enriches AP-4 and AP-17 claims without their own rules ever
   running.

   "read", not "mutate": nothing here changes, and the reader is anyone the claim
   is already visible to. The UAT-tester barrier rides along, answering 404 so a
   UAT record's existence is not confirmed either.

   AP-4's copy was written this way from the start; this is the original brought
   into line. Guarded by `ap1-people-route-authz-guard.test.ts`. */

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

  const acl = await authorizeAccRequest(session, id, "read", AP1_FORM_CODE);
  if (acl instanceof Response) return acl;

  // The ACL row carries ids, not emails, so the addresses still come from the
  // claim itself — but only once the caller has been shown to be entitled to it.
  const req = await getRequest(id);
  if (!req) {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }

  const [reqUser, mgrUser] = await Promise.all([
    req.requesterEmail ? getADUserByEmail(req.requesterEmail).catch(() => null) : null,
    req.managerEmail ? getADUserByEmail(req.managerEmail).catch(() => null) : null,
  ]);
  const [reqPhoto, mgrPhoto] = await Promise.all([
    reqUser ? getADUserPhoto(reqUser.id).catch(() => null) : null,
    mgrUser ? getADUserPhoto(mgrUser.id).catch(() => null) : null,
  ]);

  return NextResponse.json({
    ok: true,
    data: {
      requester: { photoUrl: reqPhoto },
      manager: req.managerEmail
        ? {
            staffId: req.managerStaffId,
            fullName: mgrUser?.displayName ?? null,
            position: mgrUser?.jobTitle ?? null,
            email: req.managerEmail,
            photoUrl: mgrPhoto,
          }
        : null,
    },
  });
}
