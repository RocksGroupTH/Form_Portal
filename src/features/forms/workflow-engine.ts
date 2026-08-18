/**
 * Workflow Engine — handles routing submissions through approval steps.
 *
 * Supports:
 * - Sequential steps (StepOrder 1 → 2 → 3)
 * - Parallel steps (same StepOrder, different ParallelGroup → all must approve)
 * - Auto-approve conditions (skip step if condition met)
 * - submitter_manager and role assignee resolution (@/lib/team-member/service)
 */

import { getFormPool, sql } from "@/lib/db/mssql";
import { firstActiveWithRole, managerIdOf } from "@/lib/team-member/service";
import {
  queueNewApprovalEmail, queueApprovedEmail,
  queueRejectedEmail, queueReturnedEmail,
} from "./email-queue";

/* ── Types ── */

interface WorkflowStep {
  Id: number;
  WorkflowId: number;
  StepOrder: number;
  ParallelGroup: string | null;
  Name: string;
  AssigneeType: string; // 'user' | 'role' | 'submitter_manager'
  AssigneeValue: string | null;
  AutoApproveCondition: string | null;
  IsActive: boolean;
}

interface ApprovalRow {
  Id: number;
  SubmissionId: number;
  WorkflowStepId: number;
  AssignedTo: number | null;
  Status: string;
  StepOrder: number;
  ParallelGroup: string | null;
}

/* ── Resolve assignee ── */

async function resolveAssignee(
  step: WorkflowStep,
  submitterId: number,
): Promise<number | null> {
  if (step.AssigneeType === "user" && step.AssigneeValue) {
    return Number(step.AssigneeValue);
  }

  if (step.AssigneeType === "submitter_manager") {
    return managerIdOf(submitterId);
  }

  if (step.AssigneeType === "role" && step.AssigneeValue) {
    // AssigneeValue is free-text workflow configuration, not a validated Role,
    // so an unrecognised spelling has to resolve to nobody rather than throw —
    // firstActiveWithRole() is written that way for this call site.
    return firstActiveWithRole(step.AssigneeValue);
  }

  return null;
}

/* ── Check auto-approve condition ── */

function shouldAutoApprove(
  step: WorkflowStep,
  submissionData: Record<string, unknown>,
): boolean {
  if (!step.AutoApproveCondition) return false;
  try {
    const condition = JSON.parse(step.AutoApproveCondition) as {
      field: string;
      operator: string;
      value: unknown;
    };
    const fieldVal = submissionData[condition.field];
    if (fieldVal === undefined) return false;

    switch (condition.operator) {
      case "lt": return Number(fieldVal) < Number(condition.value);
      case "lte": return Number(fieldVal) <= Number(condition.value);
      case "gt": return Number(fieldVal) > Number(condition.value);
      case "gte": return Number(fieldVal) >= Number(condition.value);
      case "eq": return String(fieldVal) === String(condition.value);
      case "neq": return String(fieldVal) !== String(condition.value);
      default: return false;
    }
  } catch {
    return false;
  }
}

/* ── Start workflow (called when submission is submitted) ── */

export async function startWorkflow(
  submissionId: number,
  formId: number,
  submitterId: number,
  submissionData: Record<string, unknown>,
): Promise<{ started: boolean; message: string }> {
  const formPool = await getFormPool();

  // Get active workflow for this form
  const wfResult = await formPool
    .request()
    .input("formId", sql.Int, formId)
    .query("SELECT Id, SLADays FROM OfficeFormWorkflows WHERE FormId = @formId AND IsActive = 1");

  if (wfResult.recordset.length === 0) {
    // No workflow configured — submission stays as Submitted
    return { started: false, message: "No workflow configured" };
  }

  const workflow = wfResult.recordset[0];

  // Get all active steps ordered
  const stepsResult = await formPool
    .request()
    .input("workflowId", sql.Int, workflow.Id)
    .query(
      "SELECT Id, WorkflowId, StepOrder, ParallelGroup, Name, AssigneeType, AssigneeValue, AutoApproveCondition, IsActive FROM OfficeFormWorkflowSteps WHERE WorkflowId = @workflowId AND IsActive = 1 ORDER BY StepOrder, ParallelGroup"
    );

  const steps = stepsResult.recordset as WorkflowStep[];
  if (steps.length === 0) {
    return { started: false, message: "Workflow has no steps" };
  }

  // Update submission status to InReview
  await formPool
    .request()
    .input("subId", sql.Int, submissionId)
    .query("UPDATE OfficeFormSubmissions SET Status = 'InReview', UpdatedAt = GETDATE() WHERE Id = @subId");

  // Create approval rows for the first step order
  const firstOrder = steps[0].StepOrder;
  const firstSteps = steps.filter((s) => s.StepOrder === firstOrder);

  await createApprovalRows(formPool, submissionId, submitterId, firstSteps, submissionData, workflow.SLADays);

  return { started: true, message: "Workflow started" };
}

/* ── Create approval rows for a set of steps ── */

async function createApprovalRows(
  pool: Awaited<ReturnType<typeof getFormPool>>,
  submissionId: number,
  submitterId: number,
  steps: WorkflowStep[],
  submissionData: Record<string, unknown>,
  slaDays: number | null,
) {
  for (const step of steps) {
    // Check auto-approve
    if (shouldAutoApprove(step, submissionData)) {
      await pool
        .request()
        .input("subId", sql.Int, submissionId)
        .input("stepId", sql.Int, step.Id)
        .input("status", sql.NVarChar, "Skipped")
        .query(
          "INSERT INTO OfficeFormApprovals (SubmissionId, WorkflowStepId, Status, ActionAt, Comment) VALUES (@subId, @stepId, @status, GETDATE(), 'Auto-approved by condition')"
        );

      // Log
      await logActivity(pool, submissionId, 0, "Approved", "Auto-approved: " + step.Name);
      continue;
    }

    const assignedTo = await resolveAssignee(step, submitterId);
    if (!assignedTo) {
      console.warn(`[Workflow] Could not resolve assignee for step ${step.Id} (${step.Name}), type=${step.AssigneeType}`);
    }
    const dueAt = slaDays ? new Date(Date.now() + slaDays * 24 * 60 * 60 * 1000).toISOString() : null;

    await pool
      .request()
      .input("subId", sql.Int, submissionId)
      .input("stepId", sql.Int, step.Id)
      .input("assignedTo", sql.Int, assignedTo)
      .input("dueAt", sql.DateTime2, dueAt)
      .query(
        "INSERT INTO OfficeFormApprovals (SubmissionId, WorkflowStepId, AssignedTo, Status, DueAt) VALUES (@subId, @stepId, @assignedTo, 'Pending', @dueAt)"
      );

    // Queue email notification to approver
    if (assignedTo) {
      void queueNewApprovalEmail(submissionId, assignedTo, step.Name);
    }
  }

  // If all first-order steps were auto-approved, advance
  await advanceWorkflow(pool, submissionId, submitterId, submissionData, slaDays);
}

/* ── Process an approval action ── */

export async function processApprovalAction(
  approvalId: number,
  action: "approve" | "reject" | "return",
  comment: string | null,
  actorId: number,
): Promise<{ ok: boolean; message: string }> {
  const formPool = await getFormPool();

  // Get the approval row
  const apResult = await formPool
    .request()
    .input("id", sql.Int, approvalId)
    .query(
      "SELECT a.Id, a.SubmissionId, a.WorkflowStepId, a.AssignedTo, a.Status, s.StepOrder, s.ParallelGroup, s.WorkflowId FROM OfficeFormApprovals a JOIN OfficeFormWorkflowSteps s ON a.WorkflowStepId = s.Id WHERE a.Id = @id"
    );

  if (apResult.recordset.length === 0) {
    return { ok: false, message: "Approval not found" };
  }

  const approval = apResult.recordset[0] as ApprovalRow & { WorkflowId: number };

  if (approval.Status !== "Pending") {
    return { ok: false, message: "Already processed" };
  }

  // Verify actor is the assigned approver
  if (approval.AssignedTo && approval.AssignedTo !== actorId) {
    return { ok: false, message: "Not your approval" };
  }

  const statusMap = { approve: "Approved", reject: "Rejected", return: "Returned" } as const;
  const newStatus = statusMap[action];

  // Update the approval row
  await formPool
    .request()
    .input("id", sql.Int, approvalId)
    .input("status", sql.NVarChar, newStatus)
    .input("comment", sql.NVarChar, comment)
    .input("actorId", sql.Int, actorId)
    .query(
      "UPDATE OfficeFormApprovals SET Status = @status, Comment = @comment, ActionAt = GETDATE(), AssignedTo = @actorId WHERE Id = @id"
    );

  // Log the action
  await logActivity(formPool, approval.SubmissionId, actorId, newStatus, comment);

  // Get step name for email context
  const stepResult = await formPool.request()
    .input("stepId", sql.Int, approval.WorkflowStepId)
    .query("SELECT Name FROM OfficeFormWorkflowSteps WHERE Id = @stepId");
  const stepName = stepResult.recordset[0]?.Name ?? "Approval";

  if (action === "reject") {
    await formPool
      .request()
      .input("subId", sql.Int, approval.SubmissionId)
      .query("UPDATE OfficeFormSubmissions SET Status = 'Rejected', CompletedAt = GETDATE(), UpdatedAt = GETDATE() WHERE Id = @subId");
    void queueRejectedEmail(approval.SubmissionId, actorId, stepName, comment ?? "No reason provided");
    return { ok: true, message: "Rejected" };
  }

  if (action === "return") {
    await formPool
      .request()
      .input("subId", sql.Int, approval.SubmissionId)
      .query("UPDATE OfficeFormSubmissions SET Status = 'Returned', UpdatedAt = GETDATE() WHERE Id = @subId");
    void queueReturnedEmail(approval.SubmissionId, actorId, stepName, comment ?? "Please revise");
    return { ok: true, message: "Returned for revision" };
  }

  // action === "approve" — check if we can advance
  // Get workflow + submission data for advancing
  const wfResult = await formPool
    .request()
    .input("wfId", sql.Int, approval.WorkflowId)
    .query("SELECT SLADays FROM OfficeFormWorkflows WHERE Id = @wfId");
  const slaDays = wfResult.recordset[0]?.SLADays ?? null;

  const subResult = await formPool
    .request()
    .input("subId", sql.Int, approval.SubmissionId)
    .query("SELECT SubmittedBy, DataJson FROM OfficeFormSubmissions WHERE Id = @subId");
  const submitterId = subResult.recordset[0]?.SubmittedBy;
  if (!submitterId) {
    return { ok: false, message: "Could not retrieve submission info" };
  }
  const submissionData = JSON.parse(subResult.recordset[0]?.DataJson ?? "{}");

  await advanceWorkflow(formPool, approval.SubmissionId, submitterId, submissionData, slaDays);

  return { ok: true, message: "Approved" };
}

/* ── Advance workflow after an approval ── */

async function advanceWorkflow(
  pool: Awaited<ReturnType<typeof getFormPool>>,
  submissionId: number,
  submitterId: number,
  submissionData: Record<string, unknown>,
  slaDays: number | null,
) {
  // Get all approvals for this submission
  const allResult = await pool
    .request()
    .input("subId", sql.Int, submissionId)
    .query(
      "SELECT a.Id, a.Status, s.StepOrder, s.ParallelGroup FROM OfficeFormApprovals a JOIN OfficeFormWorkflowSteps s ON a.WorkflowStepId = s.Id WHERE a.SubmissionId = @subId ORDER BY s.StepOrder, s.ParallelGroup"
    );

  const allApprovals = allResult.recordset as { Id: number; Status: string; StepOrder: number; ParallelGroup: string | null }[];

  // Find the current step order (lowest order with a Pending approval)
  const pending = allApprovals.filter((a) => a.Status === "Pending");
  if (pending.length > 0) {
    // Still waiting on approvals at the current step
    return;
  }

  // All current approvals are done — check if any were rejected/returned
  const hasRejected = allApprovals.some((a) => a.Status === "Rejected");
  const hasReturned = allApprovals.some((a) => a.Status === "Returned");
  if (hasRejected || hasReturned) return; // Already handled

  // All done so far — find next step order
  const completedOrders = allApprovals.map((a) => a.StepOrder);
  const maxCompletedOrder = Math.max.apply(null, completedOrders);

  // Get workflow steps for this submission's form
  const subResult = await pool
    .request()
    .input("subId", sql.Int, submissionId)
    .query("SELECT FormId FROM OfficeFormSubmissions WHERE Id = @subId");
  const formId = subResult.recordset[0]?.FormId;

  const wfResult = await pool
    .request()
    .input("formId", sql.Int, formId)
    .query("SELECT Id FROM OfficeFormWorkflows WHERE FormId = @formId AND IsActive = 1");
  const workflowId = wfResult.recordset[0]?.Id;
  if (!workflowId) return;

  const nextStepsResult = await pool
    .request()
    .input("wfId", sql.Int, workflowId)
    .input("maxOrder", sql.Int, maxCompletedOrder)
    .query(
      "SELECT Id, WorkflowId, StepOrder, ParallelGroup, Name, AssigneeType, AssigneeValue, AutoApproveCondition, IsActive FROM OfficeFormWorkflowSteps WHERE WorkflowId = @wfId AND IsActive = 1 AND StepOrder > @maxOrder ORDER BY StepOrder, ParallelGroup"
    );

  const remainingSteps = nextStepsResult.recordset as WorkflowStep[];

  if (remainingSteps.length === 0) {
    // No more steps — submission is fully approved!
    await pool
      .request()
      .input("subId", sql.Int, submissionId)
      .query("UPDATE OfficeFormSubmissions SET Status = 'Approved', CompletedAt = GETDATE(), UpdatedAt = GETDATE() WHERE Id = @subId");

    // Find last actual approver for the email
    const lastApproverResult = await pool
      .request()
      .input("subId", sql.Int, submissionId)
      .query("SELECT TOP 1 AssignedTo FROM OfficeFormApprovals WHERE SubmissionId = @subId AND Status = 'Approved' ORDER BY ActionAt DESC");
    const lastApproverId = lastApproverResult.recordset[0]?.AssignedTo ?? 0;

    await logActivity(pool, submissionId, lastApproverId, "Approved", "All approval steps completed");
    void queueApprovedEmail(submissionId, lastApproverId, "All approval steps completed");
    return;
  }

  // Create approvals for the next step order
  const nextOrder = remainingSteps[0].StepOrder;
  const nextSteps = remainingSteps.filter((s) => s.StepOrder === nextOrder);

  await createApprovalRows(pool, submissionId, submitterId, nextSteps, submissionData, slaDays);
}

/* ── Activity log helper ── */

async function logActivity(
  pool: Awaited<ReturnType<typeof getFormPool>>,
  submissionId: number,
  authorId: number,
  logType: string,
  note: string | null,
) {
  await pool
    .request()
    .input("entityType", sql.NVarChar, "Submission")
    .input("entityId", sql.Int, submissionId)
    .input("authorId", sql.Int, authorId)
    .input("logType", sql.NVarChar, logType)
    .input("note", sql.NVarChar, note)
    .query(
      "INSERT INTO OfficeFormActivityLog (EntityType, EntityId, AuthorId, LogType, Note) VALUES (@entityType, @entityId, @authorId, @logType, @note)"
    );
}
