import type { ConnectionPool } from "mssql";
import { getAccPool, sql } from "@/lib/acc/pool";
import { getProductionFormPool, getUatFormPool } from "@/lib/db/mssql";
import {
  resolveFormEnvironment,
  type FormEnvironmentValue,
} from "@/lib/form-environment";
import { listActiveUatTesterAddresses } from "@/lib/uat-tester/service";
import {
  isUatMailExempt,
  type UatMailExemptRecord,
} from "@/lib/acc/uat-mail-exempt";
import { env } from "@/env";
import { sendEmail } from "@/lib/graph";
import { esc } from "@/lib/acc/email-templates";

/**
 * Queue one message.
 *
 * `on` names the database to queue it in, and defaults to the current route's
 * — which is what the ~12 per-action callers want, since they run inside the
 * request that resolved that database. It is passed explicitly by callers with
 * no request scope: the stale-request sweep walks both form databases in turn,
 * and `getAccPool()` would file every one of its UAT notifications in
 * Production, where the drain would send them with no `[UAT]` prefix and no
 * redirect.
 */
export async function queueEmail(p: {
  requestId: number | null;
  toEmail: string;
  subject: string;
  bodyHtml: string;
  triggerType: string;
}, on?: ConnectionPool): Promise<void> {
  if (!p.toEmail) return;
  const pool = on ?? (await getAccPool());
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
 * Rewrite a queued message so a UAT-flagged form cannot email real people —
 * with one exception, now that Production and UAT run side by side and a UAT
 * request's approval chain stays inside the tester group (see
 * docs/superpowers/specs/2026-08-18-parallel-uat-design.md, "Notifications").
 * The old justification — "approval chains resolve against production HR in
 * both environments" — is exactly the assumption that design removed: if
 * every UAT message were still redirected, the configured UAT manager would
 * never be told there is anything to approve, and a UAT request could never
 * complete.
 *
 * The exception: a recipient who holds an active `UatTester` row of their own
 * gets the mail at their own address — still `[UAT]`-prefixed, so it is never
 * mistaken for a production notification. Matched on either spelling of that
 * address, the stored login one or HR's, because a queued recipient is always
 * HR-sourced and the two are allowed to differ. A configured UAT manager is
 * covered by the same rule rather than by a second one; see `isUatMailExempt`.
 * `isUatMailExempt` is the pure predicate; the caller gathers the active
 * testers once per drain cycle (not once per message) and passes them in.
 * Everyone else keeps the rewrite, and the loud throw when `UAT_MAIL_REDIRECT`
 * is unset still fires for them — this must fail closed, never fall back to
 * the real recipient.
 */
function applyUatRedirect(
  m: { ToEmail: string; Subject: string; BodyHtml: string },
  exemptTesters: readonly UatMailExemptRecord[],
): { to: string; subject: string; bodyHtml: string } {
  const exempt = isUatMailExempt(m.ToEmail, exemptTesters);

  if (exempt) {
    return {
      to: m.ToEmail,
      subject: `[UAT] ${m.Subject}`,
      bodyHtml: m.BodyHtml,
    };
  }

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

  // Fetched once per drain cycle, not once per message — every row in this
  // batch is judged against the same tester snapshot. Two reads, batched:
  // Fast_Core for the tester list and Rocks_Portal_HR for the address the queue
  // actually carries, because `UatTester.Email` is the login address and every
  // recipient here is HR's `COALESCE(Email, EmailCompBr)` (see
  // `listActiveUatTesterAddresses`).
  //
  // Its own try/catch, deliberately: neither read is the database being
  // drained. Letting one reject would abort the whole drain, and in
  // `processQueueBoth` it would reject the `Promise.all` *after* the Production
  // half had already sent its mail and marked the rows Sent — turning a
  // Fast_Core or HR hiccup into a 500 on a sweep that half succeeded. Falling
  // back to an empty list fails closed: nobody is exempt, so every UAT message
  // is redirected, which is the safe direction.
  let exemptTesters: UatMailExemptRecord[] = [];
  if (environment === "UAT" && rows.length > 0) {
    try {
      exemptTesters = await listActiveUatTesterAddresses();
    } catch (err) {
      console.error(
        "[acc/email-queue] UatTester lookup failed — redirecting every UAT message in this batch",
        err,
      );
    }
  }

  let sent = 0,
    failed = 0;
  for (const m of rows) {
    try {
      const payload =
        environment === "UAT"
          ? applyUatRedirect(m, exemptTesters)
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
