import { NextRequest, NextResponse } from "next/server";
import { getFormPool, sql } from "@/lib/db/mssql";
import { requireAuth, requireRole } from "@/lib/api-auth";
import { updateFormSchema } from "@/features/forms/schemas";

type RouteParams = { params: Promise<{ formId: string }> };

/* ── GET /api/forms/[formId] ── */

export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    if (session instanceof Response) return session;

    const { formId } = await params;
    const id = Number(formId);
    if (Number.isNaN(id)) {
      return NextResponse.json(
        { ok: false, error: "Invalid formId" },
        { status: 400 },
      );
    }

    const pool = await getFormPool();

    // Get form
    const formResult = await pool
      .request()
      .input("formId", sql.Int, id)
      .query(`
        SELECT * FROM OfficeForms
        WHERE Id = @formId AND IsActive = 1
      `);

    const form = formResult.recordset[0];
    if (!form) {
      return NextResponse.json(
        { ok: false, error: "Form not found" },
        { status: 404 },
      );
    }

    // Get current version's fields
    const versionResult = await pool
      .request()
      .input("formId", sql.Int, id)
      .input("version", sql.Int, form.CurrentVersion)
      .query(`
        SELECT * FROM OfficeFormVersions
        WHERE FormId = @formId AND Version = @version
      `);

    const version = versionResult.recordset[0];
    let fields: unknown[] = [];
    if (version?.FieldsJson) {
      try {
        fields = JSON.parse(version.FieldsJson);
      } catch {
        fields = [];
      }
    }

    return NextResponse.json({
      ok: true,
      data: {
        form: {
          id: form.Id, name: form.Name, slug: form.Slug, description: form.Description,
          category: form.Category, icon: form.Icon, status: form.Status,
          currentVersion: form.CurrentVersion, createdBy: form.CreatedBy,
          createdAt: form.CreatedAt, updatedAt: form.UpdatedAt,
        },
        fields,
      },
    });
  } catch (err) {
    console.error("[api/forms] GET [formId]", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}

/* ── PUT /api/forms/[formId] ── */

export async function PUT(req: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireRole(["IT Admin", "System Admin"]);
    if (session instanceof Response) return session;

    const { formId } = await params;
    const id = Number(formId);
    if (Number.isNaN(id)) {
      return NextResponse.json(
        { ok: false, error: "Invalid formId" },
        { status: 400 },
      );
    }

    const body = await req.json();
    const parsed = updateFormSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: parsed.error.flatten().fieldErrors },
        { status: 400 },
      );
    }

    const data = parsed.data;
    const pool = await getFormPool();

    // Build dynamic SET clause
    const setClauses: string[] = [];
    const request = pool.request().input("formId", sql.Int, id);

    if (data.name !== undefined) {
      setClauses.push("Name = @name");
      request.input("name", sql.NVarChar, data.name);
    }
    if (data.description !== undefined) {
      setClauses.push("Description = @description");
      request.input("description", sql.NVarChar, data.description);
    }
    if (data.category !== undefined) {
      setClauses.push("Category = @category");
      request.input("category", sql.NVarChar, data.category);
    }
    if (data.icon !== undefined) {
      setClauses.push("Icon = @icon");
      request.input("icon", sql.NVarChar, data.icon);
    }
    if (data.status !== undefined) {
      setClauses.push("Status = @status");
      request.input("status", sql.NVarChar, data.status);
    }

    if (setClauses.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No fields to update" },
        { status: 400 },
      );
    }

    setClauses.push("UpdatedAt = GETDATE()");

    const result = await request.query(`
      UPDATE OfficeForms
      SET ${setClauses.join(", ")}
      OUTPUT INSERTED.*
      WHERE Id = @formId AND IsActive = 1
    `);

    const updated = result.recordset[0];
    if (!updated) {
      return NextResponse.json(
        { ok: false, error: "Form not found" },
        { status: 404 },
      );
    }

    return NextResponse.json({ ok: true, data: updated });
  } catch (err) {
    console.error("[api/forms] PUT [formId]", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}

/* ── DELETE /api/forms/[formId] (soft delete) ── */

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireRole(["IT Admin", "System Admin"]);
    if (session instanceof Response) return session;

    const { formId } = await params;
    const id = Number(formId);
    if (Number.isNaN(id)) {
      return NextResponse.json(
        { ok: false, error: "Invalid formId" },
        { status: 400 },
      );
    }

    const pool = await getFormPool();

    const result = await pool
      .request()
      .input("formId", sql.Int, id)
      .query(`
        UPDATE OfficeForms
        SET IsActive = 0, UpdatedAt = GETDATE()
        WHERE Id = @formId AND IsActive = 1
      `);

    if (result.rowsAffected[0] === 0) {
      return NextResponse.json(
        { ok: false, error: "Form not found" },
        { status: 404 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/forms] DELETE [formId]", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}
