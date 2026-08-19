import { auth } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import type { Session } from "next-auth";
import { isUsableUserId } from "@/lib/auth-identity";
import { normalizeRole } from "@/lib/roles";
import type { Role } from "@/lib/types";

/**
 * An email alone is not an identity here.
 *
 * `requireAuth()` used to gate on `session.user.email` only, which let through
 * the one session shape nothing in this application can actually serve: role
 * `Staff` with `user.id = ""`. `Number("")` is 0, so such a session owns no
 * `AccRequest`, matches no ownership check and stamps 0 or NULL into whatever it
 * writes — rows their own author can never see again. It was reachable in two
 * ways, both now closed at the source: the `signIn` catch that granted a session
 * when the roster and HR were both unreadable (`@/lib/auth`), and a form
 * database standing up from migration 059 without 066, which has no `TeamMember`
 * table at all.
 *
 * Tokens minted before that fix live for 30 days, so the check stays here as
 * well. A session that fails it is answered 401 and signs in again, which is the
 * outcome that actually repairs it.
 *
 * The jwt callback still clears `userId` for a *retired* row, and that is meant
 * to end in this refusal — the roster says the person has gone. It deliberately
 * does **not** clear it when the row is merely unreadable, so a form-database
 * outage costs the role but not the session; see the long comment there.
 */
function hasInternalUserId(session: Session | null): boolean {
  return isUsableUserId(session?.user?.id);
}

const UNAUTHORIZED = () =>
  NextResponse.json({ error: "Unauthorized" }, { status: 401 });

/**
 * No internal id is a different problem from no session, and saying so saves a
 * support round-trip: signing in again is the fix, and it is not obvious.
 */
const NO_IDENTITY = () =>
  NextResponse.json(
    {
      error:
        "Your account is not linked to a Form Portal user record. Sign out and sign in again; if it persists, ask a System Admin to check Settings → Users & Roles.",
    },
    { status: 401 },
  );

export async function requireAuth(): Promise<Session | Response> {
  const session = await auth();
  if (!session?.user?.email) return UNAUTHORIZED();
  if (!hasInternalUserId(session)) return NO_IDENTITY();
  return session;
}

export async function requireRole(
  allowedRoles: Role[],
): Promise<Session | Response> {
  const session = await auth();
  if (!session?.user?.email) return UNAUTHORIZED();
  if (!hasInternalUserId(session)) return NO_IDENTITY();
  const role = normalizeRole(session.user.role);
  if (!allowedRoles.includes(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return session;
}

export function withAuthHandler(
  handler: (req: NextRequest, session: Session) => Promise<Response>
): (req: NextRequest) => Promise<Response> {
  return async (req: NextRequest) => {
    const session = await requireAuth();
    if (session instanceof Response) return session;
    return handler(req, session);
  };
}
