import { getAccPool, sql } from "@/lib/acc/pool";
import type { ErpBcEnvironment } from "@/lib/acc/erp-environment";
import type { ErpInterfaceStatus } from "@/features/accounting/constants";
import { postBcPpapJournalCreateFromJson } from "@/lib/bc/bc-odata";
import { getRequest } from "@/lib/clr/clear-advance-request-service";
import { loadClearAdvanceErpContext } from "@/lib/clr/clear-advance-erp-context";
import { buildClearAdvanceJournalPayload } from "@/lib/clr/clear-advance-erp-payload";
import type { ClrJournalItem } from "@/lib/clr/clear-advance-erp-payload";

/* ─────────────────────────── preview types ─────────────────────────── */

export interface ClrPreviewLine {
  accountType: string;
  accountNo: string;
  description: string;
  branchCode: string;
  departmentCode: string;
  debit: number | null;
  credit: number | null;
}

export interface ClrPreviewItem {
  id: number;
  requestNo: string | null;
  interfaceTarget: string | null;
  environment: ErpBcEnvironment | null;
  journalBatchName: string | null;
  ok: boolean;
  error?: string;
  lines: ClrPreviewLine[];
}

/* ─────────────────────────── send result type ─────────────────────────── */

export interface ClrSendResult {
  id: number;
  ok: boolean;
  documentNo?: string | null;
  error?: string;
}

/* ─────────────────────────── private helpers ─────────────────────────── */

/** Today as YYYY-MM-DD (server local time). */
function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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
    // Pending — only when currently NULL or Failed (idempotent guard)
    await req.query(`
      UPDATE [dbo].[AccRequest]
      SET ErpInterfaceStatus=@status, ErpInterfaceError=NULL, UpdatedAt=SYSDATETIME()
      WHERE Id=@id AND (ErpInterfaceStatus IS NULL OR ErpInterfaceStatus='Failed')`);
  }
}

async function logInterfaceActivity(
  requestId: number,
  userId: number,
  action: string,
  note: string,
): Promise<void> {
  const pool = await getAccPool();
  await pool.request()
    .input("rid", sql.Int, requestId)
    .input("by", sql.Int, userId)
    .input("action", sql.NVarChar, action)
    .input("note", sql.NVarChar, note.slice(0, 2000))
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
 * distinct nos (shouldn't happen for a single clearing) are joined. null if none.
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

/** Map ClearAdvanceItem[] → ClrJournalItem[] (drop lines with no GL or zero before-VAT). */
function toJournalItems(
  items: import("@/features/clear-advance/types").ClearAdvanceItem[],
): ClrJournalItem[] {
  return items
    .filter((it) => it.glAccountNo && (it.amountBeforeVat ?? 0) !== 0)
    .map((it) => ({
      glAccountNo: it.glAccountNo!,
      amountBeforeVat: it.amountBeforeVat ?? 0,
      vatAmount: it.vatAmount ?? 0,
      whtAmount: it.whtAmount ?? 0,
      branchCode: it.branchCode ?? null,
    }));
}

/* ─────────────────────────── public: preview ─────────────────────────── */

/**
 * Build the BC journal that WOULD post for each approved clear-advance — the preview
 * shown in the Interface ERP tab before sending. Per-item try/catch so a brand with
 * incomplete config surfaces its own error instead of failing the batch.
 */
export async function previewClrErpJournal(ids: number[]): Promise<ClrPreviewItem[]> {
  const out: ClrPreviewItem[] = [];
  for (const id of ids) {
    try {
      const req = await getRequest(id);
      if (!req) {
        out.push({ id, requestNo: null, interfaceTarget: null, environment: null, journalBatchName: null, ok: false, error: "ไม่พบคำขอ", lines: [] });
        continue;
      }
      if (!req.brandCode) throw new Error("ไม่พบแบรนด์ของคำขอ");
      if (!req.clear) throw new Error("ไม่พบข้อมูลการเคลียร์เงินทดรองจ่าย");
      if (!req.clear.items || req.clear.items.length === 0) throw new Error("ไม่มีรายการค่าใช้จ่าย");

      const postingDate = req.clear.refundTransferDate ?? req.clear.paymentDate ?? todayYmd();
      const { config, target, departmentCode } = await loadClearAdvanceErpContext(req.brandCode, req.requesterDepartmentCode);
      const journalItems = toJournalItems(req.clear.items);
      const payload = buildClearAdvanceJournalPayload({
        requestNo: req.requestNo ?? String(id),
        postingDate,
        advanceAmount: req.clear.advanceAmount ?? 0,
        items: journalItems,
        config,
        departmentCode,
      });

      out.push({
        id,
        requestNo: req.requestNo,
        interfaceTarget: target.interfaceTarget,
        environment: target.environment,
        journalBatchName: config.journalBatchName,
        ok: true,
        lines: payload.lines.map((l) => ({
          accountType: l.accountType,
          accountNo: l.accountNo,
          description: l.description,
          branchCode: l.branchCode ?? "",
          departmentCode: l.departmentCode ?? "",
          debit: l.amount > 0 ? l.amount : null,
          credit: l.amount < 0 ? -l.amount : null,
        })),
      });
    } catch (e) {
      out.push({
        id,
        requestNo: null,
        interfaceTarget: null,
        environment: null,
        journalBatchName: null,
        ok: false,
        error: e instanceof Error ? e.message : "preview error",
        lines: [],
      });
    }
  }
  return out;
}

/* ─────────────────────────── public: send ─────────────────────────── */

/**
 * Send approved clear-advance requests to BC — ONE document per request (no
 * per-Company batching). Idempotent: Sent/Pending items are refused with a
 * descriptive error; only NULL/Failed items are marked Pending before posting.
 */
export async function sendClrErpBatch(ids: number[], userId: number): Promise<ClrSendResult[]> {
  const results: ClrSendResult[] = [];
  const pool = await getAccPool();

  for (const id of ids) {
    let bcEnvironment: ErpBcEnvironment | null = null;
    try {
      const req = await getRequest(id);
      if (!req) throw new Error("ไม่พบคำขอ");
      if (req.status !== "Approved") throw new Error("ต้องอนุมัติคำขอก่อนจึงจะส่ง ERP ได้");
      if (!req.brandCode) throw new Error("ไม่พบแบรนด์ของคำขอ");
      if (!req.clear) throw new Error("ไม่พบข้อมูลการเคลียร์เงินทดรองจ่าย");
      if (!req.clear.items || req.clear.items.length === 0) throw new Error("ไม่มีรายการค่าใช้จ่าย");

      // Idempotent guard — read current ERP status
      const stRes = await pool.request().input("id", sql.Int, id)
        .query(`SELECT ErpInterfaceStatus FROM [dbo].[AccRequest] WHERE Id=@id`);
      const st = (stRes.recordset[0]?.ErpInterfaceStatus as ErpInterfaceStatus | null) ?? null;
      if (st === "Sent") throw new Error("ส่งเข้า ERP สำเร็จแล้ว");
      if (st === "Pending") throw new Error("กำลังส่งอยู่");

      const postingDate = req.clear.refundTransferDate ?? req.clear.paymentDate ?? todayYmd();
      const { config, target, departmentCode } = await loadClearAdvanceErpContext(req.brandCode, req.requesterDepartmentCode);
      bcEnvironment = target.environment;

      const journalItems = toJournalItems(req.clear.items);
      const payload = buildClearAdvanceJournalPayload({
        requestNo: req.requestNo ?? String(id),
        postingDate,
        advanceAmount: req.clear.advanceAmount ?? 0,
        items: journalItems,
        config,
        departmentCode,
      });

      // Mark Pending (only when NULL/Failed — guard is in the SQL WHERE)
      await markInterfaceStatus(id, "Pending");

      const bcResponse = await postBcPpapJournalCreateFromJson(
        target.bcConnectionId,
        target.bcId,
        target.environment,
        target.baseUrl,
        payload as unknown as Record<string, unknown>,
      );

      const summary = assertBcJournalCreated(bcResponse);
      const docNo = extractBcDocumentNo(bcResponse);
      const envLabel = target.environment === "Sandbox" ? "UAT" : "PROD";

      await markInterfaceStatus(id, "Sent", { userId, environment: target.environment, documentNo: docNo });
      await logInterfaceActivity(
        id,
        userId,
        "erp_interface_sent",
        `ส่งเข้า ERP ${envLabel} · ${target.interfaceTarget} · ${req.requestNo ?? id} · Doc: ${docNo ?? "—"} · BCResp: ${summary}`,
      );

      results.push({ id, ok: true, documentNo: docNo });
    } catch (err) {
      const message = err instanceof Error ? err.message : "ส่งเข้า ERP ไม่สำเร็จ";
      try {
        await markInterfaceStatus(id, "Failed", { error: message, environment: bcEnvironment });
      } catch {
        // logging failure must not mask the real error
      }
      results.push({ id, ok: false, error: message });
    }
  }

  return results;
}
