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
      map.set(id, list && list.length > 0 ? normalizeCodes(list, known) : null);
    }
    return map;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // `null` here means UNRESTRICTED, not "no access" — `resolveApproverInterfaceAccess`
    // maps it to `{ allAccess: true }`, because for this table no rows is the
    // intended "not scoped to any brand". That inverts the usual fail-closed
    // reading, so the catch has to be exact.
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
  if (codes === null) {
    /* Resolved only on the unrestricted branch, which is the only one that
       needs it — and after the roster read, so a non-approver costs nothing.
       `allAccess` is what every authorization check short-circuits on
       (`canActOnInterfaceTarget`), so this list is for display and filtering
       rather than for deciding whether somebody may act. */
    const all = await listErpInterfaceBrands();
    return { allAccess: true, allowedCodes: all.map((b) => b.id) };
  }
  return { allAccess: false, allowedCodes: codes };
}
