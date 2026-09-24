import { getAccPool, sql } from "@/lib/acc/pool";
import { writeBothPools } from "@/lib/acc/dual-write";
import { listErpInterfaceBrands } from "@/lib/acc/erp-interface-brands";
import { type ApproverInterfaceAccess } from "@/lib/acc/approver-interface-access-shared";

export type { ApproverInterfaceAccess } from "@/lib/acc/approver-interface-access-shared";
export {
  buildInterfaceByClaimRecord,
  canActOnClaimBrand,
  canActOnInterfaceTarget,
  canRetargetClaimBrand,
  filterInterfaceBrandCodes,
  filterRowsForInterfaceAccess,
  INTERFACE_SCOPE_ERROR,
  INTERFACE_TARGET_SCOPE_ERROR,
} from "@/lib/acc/approver-interface-access-shared";

/**
 * Uppercase, de-duplicate and **drop anything that is not an interface brand**.
 *
 * `known` is supplied rather than looked up, so the list is resolved once per
 * call rather than once per code, and so this stays synchronous. That second
 * half is not tidiness: the predicate this replaced was used as
 * `if (isErpInterfaceBrandCode(c))`, and an async version kept in place would
 * have made that `if (promise)` — always true — silently writing every posted
 * code into `AccApproverInterfaceBrand`, which is what scopes an approver.
 */
function normalizeCodes(codes: string[], known: ReadonlySet<string>): string[] {
  const set = new Set<string>();
  for (const raw of codes) {
    const c = raw.trim().toUpperCase();
    if (known.has(c)) set.add(c);
  }
  return Array.from(set).sort();
}

/** The interface brand codes, uppercased, as a set for `normalizeCodes`. */
async function knownInterfaceCodes(): Promise<ReadonlySet<string>> {
  const brands = await listErpInterfaceBrands();
  return new Set(brands.map((b) => b.id.trim().toUpperCase()));
}

export async function loadInterfaceBrandsByApproverIds(
  approverIds: number[],
): Promise<Map<number, string[] | null>> {
  const map = new Map<number, string[] | null>();
  if (approverIds.length === 0) return map;

  try {
    const pool = await getAccPool();
    const placeholders = approverIds.map((_, i) => `@id${i}`).join(", ");
    const req = pool.request();
    approverIds.forEach((id, i) => req.input(`id${i}`, sql.Int, id));

    const r = await req.query(`
      SELECT ApproverId, InterfaceBrandCode
      FROM [dbo].[AccApproverInterfaceBrand]
      WHERE ApproverId IN (${placeholders})
      ORDER BY InterfaceBrandCode
    `);

    const byApprover = new Map<number, string[]>();
    for (const row of r.recordset as {
      ApproverId: number;
      InterfaceBrandCode: string;
    }[]) {
      const id = row.ApproverId;
      const list = byApprover.get(id) ?? [];
      list.push(row.InterfaceBrandCode.trim().toUpperCase());
      byApprover.set(id, list);
    }

    const known = await knownInterfaceCodes();
    for (const id of approverIds) {
      const list = byApprover.get(id);
      /* **Zero rows is zero brands since 2026-09-24** (the user: "ไม่ได้ติ๊ก
         brand ไหนเลย ต้องไม่ขึ้น"). It used to be `null`, which
         `resolveApproverInterfaceAccess` read as every brand — the fail-open
         CLAUDE.md recorded, and what let an approver nobody had ticked
         anything for approve every brand's claim. `null` now means one thing
         only: the table itself could not be read. */
      map.set(id, list && list.length > 0 ? normalizeCodes(list, known) : []);
    }
    return map;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // `null` here is the MISSING TABLE, and nothing else — since 2026-09-24
    // it is read as no access rather than as every brand, so this degrade is
    // fail-closed like every other authorization read. The catch still has to
    // be exact: it must not swallow a deadlock or a permission failure and
    // report them as "this table is not deployed".
    //
    // Both halves must hold: the missing-object error, about THIS object.
    // The OR that was here degraded on any error merely *naming* the table —
    // a deadlock, a timeout, a permission failure — and on any `Invalid object
    // name` about some *other* table. Each of those escalated an approver to
    // every interface brand on the ERP send, the prep detail, the ACCOUNT
    // approve/reject and the report export, which is the opposite of what a
    // failed authorization read should do.
    if (
      msg.includes("Invalid object name") &&
      msg.includes("AccApproverInterfaceBrand")
    ) {
      for (const id of approverIds) map.set(id, null);
      return map;
    }
    throw err;
  }
}

export async function getApproverInterfaceBrandCodes(
  approverId: number,
): Promise<string[] | null> {
  const map = await loadInterfaceBrandsByApproverIds([approverId]);
  return map.get(approverId) ?? null;
}

export async function setApproverInterfaceBrands(
  approverId: number,
  codes: string[] | null,
): Promise<void> {
  await writeBothPools(async (tx) => {
    await tx
      .request()
      .input("aid", sql.Int, approverId)
      .query(
        `DELETE FROM [dbo].[AccApproverInterfaceBrand] WHERE ApproverId = @aid`,
      );

    if (codes != null && codes.length > 0) {
      const normalized = normalizeCodes(codes, await knownInterfaceCodes());
      for (const code of normalized) {
        await tx
          .request()
          .input("aid", sql.Int, approverId)
          .input("code", sql.NVarChar, code).query(`
            INSERT INTO [dbo].[AccApproverInterfaceBrand] (ApproverId, InterfaceBrandCode)
            VALUES (@aid, @code)
          `);
      }
    }
  });
}

export async function resolveApproverInterfaceAccess(
  email: string | null | undefined,
  _role: string | null | undefined,
): Promise<ApproverInterfaceAccess> {
  if (!email) {
    return { allAccess: false, allowedCodes: [] };
  }

  const pool = await getAccPool();
  const r = await pool.request().input("email", sql.NVarChar, email).query(`
      SELECT a.Id
      FROM [dbo].[AccApprover] a
      WHERE LOWER(a.Email) = LOWER(@email) AND a.IsActive = 1
    `);
  const approverId = r.recordset[0]?.Id as number | undefined;
  if (!approverId) {
    return { allAccess: false, allowedCodes: [] };
  }

  const codes = await getApproverInterfaceBrandCodes(approverId);
  /**
   * **`allAccess` is never granted here any more** (the user, 2026-09-24).
   *
   * An AP-1 approver may act on exactly the interface targets somebody ticked
   * for them, and on nothing when nobody has — the rule AP-4 has always had and
   * which this form deliberately did not copy until now. `null` reaches here
   * only when the scope table could not be read, and answers the same "no
   * brands": an authorization read that failed must not grant.
   *
   * **What it cost, stated rather than discovered.** Measured that day, one of
   * seven active approvers carried zero rows and could therefore approve every
   * brand; they now approve none until an admin ticks one. And **nobody was
   * scoped to KSI at all**, so KSI claims — which had been actionable only
   * through that fail-open — are actionable by nobody until somebody is ticked
   * for it. That is the point of the change rather than a side effect: the
   * queue now says out loud what the ticks actually say.
   *
   * The type keeps `allAccess` because AP-17's own resolver still grants it to
   * an admin role and the two share `approver-interface-access-shared.ts`.
   * One consequence of it being permanently false on AP-1: the queue's
   * "ยังไม่ได้จัดกลุ่ม" tab (`showUnassignedTab={access.allAccess}`) no longer
   * shows for anybody. Measured the same day, every AP-1 claim brand maps to a
   * target — KSI→KSI, PCMY→PCTH, PCTH→PCTH, ROCKS→PCTH, UNO→UNO — so that tab
   * has nothing to hold today; a brand added with no mapping would be visible
   * to nobody, and mapping it at Settings → Interface ERP is the fix.
   */
  return { allAccess: false, allowedCodes: codes ?? [] };
}
