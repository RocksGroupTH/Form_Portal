import { getAccPool, sql } from "@/lib/acc/pool";
import { AP3_FORM_CODE } from "@/features/clear-advance/constants";

export interface ClrErpQueueRow {
  id: number;
  requestNo: string | null;
  brandCode: string | null;
  erpStatus: string | null;
  erpDocumentNo: string | null;
  erpEnvironment: string | null;
  advanceRequestNo: string | null;
  actualTotal: number | null;
  refundToCompany: number | null;
  requesterFullName: string | null;
}

function num(v: unknown): number | null {
  return v === null || v === undefined ? null : Number(v);
}

/** AP-3 ERP queue — all Approved clearings, showing their current ERP interface status. */
export async function listErpQueueRows(): Promise<ClrErpQueueRow[]> {
  const pool = await getAccPool();
  const r = pool.request().input("form", sql.NVarChar, AP3_FORM_CODE);

  const res = await r.query(`
    SELECT req.Id, req.RequestNo, req.BrandCode, req.ErpInterfaceStatus, req.ErpDocumentNo,
           req.ErpInterfaceEnvironment, req.RequesterFullName,
           c.AdvanceRequestNo, c.ActualTotal, c.RefundToCompany
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
    advanceRequestNo: (x.AdvanceRequestNo as string) ?? null,
    actualTotal: num(x.ActualTotal),
    refundToCompany: num(x.RefundToCompany),
    requesterFullName: (x.RequesterFullName as string) ?? null,
  }));
}
