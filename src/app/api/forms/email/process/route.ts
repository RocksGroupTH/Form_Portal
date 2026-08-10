import { NextRequest, NextResponse } from "next/server";
import { getFormPool, sql } from "@/lib/db/mssql";
import { requireRole } from "@/lib/api-auth";
import { sendEmail } from "@/lib/graph";

const MAX_BATCH = 20;
const MAX_ATTEMPTS = 3;

/**
 * POST /api/forms/email/process
 *
 * Processes queued emails via Microsoft Graph API.
 * Protected by admin role. Can also be called via cron with API key.
 */
export async function POST(req: NextRequest) {
  // Auth: admin role OR cron secret header
  const cronSecret = req.headers.get("x-cron-secret");
  if (cronSecret !== process.env.CRON_SECRET) {
    const session = await requireRole(["IT Admin", "System Admin"]);
    if (session instanceof Response) return session;
  }
  try {
    const pool = await getFormPool();

    // Get queued emails (oldest first, max retries not exceeded)
    const result = await pool
      .request()
      .input("maxAttempts", sql.Int, MAX_ATTEMPTS)
      .input("limit", sql.Int, MAX_BATCH)
      .query(`
        SELECT TOP (@limit) Id, ToEmail, Subject, BodyHtml, SubmissionId, TriggerType, AttemptCount
        FROM OfficeFormEmailQueue
        WHERE Status = 'Queued' AND AttemptCount < @maxAttempts
        ORDER BY CreatedAt ASC
      `);

    const emails = result.recordset;
    if (emails.length === 0) {
      return NextResponse.json({ ok: true, processed: 0, message: "No emails to process" });
    }

    let sent = 0;
    let failed = 0;

    for (const row of emails) {
      try {
        await sendEmail({
          to: row.ToEmail,
          subject: row.Subject,
          bodyHtml: row.BodyHtml,
        });

        // Mark as sent
        await pool
          .request()
          .input("id", sql.Int, row.Id)
          .query("UPDATE OfficeFormEmailQueue SET Status = 'Sent', SentAt = GETDATE(), AttemptCount = AttemptCount + 1 WHERE Id = @id");

        sent++;
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`[EmailProcessor] Failed to send email ${row.Id}:`, errMsg);

        const newAttempts = (row.AttemptCount ?? 0) + 1;
        const newStatus = newAttempts >= MAX_ATTEMPTS ? "Failed" : "Queued";

        await pool
          .request()
          .input("id", sql.Int, row.Id)
          .input("error", sql.NVarChar, errMsg.slice(0, 1000))
          .input("status", sql.NVarChar, newStatus)
          .query("UPDATE OfficeFormEmailQueue SET Status = @status, ErrorMessage = @error, AttemptCount = AttemptCount + 1 WHERE Id = @id");

        failed++;
      }
    }

    return NextResponse.json({
      ok: true,
      processed: emails.length,
      sent,
      failed,
    });
  } catch (err) {
    console.error("[api/forms/email/process]", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}

/**
 * GET /api/forms/email/process
 *
 * Returns queue stats (useful for monitoring).
 */
export async function GET() {
  try {
    const pool = await getFormPool();
    const result = await pool.request().query(`
      SELECT
        Status,
        COUNT(*) as Count
      FROM OfficeFormEmailQueue
      GROUP BY Status
    `);

    return NextResponse.json({ ok: true, data: result.recordset });
  } catch (err) {
    console.error("[api/forms/email/process] GET", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}
