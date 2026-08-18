import { getAccPool, sql } from "@/lib/adv/pool";
import type { ErpBcEnvironment } from "@/lib/acc/erp-environment";
import type { ErpInterfaceStatus } from "@/features/accounting/constants";
import { postBcPpapJournalCreateFromJson } from "@/lib/bc/bc-odata";
import { getRequest } from "@/lib/adv/advance-request-service";
import { loadAdvanceErpContext } from "@/lib/adv/advance-erp-context";
import { buildAdvanceJournalPayload } from "@/lib/adv/advance-erp-payload";

export interface SendAdvanceErpResult {
  requestId: number;
  environment: ErpBcEnvironment;
  bcResponse: unknown;
}

async function markInterfaceStatus(
  requestId: number,
  status: ErpInterfaceStatus | null,
  opts: { error?: string | null; userId?: number | null; environment?: ErpBcEnvironment | null } = {},
): Promise<void> {
  const pool = await getAccPool();
  const req = pool.request()
    .input("id", sql.Int, requestId)
    .input("status", sql.NVarChar, status)
    .input("error", sql.NVarChar, opts.error ?? null)
    .input("userId", sql.Int, opts.userId ?? null)
    .input("env", sql.NVarChar, opts.environment ?? null);
  if (status === "Sent") {
    await req.input("sentAt", sql.DateTime2, new Date()).query(`
      UPDATE [dbo].[AccRequest]
      SET ErpInterfaceStatus=@status, ErpInterfaceError=NULL, ErpInterfaceSentAt=@sentAt,
          ErpInterfaceSentBy=@userId, ErpInterfaceEnvironment=@env, UpdatedAt=SYSDATETIME()
      WHERE Id=@id`);
  } else if (status === "Failed") {
    await req.query(`
      UPDATE [dbo].[AccRequest]
      SET ErpInterfaceStatus=@status, ErpInterfaceError=@error, ErpInterfaceSentAt=NULL,
          ErpInterfaceSentBy=NULL, ErpInterfaceEnvironment=@env, UpdatedAt=SYSDATETIME()
      WHERE Id=@id`);
  } else {
    await req.query(`
      UPDATE [dbo].[AccRequest]
      SET ErpInterfaceStatus=@status, ErpInterfaceError=NULL, UpdatedAt=SYSDATETIME()
      WHERE Id=@id AND (ErpInterfaceStatus IS NULL OR ErpInterfaceStatus='Failed')`);
  }
}

async function logInterfaceActivity(
  requestId: number, userId: number, action: string, note: string,
): Promise<void> {
  const pool = await getAccPool();
  await pool.request()
    .input("rid", sql.Int, requestId).input("by", sql.Int, userId)
    .input("action", sql.NVarChar, action).input("note", sql.NVarChar, note.slice(0, 2000))
    .query(`INSERT INTO [dbo].[AccActivityLog] (RequestId, AuthorId, Action, Note)
            VALUES (@rid, @by, @action, @note)`);
}

/**
 * Post one approved advance to Business Central as a Gen. Journal (staging).
 * Idempotent-guarded on ErpInterfaceStatus; marks Pending→Sent/Failed and logs.
 */
export async function sendAdvanceErp(requestId: number, userId: number): Promise<SendAdvanceErpResult> {
  const req = await getRequest(requestId);
  if (!req) throw new Error("ไม่พบคำขอ");
  if (req.status !== "Approved") throw new Error("ต้องอนุมัติคำขอก่อนจึงจะส่ง ERP ได้");
  if (!req.brandCode) throw new Error("ไม่พบแบรนด์ของคำขอ");
  if (!req.advance) throw new Error("ไม่พบข้อมูลเงินทดรองจ่าย");
  if (!req.paymentDate) throw new Error("ยังไม่กำหนดวันจ่าย (PaymentDate)");

  // Idempotency: read current interface status.
  const pool = await getAccPool();
  const stRes = await pool.request().input("id", sql.Int, requestId)
    .query(`SELECT ErpInterfaceStatus FROM [dbo].[AccRequest] WHERE Id=@id`);
  const st = (stRes.recordset[0]?.ErpInterfaceStatus as ErpInterfaceStatus | null) ?? null;
  if (st === "Sent") throw new Error("คำขอนี้ส่งเข้า ERP สำเร็จแล้ว — ไม่สามารถส่งซ้ำได้");
  if (st === "Pending") throw new Error("คำขอนี้กำลังส่งอยู่ — รอสักครู่แล้วลองใหม่");

  const { config, target } = await loadAdvanceErpContext(req.brandCode);
  const payload = buildAdvanceJournalPayload(
    req, req.advance, config, req.requesterDepartmentCode ?? "",
  );

  await markInterfaceStatus(requestId, "Pending");
  try {
    const bcResponse = await postBcPpapJournalCreateFromJson(
      target.bcConnectionId,
      target.bcId,
      target.environment,
      target.baseUrl,
      payload as unknown as Record<string, unknown>,
    );
    await markInterfaceStatus(requestId, "Sent", { userId, environment: target.environment });
    const envLabel = target.environment === "Sandbox" ? "UAT" : "PROD";
    await logInterfaceActivity(
      requestId, userId, "erp_interface_sent",
      `ส่งเข้า ERP ${envLabel} · ${target.interfaceTarget} · ${req.requestNo ?? requestId}`,
    );
    return { requestId, environment: target.environment, bcResponse };
  } catch (err) {
    const message = err instanceof Error ? err.message : "ส่งเข้า ERP ไม่สำเร็จ";
    await markInterfaceStatus(requestId, "Failed", { error: message, environment: target.environment });
    await logInterfaceActivity(requestId, userId, "erp_interface_failed", message.slice(0, 2000));
    throw new Error(message);
  }
}
