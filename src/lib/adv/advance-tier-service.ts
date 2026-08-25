import { getAccPool, sql } from "@/lib/adv/pool";
import { writeBothPools } from "@/lib/acc/dual-write";
import { parseSteps, stepsToCsv, type StepType } from "@/lib/adv/approval-steps";
import type { Transaction } from "mssql";

/**
 * Insert the ordered approval rows for a request, inside submit's transaction.
 * The manager step (HEAD_DEPT) is assigned to the requester's manager; role
 * steps are left unassigned (any active approver of that role acts). Lives here
 * (not the engine) so advance-request-service can call it without importing the
 * engine, which imports getRequest back — a cycle.
 */
export async function buildApprovalChain(
  tx: Transaction,
  requestId: number,
  steps: StepType[],
  managerStaffId: number | null,
  managerEmail: string | null,
): Promise<void> {
  let order = 1;
  for (const st of steps) {
    const isMgr = st === "HEAD_DEPT";
    await tx.request()
      .input("rid", sql.Int, requestId)
      .input("ord", sql.Int, order)
      .input("type", sql.NVarChar, st)
      .input("astaff", sql.Int, isMgr ? managerStaffId : null)
      .input("aemail", sql.NVarChar, isMgr ? managerEmail : null)
      .query(`INSERT INTO [dbo].[AccAdvanceApproval]
                (RequestId, StepOrder, StepType, AssignedStaffId, AssignedEmail, Status)
              VALUES (@rid, @ord, @type, @astaff, @aemail, 'Pending')`);
    order++;
  }
}

/** One amount tier of the AP-2 approval matrix. */
export interface ApprovalTier {
  id: number;
  minAmount: number;
  maxAmount: number | null; // null = no upper bound
  steps: StepType[];
  isActive: boolean;
  sortOrder: number;
}

function mapRow(x: Record<string, unknown>): ApprovalTier {
  return {
    id: x.Id as number,
    minAmount: Number(x.MinAmount ?? 0),
    maxAmount: x.MaxAmount == null ? null : Number(x.MaxAmount),
    steps: parseSteps(x.Steps as string),
    isActive: !!x.IsActive,
    sortOrder: (x.SortOrder as number) ?? 0,
  };
}

export async function listTiers(): Promise<ApprovalTier[]> {
  const pool = await getAccPool();
  const r = await pool.request().query(`
    SELECT Id, MinAmount, MaxAmount, Steps, IsActive, SortOrder
    FROM [dbo].[AccAdvanceApprovalTier] ORDER BY SortOrder, MinAmount`);
  return (r.recordset as Record<string, unknown>[]).map(mapRow);
}

/**
 * The tier an amount falls in: MinAmount <= amount and (MaxAmount is null or
 * amount <= MaxAmount), active only, lowest bound first. Null when none matches.
 */
export async function findTierForAmount(amount: number): Promise<ApprovalTier | null> {
  const pool = await getAccPool();
  const r = await pool.request().input("amt", sql.Decimal(18, 2), amount).query(`
    SELECT TOP 1 Id, MinAmount, MaxAmount, Steps, IsActive, SortOrder
    FROM [dbo].[AccAdvanceApprovalTier]
    WHERE IsActive = 1 AND @amt >= MinAmount AND (MaxAmount IS NULL OR @amt <= MaxAmount)
    ORDER BY MinAmount DESC`);
  return r.recordset.length ? mapRow(r.recordset[0] as Record<string, unknown>) : null;
}

export async function upsertTier(t: {
  id?: number;
  minAmount: number;
  maxAmount: number | null;
  steps: StepType[];
  isActive?: boolean;
  sortOrder?: number;
}): Promise<void> {
  // Config table — dual-write so Production and UAT stay aligned (like AP-1).
  await writeBothPools(async (tx) => {
    const req = tx
      .request()
      .input("min", sql.Decimal(18, 2), t.minAmount)
      .input("max", sql.Decimal(18, 2), t.maxAmount)
      .input("steps", sql.NVarChar, stepsToCsv(t.steps))
      .input("active", sql.Bit, t.isActive === undefined ? 1 : t.isActive ? 1 : 0)
      .input("sort", sql.Int, t.sortOrder ?? 0);
    if (t.id) {
      req.input("id", sql.Int, t.id);
      await req.query(`UPDATE [dbo].[AccAdvanceApprovalTier] SET
        MinAmount=@min, MaxAmount=@max, Steps=@steps, IsActive=@active, SortOrder=@sort,
        UpdatedAt=SYSDATETIME() WHERE Id=@id`);
    } else {
      await req.query(`INSERT INTO [dbo].[AccAdvanceApprovalTier] (MinAmount, MaxAmount, Steps, IsActive, SortOrder)
        VALUES (@min, @max, @steps, @active, @sort)`);
    }
  });
}

export async function deleteTier(id: number): Promise<void> {
  await writeBothPools(async (tx) => {
    await tx.request().input("id", sql.Int, id)
      .query(`DELETE FROM [dbo].[AccAdvanceApprovalTier] WHERE Id=@id`);
  });
}
