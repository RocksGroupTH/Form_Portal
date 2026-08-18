import { NextRequest, NextResponse } from "next/server";
import { getFormPool, sql } from "@/lib/db/mssql";
import { teamMemberTableRef } from "@/lib/team-member/service";
import { requireAuth } from "@/lib/api-auth";

/* ── GET /api/forms/approvals ── */

export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth();
    if (session instanceof Response) return session;

    const userId = Number(session.user.id);

    const pool = await getFormPool();

    const result = await pool
      .request()
      .input("userId", sql.Int, userId)
      .query(`
        SELECT
          a.*,
          s.Name AS StepName,
          s.StepOrder,
          f.Name AS FormName,
          sub.DataJson,
          sub.SubmittedAt,
          (SELECT tm.FullName FROM ${teamMemberTableRef()} tm WHERE tm.Id = sub.SubmittedBy) AS SubmitterName
        FROM OfficeFormApprovals a
        JOIN OfficeFormWorkflowSteps s ON a.WorkflowStepId = s.Id
        JOIN OfficeFormSubmissions sub ON a.SubmissionId = sub.Id
        JOIN OfficeForms f ON sub.FormId = f.Id
        WHERE a.AssignedTo = @userId AND a.Status = 'Pending'
        ORDER BY a.CreatedAt ASC
      `);

    return NextResponse.json({ ok: true, data: result.recordset });
  } catch (err) {
    console.error("[api/forms] GET approvals", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}
