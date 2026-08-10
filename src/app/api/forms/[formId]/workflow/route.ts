import { NextRequest, NextResponse } from "next/server";
import { getFormPool, sql } from "@/lib/db/mssql";
import { requireRole } from "@/lib/api-auth";

type RouteParams = { params: Promise<{ formId: string }> };

/* ── GET /api/forms/[formId]/workflow ── */

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
      return NextResponse.json({
        ok: true,
        data: { workflow: null, steps: [] },
      });
    }

    // Get steps
    const stepsResult = await pool
      .request()
      .input("workflowId", sql.Int, workflow.Id)
      .query(`
        SELECT * FROM OfficeFormWorkflowSteps
        WHERE WorkflowId = @workflowId AND IsActive = 1
        ORDER BY StepOrder, ParallelGroup
      `);

    return NextResponse.json({
      ok: true,
      data: { workflow, steps: stepsResult.recordset },
    });
  } catch (err) {
    console.error("[api/forms] GET [formId]/workflow", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}

/* ── PUT /api/forms/[formId]/workflow ── */

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
    const { name, slaDays } = body;

    const pool = await getFormPool();
    const request = pool.request().input("formId", sql.Int, id);

    const setClauses: string[] = [];

    if (name !== undefined) {
      setClauses.push("Name = @name");
      request.input("name", sql.NVarChar, name);
    }
    if (slaDays !== undefined) {
      setClauses.push("SlaDays = @slaDays");
      request.input("slaDays", sql.Int, slaDays);
    }

    if (setClauses.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No fields to update" },
        { status: 400 },
      );
    }

    setClauses.push("UpdatedAt = GETDATE()");

    const result = await request.query(`
      UPDATE OfficeFormWorkflows
      SET ${setClauses.join(", ")}
      OUTPUT INSERTED.*
      WHERE FormId = @formId AND IsActive = 1
    `);

    const updated = result.recordset[0];
    if (!updated) {
      return NextResponse.json(
        { ok: false, error: "Workflow not found" },
        { status: 404 },
      );
    }

    return NextResponse.json({ ok: true, data: updated });
  } catch (err) {
    console.error("[api/forms] PUT [formId]/workflow", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}
