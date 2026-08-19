import { getAccPool, sql } from "@/lib/adv/pool";
import type { ErpBcEnvironment } from "@/lib/acc/erp-environment";
import type { ErpInterfaceStatus } from "@/features/accounting/constants";
import { postBcPpapJournalCreateFromJson } from "@/lib/bc/bc-odata";
import { getRequest } from "@/lib/adv/advance-request-service";
import { loadAdvanceErpContext } from "@/lib/adv/advance-erp-context";
import { buildAdvanceJournalPayload, buildAdvanceBatchPayload } from "@/lib/adv/advance-erp-payload";
import type { AdvanceErpTarget } from "@/lib/adv/advance-erp-context";
import type { AdvanceRequest, AdvanceDetail } from "@/features/advance/types";
import type { BrandErpAccountConfig } from "@/lib/acc/erp-journal-builder";

export interface AdvanceJournalPreviewLine {
  groupNo: string;
  postingDate: string;
  documentType: string;
  accountType: string;
  accountNo: string;
  description: string;
  branchCode: string;
  departmentCode: string;
  amount: number;
  debitAmount: number | null;
  creditAmount: number | null;
  externalDocument: string;
}

export interface AdvanceJournalPreviewItem {
  id: number;
  requestNo: string | null;
  interfaceTarget: string | null;
  journalBatchName: string | null;
  paymentDate: string | null;
  payeeName: string | null;
  environment: ErpBcEnvironment | null;
  ok: boolean;
  error?: string;
  lines: AdvanceJournalPreviewLine[];
}

/**
 * Build the BC journal that WOULD post for each approved advance — the preview
 * shown in the Interface ERP tab before sending. Per-item try/catch so a brand
 * with incomplete config surfaces its own error instead of failing the batch.
 */
export async function previewAdvanceErpJournal(ids: number[]): Promise<AdvanceJournalPreviewItem[]> {
  const out: AdvanceJournalPreviewItem[] = [];
  for (const id of ids) {
    try {
      const req = await getRequest(id);
      if (!req) { out.push({ id, requestNo: null, interfaceTarget: null, journalBatchName: null, paymentDate: null, payeeName: null, environment: null, ok: false, error: "ไม่พบคำขอ", lines: [] }); continue; }
      if (!req.brandCode) throw new Error("ไม่พบแบรนด์ของคำขอ");
      if (!req.advance) throw new Error("ไม่พบข้อมูลเงินทดรองจ่าย");
      const { config, target, erpDeptCode } = await loadAdvanceErpContext(req.brandCode, req.requesterDepartmentCode);
      const payload = buildAdvanceJournalPayload(req, req.advance, config, erpDeptCode);
      out.push({
        id,
        requestNo: req.requestNo,
        interfaceTarget: target.interfaceTarget,
        journalBatchName: config.journalBatchName ?? null,
        paymentDate: req.paymentDate ?? null,
        payeeName: req.advance.payeeName ?? null,
        environment: target.environment,
        ok: true,
        lines: payload.lines.map((l) => ({
          groupNo: l.groupNo,
          postingDate: l.postingDate,
          documentType: l.documentType,
          accountType: l.accountType,
          accountNo: l.accountNo,
          description: l.description,
          branchCode: l.branchCode ?? "",
          departmentCode: l.departmentCode ?? "",
          amount: l.amount,
          debitAmount: l.amount > 0 ? l.amount : null,
          creditAmount: l.amount < 0 ? -l.amount : null,
          externalDocument: req.requestNo ?? "",
        })),
      });
    } catch (e) {
      out.push({ id, requestNo: null, interfaceTarget: null, journalBatchName: null, paymentDate: null, payeeName: null, environment: null, ok: false, error: e instanceof Error ? e.message : "preview error", lines: [] });
    }
  }
  return out;
}

async function markInterfaceStatus(
  requestId: number,
  status: ErpInterfaceStatus | null,
  opts: { error?: string | null; userId?: number | null; environment?: ErpBcEnvironment | null; documentNo?: string | null } = {},
): Promise<void> {
  const pool = await getAccPool();
  const req = pool.request()
    .input("id", sql.Int, requestId)
    .input("status", sql.NVarChar, status)
    .input("error", sql.NVarChar, opts.error ?? null)
    .input("userId", sql.Int, opts.userId ?? null)
    .input("env", sql.NVarChar, opts.environment ?? null)
    .input("doc", sql.NVarChar, opts.documentNo ?? null);
  if (status === "Sent") {
    await req.input("sentAt", sql.DateTime2, new Date()).query(`
      UPDATE [dbo].[AccRequest]
      SET ErpInterfaceStatus=@status, ErpInterfaceError=NULL, ErpInterfaceSentAt=@sentAt,
          ErpInterfaceSentBy=@userId, ErpInterfaceEnvironment=@env, ErpDocumentNo=@doc, UpdatedAt=SYSDATETIME()
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
 * The PPAP CU returns HTTP 200 even when it creates nothing — the real outcome is
 * in the body as `{ "status": "success" | "error", "message": "..." }`. Throw on
 * anything that is not an explicit success so a "sent but no data in BC" never
 * lands as Sent; return the summary for the activity log.
 */
function assertBcJournalCreated(resp: unknown): string {
  const raw = typeof resp === "string" ? resp : JSON.stringify(resp ?? {});
  // BC unbound action wraps the CU's return string in { value: "..." }.
  let inner = raw;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (o && typeof o === "object" && "value" in o) inner = String(o.value ?? "");
  } catch { /* keep raw */ }

  let status: string | undefined;
  let message: string | undefined;
  try {
    const r = JSON.parse(inner) as { status?: string; message?: string };
    if (r && typeof r === "object") {
      if (typeof r.status === "string") status = r.status.trim().toLowerCase();
      if (typeof r.message === "string") message = r.message;
    }
  } catch { /* not JSON — fall through to keyword guard */ }

  const summary = (message ?? inner).trim();

  // Explicit CU error (e.g. {"status":"error","message":"...batch not found"}).
  if (status === "error") throw new Error(`BC: ${summary || "error"}`);

  // The CU reports "Processed N lines. Inserted: A, Failed: B. Documents: C".
  // That count is authoritative — success is Failed: 0, regardless of the status word.
  const failedM = summary.match(/Failed:\s*(\d+)/i);
  if (failedM) {
    if (Number(failedM[1]) > 0) throw new Error(`BC: ${summary}`);
    return summary.slice(0, 900); // Failed: 0 → real success
  }

  const low = inner.toLowerCase();
  if (
    low.includes('"status":"error"') || low.includes("exception")
    || low.includes("does not exist") || low.includes("not found") || low.includes("ไม่พบ")
  ) {
    throw new Error(`BC ตอบกลับ error: ${inner.slice(0, 800)}`);
  }
  return (summary || raw).slice(0, 900);
}

/**
 * Pull the BC Document No. out of the CU response — results[].documentNo for the
 * inserted lines. One payload = one document, so this is normally a single no.;
 * distinct nos (shouldn't happen for advances) are joined. null if none.
 */
function extractBcDocumentNo(resp: unknown): string | null {
  const raw = typeof resp === "string" ? resp : JSON.stringify(resp ?? {});
  let inner = raw;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (o && typeof o === "object" && "value" in o) inner = String(o.value ?? "");
  } catch { /* keep raw */ }
  try {
    const r = JSON.parse(inner) as { results?: { documentNo?: string; status?: string }[] };
    const docs = new Set<string>();
    for (const it of r.results ?? []) {
      if (it?.status === "inserted" && typeof it.documentNo === "string" && it.documentNo.trim()) {
        docs.add(it.documentNo.trim());
      }
    }
    return docs.size > 0 ? Array.from(docs).join(", ") : null;
  } catch {
    return null;
  }
}

export interface BatchSendItemResult { id: number; ok: boolean; error?: string }

/**
 * The queue drifted between the confirm dialog and the click — an item was sent,
 * is sending, or is no longer Approved. Thrown BEFORE anything posts so the batch
 * is all-or-nothing and the popup count can never differ from what actually posts
 * (AP-1 parity). The route turns this into a 409 → the client reloads.
 */
export class AdvanceQueueDriftError extends Error {
  constructor() {
    super("คิวเปลี่ยนไปแล้ว (มีรายการถูกส่ง/สถานะเปลี่ยน) — โหลดหน้าใหม่แล้วลองอีกครั้ง");
    this.name = "AdvanceQueueDriftError";
  }
}

interface BatchEntry {
  req: AdvanceRequest;
  advance: AdvanceDetail;
  config: BrandErpAccountConfig;
  target: AdvanceErpTarget;
  erpDeptCode: string;
}

/**
 * Send many approved advances to BC, ONE post per Company (interface target):
 * all of a Company's advances go in a single payload = one BC document = one No.
 * Series (same "1 payload = 1 number" model as AP-1). Idempotent per item;
 * a Company's post is all-or-nothing.
 */
export async function sendAdvanceErpBatch(ids: number[], userId: number): Promise<BatchSendItemResult[]> {
  const results: BatchSendItemResult[] = [];
  const pool = await getAccPool();
  const byCompany = new Map<string, BatchEntry[]>();

  // Drift guard: the dialog froze this id set. If any item has since been
  // sent/is sending or is no longer Approved, refuse the whole batch (409) so
  // the confirm popup never posts a different set than it showed.
  if (ids.length > 0) {
    const ph = ids.map((_, i) => `@d${i}`).join(",");
    const dReq = pool.request();
    ids.forEach((id, i) => dReq.input(`d${i}`, sql.Int, id));
    const dRes = await dReq.query(
      `SELECT Id, Status, ErpInterfaceStatus FROM [dbo].[AccRequest] WHERE Id IN (${ph})`);
    const found = new Map<number, { status: string; erp: string | null }>();
    for (const row of dRes.recordset as Record<string, unknown>[]) {
      found.set(row.Id as number, { status: row.Status as string, erp: (row.ErpInterfaceStatus as string) ?? null });
    }
    const drifted = ids.some((id) => {
      const f = found.get(id);
      return !f || f.status !== "Approved" || f.erp === "Sent" || f.erp === "Pending";
    });
    if (drifted) throw new AdvanceQueueDriftError();
  }

  for (const id of ids) {
    try {
      const req = await getRequest(id);
      if (!req) throw new Error("ไม่พบคำขอ");
      if (req.status !== "Approved") throw new Error("ต้องอนุมัติคำขอก่อนจึงจะส่ง ERP ได้");
      if (!req.brandCode) throw new Error("ไม่พบแบรนด์ของคำขอ");
      if (!req.advance) throw new Error("ไม่พบข้อมูลเงินทดรองจ่าย");
      if (!req.paymentDate) throw new Error("ยังไม่กำหนดวันจ่าย (PaymentDate)");

      const stRes = await pool.request().input("id", sql.Int, id)
        .query(`SELECT ErpInterfaceStatus FROM [dbo].[AccRequest] WHERE Id=@id`);
      const st = (stRes.recordset[0]?.ErpInterfaceStatus as ErpInterfaceStatus | null) ?? null;
      if (st === "Sent") throw new Error("ส่งเข้า ERP สำเร็จแล้ว");
      if (st === "Pending") throw new Error("กำลังส่งอยู่");

      const { config, target, erpDeptCode } = await loadAdvanceErpContext(req.brandCode, req.requesterDepartmentCode);
      const list = byCompany.get(target.interfaceTarget) ?? [];
      list.push({ req, advance: req.advance, config, target, erpDeptCode });
      byCompany.set(target.interfaceTarget, list);
    } catch (e) {
      results.push({ id, ok: false, error: e instanceof Error ? e.message : "error" });
    }
  }

  for (const entries of Array.from(byCompany.values())) {
    entries.sort((a, b) =>
      (a.req.requestNo ?? "").localeCompare(b.req.requestNo ?? "") || a.req.id - b.req.id);
    const target = entries[0].target;

    let payload: ReturnType<typeof buildAdvanceBatchPayload>;
    try {
      payload = buildAdvanceBatchPayload(entries.map((e) => ({
        req: e.req, advance: e.advance, config: e.config, departmentCode: e.erpDeptCode,
      })));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "สร้าง payload ไม่สำเร็จ";
      for (const e2 of entries) results.push({ id: e2.req.id, ok: false, error: msg });
      continue;
    }

    for (const e of entries) await markInterfaceStatus(e.req.id, "Pending");
    const envLabel = target.environment === "Sandbox" ? "UAT" : "PROD";
    try {
      const bcResponse = await postBcPpapJournalCreateFromJson(
        target.bcConnectionId, target.bcId, target.environment, target.baseUrl,
        payload as unknown as Record<string, unknown>,
      );
      // BC returns HTTP 200 even when the CU creates nothing — capture the raw
      // response so a "sent but no data in BC" case is visible in the log.
      const resp = assertBcJournalCreated(bcResponse);
      const docNo = extractBcDocumentNo(bcResponse);
      for (const e of entries) {
        await markInterfaceStatus(e.req.id, "Sent", { userId, environment: target.environment, documentNo: docNo });
        await logInterfaceActivity(e.req.id, userId, "erp_interface_sent",
          `ส่งเข้า ERP ${envLabel} · ${target.interfaceTarget} · ${e.req.requestNo ?? e.req.id} · Doc: ${docNo ?? "—"} · BCResp: ${resp}`);
        results.push({ id: e.req.id, ok: true });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "ส่งเข้า ERP ไม่สำเร็จ";
      for (const e of entries) {
        await markInterfaceStatus(e.req.id, "Failed", { error: message, environment: target.environment });
        await logInterfaceActivity(e.req.id, userId, "erp_interface_failed", message.slice(0, 2000));
        results.push({ id: e.req.id, ok: false, error: message });
      }
    }
  }
  return results;
}
