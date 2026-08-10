import { getAccPool, sql } from "@/lib/acc/pool";
import type { ErpBcEnvironment } from "@/lib/acc/erp-environment";
import { loadErpJournalBuildContext, invalidateErpJournalBuildContextCache } from "@/lib/acc/erp-journal-context";
import {
  buildPpapJournalPayload,
  buildPpapJournalPayloadFromGroups,
  collectPersonGroupRequestIds,
  collectGroupsRequestIds,
} from "@/lib/acc/erp-ppap-payload";
import { listErpPrepRows } from "@/lib/acc/erp-prep-service";
import { buildErpJournalSections, type ErpJournalGroup } from "@/lib/acc/erp-journal-builder";
import { resolveErpTargetProfile } from "@/lib/acc/erp-target-profile";
import { filterRowsByInterfaceTarget } from "@/features/accounting/lib/erp-interface-target";
import { postBcPpapJournalCreateFromJson } from "@/lib/bc/bc-odata";
import type { ErpInterfaceStatus } from "@/features/accounting/constants";
import { deleteAccCached } from "@/lib/acc/acc-cache";

const PREP_DEPT_CTX_CACHE_KEY = "acc:prep-dept-ctx";

export interface SendErpPersonGroupInput {
  interfaceTarget: string;
  personGroupKey: string;
  role: string | null | undefined;
  host: string | null | undefined;
  userId: number;
}

export interface SendErpInterfaceBatchInput {
  interfaceTarget: string;
  role: string | null | undefined;
  host: string | null | undefined;
  userId: number;
}

export interface SendErpPersonGroupResult {
  requestIds: number[];
  environment: ErpBcEnvironment;
  bcResponse: unknown;
}

function findPersonGroup(
  groups: ErpJournalGroup[],
  personGroupKey: string,
): ErpJournalGroup | null {
  const key = personGroupKey.trim();
  return groups.find((g) => g.groupKey === key) ?? null;
}

function invalidateAccPrepCaches(): void {
  deleteAccCached(PREP_DEPT_CTX_CACHE_KEY);
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

export async function sendErpPersonGroup(
  input: SendErpPersonGroupInput,
): Promise<SendErpPersonGroupResult> {
  const target = input.interfaceTarget.trim().toUpperCase();
  const groupKey = input.personGroupKey.trim();

  const profile = await resolveErpTargetProfile(target, input.role, input.host);
  if (!profile?.profileComplete) {
    throw new Error(`การตั้งค่า BC สำหรับ ${target} ยังไม่ครบ — ตรวจสอบที่ Settings → Interface ERP`);
  }
  if (!profile.bcConnectionId || !profile.bcId || !profile.baseUrl) {
    throw new Error(`ไม่พบการเชื่อมต่อ BC สำหรับ ${target}`);
  }

  const ctx = await loadErpJournalBuildContext(input.role, input.host);
  const rows = await listErpPrepRows();
  const interfaceByClaim = ctx.interfaceByClaim;
  const filtered = filterRowsByInterfaceTarget(rows, interfaceByClaim, target);
  const built = buildErpJournalSections(filtered, ctx);
  const section = built.sections.find((s) => s.targetBrandCode === target);
  if (!section) {
    throw new Error(`ไม่พบกลุ่ม Interface ${target}`);
  }

  const group = findPersonGroup(section.personGroups, groupKey);
  if (!group) {
    throw new Error("ไม่พบกลุ่ม (คน+แผนก) ที่เลือก");
  }

  if (group.prepStatus !== "ready") {
    throw new Error("ข้อมูลยังไม่ครบสำหรับส่ง ERP — แก้ไขปัญหาที่แจ้งก่อนส่ง");
  }

  const requestIds = collectPersonGroupRequestIds(group);
  if (requestIds.length === 0) {
    throw new Error("ไม่พบเอกสารอ้างอิงในกลุ่มนี้");
  }

  const statuses = await loadRequestInterfaceStatuses(requestIds);
  for (const id of requestIds) {
    const st = statuses.get(id);
    if (st === "Sent") {
      throw new Error("มีเอกสารในกลุ่มนี้ส่งสำเร็จแล้ว — ไม่สามารถส่งซ้ำได้");
    }
    if (st === "Pending") {
      throw new Error("กลุ่มนี้กำลังส่งอยู่ — รอสักครู่แล้วลองใหม่");
    }
  }

  const journalBatchName = section.journalBatchName ?? group.journalBatchName;
  if (!journalBatchName?.trim()) {
    throw new Error("ยังไม่ตั้ง Journal Batch สำหรับกลุ่ม Interface");
  }

  const payload = buildPpapJournalPayload(group, journalBatchName);
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
      `ส่งเข้า ERP ${envLabel} · ${target} · ${group.requesterName ?? groupKey}`,
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

export async function sendErpInterfaceBatch(
  input: SendErpInterfaceBatchInput,
): Promise<SendErpPersonGroupResult> {
  const target = input.interfaceTarget.trim().toUpperCase();

  const profile = await resolveErpTargetProfile(target, input.role, input.host);
  if (!profile?.profileComplete) {
    throw new Error(`การตั้งค่า BC สำหรับ ${target} ยังไม่ครบ — ตรวจสอบที่ Settings → Interface ERP`);
  }
  if (!profile.bcConnectionId || !profile.bcId || !profile.baseUrl) {
    throw new Error(`ไม่พบการเชื่อมต่อ BC สำหรับ ${target}`);
  }

  const ctx = await loadErpJournalBuildContext(input.role, input.host);
  const rows = await listErpPrepRows();
  const interfaceByClaim = ctx.interfaceByClaim;
  const filtered = filterRowsByInterfaceTarget(rows, interfaceByClaim, target);
  const queueRows = filtered.filter((r) => r.prepStatus === "ready" && r.erpInterfaceStatus !== "Sent");
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
