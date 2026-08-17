import { getAccPool, sql } from "@/lib/acc/pool";
import type { ErpBcEnvironment } from "@/lib/acc/erp-environment";
import { loadErpJournalBuildContext, invalidateErpJournalBuildContextCache } from "@/lib/acc/erp-journal-context";
import {
  buildPpapJournalPayloadFromGroups,
  collectGroupsRequestIds,
} from "@/lib/acc/erp-ppap-payload";
import { listErpPrepRows, invalidatePrepDeptContextCache } from "@/lib/acc/erp-prep-service";
import { buildErpJournalSections } from "@/lib/acc/erp-journal-builder";
import { resolveErpTargetProfile } from "@/lib/acc/erp-target-profile";
import {
  sameRequestIdSet,
  selectErpSendBatchRows,
} from "@/features/accounting/lib/erp-send-batch";
import { postBcPpapJournalCreateFromJson } from "@/lib/bc/bc-odata";
import type { ErpInterfaceStatus } from "@/features/accounting/constants";

/**
 * The queue moved between the GET that drew the page and the click: documents
 * were approved, corrected or sent by someone else, so this target's ready set
 * is no longer the one the operator confirmed. Distinct from the environment
 * message on purpose — nothing about the viewer's environment changed here, and
 * telling them it did sent them looking for a problem that does not exist.
 */
export const ERP_QUEUE_DRIFT_ERROR =
  "รายการที่พร้อมส่งเปลี่ยนไปตั้งแต่เปิดหน้านี้ — ระบบโหลดคิวใหม่ให้แล้ว กรุณาตรวจสอบแล้วส่งอีกครั้ง";

/** Thrown by `sendErpInterfaceBatch` alone, so the route can answer 409 rather than 400. */
export class ErpQueueDriftError extends Error {
  constructor() {
    super(ERP_QUEUE_DRIFT_ERROR);
    this.name = "ErpQueueDriftError";
  }
}

export interface SendErpInterfaceBatchInput {
  interfaceTarget: string;
  userId: number;
  /**
   * The ids the operator's queue showed as ready-to-send for this target,
   * echoed back from the client. Nothing is sent unless they still match the
   * batch this call picks — see the drift check below.
   */
  expectedRequestIds: readonly number[];
}

export interface SendErpInterfaceResult {
  requestIds: number[];
  environment: ErpBcEnvironment;
  bcResponse: unknown;
}

function invalidateAccPrepCaches(): void {
  invalidatePrepDeptContextCache();
  invalidateErpJournalBuildContextCache();
}

async function loadRequestInterfaceStatuses(
  requestIds: number[],
): Promise<Map<number, ErpInterfaceStatus | null>> {
  const map = new Map<number, ErpInterfaceStatus | null>();
  if (requestIds.length === 0) return map;

  const pool = await getAccPool();
  const req = pool.request();
  const placeholders: string[] = [];
  for (let i = 0; i < requestIds.length; i++) {
    const param = `id${i}`;
    req.input(param, sql.Int, requestIds[i]);
    placeholders.push(`@${param}`);
  }

  const res = await req.query(`
    SELECT Id, ErpInterfaceStatus
    FROM [dbo].[AccRequest]
    WHERE Id IN (${placeholders.join(", ")})
  `);

  for (const row of res.recordset as Record<string, unknown>[]) {
    const status = row.ErpInterfaceStatus as ErpInterfaceStatus | null;
    map.set(row.Id as number, status ?? null);
  }
  return map;
}

async function markRequestsInterfaceStatus(
  requestIds: number[],
  status: ErpInterfaceStatus | null,
  options: {
    error?: string | null;
    userId?: number | null;
    environment?: ErpBcEnvironment | null;
    sentAt?: Date;
  } = {},
): Promise<void> {
  if (requestIds.length === 0) return;
  const pool = await getAccPool();

  for (const id of requestIds) {
    const req = pool.request();
    req.input("id", sql.Int, id);
    req.input("status", sql.NVarChar, status);
    req.input("error", sql.NVarChar, options.error ?? null);
    req.input("userId", sql.Int, options.userId ?? null);
    req.input("env", sql.NVarChar, options.environment ?? null);

    if (status === "Sent") {
      req.input("sentAt", sql.DateTime2, options.sentAt ?? new Date());
      await req.query(`
        UPDATE [dbo].[AccRequest]
        SET ErpInterfaceStatus = @status,
            ErpInterfaceError = NULL,
            ErpInterfaceSentAt = @sentAt,
            ErpInterfaceSentBy = @userId,
            ErpInterfaceEnvironment = @env,
            UpdatedAt = SYSDATETIME()
        WHERE Id = @id
      `);
    } else if (status === "Failed") {
      await req.query(`
        UPDATE [dbo].[AccRequest]
        SET ErpInterfaceStatus = @status,
            ErpInterfaceError = @error,
            ErpInterfaceSentAt = NULL,
            ErpInterfaceSentBy = NULL,
            ErpInterfaceEnvironment = @env,
            UpdatedAt = SYSDATETIME()
        WHERE Id = @id
      `);
    } else if (status === "Pending") {
      await req.query(`
        UPDATE [dbo].[AccRequest]
        SET ErpInterfaceStatus = @status,
            ErpInterfaceError = NULL,
            UpdatedAt = SYSDATETIME()
        WHERE Id = @id
          AND (ErpInterfaceStatus IS NULL OR ErpInterfaceStatus = 'Failed')
      `);
    } else {
      await req.query(`
        UPDATE [dbo].[AccRequest]
        SET ErpInterfaceStatus = NULL,
            ErpInterfaceError = NULL,
            ErpInterfaceSentAt = NULL,
            ErpInterfaceSentBy = NULL,
            ErpInterfaceEnvironment = NULL,
            UpdatedAt = SYSDATETIME()
        WHERE Id = @id
      `);
    }
  }
}

async function logInterfaceActivity(
  requestIds: number[],
  userId: number,
  action: string,
  note: string,
): Promise<void> {
  const pool = await getAccPool();
  for (const requestId of requestIds) {
    await pool
      .request()
      .input("rid", sql.Int, requestId)
      .input("by", sql.Int, userId)
      .input("action", sql.NVarChar, action)
      .input("note", sql.NVarChar, note.slice(0, 2000))
      .query(`
        INSERT INTO [dbo].[AccActivityLog] (RequestId, AuthorId, Action, Note)
        VALUES (@rid, @by, @action, @note)
      `);
  }
}

export async function sendErpInterfaceBatch(
  input: SendErpInterfaceBatchInput,
): Promise<SendErpInterfaceResult> {
  const target = input.interfaceTarget.trim().toUpperCase();

  const profile = await resolveErpTargetProfile(target);
  if (!profile?.profileComplete) {
    throw new Error(`การตั้งค่า BC สำหรับ ${target} ยังไม่ครบ — ตรวจสอบที่ Settings → Interface ERP`);
  }
  if (!profile.bcConnectionId || !profile.bcId || !profile.baseUrl) {
    throw new Error(`ไม่พบการเชื่อมต่อ BC สำหรับ ${target}`);
  }

  const ctx = await loadErpJournalBuildContext();
  const rows = await listErpPrepRows();
  const queueRows = selectErpSendBatchRows(rows, ctx.interfaceByClaim, target);

  // Bind the click to the batch that was on screen. Checked here rather than in
  // the route so it reuses the read the send already performs: `listErpPrepRows`
  // is a GROUP BY with three correlated subqueries over the full Approved
  // history, and the route used to run a second copy of it for this comparison
  // alone. Checking it here also means the comparison is over the batch — this
  // target, ready, not already Sent — instead of over every Approved row in
  // Accounting, so an approval for another interface target no longer 409s a
  // queue that is perfectly current.
  //
  // This is a staleness gate, not the double-send guard: two tabs sending the
  // same unchanged batch both pass here, and the `st === "Sent"` check further
  // down is what stops the second one.
  if (!sameRequestIdSet(queueRows.map((r) => r.id), input.expectedRequestIds)) {
    throw new ErpQueueDriftError();
  }

  if (queueRows.length === 0) {
    throw new Error("ไม่มีเอกสารที่พร้อมส่งในรอบนี้");
  }

  const built = buildErpJournalSections(queueRows, ctx);
  const section = built.sections.find((s) => s.targetBrandCode === target);
  if (!section) {
    throw new Error(`ไม่พบกลุ่ม Interface ${target}`);
  }

  const groups = section.personGroups;
  if (groups.length === 0) {
    throw new Error("ไม่พบบรรทัด Journal ที่พร้อมส่ง");
  }

  for (const group of groups) {
    if (group.prepStatus !== "ready") {
      throw new Error("ข้อมูลยังไม่ครบสำหรับส่ง ERP — แก้ไขปัญหาที่แจ้งก่อนส่ง");
    }
  }

  const requestIds = collectGroupsRequestIds(groups);
  if (requestIds.length === 0) {
    throw new Error("ไม่พบเอกสารอ้างอิงในรอบนี้");
  }

  const statuses = await loadRequestInterfaceStatuses(requestIds);
  for (const id of requestIds) {
    const st = statuses.get(id);
    if (st === "Sent") {
      throw new Error("มีเอกสารในรอบนี้ส่งสำเร็จแล้ว — ไม่สามารถส่งซ้ำได้");
    }
    if (st === "Pending") {
      throw new Error("รอบนี้กำลังส่งอยู่ — รอสักครู่แล้วลองใหม่");
    }
  }

  const journalBatchName = section.journalBatchName;
  if (!journalBatchName?.trim()) {
    throw new Error("ยังไม่ตั้ง Journal Batch สำหรับกลุ่ม Interface");
  }

  const payload = buildPpapJournalPayloadFromGroups(groups, journalBatchName);
  if (payload.lines.length === 0) {
    throw new Error("ไม่มีบรรทัด Journal ที่พร้อมส่ง");
  }

  await markRequestsInterfaceStatus(requestIds, "Pending");

  try {
    const bcResponse = await postBcPpapJournalCreateFromJson(
      profile.bcConnectionId,
      profile.bcId,
      profile.environment,
      profile.baseUrl,
      payload as unknown as Record<string, unknown>,
    );

    const sentAt = new Date();
    await markRequestsInterfaceStatus(requestIds, "Sent", {
      userId: input.userId,
      environment: profile.environment,
      sentAt,
    });

    const envLabel = profile.environment === "Sandbox" ? "UAT" : "PROD";
    await logInterfaceActivity(
      requestIds,
      input.userId,
      "erp_interface_sent",
      `ส่งเข้า ERP ${envLabel} · ${target} · ${requestIds.length} เอกสาร`,
    );

    invalidateAccPrepCaches();

    return {
      requestIds,
      environment: profile.environment,
      bcResponse,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "ส่งเข้า ERP ไม่สำเร็จ";
    await markRequestsInterfaceStatus(requestIds, "Failed", {
      error: message,
      environment: profile.environment,
    });
    await logInterfaceActivity(
      requestIds,
      input.userId,
      "erp_interface_failed",
      message.slice(0, 2000),
    );
    invalidateAccPrepCaches();
    throw new Error(message);
  }
}
