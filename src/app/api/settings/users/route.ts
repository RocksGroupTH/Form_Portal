import { NextRequest, NextResponse } from "next/server";
import { getCorePool, sql } from "@/lib/db/mssql";
import { getADUserByEmail } from "@/lib/graph";
import { requireRole } from "@/lib/api-auth";

const VALID_ROLES = ["Staff", "IT Admin", "System Admin", "Viewer"];

/** GET /api/settings/users — active team members for the Users & Roles page. */
export async function GET() {
  try {
    const session = await requireRole(["IT Admin", "System Admin"]);
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
        const result = await pool.request()
          .input("name", sql.NVarChar, name.trim())
          .input("nickname", sql.NVarChar, (nickname ?? name.split(" ")[0]).trim())
          .input("email", sql.NVarChar, email.toLowerCase().trim())
          .input("role", sql.NVarChar, role)
          .input("color", sql.NVarChar, "#6c757d")
          .query(`
            IF NOT EXISTS (SELECT 1 FROM TeamMember WHERE LOWER(LTRIM(RTRIM(Email))) = @email)
            INSERT INTO TeamMember (FullName, Nickname, Email, AppRole, Position, Color, IsActive)
            OUTPUT INSERTED.Id
            VALUES (@name, @nickname, @email, @role, '', @color, 1)
          `);
        return NextResponse.json({ ok: true, data: result.recordset[0] });
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
