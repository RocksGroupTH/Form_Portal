import { NextRequest, NextResponse } from "next/server";
import { getFormPool, sql } from "@/lib/db/mssql";
import { requireRole } from "@/lib/api-auth";

type RouteParams = { params: Promise<{ formId: string }> };

/* ── POST /api/forms/[formId]/publish ── */

export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireRole(["IT Admin", "System Admin"]);
    if (session instanceof Response) return session;

    const userId = Number(session.user.id);

    const { formId } = await params;
    const id = Number(formId);
    if (Number.isNaN(id)) {
      return NextResponse.json(
        { ok: false, error: "Invalid formId" },
        { status: 400 },
      );
    }

    const pool = await getFormPool();

    // Get the latest version for this form
    const versionResult = await pool
      .request()
      .input("formId", sql.Int, id)
      .query(`
        SELECT TOP 1 *
        FROM OfficeFormVersions
        WHERE FormId = @formId
        ORDER BY Version DESC
      `);

    const version = versionResult.recordset[0];
    if (!version) {
      return NextResponse.json(
        { ok: false, error: "No version found for this form" },
        { status: 404 },
      );
    }

    // Check that fields are not empty
    if (!version.FieldsJson || version.FieldsJson === "[]") {
      return NextResponse.json(
        { ok: false, error: "Cannot publish a form with no fields" },
        { status: 400 },
      );
    }

    // Publish the version
    await pool
      .request()
      .input("versionId", sql.Int, version.Id)
      .input("publishedBy", sql.Int, userId)
      .query(`
        UPDATE OfficeFormVersions
        SET PublishedAt = GETDATE(), PublishedBy = @publishedBy
        WHERE Id = @versionId
      `);

    // Update form status
    await pool
      .request()
      .input("formId", sql.Int, id)
      .query(`
        UPDATE OfficeForms
        SET Status = 'Published', UpdatedAt = GETDATE()
        WHERE Id = @formId
      `);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/forms] POST publish", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}
