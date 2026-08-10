import { NextRequest, NextResponse } from "next/server";
import { getFormPool, sql } from "@/lib/db/mssql";
import { requireAuth } from "@/lib/api-auth";

/* ── POST /api/forms/submissions/[submissionId]/cancel ── */

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ submissionId: string }> },
) {
  const session = await requireAuth();
  if (session instanceof Response) return session;
  const userId = Number(session.user.id);

  const { submissionId } = await params;

  try {
    const pool = await getFormPool();

    // Verify ownership
    const existing = await pool
      .request()
      .input("id", sql.Int, Number(submissionId))
      .input("userId", sql.Int, userId)
      .query(
        `SELECT Id, Status
         FROM OfficeFormSubmissions
         WHERE Id = @id AND SubmittedBy = @userId AND IsActive = 1`,
      );

    if (existing.recordset.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Submission not found" },
        { status: 404 },
      );
    }

    const { Status } = existing.recordset[0];
    if (Status !== "Draft" && Status !== "Submitted") {
      return NextResponse.json(
        { ok: false, error: "Can only cancel Draft or Submitted submissions" },
        { status: 400 },
      );
    }

    // Update status to Cancelled
    await pool
      .request()
      .input("id", sql.Int, Number(submissionId))
      .query(
        `UPDATE OfficeFormSubmissions
         SET Status = 'Cancelled', UpdatedAt = GETDATE()
         WHERE Id = @id`,
      );

    // Log activity
    await pool
      .request()
      .input("entityId", sql.Int, Number(submissionId))
      .input("authorId", sql.Int, userId)
      .query(
        `INSERT INTO OfficeFormActivityLog
           (EntityType, EntityId, AuthorId, LogType)
         VALUES
           ('Submission', @entityId, @authorId, 'Cancelled')`,
      );

    return NextResponse.json({ ok: true, data: { id: Number(submissionId) } });
  } catch (err) {
    console.error("POST /api/forms/submissions/[submissionId]/cancel error:", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}
