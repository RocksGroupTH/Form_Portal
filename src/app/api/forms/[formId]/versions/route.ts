import { NextRequest, NextResponse } from "next/server";
import { getFormPool, sql } from "@/lib/db/mssql";
import { requireRole } from "@/lib/api-auth";
import { saveVersionSchema } from "@/features/forms/schemas";

type RouteParams = { params: Promise<{ formId: string }> };

/* ── GET /api/forms/[formId]/versions ── */

export async function GET(req: NextRequest, { params }: RouteParams) {
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
        SELECT * FROM OfficeFormVersions
        WHERE FormId = @formId
        ORDER BY Version DESC
      `);

    return NextResponse.json({ ok: true, data: result.recordset });
  } catch (err) {
    console.error("[api/forms] GET versions", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}

/* ── POST /api/forms/[formId]/versions (save field schema) ── */

export async function POST(req: NextRequest, { params }: RouteParams) {
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
    const parsed = saveVersionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: parsed.error.flatten().fieldErrors },
        { status: 400 },
      );
    }

    const { fields } = parsed.data;
    const fieldsJson = JSON.stringify(fields);

    const pool = await getFormPool();

    // Get current form info
    const formResult = await pool
      .request()
      .input("formId", sql.Int, id)
      .query(`
        SELECT Id, Status, CurrentVersion
        FROM OfficeForms
        WHERE Id = @formId AND IsActive = 1
      `);

    const form = formResult.recordset[0];
    if (!form) {
      return NextResponse.json(
        { ok: false, error: "Form not found" },
        { status: 404 },
      );
    }

    let newVersion: number;

    if (form.Status === "Published") {
      // Published form: create a new draft version
      newVersion = form.CurrentVersion + 1;

      await pool
        .request()
        .input("formId", sql.Int, id)
        .input("version", sql.Int, newVersion)
        .input("fieldsJson", sql.NVarChar, fieldsJson)
        .query(`
          INSERT INTO OfficeFormVersions (FormId, Version, FieldsJson)
          VALUES (@formId, @version, @fieldsJson)
        `);

      // Update form to Draft with new version
      await pool
        .request()
        .input("formId", sql.Int, id)
        .input("currentVersion", sql.Int, newVersion)
        .query(`
          UPDATE OfficeForms
          SET CurrentVersion = @currentVersion, Status = 'Draft', UpdatedAt = GETDATE()
          WHERE Id = @formId
        `);
    } else {
      // Draft form: update existing latest version's fields
      newVersion = form.CurrentVersion;

      await pool
        .request()
        .input("formId", sql.Int, id)
        .input("version", sql.Int, newVersion)
        .input("fieldsJson", sql.NVarChar, fieldsJson)
        .query(`
          UPDATE OfficeFormVersions
          SET FieldsJson = @fieldsJson
          WHERE FormId = @formId AND Version = @version
        `);

      // Update form timestamp
      await pool
        .request()
        .input("formId", sql.Int, id)
        .input("currentVersion", sql.Int, newVersion)
        .query(`
          UPDATE OfficeForms
          SET CurrentVersion = @currentVersion, UpdatedAt = GETDATE()
          WHERE Id = @formId
        `);
    }

    return NextResponse.json({
      ok: true,
      data: { version: newVersion, fields },
    });
  } catch (err) {
    console.error("[api/forms] POST versions", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}
