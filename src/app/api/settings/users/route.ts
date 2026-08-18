import { NextRequest, NextResponse } from "next/server";
import { getADUserByEmail } from "@/lib/graph";
import { requireRole } from "@/lib/api-auth";
import { clearTeamMemberRoleCache } from "@/lib/auth";
import {
  addOrReactivate,
  isValidRole,
  listActive,
  setActive,
  updateFullName,
  updateRole,
} from "@/lib/team-member/service";

/**
 * GET /api/settings/users — active team members for the Users & Roles page.
 *
 * System Admin only, matching the UI: the Settings hub card is `systemAdminOnly`
 * and the page redirects anyone else away. Without this an IT Admin could still
 * read every user's name, email, and role straight from the endpoint.
 */
export async function GET() {
  try {
    const session = await requireRole(["System Admin"]);
    if (session instanceof Response) return session;

    const users = await listActive();

    return NextResponse.json({
      ok: true,
      data: {
        users: users.map((u) => ({
          id: u.id,
          name: u.fullName,
          nickname: u.nickname,
          email: u.email,
          role: u.appRole,
        })),
      },
    });
  } catch (err) {
    console.error("[api/settings/users] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/settings/users — actions: updateRole, addUser, deleteUser, resyncAll.
 *
 * The three actions that change who is who clear the role cache in `@/lib/auth`
 * on their way out. The jwt callback re-reads TeamMember at most once a minute
 * per person, so without that a role change, a deactivation or a reactivation
 * looks like it did not take until the entry expires — and the first person to
 * test it reads that as the change having failed. `resyncAll` needs no clear:
 * it only rewrites FullName, which the token does not carry.
 *
 * The whole map goes rather than one entry. It is keyed by email and two of the
 * three actions carry only a target id, so being precise would cost a lookup to
 * save a handful of single-row reads on a roster this size.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireRole(["IT Admin", "System Admin"]);
    if (session instanceof Response) return session;

    const userId = Number(session.user?.id ?? 0);
    const currentRole = (session.user?.role ?? "") as string;
    if (currentRole !== "System Admin") {
      return NextResponse.json({ ok: false, error: "Only System Admin can manage users" }, { status: 403 });
    }

    const body = await req.json();
    const { action } = body as { action: string };

    switch (action) {
      case "updateRole": {
        const { targetUserId, newRole } = body as { targetUserId: number; newRole: string };
        // The service throws on an unrecognised role, which the catch below would
        // turn into a 500. Validating here keeps a bad request body a 400.
        if (!targetUserId || !isValidRole(newRole)) {
          return NextResponse.json({ ok: false, error: "Invalid userId or role" }, { status: 400 });
        }
        if (targetUserId === userId && newRole !== "System Admin") {
          return NextResponse.json({ ok: false, error: "Cannot change your own role" }, { status: 400 });
        }
        await updateRole(targetUserId, newRole);
        clearTeamMemberRoleCache();
        return NextResponse.json({ ok: true });
      }

      case "addUser": {
        const { name, email, nickname, role: requestedRole } = body as {
          name: string; email: string; nickname?: string; role?: string;
        };
        // Trimmed before the emptiness check, not after: addOrReactivate() throws
        // on a name or email that is blank once trimmed, and a request body is not
        // trusted to be either a string or non-padded.
        const fullName = typeof name === "string" ? name.trim() : "";
        const emailAddress = typeof email === "string" ? email.trim() : "";
        if (!fullName || !emailAddress) {
          return NextResponse.json({ ok: false, error: "name and email required" }, { status: 400 });
        }
        // The directory modal often sends no role at all, so an unrecognised or
        // absent one means the lowest role rather than an error. Resolving it
        // here also keeps addOrReactivate() — which throws — from ever seeing one.
        const role = isValidRole(requestedRole) ? requestedRole : "Staff";

        const { id, outcome } = await addOrReactivate({
          fullName,
          email: emailAddress,
          nickname,
          appRole: role,
        });

        // Nothing changed — say so rather than letting the UI toast "Done".
        // (`deleteUser` below is a soft delete and GET lists only active rows, so
        // "already active" is the one outcome the page cannot see for itself.)
        if (outcome === "exists") {
          return NextResponse.json(
            { ok: false, error: `${emailAddress} is already an active user` },
            { status: 409 },
          );
        }
        // A reactivation is the case that needs this: the deactivated row can
        // already be sitting in the cache with `IsActive` false.
        clearTeamMemberRoleCache();
        return NextResponse.json({ ok: true, data: { id, outcome } });
      }

      case "deleteUser": {
        const { targetUserId } = body as { targetUserId: number };
        if (targetUserId === userId) {
          return NextResponse.json({ ok: false, error: "Cannot delete yourself" }, { status: 400 });
        }
        await setActive(targetUserId, false);
        clearTeamMemberRoleCache();
        return NextResponse.json({ ok: true });
      }

      case "resyncAll": {
        const allUsers = await listActive();
        let synced = 0;
        for (const u of allUsers) {
          try {
            const adUser = await getADUserByEmail(u.email);
            // A blank displayName is skipped: updateFullName() ignores it, so
            // counting it as synced would report work that never happened.
            if (adUser && adUser.displayName && adUser.displayName !== u.fullName) {
              await updateFullName(u.id, adUser.displayName);
              synced++;
            }
          } catch { /* skip failed lookups */ }
        }
        return NextResponse.json({ ok: true, data: { synced, total: allUsers.length } });
      }

      default:
        return NextResponse.json({ ok: false, error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err) {
    console.error("[api/settings/users] POST", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
