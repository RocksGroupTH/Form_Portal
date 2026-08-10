import { NextRequest, NextResponse } from "next/server";
import { getFormPool, sql } from "@/lib/db/mssql";
import { requireAuth } from "@/lib/api-auth";
import { startWorkflow } from "@/features/forms/workflow-engine";
import { queueSubmittedEmail } from "@/features/forms/email-queue";

/* ── POST /api/forms/submissions/[submissionId]/submit ── */

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

    // Verify ownership and status
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
    if (Status !== "Draft" && Status !== "Returned") {
      return NextResponse.json(
        { ok: false, error: "Only Draft or Returned submissions can be submitted" },
        { status: 400 },
      );
    }

    // Update status to Submitted
    await pool
      .request()
      .input("id", sql.Int, Number(submissionId))
      .query(
        `UPDATE OfficeFormSubmissions
         SET Status = 'Submitted', SubmittedAt = GETDATE(), UpdatedAt = GETDATE()
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
           ('Submission', @entityId, @authorId, 'Submitted')`,
      );

    // Queue confirmation email to submitter
    void queueSubmittedEmail(Number(submissionId));

    // Start approval workflow if configured
    const subDetail = await pool
      .request()
      .input("id", sql.Int, Number(submissionId))
      .query("SELECT FormId, DataJson FROM OfficeFormSubmissions WHERE Id = @id");
    const { FormId, DataJson } = subDetail.recordset[0];
    const data = JSON.parse(DataJson || "{}");

    await startWorkflow(Number(submissionId), FormId, userId, data);

    // Return updated record
    const updated = await pool
      .request()
      .input("id", sql.Int, Number(submissionId))
      .query("SELECT * FROM OfficeFormSubmissions WHERE Id = @id");

    return NextResponse.json({ ok: true, data: updated.recordset[0] });
  } catch (err) {
    console.error("POST /api/forms/submissions/[submissionId]/submit error:", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}
