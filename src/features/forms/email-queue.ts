/**
 * Email Queue — queue emails to OfficeFormEmailQueue for async processing.
 * Decouples email sending from the request/response cycle.
 */

import { getFormPool, sql } from "@/lib/db/mssql";
import { findById } from "@/lib/team-member/service";
import {
  newApprovalEmail, approvedEmail, rejectedEmail,
  returnedEmail, submittedEmail, reminderEmail,
} from "./email-templates";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3081";

/* ── Helpers ── */

/** Who to address an email to. Kept in the column shape the templates below read. */
async function getTeamMember(userId: number): Promise<{ FullName: string; Email: string } | null> {
  const member = await findById(userId);
  return member ? { FullName: member.fullName, Email: member.email } : null;
}

async function getSubmissionContext(submissionId: number) {
  const pool = await getFormPool();
  const result = await pool.request()
    .input("id", sql.Int, submissionId)
    .query(`
      SELECT s.Id, s.FormId, s.SubmittedBy, s.DataJson,
             f.Name as FormName
      FROM OfficeFormSubmissions s
      JOIN OfficeForms f ON f.Id = s.FormId
      WHERE s.Id = @id
    `);
  return result.recordset[0] ?? null;
}

function extractKeyFields(dataJson: string, maxFields: number = 4): { label: string; value: string }[] {
  try {
    const data = JSON.parse(dataJson);
    const keys = Object.keys(data).slice(0, maxFields);
    return keys
      .filter((k) => typeof data[k] === "string" || typeof data[k] === "number")
      .map((k) => ({
        label: k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        value: String(data[k]),
      }));
  } catch {
    return [];
  }
}

async function queueEmail(
  toEmail: string,
  subject: string,
  bodyHtml: string,
  submissionId: number | null,
  triggerType: string,
) {
  const pool = await getFormPool();
  await pool.request()
    .input("to", sql.NVarChar, toEmail)
    .input("subject", sql.NVarChar, subject)
    .input("body", sql.NVarChar, bodyHtml)
    .input("subId", sql.Int, submissionId)
    .input("trigger", sql.NVarChar, triggerType)
    .query(
      "INSERT INTO OfficeFormEmailQueue (ToEmail, Subject, BodyHtml, SubmissionId, TriggerType) VALUES (@to, @subject, @body, @subId, @trigger)"
    );
}

/* ── Public queue functions ── */

/** Queue email to approver when a new approval step is created */
export async function queueNewApprovalEmail(
  submissionId: number,
  approverUserId: number,
  stepName: string,
): Promise<void> {
  try {
    const sub = await getSubmissionContext(submissionId);
    if (!sub) return;

    const submitter = await getTeamMember(sub.SubmittedBy);
    const approver = await getTeamMember(approverUserId);
    if (!submitter || !approver) return;

    const email = newApprovalEmail({
      formName: sub.FormName,
      submissionId,
      submitterName: submitter.FullName,
      submitterEmail: submitter.Email,
      appUrl: APP_URL,
      stepName,
      approverName: approver.FullName,
      keyFields: extractKeyFields(sub.DataJson),
    });

    await queueEmail(approver.Email, email.subject, email.bodyHtml, submissionId, "NewApproval");
  } catch (err) {
    console.error("[EmailQueue] Failed to queue NewApproval:", err);
  }
}

/** Queue email to submitter when fully approved */
export async function queueApprovedEmail(
  submissionId: number,
  approverUserId: number,
  comment: string | null,
): Promise<void> {
  try {
    const sub = await getSubmissionContext(submissionId);
    if (!sub) return;

    const submitter = await getTeamMember(sub.SubmittedBy);
    const approver = await getTeamMember(approverUserId);
    if (!submitter) return;

    const email = approvedEmail({
      formName: sub.FormName,
      submissionId,
      submitterName: submitter.FullName,
      submitterEmail: submitter.Email,
      appUrl: APP_URL,
      approverName: approver?.FullName ?? "System",
      comment,
      keyFields: extractKeyFields(sub.DataJson),
    });

    await queueEmail(submitter.Email, email.subject, email.bodyHtml, submissionId, "Approved");
  } catch (err) {
    console.error("[EmailQueue] Failed to queue Approved:", err);
  }
}

/** Queue email to submitter when rejected */
export async function queueRejectedEmail(
  submissionId: number,
  approverUserId: number,
  stepName: string,
  comment: string,
): Promise<void> {
  try {
    const sub = await getSubmissionContext(submissionId);
    if (!sub) return;

    const submitter = await getTeamMember(sub.SubmittedBy);
    const approver = await getTeamMember(approverUserId);
    if (!submitter) return;

    const email = rejectedEmail({
      formName: sub.FormName,
      submissionId,
      submitterName: submitter.FullName,
      submitterEmail: submitter.Email,
      appUrl: APP_URL,
      approverName: approver?.FullName ?? "Unknown",
      stepName,
      comment,
      keyFields: extractKeyFields(sub.DataJson),
    });

    await queueEmail(submitter.Email, email.subject, email.bodyHtml, submissionId, "Rejected");
  } catch (err) {
    console.error("[EmailQueue] Failed to queue Rejected:", err);
  }
}

/** Queue email to submitter when returned */
export async function queueReturnedEmail(
  submissionId: number,
  approverUserId: number,
  stepName: string,
  comment: string,
): Promise<void> {
  try {
    const sub = await getSubmissionContext(submissionId);
    if (!sub) return;

    const submitter = await getTeamMember(sub.SubmittedBy);
    const approver = await getTeamMember(approverUserId);
    if (!submitter) return;

    const email = returnedEmail({
      formName: sub.FormName,
      submissionId,
      submitterName: submitter.FullName,
      submitterEmail: submitter.Email,
      appUrl: APP_URL,
      approverName: approver?.FullName ?? "Unknown",
      stepName,
      comment,
      keyFields: extractKeyFields(sub.DataJson),
    });

    await queueEmail(submitter.Email, email.subject, email.bodyHtml, submissionId, "Returned");
  } catch (err) {
    console.error("[EmailQueue] Failed to queue Returned:", err);
  }
}

/** Queue confirmation email to submitter */
export async function queueSubmittedEmail(submissionId: number): Promise<void> {
  try {
    const sub = await getSubmissionContext(submissionId);
    if (!sub) return;

    const submitter = await getTeamMember(sub.SubmittedBy);
    if (!submitter) return;

    const email = submittedEmail({
      formName: sub.FormName,
      submissionId,
      submitterName: submitter.FullName,
      submitterEmail: submitter.Email,
      appUrl: APP_URL,
      keyFields: extractKeyFields(sub.DataJson),
    });

    await queueEmail(submitter.Email, email.subject, email.bodyHtml, submissionId, "Submitted");
  } catch (err) {
    console.error("[EmailQueue] Failed to queue Submitted:", err);
  }
}

export { reminderEmail };
