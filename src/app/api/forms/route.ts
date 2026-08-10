import { NextRequest, NextResponse } from "next/server";
import { getFormPool, sql } from "@/lib/db/mssql";
import { requireAuth, requireRole } from "@/lib/api-auth";
import { createFormSchema } from "@/features/forms/schemas";

/* ── GET /api/forms ── */

export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth();
    if (session instanceof Response) return session;

    const isAdmin = req.nextUrl.searchParams.get("admin") === "true";

    const pool = await getFormPool();

    // Helper to normalize PascalCase DB columns to camelCase
    const mapForm = (r: Record<string, unknown>) => ({
      id: r.Id, name: r.Name, slug: r.Slug, description: r.Description,
      category: r.Category, icon: r.Icon, status: r.Status,
      currentVersion: r.CurrentVersion, createdBy: r.CreatedBy,
      createdAt: r.CreatedAt, updatedAt: r.UpdatedAt,
      ...(r.submissionCount !== undefined ? { submissionCount: r.submissionCount } : {}),
    });

    if (isAdmin) {
      // Admin view — requires elevated role
      const roleCheck = await requireRole(["IT Admin", "System Admin"]);
      if (roleCheck instanceof Response) return roleCheck;

      const result = await pool.request().query(`
        SELECT
          f.*,
          (SELECT COUNT(*) FROM OfficeFormSubmissions WHERE FormId = f.Id AND IsActive = 1) AS submissionCount
        FROM OfficeForms f
        WHERE f.IsActive = 1
        ORDER BY f.CreatedAt DESC
      `);

      return NextResponse.json({ ok: true, data: result.recordset.map(mapForm) });
    }

    // Also handle ?slug= for form fill page
    const slug = req.nextUrl.searchParams.get("slug");
    if (slug) {
      const result = await pool.request()
        .input("slug", sql.NVarChar, slug)
        .query(`
          SELECT f.*, v.FieldsJson
          FROM OfficeForms f
          JOIN OfficeFormVersions v ON v.FormId = f.Id AND v.Version = f.CurrentVersion
          WHERE f.Slug = @slug AND f.Status = 'Published' AND f.IsActive = 1
        `);
      if (result.recordset.length === 0) {
        return NextResponse.json({ ok: false, error: "Form not found" }, { status: 404 });
      }
      const row = result.recordset[0];
      return NextResponse.json({
        ok: true,
        data: {
          form: mapForm(row),
          fields: row.FieldsJson ? JSON.parse(row.FieldsJson) : [],
        },
      });
    }

    // Public view — only published & active
    const result = await pool.request().query(`
      SELECT *
      FROM OfficeForms
      WHERE Status = 'Published' AND IsActive = 1
      ORDER BY CreatedAt DESC
    `);

    return NextResponse.json({ ok: true, data: result.recordset.map(mapForm) });
  } catch (err) {
    console.error("[api/forms] GET", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}

/* ── POST /api/forms ── */

export async function POST(req: NextRequest) {
  try {
    const session = await requireRole(["IT Admin", "System Admin"]);
    if (session instanceof Response) return session;

    const userId = Number(session.user.id);

    const body = await req.json();
    const parsed = createFormSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: parsed.error.flatten().fieldErrors },
        { status: 400 },
      );
    }

    const { name, slug, description, category, icon } = parsed.data;

    const pool = await getFormPool();

    // Insert the form
    const formResult = await pool
      .request()
      .input("name", sql.NVarChar, name)
      .input("slug", sql.NVarChar, slug)
      .input("description", sql.NVarChar, description ?? null)
      .input("category", sql.NVarChar, category ?? null)
      .input("icon", sql.NVarChar, icon ?? null)
      .input("createdBy", sql.Int, userId)
      .query(`
        INSERT INTO OfficeForms (Name, Slug, Description, Category, Icon, CreatedBy)
        OUTPUT INSERTED.*
        VALUES (@name, @slug, @description, @category, @icon, @createdBy)
      `);

    const newForm = formResult.recordset[0];

    // Create first version row (v1, empty fields)
    await pool
      .request()
      .input("formId", sql.Int, newForm.Id)
      .query(`
        INSERT INTO OfficeFormVersions (FormId, Version, FieldsJson)
        VALUES (@formId, 1, '[]')
      `);

    return NextResponse.json({ ok: true, data: newForm }, { status: 201 });
  } catch (err) {
    console.error("[api/forms] POST", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}
