/**
 * Email templates for form workflow notifications.
 * All return HTML strings styled with inline CSS for email compatibility.
 */

const APP_NAME = "Rocks Fast";
const BRAND_COLOR = "#A3121B";
const BRAND_BG = "#1A0608";

/** Escape user content for safe HTML injection */
function esc(unsafe: string | null | undefined): string {
  if (!unsafe) return "";
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function baseLayout(title: string, body: string, actionUrl?: string, actionLabel?: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f0eded;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0eded;padding:24px 0;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
  <!-- Header -->
  <tr><td style="background:${BRAND_BG};padding:20px 24px;">
    <span style="color:#ffffff;font-size:16px;font-weight:700;">${APP_NAME}</span>
  </td></tr>
  <!-- Title -->
  <tr><td style="padding:24px 24px 8px;">
    <h1 style="margin:0;font-size:18px;color:#111111;">${title}</h1>
  </td></tr>
  <!-- Body -->
  <tr><td style="padding:8px 24px 24px;font-size:14px;color:#333333;line-height:1.6;">
    ${body}
  </td></tr>
  ${actionUrl ? `
  <!-- CTA Button -->
  <tr><td style="padding:0 24px 24px;" align="center">
    <a href="${actionUrl}" style="display:inline-block;background:${BRAND_COLOR};color:#ffffff;font-weight:700;font-size:14px;padding:12px 28px;border-radius:8px;text-decoration:none;">
      ${actionLabel ?? "View Details"}
    </a>
  </td></tr>` : ""}
  <!-- Footer -->
  <tr><td style="padding:16px 24px;border-top:1px solid #e5e0e0;font-size:11px;color:#888888;">
    This is an automated notification from ${APP_NAME}. Please do not reply to this email.
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function fieldRow(label: string, value: string): string {
  return `<tr>
    <td style="padding:4px 0;font-size:13px;color:#888888;width:140px;vertical-align:top;">${esc(label)}</td>
    <td style="padding:4px 0;font-size:13px;color:#111111;font-weight:500;">${esc(value)}</td>
  </tr>`;
}

function fieldsTable(fields: { label: string; value: string }[]): string {
  return `<table cellpadding="0" cellspacing="0" style="width:100%;margin:12px 0;">
    ${fields.map((f) => fieldRow(f.label, f.value)).join("")}
  </table>`;
}

/* ── Template Functions ── */

interface EmailContext {
  formName: string;
  submissionId: number;
  submitterName: string;
  submitterEmail: string;
  appUrl: string;
  keyFields?: { label: string; value: string }[];
}

/** Sent to approver when a submission needs their review */
export function newApprovalEmail(ctx: EmailContext & { stepName: string; approverName: string }): { subject: string; bodyHtml: string } {
  const url = `${ctx.appUrl}/forms/submissions/${ctx.submissionId}`;
  return {
    subject: `[Action Required] ${ctx.formName} — Pending your approval`,
    bodyHtml: baseLayout(
      `New Approval Request`,
      `<p>Hi <strong>${esc(ctx.approverName)}</strong>,</p>
       <p><strong>${esc(ctx.submitterName)}</strong> has submitted a <strong>${esc(ctx.formName)}</strong> that requires your approval at step: <strong>${esc(ctx.stepName)}</strong>.</p>
       ${ctx.keyFields ? fieldsTable(ctx.keyFields) : ""}
       <p>Please review and take action.</p>`,
      url,
      "Review & Approve",
    ),
  };
}

/** Sent to submitter when their submission is approved */
export function approvedEmail(ctx: EmailContext & { approverName: string; comment?: string | null }): { subject: string; bodyHtml: string } {
  const url = `${ctx.appUrl}/forms/submissions/${ctx.submissionId}`;
  return {
    subject: `[Approved] ${ctx.formName} #${ctx.submissionId}`,
    bodyHtml: baseLayout(
      `Your submission has been approved`,
      `<p>Hi <strong>${esc(ctx.submitterName)}</strong>,</p>
       <p>Your <strong>${esc(ctx.formName)}</strong> submission has been fully approved.</p>
       ${ctx.comment ? `<p style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:12px;font-size:13px;color:#166534;"><strong>Comment:</strong> ${esc(ctx.comment)}</p>` : ""}
       ${ctx.keyFields ? fieldsTable(ctx.keyFields) : ""}`,
      url,
    ),
  };
}

/** Sent to submitter when their submission is rejected */
export function rejectedEmail(ctx: EmailContext & { approverName: string; stepName: string; comment: string }): { subject: string; bodyHtml: string } {
  const url = `${ctx.appUrl}/forms/submissions/${ctx.submissionId}`;
  return {
    subject: `[Rejected] ${ctx.formName} #${ctx.submissionId}`,
    bodyHtml: baseLayout(
      `Your submission has been rejected`,
      `<p>Hi <strong>${esc(ctx.submitterName)}</strong>,</p>
       <p>Your <strong>${esc(ctx.formName)}</strong> submission was rejected by <strong>${esc(ctx.approverName)}</strong> at step: <strong>${esc(ctx.stepName)}</strong>.</p>
       <p style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px;font-size:13px;color:#991b1b;"><strong>Reason:</strong> ${esc(ctx.comment)}</p>
       ${ctx.keyFields ? fieldsTable(ctx.keyFields) : ""}`,
      url,
    ),
  };
}

/** Sent to submitter when their submission is returned for revision */
export function returnedEmail(ctx: EmailContext & { approverName: string; stepName: string; comment: string }): { subject: string; bodyHtml: string } {
  const url = `${ctx.appUrl}/forms/submissions/${ctx.submissionId}`;
  return {
    subject: `[Returned] ${ctx.formName} #${ctx.submissionId} — Changes requested`,
    bodyHtml: baseLayout(
      `Changes requested on your submission`,
      `<p>Hi <strong>${esc(ctx.submitterName)}</strong>,</p>
       <p>Your <strong>${esc(ctx.formName)}</strong> submission was returned by <strong>${esc(ctx.approverName)}</strong> at step: <strong>${esc(ctx.stepName)}</strong>.</p>
       <p style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:12px;font-size:13px;color:#92400e;"><strong>Feedback:</strong> ${esc(ctx.comment)}</p>
       <p>Please revise and resubmit.</p>`,
      url,
      "Revise Submission",
    ),
  };
}

/** Sent when submission is first submitted (confirmation to submitter) */
export function submittedEmail(ctx: EmailContext): { subject: string; bodyHtml: string } {
  const url = `${ctx.appUrl}/forms/submissions/${ctx.submissionId}`;
  return {
    subject: `[Submitted] ${ctx.formName} #${ctx.submissionId}`,
    bodyHtml: baseLayout(
      `Submission received`,
      `<p>Hi <strong>${esc(ctx.submitterName)}</strong>,</p>
       <p>Your <strong>${esc(ctx.formName)}</strong> has been submitted successfully and is pending review.</p>
       ${ctx.keyFields ? fieldsTable(ctx.keyFields) : ""}
       <p>You will be notified when there's an update.</p>`,
      url,
    ),
  };
}

/** SLA reminder sent to approver when approval is overdue */
export function reminderEmail(ctx: EmailContext & { stepName: string; approverName: string; daysOverdue: number }): { subject: string; bodyHtml: string } {
  const url = `${ctx.appUrl}/forms/submissions/${ctx.submissionId}`;
  return {
    subject: `[Reminder] ${ctx.formName} — Approval overdue by ${ctx.daysOverdue} day(s)`,
    bodyHtml: baseLayout(
      `Approval reminder — overdue`,
      `<p>Hi <strong>${esc(ctx.approverName)}</strong>,</p>
       <p>A <strong>${esc(ctx.formName)}</strong> submitted by <strong>${esc(ctx.submitterName)}</strong> is waiting for your approval at step: <strong>${esc(ctx.stepName)}</strong>.</p>
       <p style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px;font-size:13px;color:#991b1b;">This approval is <strong>${ctx.daysOverdue} day(s) overdue</strong>.</p>
       <p>Please review as soon as possible.</p>`,
      url,
      "Review Now",
    ),
  };
}
