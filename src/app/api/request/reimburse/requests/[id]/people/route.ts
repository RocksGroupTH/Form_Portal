import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { authorizeAccRequest } from "@/lib/acc/request-acl";
import { getADUserByEmail, getADUserPhoto } from "@/lib/graph";
import { getReimburseContactEmails } from "@/lib/acc/reimburse/request-service";
import { AP4_FORM_CODE } from "@/features/reimburse/constants";

/**
 * GET /api/request/reimburse/requests/[id]/people
 *
 * The requester's and the manager's Entra photo, display name and job title for
 * one AP-4 claim, so the detail view can put faces on the ผู้ขอเบิก card. The
 * claim stores the two emails; everything else here comes from the directory.
 *
 * **`authorizeAccRequest` first, which AP-1's otherwise-identical route does
 * not do.** `/api/request/accounting/requests/[id]/people` calls `requireAuth()`
 * and nothing else, so any signed-in session can walk small integers and collect
 * who filed each claim and who approves it. That is the gap the convention
 * exists to close — `requireAuth()` proves *a* session, not a right to *this*
 * record — and this copy was written with the check rather than without it.
 * Pinned to `AP4_FORM_CODE` too: `AccRequest` holds every form's header, and an
 * unpinned route would enrich AP-1 and AP-17 claims without their own rules
 * ever running. Guarded by `people-route-authz-guard.test.ts`.
 *
 * "read", not "mutate": this changes nothing, and the reader here is anyone the
 * claim is already visible to — owner, on-behalf requester, assigned manager or
 * the account area. The UAT-tester barrier rides along with it, answering 404
 * rather than 403 so a UAT record's existence is not confirmed either.
 *
 * Every directory lookup carries its own `catch`. A photo is decoration: Graph
 * being unreachable must leave the card rendering initials, not fail the panel
 * that shows the claim.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
  }

  const acl = await authorizeAccRequest(session, id, "read", AP4_FORM_CODE);
  if (acl instanceof Response) return acl;

  // The ACL row carries ids, not emails, so the addresses come from their own
  // read — two columns, not the whole claim: the panel calling this has already
  // loaded the items, their document lines and the attachments.
  const contacts = await getReimburseContactEmails(id);
  if (!contacts) {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }
  const { requesterEmail, managerEmail } = contacts;

  const [reqUser, mgrUser] = await Promise.all([
    requesterEmail ? getADUserByEmail(requesterEmail).catch(() => null) : null,
    managerEmail ? getADUserByEmail(managerEmail).catch(() => null) : null,
  ]);
  const [reqPhoto, mgrPhoto] = await Promise.all([
    reqUser ? getADUserPhoto(reqUser.id).catch(() => null) : null,
    mgrUser ? getADUserPhoto(mgrUser.id).catch(() => null) : null,
  ]);

  return NextResponse.json({
    ok: true,
    data: {
      requester: { photoUrl: reqPhoto },
      manager: managerEmail
        ? {
            fullName: mgrUser?.displayName ?? null,
            position: mgrUser?.jobTitle ?? null,
            email: managerEmail,
            photoUrl: mgrPhoto,
          }
        : null,
    },
  });
}
