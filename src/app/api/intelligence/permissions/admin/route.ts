import { NextRequest, NextResponse } from "next/server";
import { getCorePool, sql } from "@/lib/db/mssql";
import { getADUserByEmail } from "@/lib/graph";
import { requireRole } from "@/lib/api-auth";

/**
 * GET /api/intelligence/permissions/admin
 * Returns all groups, members, and brand permissions for admin management.
 */
export async function GET() {
  try {
    const session = await requireRole(["IT Admin", "System Admin"]);
    if (session instanceof Response) return session;

    const pool = await getCorePool();

    // Groups
    const groups = await pool.request().query(`
      SELECT g.Id, g.Name, g.Description, g.IsActive, g.CreatedAt,
        (SELECT COUNT(*) FROM IntelPermissionGroupMember WHERE GroupId = g.Id) AS memberCount
      FROM IntelPermissionGroup g ORDER BY g.Name
    `);

    // Group members
    const members = await pool.request().query(`
      SELECT gm.Id, gm.GroupId, gm.UserEmail, gm.AddedAt
      FROM IntelPermissionGroupMember gm ORDER BY gm.GroupId, gm.UserEmail
    `);

    // Brand permissions
    const permissions = await pool.request().query(`
      SELECT bp.Id, bp.BrandCode, bp.UserEmail, bp.GroupId, bp.GrantedAt,
        g.Name AS GroupName
      FROM IntelBrandPermission bp
      LEFT JOIN IntelPermissionGroup g ON bp.GroupId = g.Id
      ORDER BY bp.BrandCode, bp.UserEmail, g.Name
    `);

    // Team members for user picker
    const corePool = await getCorePool();
    const users = await corePool.request().query(`
      SELECT Id, FullName, Nickname, Email, AppRole
      FROM TeamMember WHERE IsActive = 1 ORDER BY FullName
    `);

    return NextResponse.json({
      ok: true,
      data: {
        groups: groups.recordset,
        members: members.recordset,
        permissions: permissions.recordset,
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
    console.error("[api/intelligence/permissions/admin] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/intelligence/permissions/admin
 * Actions: createGroup, addMember, removeMember, grantBrand, revokeBrand, deleteGroup
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireRole(["IT Admin", "System Admin"]);
    if (session instanceof Response) return session;

    const userId = Number(session.user?.id ?? 0);
    const body = await req.json();
    const { action } = body as { action: string };
    const pool = await getCorePool();

    switch (action) {
      case "createGroup": {
        const { name, description } = body as { name: string; description?: string };
        if (!name) return NextResponse.json({ ok: false, error: "Name is required" }, { status: 400 });
        const result = await pool.request()
          .input("name", sql.NVarChar, name.trim())
          .input("desc", sql.NVarChar, description?.trim() ?? null)
          .input("createdBy", sql.Int, userId)
          .query(`
            INSERT INTO IntelPermissionGroup (Name, Description, CreatedBy)
            OUTPUT INSERTED.Id, INSERTED.Name
            VALUES (@name, @desc, @createdBy)
          `);
        return NextResponse.json({ ok: true, data: result.recordset[0] });
      }

      case "deleteGroup": {
        const { groupId } = body as { groupId: number };
        await pool.request().input("id", sql.Int, groupId)
          .query("DELETE FROM IntelPermissionGroup WHERE Id = @id");
        return NextResponse.json({ ok: true });
      }

      case "addMember": {
        const { groupId, email } = body as { groupId: number; email: string };
        if (!groupId || !email) return NextResponse.json({ ok: false, error: "groupId and email required" }, { status: 400 });
        await pool.request()
          .input("groupId", sql.Int, groupId)
          .input("email", sql.NVarChar, email.toLowerCase().trim())
          .input("addedBy", sql.Int, userId)
          .query(`
            IF NOT EXISTS (SELECT 1 FROM IntelPermissionGroupMember WHERE GroupId = @groupId AND LOWER(UserEmail) = @email)
            INSERT INTO IntelPermissionGroupMember (GroupId, UserEmail, AddedBy) VALUES (@groupId, @email, @addedBy)
          `);
        return NextResponse.json({ ok: true });
      }

      case "removeMember": {
        const { memberId } = body as { memberId: number };
        await pool.request().input("id", sql.Int, memberId)
          .query("DELETE FROM IntelPermissionGroupMember WHERE Id = @id");
        return NextResponse.json({ ok: true });
      }

      case "grantBrand": {
        const { brandCode, email, groupId } = body as { brandCode: string; email?: string; groupId?: number };
        if (!brandCode) return NextResponse.json({ ok: false, error: "brandCode required" }, { status: 400 });
        if (!email && !groupId) return NextResponse.json({ ok: false, error: "email or groupId required" }, { status: 400 });

        if (email) {
          await pool.request()
            .input("brand", sql.NVarChar, brandCode)
            .input("email", sql.NVarChar, email.toLowerCase().trim())
            .input("grantedBy", sql.Int, userId)
            .query(`
              IF NOT EXISTS (SELECT 1 FROM IntelBrandPermission WHERE BrandCode = @brand AND LOWER(UserEmail) = @email)
              INSERT INTO IntelBrandPermission (BrandCode, UserEmail, GrantedBy) VALUES (@brand, @email, @grantedBy)
            `);
        } else {
          await pool.request()
            .input("brand", sql.NVarChar, brandCode)
            .input("groupId", sql.Int, groupId)
            .input("grantedBy", sql.Int, userId)
            .query(`
              IF NOT EXISTS (SELECT 1 FROM IntelBrandPermission WHERE BrandCode = @brand AND GroupId = @groupId)
              INSERT INTO IntelBrandPermission (BrandCode, GroupId, GrantedBy) VALUES (@brand, @groupId, @grantedBy)
            `);
        }
        return NextResponse.json({ ok: true });
      }

      case "revokeBrand": {
        const { permissionId } = body as { permissionId: number };
        await pool.request().input("id", sql.Int, permissionId)
          .query("DELETE FROM IntelBrandPermission WHERE Id = @id");
        return NextResponse.json({ ok: true });
      }

      case "updateRole": {
        // Only System Admin can change roles
        const currentRole = (session.user?.role ?? "") as string;
        if (currentRole !== "System Admin") {
          return NextResponse.json({ ok: false, error: "Only System Admin can change roles" }, { status: 403 });
        }
        const { targetUserId, newRole } = body as { targetUserId: number; newRole: string };
        const validRoles = ["Staff", "IT Admin", "System Admin", "Viewer"];
        if (!targetUserId || !validRoles.includes(newRole)) {
          return NextResponse.json({ ok: false, error: "Invalid userId or role" }, { status: 400 });
        }
        // Prevent demoting yourself
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
        const currentRole = (session.user?.role ?? "") as string;
        if (currentRole !== "System Admin") {
          return NextResponse.json({ ok: false, error: "Only System Admin can add users" }, { status: 403 });
        }
        const { name, email, nickname, role: newUserRole } = body as { name: string; email: string; nickname?: string; role?: string };
        if (!name || !email) return NextResponse.json({ ok: false, error: "name and email required" }, { status: 400 });
        const validRoles = ["Staff", "IT Admin", "System Admin", "Viewer"];
        const role = validRoles.includes(newUserRole ?? "") ? newUserRole! : "Staff";
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
        const currentRole2 = (session.user?.role ?? "") as string;
        if (currentRole2 !== "System Admin") {
          return NextResponse.json({ ok: false, error: "Only System Admin can delete users" }, { status: 403 });
        }
        const { targetUserId: delId } = body as { targetUserId: number };
        if (delId === userId) {
          return NextResponse.json({ ok: false, error: "Cannot delete yourself" }, { status: 400 });
        }
        await pool.request().input("id", sql.Int, delId)
          .query("UPDATE TeamMember SET IsActive = 0, UpdatedAt = GETDATE() WHERE Id = @id");
        return NextResponse.json({ ok: true });
      }

      case "resyncAll": {
        const currentRole3 = (session.user?.role ?? "") as string;
        if (currentRole3 !== "System Admin") {
          return NextResponse.json({ ok: false, error: "Only System Admin can resync" }, { status: 403 });
        }
        // Get all active users
        const allUsers = await pool.request().query("SELECT Id, Email, FullName FROM TeamMember WHERE IsActive = 1");
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
    console.error("[api/intelligence/permissions/admin] POST", err);
    const msg = err instanceof Error ? err.message : "Internal server error";
    if (msg.includes("UQ_")) {
      return NextResponse.json({ ok: false, error: "Already exists" }, { status: 409 });
    }
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
