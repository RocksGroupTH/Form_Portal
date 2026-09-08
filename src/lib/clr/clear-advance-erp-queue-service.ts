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
  advanceRequestNo: string | null;
  actualTotal: number | null;
  refundToCompany: number | null;
  requesterFullName: string | null;
  paymentDate: string | null;
}

function num(v: unknown): number | null {
  return v === null || v === undefined ? null : Number(v);
}

/** Date column → YYYY-MM-DD using local getters (server is Thai time). */
function toYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** AP-3 ERP queue — all Approved clearings, showing their current ERP interface status. */
export async function listErpQueueRows(): Promise<ClrErpQueueRow[]> {
  const pool = await getAccPool();
  const r = pool.request().input("form", sql.NVarChar, AP3_FORM_CODE);

  const res = await r.query(`
    SELECT req.Id, req.RequestNo, req.BrandCode, req.ErpInterfaceStatus, req.ErpDocumentNo,
           req.ErpInterfaceEnvironment, req.ErpInterfaceSentAt, req.ErpInterfaceError,
           req.RequesterFullName,
           c.AdvanceRequestNo, c.ActualTotal, c.RefundToCompany, c.PaymentDate
    FROM [dbo].[AccRequest] req
    LEFT JOIN [dbo].[AccClearAdvance] c ON c.RequestId = req.Id
    WHERE req.FormCode = @form AND req.Status = 'Approved'
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
    advanceRequestNo: (x.AdvanceRequestNo as string) ?? null,
    actualTotal: num(x.ActualTotal),
    refundToCompany: num(x.RefundToCompany),
    requesterFullName: (x.RequesterFullName as string) ?? null,
    paymentDate: x.PaymentDate instanceof Date ? toYmd(x.PaymentDate) : ((x.PaymentDate as string) ?? null),
  }));
}
