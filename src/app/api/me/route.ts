import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { resolveLoginEmail } from "@/lib/auth-email";
import { normalizeRole, isAdminRole } from "@/lib/roles";
import { findTeamMemberForLogin } from "@/lib/team-member-lookup";

/**
 * GET /api/me — current user + DB role (source of truth for admin UI)
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const loginEmail = resolveLoginEmail(
    session.user,
    null,
    { email: session.user.email },
  );

  if (!loginEmail) {
    return NextResponse.json({
      ok: true,
      data: {
        email: null,
        sessionRole: normalizeRole(session.user.role),
        dbRole: null,
        effectiveRole: normalizeRole(session.user.role),
        isActive: null,
        isAdmin: false,
        teamMemberFound: false,
        error: "No email on session — sign out and sign in again",
      },
    });
  }

  const member = await findTeamMemberForLogin(loginEmail);
  const dbRole = member ? normalizeRole(member.AppRole) : null;
  const sessionRole = normalizeRole(session.user.role);
  const effectiveRole = dbRole ?? sessionRole;

  return NextResponse.json({
    ok: true,
    data: {
      email: loginEmail,
      teamMemberEmail: member?.Email ?? null,
      sessionRole,
      dbRole,
      effectiveRole,
      isActive: member?.IsActive ?? null,
      isAdmin: isAdminRole(effectiveRole) && (member?.IsActive !== false),
      teamMemberFound: !!member,
    },
  });
}
