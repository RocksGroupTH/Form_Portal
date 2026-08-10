import { auth } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import type { Session } from "next-auth";
import { normalizeRole } from "@/lib/roles";
import type { Role } from "@/lib/types";

export async function requireAuth(): Promise<Session | Response> {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return session;
}

export async function requireRole(
  allowedRoles: Role[],
): Promise<Session | Response> {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
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
