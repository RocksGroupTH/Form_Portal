import { NextRequest, NextResponse } from "next/server";
import { getFormPool, sql } from "@/lib/db/mssql";
import { requireRole } from "@/lib/api-auth";

type RouteParams = { params: Promise<{ formId: string }> };

/* ── GET /api/forms/[formId]/workflow/steps ── */

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

    // Get workflow
    const workflowResult = await pool
      .request()
      .input("formId", sql.Int, id)
      .query(`
        SELECT * FROM OfficeFormWorkflows
        WHERE FormId = @formId AND IsActive = 1
      `);

    const workflow = workflowResult.recordset[0];
    if (!workflow) {
      return NextResponse.json({ ok: true, data: [] });
    }

    // Get steps
    const stepsResult = await pool
      .request()
      .input("workflowId", sql.Int, workflow.Id)
      .query(`
        SELECT * FROM OfficeFormWorkflowSteps
        WHERE WorkflowId = @workflowId AND IsActive = 1
        ORDER BY StepOrder
      `);

    return NextResponse.json({ ok: true, data: stepsResult.recordset });
  } catch (err) {
    console.error("[api/forms] GET [formId]/workflow/steps", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}

/* ── POST /api/forms/[formId]/workflow/steps ── */

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

    const body = await req.json();
    const { name, stepOrder, parallelGroup, assigneeType, assigneeValue, autoApproveCondition } = body;

    if (!name || stepOrder === undefined || !assigneeType) {
      return NextResponse.json(
        { ok: false, error: "name, stepOrder, and assigneeType are required" },
        { status: 400 },
      );
    }

    const pool = await getFormPool();

    // Ensure workflow exists for this form — create if not
    let workflowResult = await pool
      .request()
      .input("formId", sql.Int, id)
      .query(`
        SELECT * FROM OfficeFormWorkflows
        WHERE FormId = @formId AND IsActive = 1
      `);

    let workflow = workflowResult.recordset[0];

    if (!workflow) {
      const createResult = await pool
        .request()
        .input("formId", sql.Int, id)
        .input("createdBy", sql.Int, userId)
        .query(`
          INSERT INTO OfficeFormWorkflows (FormId, Name, CreatedBy)
          OUTPUT INSERTED.*
          VALUES (@formId, 'Default Workflow', @createdBy)
        `);
      workflow = createResult.recordset[0];
    }

    // Insert the step
    const stepResult = await pool
      .request()
      .input("workflowId", sql.Int, workflow.Id)
      .input("name", sql.NVarChar, name)
      .input("stepOrder", sql.Int, stepOrder)
      .input("parallelGroup", sql.NVarChar, parallelGroup ?? null)
      .input("assigneeType", sql.NVarChar, assigneeType)
      .input("assigneeValue", sql.NVarChar, assigneeValue ?? null)
      .input("autoApproveCondition", sql.NVarChar, autoApproveCondition ?? null)
      .query(`
        INSERT INTO OfficeFormWorkflowSteps
          (WorkflowId, Name, StepOrder, ParallelGroup, AssigneeType, AssigneeValue, AutoApproveCondition)
        OUTPUT INSERTED.*
        VALUES (@workflowId, @name, @stepOrder, @parallelGroup, @assigneeType, @assigneeValue, @autoApproveCondition)
      `);

    return NextResponse.json(
      { ok: true, data: stepResult.recordset[0] },
      { status: 201 },
    );
  } catch (err) {
    console.error("[api/forms] POST [formId]/workflow/steps", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}

/* ── PUT /api/forms/[formId]/workflow/steps ── */

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
    const { id: stepId, name, stepOrder, parallelGroup, assigneeType, assigneeValue, autoApproveCondition } = body;

    if (!stepId) {
      return NextResponse.json(
        { ok: false, error: "Step id is required" },
        { status: 400 },
      );
    }

    const pool = await getFormPool();
    const request = pool.request().input("stepId", sql.Int, stepId);

    const setClauses: string[] = [];

    if (name !== undefined) {
      setClauses.push("Name = @name");
      request.input("name", sql.NVarChar, name);
    }
    if (stepOrder !== undefined) {
      setClauses.push("StepOrder = @stepOrder");
      request.input("stepOrder", sql.Int, stepOrder);
    }
    if (parallelGroup !== undefined) {
      setClauses.push("ParallelGroup = @parallelGroup");
      request.input("parallelGroup", sql.NVarChar, parallelGroup);
    }
    if (assigneeType !== undefined) {
      setClauses.push("AssigneeType = @assigneeType");
      request.input("assigneeType", sql.NVarChar, assigneeType);
    }
    if (assigneeValue !== undefined) {
      setClauses.push("AssigneeValue = @assigneeValue");
      request.input("assigneeValue", sql.NVarChar, assigneeValue);
    }
    if (autoApproveCondition !== undefined) {
      setClauses.push("AutoApproveCondition = @autoApproveCondition");
      request.input("autoApproveCondition", sql.NVarChar, autoApproveCondition);
    }

    if (setClauses.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No fields to update" },
        { status: 400 },
      );
    }

    setClauses.push("UpdatedAt = GETDATE()");

    const result = await request.query(`
      UPDATE OfficeFormWorkflowSteps
      SET ${setClauses.join(", ")}
      OUTPUT INSERTED.*
      WHERE Id = @stepId AND IsActive = 1
    `);

    const updated = result.recordset[0];
    if (!updated) {
      return NextResponse.json(
        { ok: false, error: "Step not found" },
        { status: 404 },
      );
    }

    return NextResponse.json({ ok: true, data: updated });
  } catch (err) {
    console.error("[api/forms] PUT [formId]/workflow/steps", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}

/* ── DELETE /api/forms/[formId]/workflow/steps ── */

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

    const body = await req.json();
    const { id: stepId } = body;

    if (!stepId) {
      return NextResponse.json(
        { ok: false, error: "Step id is required" },
        { status: 400 },
      );
    }

    const pool = await getFormPool();

    const result = await pool
      .request()
      .input("id", sql.Int, stepId)
      .query(`
        UPDATE OfficeFormWorkflowSteps
        SET IsActive = 0, UpdatedAt = GETDATE()
        WHERE Id = @id
      `);

    if (result.rowsAffected[0] === 0) {
      return NextResponse.json(
        { ok: false, error: "Step not found" },
        { status: 404 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/forms] DELETE [formId]/workflow/steps", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}
