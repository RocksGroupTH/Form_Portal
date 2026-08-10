import { getAccPool, sql } from "@/lib/acc/pool";
import { sendEmail } from "@/lib/graph";

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

export async function processQueue(
  max = 20,
): Promise<{ sent: number; failed: number }> {
  const pool = await getAccPool();
  const rows = (
    await pool
      .request()
      .input("max", sql.Int, max)
      .query(`
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
      await sendEmail({ to: m.ToEmail, subject: m.Subject, bodyHtml: m.BodyHtml });
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
