import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { getRequest } from "@/lib/acc/request-service";
import { getADUserByEmail, getADUserPhoto } from "@/lib/graph";

/* ── GET /api/request/accounting/requests/[id]/people ──
   Enrich requester + manager with AD photo / name / title (by their stored emails). */

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
