import { getAccPool, sql } from "@/lib/acc/pool";
import { isErpInterfaceBrandCode } from "@/lib/acc/erp-interface-brands";
import {
  allInterfaceBrandCodes,
  type ApproverInterfaceAccess,
} from "@/lib/acc/approver-interface-access-shared";

export type { ApproverInterfaceAccess } from "@/lib/acc/approver-interface-access-shared";
export {
  allInterfaceBrandCodes,
  buildInterfaceByClaimRecord,
  filterInterfaceBrandCodes,
  filterRowsForInterfaceAccess,
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
    for (const row of r.recordset as { ApproverId: number; InterfaceBrandCode: string }[]) {
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
    if (msg.includes("AccApproverInterfaceBrand") || msg.includes("Invalid object name")) {
      for (const id of approverIds) map.set(id, null);
      return map;
    }
    throw err;
  }
}

export async function getApproverInterfaceBrandCodes(approverId: number): Promise<string[] | null> {
  const map = await loadInterfaceBrandsByApproverIds([approverId]);
  return map.get(approverId) ?? null;
}

export async function setApproverInterfaceBrands(
  approverId: number,
  codes: string[] | null,
): Promise<void> {
  const pool = await getAccPool();
  const tx = pool.transaction();
  await tx.begin();
  try {
    await tx.request()
      .input("aid", sql.Int, approverId)
      .query(`DELETE FROM [dbo].[AccApproverInterfaceBrand] WHERE ApproverId = @aid`);

    if (codes != null && codes.length > 0) {
      const normalized = normalizeCodes(codes);
      for (const code of normalized) {
        await tx.request()
          .input("aid", sql.Int, approverId)
          .input("code", sql.NVarChar, code)
          .query(`
            INSERT INTO [dbo].[AccApproverInterfaceBrand] (ApproverId, InterfaceBrandCode)
            VALUES (@aid, @code)
          `);
      }
    }
    await tx.commit();
  } catch (e) {
    await tx.rollback();
    throw e;
  }
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
  const r = await pool.request()
    .input("email", sql.NVarChar, email)
    .query(`
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
