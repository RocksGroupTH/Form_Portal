import { NextRequest, NextResponse } from "next/server";
import { getFormPool, sql } from "@/lib/db/mssql";
import { requireAuth, requireRole } from "@/lib/api-auth";
import { createSubmissionSchema } from "@/features/forms/schemas";

/* ── GET /api/forms/submissions ── */

export async function GET(req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;
  const userId = Number(session.user.id);

  const { searchParams } = req.nextUrl;
  const formId = searchParams.get("formId");
  const status = searchParams.get("status");
  const isAdmin = searchParams.get("admin") === "true";

  try {
    if (isAdmin) {
      const adminSession = await requireRole(["IT Admin", "System Admin"]);
      if (adminSession instanceof Response) return adminSession;
    }

    const pool = await getFormPool();
    const request = pool.request();

    let where = "s.IsActive = 1";

    if (!isAdmin) {
      request.input("userId", sql.Int, userId);
      where += " AND s.SubmittedBy = @userId";
    }

    if (formId) {
      request.input("formId", sql.Int, Number(formId));
      where += " AND s.FormId = @formId";
    }

    if (status) {
      request.input("status", sql.NVarChar(50), status);
      where += " AND s.Status = @status";
    }

    const result = await request.query(`
      SELECT
        s.Id,
        s.FormId,
        s.FormVersionId,
        s.SubmittedBy,
        s.Status,
        s.DataJson,
        s.SubmittedAt,
        s.CreatedAt,
        s.UpdatedAt,
        f.Name   AS FormName,
        f.Slug   AS FormSlug,
        v.Version AS VersionNumber
      FROM OfficeFormSubmissions s
      JOIN OfficeForms f          ON f.Id = s.FormId
      JOIN OfficeFormVersions v   ON v.Id = s.FormVersionId
      WHERE ${where}
      ORDER BY s.CreatedAt DESC
    `);

    const mapped = result.recordset.map((r: Record<string, unknown>) => ({
      id: r.Id, formId: r.FormId, formVersionId: r.FormVersionId,
      submittedBy: r.SubmittedBy, status: r.Status,
      data: r.DataJson ? JSON.parse(r.DataJson as string) : {},
      submittedAt: r.SubmittedAt, createdAt: r.CreatedAt, updatedAt: r.UpdatedAt,
      formName: r.FormName, formSlug: r.FormSlug,
    }));

    return NextResponse.json({ ok: true, data: mapped });
  } catch (err) {
    console.error("GET /api/forms/submissions error:", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}

/* ── POST /api/forms/submissions ── */

export async function POST(req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;
  const userId = Number(session.user.id);

  try {
    const body = await req.json();
    const parsed = createSubmissionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: parsed.error.flatten().fieldErrors },
        { status: 400 },
      );
    }

    const { formId, data, isDraft } = parsed.data;
    const pool = await getFormPool();

    // Verify form exists and is published
    const formResult = await pool
      .request()
      .input("formId", sql.Int, formId)
      .query(
        `SELECT Id FROM OfficeForms
         WHERE Id = @formId AND Status = 'Published' AND IsActive = 1`,
      );

    if (formResult.recordset.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Form not found or not published" },
        { status: 400 },
      );
    }

    // Get current published version
    const versionResult = await pool
      .request()
      .input("formId", sql.Int, formId)
      .query(
        `SELECT TOP 1 Id
         FROM OfficeFormVersions
         WHERE FormId = @formId AND PublishedAt IS NOT NULL
         ORDER BY Version DESC`,
      );

    if (versionResult.recordset.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No published version found" },
        { status: 400 },
      );
    }

    const versionId = versionResult.recordset[0].Id;
    const status = isDraft ? "Draft" : "Submitted";

    const insertResult = await pool
      .request()
      .input("formId", sql.Int, formId)
      .input("versionId", sql.Int, versionId)
      .input("userId", sql.Int, userId)
      .input("status", sql.NVarChar(50), status)
      .input("dataJson", sql.NVarChar(sql.MAX), JSON.stringify(data))
      .query(
        `INSERT INTO OfficeFormSubmissions
           (FormId, FormVersionId, SubmittedBy, Status, DataJson${!isDraft ? ", SubmittedAt" : ""})
         VALUES
           (@formId, @versionId, @userId, @status, @dataJson${!isDraft ? ", GETDATE()" : ""});
         SELECT SCOPE_IDENTITY() AS Id;`,
      );

    const newId = insertResult.recordset[0].Id;

    // Fetch the created submission
    const created = await pool
      .request()
      .input("id", sql.Int, newId)
      .query(
        `SELECT * FROM OfficeFormSubmissions WHERE Id = @id`,
      );

    return NextResponse.json({ ok: true, data: created.recordset[0] });
  } catch (err) {
    console.error("POST /api/forms/submissions error:", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}
