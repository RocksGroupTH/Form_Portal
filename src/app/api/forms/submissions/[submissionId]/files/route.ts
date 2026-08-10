import { NextRequest, NextResponse } from "next/server";
import { getFormPool, sql } from "@/lib/db/mssql";
import { requireAuth } from "@/lib/api-auth";
import { uploadFile } from "@/lib/storage";

/* ── POST /api/forms/submissions/[submissionId]/files ── */

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ submissionId: string }> },
) {
  const session = await requireAuth();
  if (session instanceof Response) return session;
  const userId = Number(session.user.id);

  const { submissionId } = await params;

  try {
    const formData = await req.formData();
    const fieldKey = formData.get("fieldKey") as string | null;

    if (!fieldKey) {
      return NextResponse.json(
        { ok: false, error: "fieldKey is required" },
        { status: 400 },
      );
    }

    const files = formData.getAll("file") as File[];
    if (files.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No files provided" },
        { status: 400 },
      );
    }

    const pool = await getFormPool();
    const created: Record<string, unknown>[] = [];

    for (const file of files) {
      const timestamp = Date.now();
      const storagePath = `submissions/${submissionId}/${fieldKey}/${timestamp}_${file.name}`;
      const buffer = Buffer.from(await file.arrayBuffer());

      await uploadFile(storagePath, buffer);

      const result = await pool
        .request()
        .input("submissionId", sql.Int, Number(submissionId))
        .input("fieldKey", sql.NVarChar(100), fieldKey)
        .input("fileName", sql.NVarChar(500), file.name)
        .input("fileSize", sql.BigInt, file.size)
        .input("contentType", sql.NVarChar(200), file.type)
        .input("storagePath", sql.NVarChar(1000), storagePath)
        .input("uploadedBy", sql.Int, userId)
        .query(
          `INSERT INTO OfficeFormFiles
             (SubmissionId, FieldKey, FileName, FileSize, ContentType, StoragePath, UploadedBy)
           VALUES
             (@submissionId, @fieldKey, @fileName, @fileSize, @contentType, @storagePath, @uploadedBy);
           SELECT SCOPE_IDENTITY() AS Id;`,
        );

      const newId = result.recordset[0].Id;

      const record = await pool
        .request()
        .input("id", sql.Int, newId)
        .query(`SELECT * FROM OfficeFormFiles WHERE Id = @id`);

      created.push(record.recordset[0]);
    }

    return NextResponse.json({ ok: true, data: created });
  } catch (err) {
    console.error("POST /api/forms/submissions/[submissionId]/files error:", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}

/* ── GET /api/forms/submissions/[submissionId]/files ── */

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ submissionId: string }> },
) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const { submissionId } = await params;

  try {
    const pool = await getFormPool();
    const result = await pool
      .request()
      .input("submissionId", sql.Int, Number(submissionId))
      .query(
        `SELECT *
         FROM OfficeFormFiles
         WHERE SubmissionId = @submissionId AND IsActive = 1
         ORDER BY CreatedAt ASC`,
      );

    return NextResponse.json({ ok: true, data: result.recordset });
  } catch (err) {
    console.error("GET /api/forms/submissions/[submissionId]/files error:", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}
