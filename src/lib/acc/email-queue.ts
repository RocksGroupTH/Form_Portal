import type { ConnectionPool } from "mssql";
import { getAccPool, sql } from "@/lib/acc/pool";
import { getProductionFormPool, getUatFormPool } from "@/lib/db/mssql";
import {
  resolveFormEnvironment,
  type FormEnvironmentValue,
} from "@/lib/form-environment";
import { env } from "@/env";
import { sendEmail } from "@/lib/graph";
import { esc } from "@/lib/acc/email-templates";

export async function queueEmail(p: {
  requestId: number | null;
  toEmail: string;
  subject: string;
  bodyHtml: string;
  triggerType: string;
}): Promise<void> {
  if (!p.toEmail) return;
  const pool = await getAccPool();
  await pool
    .request()
    .input("rid", sql.Int, p.requestId)
    .input("to", sql.NVarChar, p.toEmail)
    .input("sub", sql.NVarChar, p.subject)
    .input("body", sql.NVarChar, p.bodyHtml)
    .input("trig", sql.NVarChar, p.triggerType)
    .query(`INSERT INTO [dbo].[AccEmailQueue] (RequestId,ToEmail,Subject,BodyHtml,TriggerType)
            VALUES (@rid,@to,@sub,@body,@trig)`);
}

/**
 * Rewrite a queued message so a UAT-flagged form cannot email real people.
 *
 * Approval chains resolve against production Rocks_Portal_HR in both
 * environments, so a tester's fake request would otherwise ask a real manager
 * to approve it. The intended recipient stays visible in the body so routing
 * can still be checked.
 */
function applyUatRedirect(m: {
  ToEmail: string;
  Subject: string;
  BodyHtml: string;
}) {
  const to = env.UAT_MAIL_REDIRECT || env.GRAPH_MAIL_FROM;
  if (!to) {
    // Refuse rather than fall back to the real recipient. An unconfigured
    // redirect must fail loudly and leave the message in the queue; sending it
    // to the manager it names is the exact outcome this function prevents.
    throw new Error(
      "UAT mail has nowhere to go: set UAT_MAIL_REDIRECT (or GRAPH_MAIL_FROM). " +
        "Refusing to send to the real recipient.",
    );
  }
  return {
    to,
    subject: `[UAT] ${m.Subject}`,
    bodyHtml:
      `<p style="background:#fff4e5;padding:10px;border-left:4px solid #b5793a;` +
      `font-family:sans-serif;font-size:13px;margin:0 0 12px">` +
      `<b>UAT test mail.</b> In production this would have gone to ` +
      `<b>${esc(m.ToEmail)}</b>.</p>` +
      m.BodyHtml,
  };
}

/**
 * Drain the queue in one specific database.
 *
 * Exported so the sweep endpoint can drain both — an AP-17 request flagged UAT
 * queues its mail in the UAT database, which a production-scoped drain would
 * never see.
 */
export async function processQueueOn(
  pool: ConnectionPool,
  environment: FormEnvironmentValue,
  max = 20,
): Promise<{ sent: number; failed: number }> {
  const rows = (
    await pool.request().input("max", sql.Int, max).query(`
    SELECT TOP (@max) Id, ToEmail, Subject, BodyHtml FROM [dbo].[AccEmailQueue]
    WHERE Status='Queued' AND AttemptCount < 3 ORDER BY Id
  `)
  ).recordset as {
    Id: number;
    ToEmail: string;
    Subject: string;
    BodyHtml: string;
  }[];

  let sent = 0,
    failed = 0;
  for (const m of rows) {
    try {
      const payload =
        environment === "UAT"
          ? applyUatRedirect(m)
          : { to: m.ToEmail, subject: m.Subject, bodyHtml: m.BodyHtml };
      await sendEmail(payload);
      await pool
        .request()
        .input("id", sql.Int, m.Id)
        .query(
          `UPDATE [dbo].[AccEmailQueue] SET Status='Sent', SentAt=SYSDATETIME() WHERE Id=@id`,
        );
      sent++;
    } catch (e) {
      await pool
        .request()
        .input("id", sql.Int, m.Id)
        .input("err", sql.NVarChar, e instanceof Error ? e.message : String(e))
        .query(`UPDATE [dbo].[AccEmailQueue]
          SET AttemptCount=AttemptCount+1, ErrorMessage=@err,
              Status=CASE WHEN AttemptCount+1 >= 3 THEN 'Failed' ELSE 'Queued' END WHERE Id=@id`);
      failed++;
    }
  }
  return { sent, failed };
}

/**
 * Drain the queue for the current route's database.
 *
 * This is what the ~12 per-action drains call: they run inside the request that
 * queued the mail, so the route already resolves to the right database.
 */
export async function processQueue(
  max = 20,
): Promise<{ sent: number; failed: number }> {
  const [pool, environment] = await Promise.all([
    getAccPool(),
    resolveFormEnvironment(),
  ]);
  return processQueueOn(pool, environment, max);
}

/**
 * Drain both databases. Used by the scheduled/manual sweep endpoint, which has
 * no particular form in scope and must not leave UAT mail queued forever.
 */
export async function processQueueBoth(
  max = 20,
): Promise<{ sent: number; failed: number }> {
  const [prod, uat] = await Promise.all([
    getProductionFormPool(),
    getUatFormPool(),
  ]);
  const [a, b] = await Promise.all([
    processQueueOn(prod, "Production", max),
    processQueueOn(uat, "UAT", max),
  ]);
  return { sent: a.sent + b.sent, failed: a.failed + b.failed };
}
