import { getAccPool, sql } from "@/lib/adv/pool";

export interface ErpAttempt {
  id: number;
  attemptNo: number;
  erpDocumentNo: string | null;
  environment: string | null;
  company: string | null;
  status: "Sent" | "Resent";
  sentAt: string | null;
  sentBy: number | null;
  resentAt: string | null;
}

/** Pure: the attempt number to use given the current max (null/0 → 1). */
export function nextAttemptNo(currentMax: number | null): number {
  return (currentMax ?? 0) + 1;
}

/** Record a successful send as the next attempt (Status='Sent') for a request. */
export async function recordSentAttempt(
  requestId: number,
  documentNo: string | null,
  environment: string | null,
  company: string | null,
  userId: number,
): Promise<void> {
  const pool = await getAccPool();
  await pool.request()
    .input("rid", sql.Int, requestId)
    .input("doc", sql.NVarChar, documentNo)
    .input("env", sql.NVarChar, environment)
    .input("company", sql.NVarChar, company)
    .input("by", sql.Int, userId)
    .query(`
      INSERT INTO [dbo].[AccAdvanceErpAttempt]
        (RequestId, AttemptNo, ErpDocumentNo, Environment, Company, Status, SentAt, SentBy)
      SELECT @rid,
             COALESCE((SELECT MAX(AttemptNo) FROM [dbo].[AccAdvanceErpAttempt] WHERE RequestId=@rid), 0) + 1,
             @doc, @env, @company, 'Sent', SYSDATETIME(), @by`);
}

/** Pull a Sent advance back: flip its current 'Sent' attempt to 'Resent' and
 *  clear the request's interface fields so it re-enters the "รอส่ง" queue. */
export async function markResent(requestId: number, userId: number): Promise<void> {
  const pool = await getAccPool();
  const tx = pool.transaction();
  await tx.begin();
  try {
    await tx.request()
      .input("rid", sql.Int, requestId)
      .input("by", sql.Int, userId)
      .query(`
        UPDATE [dbo].[AccAdvanceErpAttempt]
        SET Status='Resent', ResentBy=@by, ResentAt=SYSDATETIME(), UpdatedAt=SYSDATETIME()
        WHERE RequestId=@rid AND Status='Sent'`);
    await tx.request()
      .input("rid", sql.Int, requestId)
      .query(`
        UPDATE [dbo].[AccRequest]
        SET ErpInterfaceStatus=NULL, ErpDocumentNo=NULL, ErpInterfaceError=NULL,
            ErpInterfaceSentAt=NULL, ErpInterfaceSentBy=NULL, ErpInterfaceEnvironment=NULL,
            UpdatedAt=SYSDATETIME()
        WHERE Id=@rid`);
    await tx.request()
      .input("rid", sql.Int, requestId)
      .input("by", sql.Int, userId)
      .query(`INSERT INTO [dbo].[AccActivityLog] (RequestId, AuthorId, Action, Note)
              VALUES (@rid, @by, 'erp_interface_pullback', N'ดึงกลับเพื่อยิงใหม่ (Resent)')`);
    await tx.commit();
  } catch (e) { await tx.rollback().catch(() => {}); throw e; }
}

/** All send attempts for a request, oldest first (for the mapping display). */
export async function listAttempts(requestId: number): Promise<ErpAttempt[]> {
  const pool = await getAccPool();
  const r = await pool.request().input("rid", sql.Int, requestId).query(`
    SELECT Id, AttemptNo, ErpDocumentNo, Environment, Company, Status, SentAt, SentBy, ResentAt
    FROM [dbo].[AccAdvanceErpAttempt] WHERE RequestId=@rid ORDER BY AttemptNo`);
  return r.recordset.map((x: Record<string, unknown>) => ({
    id: x.Id as number,
    attemptNo: x.AttemptNo as number,
    erpDocumentNo: (x.ErpDocumentNo as string) ?? null,
    environment: (x.Environment as string) ?? null,
    company: (x.Company as string) ?? null,
    status: x.Status as "Sent" | "Resent",
    sentAt: x.SentAt ? (x.SentAt as Date).toISOString() : null,
    sentBy: (x.SentBy as number) ?? null,
    resentAt: x.ResentAt ? (x.ResentAt as Date).toISOString() : null,
  }));
}
