import * as XLSX from "xlsx-js-style";
import { getAccPool, sql } from "@/lib/adv/pool";
import { AP2_FORM_CODE } from "@/features/advance/constants";
import { STEP_LABEL, needsPayment, type StepType } from "@/lib/adv/approval-steps";
import { isAdvanceApprover } from "@/lib/adv/advance-approver-service";
import { listBrandErpInterfaceMaps } from "@/lib/acc/brand-erp-interface-map-service";

/** One row in the AP-2 approval / interface queues (with resolved Company). */
export interface AdvanceQueueRow {
  id: number;
  requestNo: string | null;
  brandCode: string | null;
  /** Resolved ERP interface target (Company), e.g. PCTH / PCMY — same concept as AP-1. */
  interfaceTarget: string;
  requesterFullName: string | null;
  payeeName: string | null;
  purpose: string | null;
  currency: string | null;
  amount: number | null;
  baseAmount: number | null;
  status: string;
  currentStepCode: string | null;
  stepLabel: string;
  /** true when the current step is the payment step (ACC_OFFICER) — needs date + check. */
  needsPayment: boolean;
  erpInterfaceStatus: string | null;
  erpInterfaceError: string | null;
  erpInterfaceSentAt: string | null;
  erpInterfaceEnvironment: string | null;
  erpDocumentNo: string | null;
  paymentDate: string | null;
  updatedAt: string;
}

type Pool = Awaited<ReturnType<typeof getAccPool>>;

function n(v: unknown): number | null {
  if (v == null) return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

/**
 * claim brand → interface brand (Company). AP-1's shared mapping, overlaid with
 * AP-2's own target overrides so the queue shows the same Company AP-2 posts to.
 * Missing → brand maps to itself.
 */
async function loadInterfaceMap(pool: Pool): Promise<Record<string, string>> {
  const r = await pool.request().query(
    `SELECT BrandCode, InterfaceBrandCode FROM [dbo].[AccBrandErpInterface]`,
  );
  const map: Record<string, string> = {};
  for (const row of r.recordset as { BrandCode: string; InterfaceBrandCode: string }[]) {
    map[(row.BrandCode ?? "").trim().toUpperCase()] = (row.InterfaceBrandCode ?? "").trim().toUpperCase();
  }
  const ap2Maps = await listBrandErpInterfaceMaps(AP2_FORM_CODE);
  for (const m of ap2Maps) {
    if (m.interfaceBrandCode) map[m.brandCode.trim().toUpperCase()] = m.interfaceBrandCode.trim().toUpperCase();
  }
  return map;
}

function resolveTarget(map: Record<string, string>, brandCode: string | null): string {
  const b = (brandCode ?? "").trim().toUpperCase();
  return map[b] || b || "";
}

function mapRow(row: Record<string, unknown>, map: Record<string, string>): AdvanceQueueRow {
  const step = (row.CurrentStepCode as StepType) ?? null;
  return {
    id: row.Id as number,
    requestNo: (row.RequestNo as string) ?? null,
    brandCode: (row.BrandCode as string) ?? null,
    interfaceTarget: resolveTarget(map, (row.BrandCode as string) ?? null),
    requesterFullName: (row.RequesterFullName as string) ?? null,
    payeeName: (row.PayeeName as string) || (row.RequesterFullName as string) || null,
    purpose: (row.Purpose as string) ?? null,
    currency: (row.Currency as string) ?? null,
    amount: n(row.Amount),
    baseAmount: n(row.BaseAmount ?? row.TotalAmount),
    status: row.Status as string,
    currentStepCode: (row.CurrentStepCode as string) ?? null,
    stepLabel: step ? STEP_LABEL[step] ?? String(step) : "",
    needsPayment: step ? needsPayment(step) : false,
    erpInterfaceStatus: (row.ErpInterfaceStatus as string) ?? null,
    erpInterfaceError: (row.ErpInterfaceError as string) ?? null,
    erpInterfaceSentAt: row.ErpInterfaceSentAt ? (row.ErpInterfaceSentAt as Date).toISOString() : null,
    erpInterfaceEnvironment: (row.ErpInterfaceEnvironment as string) ?? null,
    erpDocumentNo: (row.ErpDocumentNo as string) ?? null,
    paymentDate: row.PaymentDate ? (row.PaymentDate as Date).toISOString().slice(0, 10) : null,
    updatedAt: row.UpdatedAt ? (row.UpdatedAt as Date).toISOString() : "",
  };
}

const SELECT_COLS = `
  r.Id, r.RequestNo, r.BrandCode, r.RequesterFullName, r.TotalAmount,
  r.Status, r.CurrentStepCode, r.ErpInterfaceStatus, r.ErpInterfaceError,
  r.ErpInterfaceSentAt, r.ErpInterfaceEnvironment, r.ErpDocumentNo,
  r.PaymentDate, r.UpdatedAt,
  a.PayeeName, a.Purpose, a.Currency, a.Amount, a.BaseAmount
`;

/**
 * AP-2 requests (Submitted) the viewer can approve NOW — the "รออนุมัติ" tab.
 * Admins see every pending request; others see only steps they own
 * (role step they approve, or the HEAD_DEPT step where they are the manager).
 */
export async function listAdvanceApproveQueue(
  email: string | null,
  staffId: number | null,
  isAdmin: boolean,
): Promise<AdvanceQueueRow[]> {
  const [isHead, isOfficer, isDirector] = await Promise.all([
    isAdvanceApprover(email, "HEAD_ACC"),
    isAdvanceApprover(email, "ACC_OFFICER"),
    isAdvanceApprover(email, "DIRECTOR"),
  ]);
  const roleSteps: string[] = [];
  if (isHead) roleSteps.push("HEAD_ACC");
  if (isOfficer) roleSteps.push("ACC_OFFICER");
  if (isDirector) roleSteps.push("DIRECTOR");
  if (!isAdmin && roleSteps.length === 0 && staffId == null) return [];

  const conds: string[] = [];
  if (isAdmin) {
    conds.push("1=1");
  } else {
    // roleSteps values are fixed constants (never user input) — safe to inline.
    if (roleSteps.length) conds.push(`r.CurrentStepCode IN ('${roleSteps.join("','")}')`);
    if (staffId != null) conds.push("(r.CurrentStepCode = 'HEAD_DEPT' AND r.ManagerStaffId = @staff)");
  }

  const pool = await getAccPool();
  const map = await loadInterfaceMap(pool);
  const res = await pool.request()
    .input("form", sql.NVarChar, AP2_FORM_CODE)
    .input("staff", sql.Int, staffId)
    .query(`
      SELECT ${SELECT_COLS}
      FROM [dbo].[AccRequest] r
      LEFT JOIN [dbo].[AccAdvance] a ON a.RequestId = r.Id
      WHERE r.FormCode = @form AND r.Status = 'Submitted' AND (${conds.join(" OR ")})
      ORDER BY r.UpdatedAt DESC
    `);
  return (res.recordset as Record<string, unknown>[]).map((row) => mapRow(row, map));
}

/**
 * Approved AP-2 requests ready to send to BC — the "Interface ERP" tab.
 * Includes ErpInterfaceStatus so the UI can show Pending / Sent / Failed.
 */
export async function listAdvanceErpQueue(): Promise<AdvanceQueueRow[]> {
  const pool = await getAccPool();
  const map = await loadInterfaceMap(pool);
  const res = await pool.request()
    .input("form", sql.NVarChar, AP2_FORM_CODE)
    .query(`
      SELECT ${SELECT_COLS}
      FROM [dbo].[AccRequest] r
      LEFT JOIN [dbo].[AccAdvance] a ON a.RequestId = r.Id
      WHERE r.FormCode = @form AND r.Status = 'Approved'
      ORDER BY (CASE WHEN r.ErpInterfaceStatus = 'Sent' THEN 1 ELSE 0 END),
               r.PaymentDate DESC, r.UpdatedAt DESC
    `);
  return (res.recordset as Record<string, unknown>[]).map((row) => mapRow(row, map));
}

const ERP_STATUS_TH: Record<string, string> = { Sent: "ส่งแล้ว", Pending: "กำลังส่ง", Failed: "ล้มเหลว" };

/** Superseded (Resent) PV numbers per request, so the export can show them. */
export async function listResentDocNos(requestIds: number[]): Promise<Map<number, string[]>> {
  const map = new Map<number, string[]>();
  if (requestIds.length === 0) return map;
  const pool = await getAccPool();
  const ph = requestIds.map((_, i) => `@r${i}`).join(",");
  const req = pool.request();
  requestIds.forEach((id, i) => req.input(`r${i}`, sql.Int, id));
  const r = await req.query(`
    SELECT RequestId, ErpDocumentNo FROM [dbo].[AccAdvanceErpAttempt]
    WHERE Status='Resent' AND RequestId IN (${ph}) ORDER BY AttemptNo`);
  for (const row of r.recordset as Record<string, unknown>[]) {
    const id = row.RequestId as number;
    const doc = (row.ErpDocumentNo as string) ?? null;
    if (!doc) continue;
    const list = map.get(id) ?? [];
    list.push(doc);
    map.set(id, list);
  }
  return map;
}

/** Excel (.xlsx) of AP-2 ERP-interface rows — mirrors the "ส่งแล้ว" table columns. */
export async function buildAdvanceErpWorkbook(rows: AdvanceQueueRow[]): Promise<Buffer> {
  const headerStyle = { font: { bold: true }, alignment: { horizontal: "center" as const } };
  const moneyStyle = { alignment: { horizontal: "right" as const }, numFmt: "#,##0.00" };

  const aoa: (string | number | null)[][] = [];
  aoa.push(["Rocks Group"]);
  aoa.push(["รายการเบิกเงินทดรองจ่าย ส่งเข้า ERP (AP-2)"]);
  aoa.push([`สร้างเมื่อ: ${new Date().toLocaleString("th-TH")}`]);
  aoa.push([]);

  const resent = await listResentDocNos(rows.map((r) => r.id));

  const headerRowIndex = aoa.length;
  const columns = ["เลขที่", "Company", "ผู้รับเงิน", "รายละเอียดค่าใช้จ่าย", "วันจ่าย", "จำนวน", "External Doc.", "Doc No. (ERP)", "PV เดิม (Resent)", "วันที่ส่ง", "สถานะ"];
  aoa.push(columns);

  for (const r of rows) {
    aoa.push([
      r.requestNo,
      r.interfaceTarget,
      r.payeeName,
      r.purpose,
      r.paymentDate,
      r.baseAmount ?? r.amount ?? 0,
      r.requestNo,
      r.erpDocumentNo,
      (resent.get(r.id) ?? []).join(", ") || "—",
      r.erpInterfaceSentAt ? new Date(r.erpInterfaceSentAt).toLocaleString("th-TH") : null,
      r.erpInterfaceStatus ? (ERP_STATUS_TH[r.erpInterfaceStatus] ?? r.erpInterfaceStatus) : "พร้อมส่ง",
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const range = XLSX.utils.decode_range(ws["!ref"] as string);
  for (let c = range.s.c; c <= range.e.c; c++) {
    const addr = XLSX.utils.encode_cell({ r: headerRowIndex, c });
    if (ws[addr]) ws[addr].s = headerStyle;
  }
  for (let rr = headerRowIndex + 1; rr <= range.e.r; rr++) {
    const amtAddr = XLSX.utils.encode_cell({ r: rr, c: 5 });
    if (ws[amtAddr]) ws[amtAddr].s = moneyStyle;
  }
  // Wider "รายละเอียดค่าใช้จ่าย" (col 3) column.
  ws["!cols"] = columns.map((_, i) => ({ wch: i === 3 ? 36 : 16 }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "AP-2 ERP");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
