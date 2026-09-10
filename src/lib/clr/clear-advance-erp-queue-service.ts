import { getAccPool, sql } from "@/lib/acc/pool";
import { AP3_FORM_CODE } from "@/features/clear-advance/constants";

export interface ClrErpQueueRow {
  id: number;
  requestNo: string | null;
  brandCode: string | null;
  erpStatus: string | null;
  erpDocumentNo: string | null;
  erpEnvironment: string | null;
  erpSentAt: string | null;
  erpError: string | null;
  /** BC's own answer to the last attempt, verbatim. Null before any send. */
  erpResponse: string | null;
  advanceRequestNo: string | null;
  actualTotal: number | null;
  refundToCompany: number | null;
  requesterFullName: string | null;
  paymentDate: string | null;
  /** 'Approved' or 'Cancelled' — the queue shows both, in different tabs. */
  status: string | null;
  cancelledAt: string | null;
  /** Why it was cancelled, from the activity log. Null unless cancelled. */
  cancelNote: string | null;
}

function num(v: unknown): number | null {
  return v === null || v === undefined ? null : Number(v);
}

/** Date column → YYYY-MM-DD using local getters (server is Thai time). */
function toYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * AP-3 ERP queue — every Approved clearing with its ERP interface status, plus
 * the ones cancelled after approval.
 *
 * Cancelled rows are here rather than gone because a clearing that leaves the
 * queue without a trace looks exactly like one that was lost: the ยกเลิก tab is
 * where accounting goes to see that it was a decision. They are marked by
 * `status` and never counted as sendable.
 */
export async function listErpQueueRows(): Promise<ClrErpQueueRow[]> {
  const pool = await getAccPool();
  const r = pool.request().input("form", sql.NVarChar, AP3_FORM_CODE);

  const res = await r.query(`
    SELECT req.Id, req.RequestNo, req.BrandCode, req.ErpInterfaceStatus, req.ErpDocumentNo,
           req.ErpInterfaceEnvironment, req.ErpInterfaceSentAt, req.ErpInterfaceError,
           req.ErpInterfaceResponse,
           req.RequesterFullName, req.Status, req.CancelledAt,
           c.AdvanceRequestNo, c.ActualTotal, c.RefundToCompany, c.PaymentDate,
           (SELECT TOP 1 log.Note FROM [dbo].[AccActivityLog] log
             WHERE log.RequestId = req.Id AND log.Action = 'cancelled_after_approval'
             ORDER BY log.Id DESC) AS CancelNote
    FROM [dbo].[AccRequest] req
    LEFT JOIN [dbo].[AccClearAdvance] c ON c.RequestId = req.Id
    WHERE req.FormCode = @form
      AND (req.Status = 'Approved'
           /* Cancelled AFTER approval only. Status alone also matches a requester
              self-cancel, which happens before the manager has even seen it — those
              never reached this queue, and listing them here reads as accounting
              having killed work it never received. The activity log is what tells
              the two apart. */
           OR (req.Status = 'Cancelled'
               AND EXISTS (SELECT 1 FROM [dbo].[AccActivityLog] log
                            WHERE log.RequestId = req.Id
                              AND log.Action = 'cancelled_after_approval')))
    ORDER BY req.Id DESC
  `);

  return (res.recordset as Record<string, unknown>[]).map((x) => ({
    id: x.Id as number,
    requestNo: (x.RequestNo as string) ?? null,
    brandCode: (x.BrandCode as string) ?? null,
    erpStatus: (x.ErpInterfaceStatus as string) ?? null,
    erpDocumentNo: (x.ErpDocumentNo as string) ?? null,
    erpEnvironment: (x.ErpInterfaceEnvironment as string) ?? null,
    erpSentAt: (x.ErpInterfaceSentAt instanceof Date ? x.ErpInterfaceSentAt.toISOString() : (x.ErpInterfaceSentAt as string)) ?? null,
    erpError: (x.ErpInterfaceError as string) ?? null,
    erpResponse: (x.ErpInterfaceResponse as string) ?? null,
    advanceRequestNo: (x.AdvanceRequestNo as string) ?? null,
    actualTotal: num(x.ActualTotal),
    refundToCompany: num(x.RefundToCompany),
    requesterFullName: (x.RequesterFullName as string) ?? null,
    paymentDate: x.PaymentDate instanceof Date ? toYmd(x.PaymentDate) : ((x.PaymentDate as string) ?? null),
    status: (x.Status as string) ?? null,
    cancelledAt: (x.CancelledAt instanceof Date ? x.CancelledAt.toISOString() : (x.CancelledAt as string)) ?? null,
    cancelNote: (x.CancelNote as string) ?? null,
  }));
}
