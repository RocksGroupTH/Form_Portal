import { getAccPool, sql } from "@/lib/acc/pool";
import type { ErpBcEnvironment } from "@/lib/acc/erp-environment";
import type { ErpInterfaceStatus } from "@/features/accounting/constants";
import { postBcPpapJournalCreateFromJson } from "@/lib/bc/bc-odata";
import { getRequest } from "@/lib/clr/clear-advance-request-service";
import { loadClearAdvanceErpContext } from "@/lib/clr/clear-advance-erp-context";
import { buildClearAdvanceJournalPayload, journalPostingDate } from "@/lib/clr/clear-advance-erp-payload";
import { loadBranchLookup } from "@/lib/erp/location-lookup";
import { loadBranchGlAccounts, loadBuGlAccounts } from "@/lib/clr/clr-bu-gl-map-service";
import { isRocksPcBrand } from "@/features/clear-advance/constants";
import { AP3_FORM_CODE } from "@/features/clear-advance/constants";
import type { PpapJournalLinePayload } from "@/lib/acc/erp-ppap-payload";
import type { ClrJournalItem } from "@/lib/clr/clear-advance-erp-payload";

/* ─────────────────────────── preview types ─────────────────────────── */

/**
 * One line as Business Central will receive it.
 *
 * The whole payload line, not a summary of it: the preview exists to be checked
 * against BC, and a preview that shows seven of the twenty-three fields being
 * sent cannot answer "is the tax block right" — the question the VAT work made
 * worth asking. `debit`/`credit` and `branchBlocked` are the only additions, and
 * both are derived rather than sent.
 */
export interface ClrPreviewLine extends PpapJournalLinePayload {
  debit: number | null;
  credit: number | null;
  /**
   * This line's BRANCH dimension value is blocked in BC.
   *
   * Shown, never enforced: BC may still accept the line, and refusing the send on
   * an untested assumption would block work that actually posts. Accounting sees
   * the warning and decides.
   */
  branchBlocked: boolean;
}

export interface ClrPreviewItem {
  id: number;
  requestNo: string | null;
  interfaceTarget: string | null;
  environment: ErpBcEnvironment | null;
  journalBatchName: string | null;
  /** Refund or Payment — the whole clearing's type, blank on a failed preview. */
  documentType?: string;
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

/**
 * BC's answer as text, bounded.
 *
 * Kept whole rather than summarised: the summary is what we already had, and it
 * was the summary that could not say which line BC refused. 8,000 characters is
 * far more than the codeunit has ever returned and still small enough that a
 * pathological answer cannot fill the column.
 */
function bcResponseText(resp: unknown): string | null {
  if (resp == null) return null;
  const raw = typeof resp === "string" ? resp : JSON.stringify(resp);
  return raw ? raw.slice(0, 8000) : null;
}

async function markInterfaceStatus(
  requestId: number,
  status: ErpInterfaceStatus | null,
  opts: {
    error?: string | null; userId?: number | null;
    environment?: ErpBcEnvironment | null; documentNo?: string | null;
    /** BC's own answer, stored so anyone can read it without opening BC. */
    response?: string | null;
  } = {},
): Promise<void> {
  const pool = await getAccPool();
  const req = pool.request()
    .input("id", sql.Int, requestId)
    .input("status", sql.NVarChar, status)
    .input("error", sql.NVarChar, opts.error ?? null)
    .input("userId", sql.Int, opts.userId ?? null)
    .input("env", sql.NVarChar, opts.environment ?? null)
    .input("doc", sql.NVarChar, opts.documentNo ?? null)
    .input("resp", sql.NVarChar(sql.MAX), opts.response ?? null);
  if (status === "Sent") {
    await req.input("sentAt", sql.DateTime2, new Date()).query(`
      UPDATE [dbo].[AccRequest]
      SET ErpInterfaceStatus=@status, ErpInterfaceError=NULL, ErpInterfaceSentAt=@sentAt,
          ErpInterfaceSentBy=@userId, ErpInterfaceEnvironment=@env, ErpDocumentNo=@doc,
          ErpInterfaceResponse=@resp, UpdatedAt=SYSDATETIME()
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
    if (Number(failedM[1]) > 0) {
      // The count alone sends the reader to BC to find out which line and why.
      // The CU already says both, per line, in results[] — it was being read
      // only for the document no. and thrown away exactly when it mattered.
      const detail = extractBcLineErrors(resp);
      throw new Error(`BC: ${summary}${detail ? ` — ${detail}` : ""}`);
    }
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
 * The lines BC refused, and what it said about each.
 *
 * `results[]` carries one entry per line in the order they were sent, so the
 * index names the line the journal builder produced — 1 is the first expense
 * line. Empty when the response carries no per-line detail.
 */
function extractBcLineErrors(resp: unknown): string | null {
  const raw = typeof resp === "string" ? resp : JSON.stringify(resp ?? {});
  let inner = raw;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (o && typeof o === "object" && "value" in o) inner = String(o.value ?? "");
  } catch { /* keep raw */ }
  try {
    const r = JSON.parse(inner) as {
      results?: { status?: string; message?: string; error?: string }[];
    };
    const bad = (r.results ?? [])
      .map((it, i) => ({ i: i + 1, it }))
      .filter(({ it }) => it?.status && it.status !== "inserted");
    if (bad.length === 0) return null;
    return bad
      .map(({ i, it }) => `บรรทัด ${i}: ${(it.message ?? it.error ?? it.status ?? "").toString().slice(0, 200)}`)
      .join(" · ");
  } catch {
    return null;
  }
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
      description: it.description ?? null,
      expenseDate: it.expenseDate ?? null,
      // The invoice and who issued it — the VAT line's tax block (spec §5.4).
      docNo: it.docNo ?? null,
      taxId: it.taxId ?? null,
      payeeName: it.payeeName ?? null,
      taxBranchCode: it.taxBranchCode ?? null,
      taxVendorNo: it.taxVendorNo ?? null,
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

      /* The date the money moved, which depends on which way it moved.
         `refundToCompany` is positive when the employee returns the unspent part
         and negative when the company pays the shortfall — the same sign the
         document type reads. */
      const postingDate = journalPostingDate(
        req.clear.refundToCompany ?? 0,
        req.clear.refundTransferDate,
        req.clear.paymentDate,
        todayYmd(),
      );
      const { config, target, departmentCode } = await loadClearAdvanceErpContext(req.brandCode, req.requesterDepartmentCode, req.clear.advanceRequestId);
      const journalItems = toJournalItems(req.clear.items);
      const itemBranch = journalItems.find((it) => it.branchCode)?.branchCode ?? null;
      // Keyed by the interface target Company, NOT req.brandCode. The claim brand
      // is what the requester picked (ROCKS); everything in Rocks_ERP_Data is
      // keyed by the Company the journal actually posts into (PCTH, KSI, …),
      // which is what AP-2's branch and G/L pickers read too. Passing the claim
      // brand returns an empty map, sends no buCode on any line, and leaves every
      // one of them on the codeunit's COCO — this change doing nothing at all,
      // indistinguishable from the bug it fixes.
      //
      // Once per clearing, not once per line: a handful of lines against a few
      // hundred Locations makes one read cheaper than one round trip each.
      const branchBu = await loadBranchLookup(target.interfaceTarget);
      /* BU → G/L, and only for a home brand.
         A non-home brand already has every expense forced to 110723001 at save
         time (`FORCE_GL_NON_ROCKS_PC`), and letting the BU rule move it off that
         account would undo the older rule silently. Which of the two should win
         where they meet is accounting's question, not a default worth inventing —
         so the older one keeps its ground until they answer. */
      const buGlAccounts = isRocksPcBrand(req.brandCode)
        ? await loadBuGlAccounts(target.interfaceTarget)
        : {};
      const branchGlAccounts = isRocksPcBrand(req.brandCode)
        ? await loadBranchGlAccounts(target.interfaceTarget)
        : {};
      const payload = buildClearAdvanceJournalPayload({
        requestNo: req.requestNo ?? String(id),
        postingDate,
        advanceAmount: req.clear.advanceAmount ?? 0,
        items: journalItems,
        config,
        departmentCode,
        defaultBranchCode: itemBranch,
        advanceRequestNo: req.clear.advanceRequestNo,
        requesterName: req.requesterFullName,
        staffId: req.staffId,
        branchBu,
        buGlAccounts,
        branchGlAccounts,
        whtPayees: req.clear.whtItems ?? [],
      });

      out.push({
        id,
        requestNo: req.requestNo,
        interfaceTarget: target.interfaceTarget,
        environment: target.environment,
        journalBatchName: config.journalBatchName,
        // Every line carries the same document type, so it belongs to the
        // clearing, not to a row. Accounting needs to see Refund vs Payment
        // before sending — BC treats the two differently once posted.
        documentType: payload.lines[0]?.documentType ?? "",
        ok: true,
        lines: payload.lines.map((l) => ({
          ...l,
          debit: l.amount > 0 ? l.amount : null,
          credit: l.amount < 0 ? -l.amount : null,
          branchBlocked: branchBu.get((l.branchCode ?? "").trim().toUpperCase())?.isBlocked ?? false,
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
 *
 * Two-phase per id:
 *   Phase A — pre-flight (NO status mutation): guard against not-found / not-Approved /
 *             already-Sent / already-Pending → push error result and continue.
 *   Phase B — only for ids that passed pre-flight: resolve context + build payload,
 *             mark Pending, call BC, stamp Sent or Failed. The Failed UPDATE also
 *             carries AND ErpInterfaceStatus <> 'Sent' as belt-and-suspenders so an
 *             already-Sent record can never be flipped to Failed even if a logic bug
 *             somehow reaches Phase B with an already-Sent id.
 */
export async function sendClrErpBatch(ids: number[], userId: number): Promise<ClrSendResult[]> {
  const results: ClrSendResult[] = [];
  const pool = await getAccPool();

  for (const id of ids) {
    /* ── Phase A: pre-flight — no status mutation ── */
    let req: Awaited<ReturnType<typeof getRequest>>;
    try {
      req = await getRequest(id);
    } catch (e) {
      results.push({ id, ok: false, error: e instanceof Error ? e.message : "โหลดคำขอไม่สำเร็จ" });
      continue;
    }
    if (!req) {
      results.push({ id, ok: false, error: "ไม่พบคำขอ" });
      continue;
    }
    if (req.status !== "Approved") {
      results.push({ id, ok: false, error: "ต้องอนุมัติคำขอก่อนจึงจะส่ง ERP ได้" });
      continue;
    }
    if (!req.brandCode) {
      results.push({ id, ok: false, error: "ไม่พบแบรนด์ของคำขอ" });
      continue;
    }
    if (!req.clear) {
      results.push({ id, ok: false, error: "ไม่พบข้อมูลการเคลียร์เงินทดรองจ่าย" });
      continue;
    }
    if (!req.clear.items || req.clear.items.length === 0) {
      results.push({ id, ok: false, error: "ไม่มีรายการค่าใช้จ่าย" });
      continue;
    }

    // Idempotent guard — read current ERP status (pre-flight, no mutation)
    let st: ErpInterfaceStatus | null;
    try {
      const stRes = await pool.request().input("id", sql.Int, id)
        .query(`SELECT ErpInterfaceStatus FROM [dbo].[AccRequest] WHERE Id=@id`);
      st = (stRes.recordset[0]?.ErpInterfaceStatus as ErpInterfaceStatus | null) ?? null;
    } catch (e) {
      results.push({ id, ok: false, error: e instanceof Error ? e.message : "อ่านสถานะไม่สำเร็จ" });
      continue;
    }
    if (st === "Sent") {
      results.push({ id, ok: false, error: "ส่งเข้า ERP สำเร็จแล้ว" });
      continue;
    }
    if (st === "Pending") {
      results.push({ id, ok: false, error: "กำลังส่งอยู่" });
      continue;
    }

    /* ── Phase B: only ids that passed pre-flight reach here ── */
    let bcEnvironment: ErpBcEnvironment | null = null;
    // Declared out here so the catch can store what BC said. Inside the try it
    // is out of scope exactly when the answer is the thing worth keeping.
    let bcRaw: string | null = null;
    try {
      /* The date the money moved, which depends on which way it moved.
         `refundToCompany` is positive when the employee returns the unspent part
         and negative when the company pays the shortfall — the same sign the
         document type reads. */
      const postingDate = journalPostingDate(
        req.clear.refundToCompany ?? 0,
        req.clear.refundTransferDate,
        req.clear.paymentDate,
        todayYmd(),
      );
      const { config, target, departmentCode } = await loadClearAdvanceErpContext(req.brandCode, req.requesterDepartmentCode, req.clear.advanceRequestId);
      bcEnvironment = target.environment;

      const journalItems = toJournalItems(req.clear.items);
      const itemBranch = journalItems.find((it) => it.branchCode)?.branchCode ?? null;
      // Keyed by the interface target Company, NOT req.brandCode. The claim brand
      // is what the requester picked (ROCKS); everything in Rocks_ERP_Data is
      // keyed by the Company the journal actually posts into (PCTH, KSI, …),
      // which is what AP-2's branch and G/L pickers read too. Passing the claim
      // brand returns an empty map, sends no buCode on any line, and leaves every
      // one of them on the codeunit's COCO — this change doing nothing at all,
      // indistinguishable from the bug it fixes.
      //
      // Once per clearing, not once per line: a handful of lines against a few
      // hundred Locations makes one read cheaper than one round trip each.
      const branchBu = await loadBranchLookup(target.interfaceTarget);
      /* BU → G/L, and only for a home brand.
         A non-home brand already has every expense forced to 110723001 at save
         time (`FORCE_GL_NON_ROCKS_PC`), and letting the BU rule move it off that
         account would undo the older rule silently. Which of the two should win
         where they meet is accounting's question, not a default worth inventing —
         so the older one keeps its ground until they answer. */
      const buGlAccounts = isRocksPcBrand(req.brandCode)
        ? await loadBuGlAccounts(target.interfaceTarget)
        : {};
      const branchGlAccounts = isRocksPcBrand(req.brandCode)
        ? await loadBranchGlAccounts(target.interfaceTarget)
        : {};
      const payload = buildClearAdvanceJournalPayload({
        requestNo: req.requestNo ?? String(id),
        postingDate,
        advanceAmount: req.clear.advanceAmount ?? 0,
        items: journalItems,
        config,
        departmentCode,
        defaultBranchCode: itemBranch,
        advanceRequestNo: req.clear.advanceRequestNo,
        requesterName: req.requesterFullName,
        staffId: req.staffId,
        branchBu,
        buGlAccounts,
        branchGlAccounts,
        whtPayees: req.clear.whtItems ?? [],
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

      bcRaw = bcResponseText(bcResponse);
      const summary = assertBcJournalCreated(bcResponse);
      const docNo = extractBcDocumentNo(bcResponse);
      const envLabel = target.environment === "Sandbox" ? "UAT" : "PROD";

      await markInterfaceStatus(id, "Sent", {
        userId, environment: target.environment, documentNo: docNo, response: bcRaw,
      });
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
        // Belt-and-suspenders: AND ErpInterfaceStatus <> 'Sent' prevents flipping
        // a Sent record to Failed even if a logic defect reaches this catch.
        const pool2 = await getAccPool();
        await pool2.request()
          .input("id", sql.Int, id)
          .input("status", sql.NVarChar, "Failed")
          .input("error", sql.NVarChar, message)
          .input("env", sql.NVarChar, bcEnvironment)
          .input("resp", sql.NVarChar(sql.MAX), bcRaw)
          .query(`
            UPDATE [dbo].[AccRequest]
            SET ErpInterfaceStatus=@status, ErpInterfaceError=@error, ErpInterfaceSentAt=NULL,
                ErpInterfaceSentBy=NULL, ErpInterfaceEnvironment=@env,
                ErpInterfaceResponse=@resp, UpdatedAt=SYSDATETIME()
            WHERE Id=@id AND ErpInterfaceStatus <> 'Sent'`);
        await logInterfaceActivity(id, userId, "erp_interface_failed", message);
      } catch {
        // logging failure must not mask the real error
      }
      results.push({ id, ok: false, error: message });
    }
  }

  return results;
}

/**
 * Put a failed clearing back in the "รอส่ง" queue.
 *
 * Clears our record of the attempt — status, error, response, environment — so
 * the row is selectable again. It does **not** touch Business Central, and that
 * is the thing to know before pressing it: when the codeunit refuses one line of
 * four it keeps the three it accepted, so BC is already holding a partial
 * document and a re-send adds a second set. Whoever pulls back has to delete the
 * partial one in the batch first.
 *
 * Failed only, on purpose. A Sent clearing has a complete document that
 * accounting may already be posting against; AP-2 allows that pull-back because
 * it marks the old attempt Resent and keeps the mapping, and AP-3 has nowhere to
 * record it.
 */
export async function pullBackFailedSend(requestId: number, userId: number): Promise<void> {
  const pool = await getAccPool();
  const cur = await pool.request()
    .input("id", sql.Int, requestId)
    .input("form", sql.NVarChar, AP3_FORM_CODE)
    .query(`SELECT ErpInterfaceStatus FROM [dbo].[AccRequest] WHERE Id=@id AND FormCode=@form`);
  if (cur.recordset.length === 0) throw new Error("ไม่พบรายการ");
  if ((cur.recordset[0].ErpInterfaceStatus as string | null) !== "Failed") {
    throw new Error("ดึงกลับได้เฉพาะรายการที่ล้มเหลว (Failed)");
  }

  const tx = pool.transaction();
  await tx.begin();
  try {
    await tx.request().input("id", sql.Int, requestId).query(`
      UPDATE [dbo].[AccRequest]
      SET ErpInterfaceStatus=NULL, ErpInterfaceError=NULL, ErpInterfaceResponse=NULL,
          ErpInterfaceSentAt=NULL, ErpInterfaceSentBy=NULL, ErpInterfaceEnvironment=NULL,
          ErpDocumentNo=NULL, UpdatedAt=SYSDATETIME()
      WHERE Id=@id AND ErpInterfaceStatus='Failed'`);
    await tx.request()
      .input("rid", sql.Int, requestId)
      .input("by", sql.Int, userId)
      .query(`INSERT INTO [dbo].[AccActivityLog] (RequestId, AuthorId, Action, Note)
              VALUES (@rid, @by, 'erp_interface_pullback', N'ดึงกลับเข้าคิวเพื่อยิงใหม่ (จากสถานะล้มเหลว)')`);
    await tx.commit();
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  }
}
