import { getAccPool, sql } from "@/lib/acc/pool";
import { writeBothPools } from "@/lib/acc/dual-write";
import { isErpInterfaceBrandCode } from "@/lib/acc/erp-interface-brands";
import {
  allInterfaceBrandCodes,
  type ApproverInterfaceAccess,
} from "@/lib/acc/approver-interface-access-shared";

export type { ApproverInterfaceAccess } from "@/lib/acc/approver-interface-access-shared";
export {
  allInterfaceBrandCodes,
  buildInterfaceByClaimRecord,
  canActOnClaimBrand,
  canActOnInterfaceTarget,
  canRetargetClaimBrand,
  filterInterfaceBrandCodes,
  filterRowsForInterfaceAccess,
  INTERFACE_SCOPE_ERROR,
  INTERFACE_TARGET_SCOPE_ERROR,
} from "@/lib/acc/approver-interface-access-shared";

function normalizeCodes(codes: string[]): string[] {
  const set = new Set<string>();
  for (const raw of codes) {
    const c = raw.trim().toUpperCase();
    if (isErpInterfaceBrandCode(c)) set.add(c);
  }
  return Array.from(set).sort();
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

    for (const id of approverIds) {
      const list = byApprover.get(id);
      map.set(id, list && list.length > 0 ? normalizeCodes(list) : null);
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
      const normalized = normalizeCodes(codes);
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
  const allCodes = allInterfaceBrandCodes();
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
    return { allAccess: true, allowedCodes: allCodes };
  }
  return { allAccess: false, allowedCodes: codes };
}
