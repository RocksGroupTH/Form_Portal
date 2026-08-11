import { NextRequest, NextResponse } from "next/server";
import { getCorePool, sql } from "@/lib/db/mssql";
import { getADUserByEmail } from "@/lib/graph";
import { requireRole } from "@/lib/api-auth";

const VALID_ROLES = ["Staff", "IT Admin", "System Admin", "Viewer"];

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

    const pool = await getCorePool();
    const users = await pool.request().query(`
      SELECT Id, FullName, Nickname, Email, AppRole
      FROM TeamMember WHERE IsActive = 1 ORDER BY FullName
    `);

    return NextResponse.json({
      ok: true,
      data: {
        users: users.recordset.map((u: Record<string, unknown>) => ({
          id: u.Id,
          name: u.FullName,
          nickname: u.Nickname,
          email: u.Email,
          role: u.AppRole,
        })),
      },
    });
  } catch (err) {
    console.error("[api/settings/users] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

/** POST /api/settings/users — actions: updateRole, addUser, deleteUser, resyncAll. */
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
    const pool = await getCorePool();

    switch (action) {
      case "updateRole": {
        const { targetUserId, newRole } = body as { targetUserId: number; newRole: string };
        if (!targetUserId || !VALID_ROLES.includes(newRole)) {
          return NextResponse.json({ ok: false, error: "Invalid userId or role" }, { status: 400 });
        }
        if (targetUserId === userId && newRole !== "System Admin") {
          return NextResponse.json({ ok: false, error: "Cannot change your own role" }, { status: 400 });
        }
        await pool.request()
          .input("id", sql.Int, targetUserId)
          .input("role", sql.NVarChar, newRole)
          .query("UPDATE TeamMember SET AppRole = @role, UpdatedAt = GETDATE() WHERE Id = @id");
        return NextResponse.json({ ok: true });
      }

      case "addUser": {
        const { name, email, nickname, role: requestedRole } = body as {
          name: string; email: string; nickname?: string; role?: string;
        };
        if (!name || !email) {
          return NextResponse.json({ ok: false, error: "name and email required" }, { status: 400 });
        }
        const role = VALID_ROLES.includes(requestedRole ?? "") ? requestedRole! : "Staff";
        /*
         * `deleteUser` below only sets IsActive = 0, and GET filters IsActive = 1.
         * A guarded INSERT therefore matched the deactivated row, inserted nothing,
         * and returned {ok:true} with no id — the UI toasted success, the list never
         * changed, and the AD modal would not mark the user "Already Added" either,
         * so the flow was unrecoverable from this page.
         *
         * Reactivate instead of inserting. The row's Id is referenced all over both
         * apps (AccRequest.CreatedBy/SubmittedBy, OfficeFormSubmissions.SubmittedBy,
         * OfficeFormApprovals.AssignedTo), so a second row would orphan that history.
         * Only IsActive / FullName / AppRole are written — the caller genuinely
         * supplies those. Position, Color, Photo, and ManagerId are left untouched
         * because the Rocks Fast sibling reads them (avatar colour, cached AD photo,
         * Form Builder manager resolution) and this endpoint has nothing to put there.
         * Nickname is only filled if it is currently blank, so a hand-curated one is
         * not clobbered by the `name.split(" ")[0]` fallback.
         */
        const result = await pool.request()
          .input("name", sql.NVarChar, name.trim())
          .input("nickname", sql.NVarChar, (nickname ?? name.split(" ")[0]).trim())
          .input("email", sql.NVarChar, email.toLowerCase().trim())
          .input("role", sql.NVarChar, role)
          .input("color", sql.NVarChar, "#6c757d")
          .query(`
            DECLARE @existingId INT, @wasActive BIT;

            SELECT TOP 1 @existingId = Id, @wasActive = IsActive
            FROM TeamMember
            WHERE LOWER(LTRIM(RTRIM(Email))) = @email;

            IF @existingId IS NULL
            BEGIN
              INSERT INTO TeamMember (FullName, Nickname, Email, AppRole, Position, Color, IsActive)
              VALUES (@name, @nickname, @email, @role, '', @color, 1);
              SELECT CAST(SCOPE_IDENTITY() AS INT) AS Id, 'created' AS Outcome;
            END
            ELSE IF @wasActive = 1
            BEGIN
              SELECT @existingId AS Id, 'exists' AS Outcome;
            END
            ELSE
            BEGIN
              UPDATE TeamMember
              SET IsActive = 1,
                  FullName = @name,
                  Nickname = COALESCE(NULLIF(LTRIM(RTRIM(Nickname)), N''), @nickname),
                  AppRole  = @role,
                  UpdatedAt = GETDATE()
              WHERE Id = @existingId;
              SELECT @existingId AS Id, 'reactivated' AS Outcome;
            END
          `);

        const row = result.recordset[0] as { Id: number; Outcome: string } | undefined;
        if (!row) {
          return NextResponse.json({ ok: false, error: "Failed to add user" }, { status: 500 });
        }
        // Nothing changed — say so rather than letting the UI toast "Done".
        if (row.Outcome === "exists") {
          return NextResponse.json(
            { ok: false, error: `${email.trim()} is already an active user` },
            { status: 409 },
          );
        }
        return NextResponse.json({ ok: true, data: { id: row.Id, outcome: row.Outcome } });
      }

      case "deleteUser": {
        const { targetUserId } = body as { targetUserId: number };
        if (targetUserId === userId) {
          return NextResponse.json({ ok: false, error: "Cannot delete yourself" }, { status: 400 });
        }
        await pool.request().input("id", sql.Int, targetUserId)
          .query("UPDATE TeamMember SET IsActive = 0, UpdatedAt = GETDATE() WHERE Id = @id");
        return NextResponse.json({ ok: true });
      }

      case "resyncAll": {
        const allUsers = await pool.request()
          .query("SELECT Id, Email, FullName FROM TeamMember WHERE IsActive = 1");
        let synced = 0;
        for (const u of allUsers.recordset) {
          try {
            const adUser = await getADUserByEmail(u.Email as string);
            if (adUser && adUser.displayName !== u.FullName) {
              await pool.request()
                .input("id", sql.Int, u.Id)
                .input("name", sql.NVarChar, adUser.displayName)
                .query("UPDATE TeamMember SET FullName = @name, UpdatedAt = GETDATE() WHERE Id = @id");
              synced++;
            }
          } catch { /* skip failed lookups */ }
        }
        return NextResponse.json({ ok: true, data: { synced, total: allUsers.recordset.length } });
      }

      default:
        return NextResponse.json({ ok: false, error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err) {
    console.error("[api/settings/users] POST", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
