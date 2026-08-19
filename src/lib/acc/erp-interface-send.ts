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
import { BcJournalPostError, postBcPpapJournalCreateFromJson } from "@/lib/bc/bc-odata";
import type { ErpInterfaceStatus } from "@/features/accounting/constants";

/**
 * The queue moved between the GET that drew the page and the click: documents
 * were approved, corrected or sent by someone else, so this target's ready set
 * is no longer the one the operator confirmed. Distinct from the environment
 * message on purpose — nothing about the viewer's environment changed here, and
 * telling them it did sent them looking for a problem that does not exist.
 *
 * States what is true on the server and stops there. Reloading the queue is the
 * client's doing — `ErpPrepQueue`'s `onStale` calls `fetchList()` — so the toast
 * there may promise it, but this constant also reaches anyone calling
 * `sendErpInterfaceBatch` directly or hitting the route, for whom nothing was
 * reloaded.
 */
export const ERP_QUEUE_DRIFT_ERROR =
  "รายการที่พร้อมส่งเปลี่ยนไปตั้งแต่เปิดหน้านี้ กรุณาตรวจสอบแล้วส่งอีกครั้ง";

/** Thrown by `sendErpInterfaceBatch` alone, so the route can answer 409 rather than 400. */
export class ErpQueueDriftError extends Error {
  constructor() {
    super(ERP_QUEUE_DRIFT_ERROR);
    this.name = "ErpQueueDriftError";
  }
}

/**
 * What an operator is told when the batch is held for reconciliation.
 *
 * Deliberately not a failure message: the documents may be in Business Central.
 * The rows stay `Pending`, which the pre-send check refuses, so nothing posts
 * them again until someone has looked.
 */
export const ERP_RECONCILE_ERROR =
  "ส่งเข้า ERP แล้วไม่ทราบผล — กรุณาตรวจสอบใน Business Central ก่อนส่งซ้ำ (รอบนี้ถูกพักไว้)";

/**
 * The remote outcome is unknown, so the batch was left claimed rather than
 * released. Distinct from `ErpQueueDriftError`: nothing about this is
 * retryable, and the route must not present it as such.
 */
export class ErpReconciliationRequiredError extends Error {
  constructor(readonly detail: string) {
    super(ERP_RECONCILE_ERROR);
    this.name = "ErpReconciliationRequiredError";
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

/**
 * Take exclusive ownership of the whole batch, or nothing.
 *
 * One conditional UPDATE over the exact id set inside one transaction, and the
 * affected-row count has to equal the batch size. What it replaces was a read
 * (`loadRequestInterfaceStatuses`) followed by a per-row `markRequestsInterfaceStatus`
 * whose predicate *was* conditional but whose row count was discarded — so two
 * clicks on the same ready batch both passed the read, both "claimed", and both
 * went on to post the same journal to Business Central. Duplicated financial
 * documents, from a double-click.
 *
 * Returns false when any row was already Pending or Sent; the transaction rolls
 * back, so a partial claim is never left behind.
 */
async function claimRequestsForSend(requestIds: number[]): Promise<boolean> {
  if (requestIds.length === 0) return false;

  const pool = await getAccPool();
  const tx = pool.transaction();
  await tx.begin();
  try {
    const req = tx.request();
    const placeholders: string[] = [];
    requestIds.forEach((id, i) => {
      req.input(`id${i}`, sql.Int, id);
      placeholders.push(`@id${i}`);
    });

    const res = await req.query(`
      UPDATE [dbo].[AccRequest]
      SET ErpInterfaceStatus = 'Pending',
          ErpInterfaceError = NULL,
          UpdatedAt = SYSDATETIME()
      WHERE Id IN (${placeholders.join(", ")})
        AND (ErpInterfaceStatus IS NULL OR ErpInterfaceStatus = 'Failed')
    `);

    if (res.rowsAffected[0] !== requestIds.length) {
      await tx.rollback();
      return false;
    }
    await tx.commit();
    return true;
  } catch (err) {
    await tx.rollback().catch(() => {});
    throw err;
  }
}

/**
 * Give the claim back, so the batch can be corrected and sent again.
 *
 * Only ever called when the remote call definitely did not create anything —
 * before it, or after a 4xx. A 5xx or a transport error goes to
 * `holdForReconciliation` instead.
 */
async function releaseClaim(requestIds: number[], message: string): Promise<void> {
  await markRequestsInterfaceStatus(requestIds, "Failed", { error: message });
}

/**
 * Leave the batch claimed and record why.
 *
 * `Pending` is the reconciliation state. It is not a value this code will move
 * on its own — the pre-send check refuses a Pending row outright — so the batch
 * stays out of every future send until a person decides what happened. Using
 * the existing status keeps this to a code change: `CK_AccRequest_ErpInterfaceStatus`
 * permits only Pending/Sent/Failed, and a new value would need a migration
 * applied to both databases before the code could ship.
 */
async function holdForReconciliation(
  requestIds: number[],
  userId: number,
  detail: string,
): Promise<void> {
  const pool = await getAccPool();
  for (const id of requestIds) {
    await pool
      .request()
      .input("id", sql.Int, id)
      .input("error", sql.NVarChar, detail.slice(0, 2000))
      .query(`
        UPDATE [dbo].[AccRequest]
        SET ErpInterfaceStatus = 'Pending',
            ErpInterfaceError = @error,
            UpdatedAt = SYSDATETIME()
        WHERE Id = @id
      `)
      .catch(() => {});
  }
  await logInterfaceActivity(
    requestIds,
    userId,
    "erp_interface_unknown",
    `ผลการส่งไม่แน่ชัด — ต้องตรวจสอบใน BC: ${detail}`,
  ).catch(() => {});
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

  // Drift, not a bad request. An empty batch survives the check above only when
  // the client echoed an empty set too — `sameRequestIdSet([], [])` is true — so
  // what actually happened is that the queue emptied out from under a page that
  // was already showing nothing. A plain Error 400s, and 400 is the dialog's
  // retryable phase: the operator would be offered a retry that must 400 again
  // forever. As an ErpQueueDriftError it 409s and the client reloads instead.
  if (queueRows.length === 0) {
    throw new ErpQueueDriftError();
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

  // A friendlier message than the claim's 409 for the two states an operator
  // meets routinely. The claim below is what actually decides — this read is
  // advisory and can be stale by the time it returns.
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

  // Everything above is a read or a pure build, so nothing has been written
  // yet and a failure there needs no unwinding. From here on the batch is
  // owned: claim it in one statement, and only then talk to Business Central.
  if (!(await claimRequestsForSend(requestIds))) {
    invalidateAccPrepCaches();
    throw new ErpQueueDriftError();
  }

  let bcResponse: unknown;
  try {
    bcResponse = await postBcPpapJournalCreateFromJson(
      profile.bcConnectionId,
      profile.bcId,
      profile.environment,
      profile.baseUrl,
      payload as unknown as Record<string, unknown>,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "ส่งเข้า ERP ไม่สำเร็จ";

    // A 4xx is Business Central refusing the payload: nothing was created, so
    // the claim goes back and the operator may correct and resend.
    if (err instanceof BcJournalPostError && err.definitelyRejected) {
      await releaseClaim(requestIds, message);
      await logInterfaceActivity(
        requestIds,
        input.userId,
        "erp_interface_failed",
        message.slice(0, 2000),
      );
      invalidateAccPrepCaches();
      throw new Error(message);
    }

    // A 5xx, a timeout, a dropped connection: the journal may exist. Marking
    // this `Failed` — which is what happened before — put it straight back in
    // the ready queue, so the next click posted the same financial document a
    // second time. Hold it instead.
    await holdForReconciliation(requestIds, input.userId, message);
    invalidateAccPrepCaches();
    throw new ErpReconciliationRequiredError(message);
  }

  // BC accepted. From here the documents exist remotely and must never be
  // posted again, whatever goes wrong locally.
  try {
    await markRequestsInterfaceStatus(requestIds, "Sent", {
      userId: input.userId,
      environment: profile.environment,
      sentAt: new Date(),
    });
  } catch (persistErr) {
    const message = persistErr instanceof Error ? persistErr.message : String(persistErr);
    await holdForReconciliation(
      requestIds,
      input.userId,
      `BC รับเอกสารแล้ว แต่บันทึกสถานะไม่สำเร็จ: ${message}`,
    );
    invalidateAccPrepCaches();
    throw new ErpReconciliationRequiredError(message);
  }

  const envLabel = profile.environment === "Sandbox" ? "UAT" : "PROD";
  // Best-effort: the send is already durable in both systems, so a logging
  // failure must not be reported as a send failure.
  await logInterfaceActivity(
    requestIds,
    input.userId,
    "erp_interface_sent",
    `ส่งเข้า ERP ${envLabel} · ${target} · ${requestIds.length} เอกสาร`,
  ).catch((logErr) => {
    console.error("[erp-interface-send] activity log after a successful send:", logErr);
  });

  invalidateAccPrepCaches();

  return {
    requestIds,
    environment: profile.environment,
    bcResponse,
  };
}
