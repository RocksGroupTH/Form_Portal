import { NextRequest, NextResponse } from "next/server";
import { getFormPool, sql } from "@/lib/db/mssql";
import { teamMemberTableRef } from "@/lib/team-member/service";
import { requireAuth, requireRole } from "@/lib/api-auth";
import { updateSubmissionSchema } from "@/features/forms/schemas";

/* ── GET /api/forms/submissions/[submissionId] ── */

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ submissionId: string }> },
) {
  const session = await requireAuth();
  if (session instanceof Response) return session;
  const userId = Number(session.user.id);

  const { submissionId } = await params;

  try {
    const pool = await getFormPool();
    const result = await pool
      .request()
      .input("id", sql.Int, Number(submissionId))
      .query(
        `SELECT
           s.Id,
           s.FormId,
           s.FormVersionId,
           s.SubmittedBy,
           s.Status,
           s.DataJson,
           s.SubmittedAt,
           s.CreatedAt,
           s.UpdatedAt,
           f.Name       AS FormName,
           v.FieldsJson AS FieldsJson
         FROM OfficeFormSubmissions s
         JOIN OfficeForms f          ON f.Id = s.FormId
         JOIN OfficeFormVersions v   ON v.Id = s.FormVersionId
         WHERE s.Id = @id AND s.IsActive = 1`,
      );

    if (result.recordset.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Submission not found" },
        { status: 404 },
      );
    }

    const submission = result.recordset[0];

    // Access check: own submission, admin, or assigned approver
    if (submission.SubmittedBy !== userId) {
      const approverCheck = await pool
        .request()
        .input("subId", sql.Int, Number(submissionId))
        .input("userId", sql.Int, userId)
        .query("SELECT Id FROM OfficeFormApprovals WHERE SubmissionId = @subId AND AssignedTo = @userId");
      if (approverCheck.recordset.length === 0) {
        const adminSession = await requireRole(["IT Admin", "System Admin"]);
        if (adminSession instanceof Response) return adminSession;
      }
    }

    // Get files
    const filesResult = await pool
      .request()
      .input("subId", sql.Int, Number(submissionId))
      .query("SELECT * FROM OfficeFormFiles WHERE SubmissionId = @subId AND IsActive = 1");

    // Get activity logs
    const logsResult = await pool
      .request()
      .input("subId", sql.Int, Number(submissionId))
      .query(
        `SELECT l.*, (SELECT tm.FullName FROM ${teamMemberTableRef()} tm WHERE tm.Id = l.AuthorId) as AuthorName FROM OfficeFormActivityLog l WHERE l.EntityType = 'Submission' AND l.EntityId = @subId ORDER BY l.CreatedAt DESC`
      );

    // Get approval steps
    const approvalsResult = await pool
      .request()
      .input("subId", sql.Int, Number(submissionId))
      .query(
        `SELECT a.Id, a.SubmissionId, a.WorkflowStepId, a.AssignedTo, a.Status, a.Comment, a.ActionAt, a.DueAt, a.CreatedAt, s.Name as StepName, s.StepOrder, (SELECT tm.FullName FROM ${teamMemberTableRef()} tm WHERE tm.Id = a.AssignedTo) as AssignedToName FROM OfficeFormApprovals a JOIN OfficeFormWorkflowSteps s ON a.WorkflowStepId = s.Id WHERE a.SubmissionId = @subId ORDER BY s.StepOrder, s.ParallelGroup`
      );

    // Get submitter name
    const submitterResult = await pool
      .request()
      .input("uid", sql.Int, submission.SubmittedBy)
      .query(`SELECT FullName FROM ${teamMemberTableRef()} WHERE Id = @uid`);

    const responseData = {
      submission: {
        id: submission.Id,
        formId: submission.FormId,
        formVersionId: submission.FormVersionId,
        formName: submission.FormName,
        submittedBy: submission.SubmittedBy,
        submittedByName: submitterResult.recordset[0]?.FullName ?? null,
        status: submission.Status,
        data: submission.DataJson ? JSON.parse(submission.DataJson) : {},
        submittedAt: submission.SubmittedAt,
        createdAt: submission.CreatedAt,
        updatedAt: submission.UpdatedAt,
      },
      fields: submission.FieldsJson ? JSON.parse(submission.FieldsJson) : [],
      files: filesResult.recordset,
      logs: logsResult.recordset.map((l: Record<string, unknown>) => ({
        id: l.Id, entityType: l.EntityType, entityId: l.EntityId,
        authorId: l.AuthorId, authorName: l.AuthorName,
        logType: l.LogType, note: l.Note, createdAt: l.CreatedAt,
      })),
      approvals: approvalsResult.recordset.map((a: Record<string, unknown>) => ({
        id: a.Id, stepName: a.StepName, stepOrder: a.StepOrder,
        assignedTo: a.AssignedTo, assignedToName: a.AssignedToName,
        status: a.Status, comment: a.Comment,
        actionAt: a.ActionAt, createdAt: a.CreatedAt, dueAt: a.DueAt,
      })),
    };

    return NextResponse.json({ ok: true, data: responseData });
  } catch (err) {
    console.error("GET /api/forms/submissions/[submissionId] error:", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}

/* ── PUT /api/forms/submissions/[submissionId] ── */

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ submissionId: string }> },
) {
  const session = await requireAuth();
  if (session instanceof Response) return session;
  const userId = Number(session.user.id);

  const { submissionId } = await params;

  try {
    const body = await req.json();
    const parsed = updateSubmissionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: parsed.error.flatten().fieldErrors },
        { status: 400 },
      );
    }

    const pool = await getFormPool();

    // Verify ownership and editable status
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
        { ok: false, error: "Submission not found or not yours" },
        { status: 404 },
      );
    }

    const { Status } = existing.recordset[0];
    if (Status !== "Draft" && Status !== "Returned") {
      return NextResponse.json(
        { ok: false, error: "Can only edit Draft or Returned submissions" },
        { status: 400 },
      );
    }

    await pool
      .request()
      .input("id", sql.Int, Number(submissionId))
      .input("data", sql.NVarChar(sql.MAX), JSON.stringify(parsed.data.data))
      .query(
        `UPDATE OfficeFormSubmissions
         SET DataJson = @data, UpdatedAt = GETDATE()
         WHERE Id = @id`,
      );

    // Return updated record
    const updated = await pool
      .request()
      .input("id", sql.Int, Number(submissionId))
      .query(`SELECT * FROM OfficeFormSubmissions WHERE Id = @id`);

    return NextResponse.json({ ok: true, data: updated.recordset[0] });
  } catch (err) {
    console.error("PUT /api/forms/submissions/[submissionId] error:", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}
